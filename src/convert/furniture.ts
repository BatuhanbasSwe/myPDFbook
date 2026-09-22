import type { PageLines } from './types';

const PAGE_NUMBER = /^[\s\-–—.([]*(\d{1,4}|[ivxlcdm]{1,7})[\s\-–—.)\]]*$/i;
const PAGE_LABEL = /^(sayfa|page|s\.)\s*\d{1,4}$/i;
const TOP_ZONE = 0.12;
const BOTTOM_ZONE = 0.1;

/** Kitabın gövde puntosu: en çok karakterin yazıldığı punto (0,5 pt hassasiyetle). */
export function bodyFontSize(pages: PageLines[]): number {
  const chars = new Map<number, number>();
  for (const p of pages) {
    for (const l of p.lines) {
      const key = Math.round(l.size * 2) / 2;
      chars.set(key, (chars.get(key) ?? 0) + l.text.length);
    }
  }
  let best = 10;
  let bestCount = -1;
  for (const [size, count] of chars) {
    if (count > bestCount) {
      best = size;
      bestCount = count;
    }
  }
  return best;
}

function furnitureKey(text: string, isTop: boolean): string {
  const norm = text
    .toLocaleLowerCase('tr')
    .replace(/\d+/g, '#')
    .replace(/[^\p{L}#]+/gu, ' ')
    .trim();
  return `${isTop ? 'T' : 'B'}:${norm}`;
}

/** Sayfa numaralarını, 3+ sayfada tekrar eden üst/alt bilgileri (filigran dahil) ve küçük puntolu sayfa başlıklarını çıkarır. */
export function stripPageFurniture(pages: PageLines[], bodySize: number): PageLines[] {
  // Aday: sayfanın ilk/son iki satırından üst ya da alt bölgede olanlar
  const candidates = pages.map((p) => {
    const n = p.lines.length;
    return [...new Set([0, 1, n - 2, n - 1])].filter((i) => {
      const l = p.lines[i];
      return l !== undefined && (l.y >= p.height * (1 - TOP_ZONE) || l.y <= p.height * BOTTOM_ZONE);
    });
  });

  const counts = new Map<string, number>();
  pages.forEach((p, pi) => {
    for (const i of candidates[pi]) {
      const l = p.lines[i];
      const key = furnitureKey(l.text, l.y > p.height / 2);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  });

  return pages.map((p, pi) => {
    const remove = new Set<number>();
    for (const i of candidates[pi]) {
      const l = p.lines[i];
      const text = l.text.trim();
      const isTop = l.y > p.height / 2;
      const key = furnitureKey(text, isTop);
      if (PAGE_NUMBER.test(text) || PAGE_LABEL.test(text)) remove.add(i);
      else if ((counts.get(key) ?? 0) >= 3 && key.length > 7) remove.add(i);
      else if (isTop && i <= 1 && l.size <= bodySize * 0.92 && text.length <= 80) remove.add(i);
    }
    return remove.size ? { ...p, lines: p.lines.filter((_, i) => !remove.has(i)) } : p;
  });
}
