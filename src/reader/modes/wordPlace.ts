import { normalizeForSearch, type MatchPart } from '../../text/pageGeometry';

/** Normalleştirilmiş cümle uzunluğu (her kelimede yeniden hesaplanmasın) */
const needleCache = new Map<string, number>();

function needleLength(text: string): number {
  let n = needleCache.get(text);
  if (n === undefined) {
    n = normalizeForSearch(text).length;
    if (needleCache.size > 64) needleCache.clear();
    needleCache.set(text, n);
  }
  return n;
}

/**
 * Okunan kelimenin sayfa görünümündeki yeri (Plan 14): kelimenin cümle metnindeki [start, end) aralığı, cümlenin bu
 * sayfadaki parçasının (`part`: harf haritasındaki [start, end)) içinde harf haritasındaki aralığa çevrilir. Harita
 * metni `normalizeForSearch` biçimindedir: cümle metninin kelimeden önceki kısmı normalleştirilip sayılır. Son parçada
 * (`tail`: cümlenin başı önceki sayfada) sayfada olmayan baş kısım düşülür. Kelime parçada değilse ya da harfi yoksa
 * null.
 */
export function wordPageRange(
  part: { part: MatchPart; start: number; end: number },
  text: string,
  start: number,
  end: number,
): [number, number] | null {
  const a = normalizeForSearch(text.slice(0, start)).length;
  const b = a + normalizeForSearch(text.slice(start, end)).length;
  if (b <= a) return null;
  const shift = part.part === 'tail' ? needleLength(text) - (part.end - part.start) : 0;
  const s = Math.max(part.start, part.start + a - shift);
  const e = Math.min(part.end, part.start + b - shift);
  return e > s ? [s, e] : null;
}
