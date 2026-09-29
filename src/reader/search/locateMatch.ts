import type { Block } from '../../convert/types';
import type { PdfDocument } from '../../pdf/pdfjs';
import { createPdfSource } from '../../pdf/pdfSource';
import {
  findInContext,
  findTextRects,
  pageCharMap,
  type PageCharMap,
  type TextMatch,
} from '../../text/pageGeometry';

/** Aranan yerin blok metnindeki aralığı */
export interface BlockSpan {
  block: number;
  start: number;
  end: number;
}

/** Eşleşmenin PDF sayfasındaki yeri */
export interface LocatedMatch {
  /** PDF sayfası (0'dan) */
  page: number;
  match: TextMatch;
}

/** Bellekte tutulan sayfa haritası sayısı (en eskisi atılır) */
const MAP_CACHE = 12;
/** Eşleşme bloğun başladığı sayfadan en çok bu kadar sayfa ötede aranır (çok uzun paragraf) */
const MAX_SPAN = 30;
/** Bağlam için eşleşmenin önünden ve ardından alınan karakter (harf olmayanlar da sayılır) */
const CONTEXT_CHARS = 48;

const maps = new WeakMap<PdfDocument, Map<number, Promise<PageCharMap>>>();
const sources = new WeakMap<PdfDocument, ReturnType<typeof createPdfSource>>();

/** Sayfanın aranabilir haritası (belge başına önbellekli; okunamayan sayfa sonra yeniden denenir) */
function pageMap(pdf: PdfDocument, page: number): Promise<PageCharMap> {
  let byPage = maps.get(pdf);
  if (!byPage) maps.set(pdf, (byPage = new Map()));
  const cached = byPage.get(page);
  if (cached) return cached;
  let source = sources.get(pdf);
  if (!source) sources.set(pdf, (source = createPdfSource(pdf, { glyphAdvances: true })));
  const p = source.getPageText(page).then(pageCharMap);
  const cache = byPage;
  p.catch(() => cache.delete(page));
  cache.set(page, p);
  if (cache.size > MAP_CACHE) cache.delete(cache.keys().next().value as number);
  return p;
}

/**
 * Arama sonucunun PDF sayfasındaki yeri: bloğun başladığı sayfadan sonraki bloğun sayfasına dek, önce bağlamıyla
 * (aynı kelimenin öteki geçişleri karışmasın), bulunamazsa bağlamsız aranır. Bulunamazsa null.
 */
export async function locateMatch(
  pdf: PdfDocument,
  blocks: Block[],
  span: BlockSpan,
): Promise<LocatedMatch | null> {
  const b = blocks[span.block];
  const pageCount = pdf.numPages;
  if (!b || !('text' in b) || pageCount === 0) return null;
  const first = Math.min(pageCount - 1, Math.max(0, b.srcPage));
  const next = blocks[span.block + 1]?.srcPage ?? first;
  const last = Math.min(pageCount - 1, Math.max(first, next), first + MAX_SPAN);
  const text = b.text.slice(span.start, span.end);
  const before = b.text.slice(Math.max(0, span.start - CONTEXT_CHARS), span.start);
  const after = b.text.slice(span.end, span.end + CONTEXT_CHARS);

  const pages: PageCharMap[] = [];
  for (let p = first; p <= last; p++) {
    const map = await pageMap(pdf, p).catch(() => null);
    pages.push(map ?? pageCharMap({ width: 1, height: 1, items: [] }));
    const m = map && findInContext(map, before, text, after, false);
    if (m) return { page: p, match: m };
  }
  // Bağlamla bulunamadı: bağlamsız (tamamı, yoksa sayfa sınırında bölünen parçası)
  let partial: LocatedMatch | null = null;
  for (let k = 0; k < pages.length; k++) {
    const m = findTextRects(pages[k], text);
    if (m?.part === 'whole') return { page: first + k, match: m };
    if (m && !partial) partial = { page: first + k, match: m };
  }
  return partial;
}
