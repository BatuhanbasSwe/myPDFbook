import type { Block, Chapter, OutlineEntry } from './types';

const norm = (t: string) => t.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]+/gu, '');

/** Bölümler: PDF içindekiler varsa ondan, yoksa başlık bloklarından. */
export function buildChapters(blocks: Block[], outline: OutlineEntry[]): Chapter[] {
  const fromOutline = chaptersFromOutline(blocks, outline);
  return fromOutline.length ? fromOutline : chaptersFromHeadings(blocks);
}

function chaptersFromOutline(blocks: Block[], outline: OutlineEntry[]): Chapter[] {
  const used = new Set<number>();
  const chapters: Chapter[] = [];
  for (const o of outline) {
    if (o.level > 2) continue;
    const headingOnPage = (b: Block, i: number) => b.kind === 'heading' && b.srcPage === o.pageIndex && !used.has(i);
    let idx = blocks.findIndex((b, i) => headingOnPage(b, i) && b.kind === 'heading' && norm(b.text) === norm(o.title));
    if (idx < 0) idx = blocks.findIndex(headingOnPage);
    if (idx < 0) idx = blocks.findIndex((b) => b.srcPage >= o.pageIndex);
    if (idx < 0 || used.has(idx)) continue;
    used.add(idx);
    chapters.push({ title: o.title, block: idx, level: o.level });
  }
  return chapters.sort((a, b) => a.block - b.block);
}

function chaptersFromHeadings(blocks: Block[]): Chapter[] {
  const chapters: Chapter[] = [];
  blocks.forEach((b, i) => {
    if (b.kind !== 'heading') return;
    const last = chapters[chapters.length - 1];
    // "BİRİNCİ BÖLÜM" + alt başlık "Sisli Sabah" → tek bölüm adı
    if (b.level === 2 && last && last.block === i - 1) {
      last.title = `${last.title} — ${b.text}`;
      return;
    }
    chapters.push({ title: b.text, block: i, level: b.level });
  });
  return chapters;
}
