import type { Block, Chapter, OutlineEntry } from './types';

const norm = (t: string) => t.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Bölümler: PDF içindekiler kitabın başlıklarına gerçekten oturuyorsa ondan, yoksa başlık bloklarından.
 * ("Kapak" gibi tek girişli içindekiler, başlıklardan bulunan gerçek bölümleri gölgelemesin.)
 */
export function buildChapters(blocks: Block[], outline: OutlineEntry[]): Chapter[] {
  const fromOutline = chaptersFromOutline(blocks, outline);
  const fromHeadings = chaptersFromHeadings(blocks);
  const onHeadings = fromOutline.filter((c) => blocks[c.block]?.kind === 'heading').length;
  if (
    fromOutline.length &&
    (onHeadings >= 2 || fromOutline.length >= fromHeadings.length) &&
    !outlineStopsEarly(blocks, outline, fromHeadings)
  )
    return fromOutline;
  return fromHeadings;
}

/**
 * İçindekiler kitabın yalnızca başını kapsıyor (kapak, künye, yazar adı gibi birkaç giriş) ama başlıklar
 * sonrasında da bölümler buluyor: o zaman başlıklardan çıkan liste daha doğrudur.
 */
function outlineStopsEarly(
  blocks: Block[],
  outline: OutlineEntry[],
  fromHeadings: Chapter[],
): boolean {
  const lastPage = blocks[blocks.length - 1]?.srcPage ?? 0;
  const span = Math.max(...outline.map((o) => o.pageIndex));
  const later = fromHeadings.filter(
    (c) => c.level === 1 && (blocks[c.block]?.srcPage ?? 0) > span,
  ).length;
  return span < lastPage * 0.5 && later >= 2;
}

function chaptersFromOutline(blocks: Block[], outline: OutlineEntry[]): Chapter[] {
  const used = new Set<number>();
  const chapters: Chapter[] = [];
  for (const o of outline) {
    if (o.level > 2) continue;
    const headingOnPage = (b: Block, i: number) =>
      b.kind === 'heading' && b.srcPage === o.pageIndex && !used.has(i);
    let idx = blocks.findIndex(
      (b, i) => headingOnPage(b, i) && b.kind === 'heading' && norm(b.text) === norm(o.title),
    );
    if (idx < 0) idx = blocks.findIndex(headingOnPage);
    if (idx < 0) idx = blocks.findIndex((b, i) => b.srcPage >= o.pageIndex && !used.has(i));
    if (idx < 0) continue;
    used.add(idx);
    chapters.push({ title: o.title, block: idx, level: o.level });
  }
  return chapters.sort((a, b) => a.block - b.block);
}

function chaptersFromHeadings(blocks: Block[]): Chapter[] {
  const chapters: Chapter[] = [];
  let chainEnd = -1;
  blocks.forEach((b, i) => {
    if (b.kind !== 'heading') return;
    const last = chapters[chapters.length - 1];
    // "BİRİNCİ BÖLÜM" + hemen ardından gelen alt başlık(lar) "Sisli Sabah" → tek bölüm adı
    if (b.level === 2 && last && chainEnd === i - 1) {
      last.title = `${last.title} — ${b.text}`;
      chainEnd = i;
      return;
    }
    chapters.push({ title: b.text, block: i, level: b.level });
    chainEnd = i;
  });
  return chapters;
}
