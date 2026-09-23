import { buildBlocks } from './blocks';
import { buildChapters } from './chapters';
import { extractLines } from './extractLines';
import { bodyFontSize, stripPageFurniture } from './furniture';
import { countWords, detectLanguage, needsTurkishRepair, repairTurkish } from './text';
import { CONVERTER_VERSION, type BookContent, type PageLines, type PdfSource } from './types';

export interface ConvertOptions {
  /** 0..1 arası ilerleme */
  onProgress?: (fraction: number) => void;
}

/** Bu kadar karakterden az metni olan sayfa "metinsiz" adayıdır (görsel ya da boş sayfa). */
const TEXTLESS_CHARS = 30;

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function convertPdf(src: PdfSource, opts: ConvertOptions = {}): Promise<BookContent> {
  const pages: PageLines[] = [];
  for (let i = 0; i < src.numPages; i++) {
    pages.push(extractLines(i, await src.getPageText(i)));
    opts.onProgress?.(((i + 1) / src.numPages) * 0.95);
    if (i % 8 === 7) await yieldToEventLoop(); // arayüz donmasın
  }

  const sample = pages
    .flatMap((p) => p.lines.map((l) => l.text))
    .join(' ')
    .slice(0, 200_000);
  const repair = needsTurkishRepair(sample);
  if (repair) {
    for (const p of pages) for (const l of p.lines) l.text = repairTurkish(l.text);
  }

  // Metinsiz sayfalar: kitabın çoğu metinsizse taranmıştır; değilse yalnızca resim içerenler görsel olur (boş sayfalar atlanır).
  const chars = pages.map((p) => p.lines.reduce((n, l) => n + l.text.replace(/\s/g, '').length, 0));
  const candidates = chars.flatMap((n, i) => (n < TEXTLESS_CHARS ? [i] : []));
  const scanned = candidates.length > src.numPages * 0.5;
  const textless = new Set<number>();
  for (const i of candidates) if (scanned || (await src.hasImages(i))) textless.add(i);

  const body = bodyFontSize(pages.filter((p) => !textless.has(p.pageIndex)));
  const blocks = buildBlocks(stripPageFurniture(pages, body), body, textless);
  const outline = (await src.getOutline()).map((o) => (repair ? { ...o, title: repairTurkish(o.title) } : o));
  const chapters = buildChapters(blocks, outline);
  const paras = blocks.flatMap((b) => (b.kind === 'para' ? [b.text] : []));
  const totalWords = blocks.reduce((n, b) => n + ('text' in b ? countWords(b.text) : 0), 0);

  opts.onProgress?.(1);
  return {
    version: CONVERTER_VERSION,
    lang: detectLanguage(paras.slice(0, 80).join(' ')),
    blocks,
    chapters,
    textlessPages: [...textless].sort((a, b) => a - b),
    totalWords,
  };
}
