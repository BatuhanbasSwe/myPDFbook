import type { Line, PageLines, PageText, RawTextItem } from './types';

interface Positioned {
  str: string;
  x: number;
  y: number;
  w: number;
  size: number;
}

const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;

function toPositioned(item: RawTextItem): Positioned | null {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform;
  // döndürülmüş (dikey) metin kitap akışına ait değildir
  if (Math.abs(a) < 1e-6 || Math.abs(b) > Math.abs(a) * 0.1) return null;
  const str = item.str.replace(INVISIBLE, '').replace(/\u00A0/g, ' ');
  if (str.trim() === '') return null;
  const size = Math.hypot(c, d) || item.height;
  if (!(size > 0)) return null;
  return { str, x: e, y: f, w: item.width, size };
}

function buildLine(group: Positioned[]): Line | null {
  group.sort((p, q) => p.x - q.x);
  let text = '';
  let end = -Infinity;
  let dominant = group[0];
  for (const it of group) {
    // aradaki boşluk yazı boyunun %15'inden büyükse kelime arasıdır; değilse aynı kelimenin parçasıdır
    if (
      text !== '' &&
      it.x - end > 0.15 * it.size &&
      !text.endsWith(' ') &&
      !it.str.startsWith(' ')
    ) {
      text += ' ';
    }
    text += it.str;
    end = Math.max(end, it.x + it.w);
    if (it.str.length > dominant.str.length) dominant = it;
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  return { text, x0: group[0].x, x1: end, y: dominant.y, size: dominant.size };
}

/** pdf.js metin parçalarını taban çizgisine göre satırlara toplar (yukarıdan aşağıya). */
export function extractLines(pageIndex: number, page: PageText): PageLines {
  const items = page.items.map(toPositioned).filter((p): p is Positioned => p !== null);
  items.sort((p, q) => q.y - p.y || p.x - q.x);
  const groups: Positioned[][] = [];
  for (const it of items) {
    const group = groups[groups.length - 1];
    const ref = group?.[0];
    if (group && ref && Math.abs(ref.y - it.y) <= 0.5 * Math.max(ref.size, it.size)) group.push(it);
    else groups.push([it]);
  }
  const lines = groups.map((g) => buildLine(g)).filter((l): l is Line => l !== null);
  return { pageIndex, width: page.width, height: page.height, lines };
}
