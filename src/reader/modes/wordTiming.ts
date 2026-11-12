/**
 * Sesli okumada okunan kelime (Plan 14): cümlenin kelimeleri, kelimelerin süre ağırlıkları ve zamandan ya da
 * motorun kelime sınırından (charIndex) kelime. Saf; Node'da test edilir.
 *
 * Süre ağırlığı: kelimenin harf ve rakam sayısı + 1 (kısa kelime de zaman alır); ardından gelen noktalama
 * duraklamadır ve kelimeye eklenir (duraklama sırasında kelime vurgulu kalır): virgül, noktalı virgül, iki nokta,
 * tire kısa; nokta, ünlem, soru, üç nokta uzun.
 */

/** Metindeki kelime: [start, end) */
export interface WordSpan {
  start: number;
  end: number;
}

const LETTER = /[\p{L}\p{N}]/u;
const SHORT_PAUSE = /[,;:—–-]/u;
const LONG_PAUSE = /[.!?…]/u;
/** Kelimenin ardından gelen duraklamanın ağırlığı (harf cinsinden) */
export const SHORT_PAUSE_WEIGHT = 3;
export const LONG_PAUSE_WEIGHT = 6;
/** Sistem sesinin tahmini hızı (ağırlık birimi / sn, hız 1'de): Türkçe ve İngilizce sesler ~12–16 harf/sn */
export const DEFAULT_CPS = 14;

/** Boşlukla ayrılan kelimeler (noktalama ve kesme işareti kelimenin içindedir) */
export function speechWords(text: string): WordSpan[] {
  const out: WordSpan[] = [];
  const re = /\S+/gu;
  for (let m = re.exec(text); m; m = re.exec(text))
    out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

/** Kelimelerin süre ağırlıkları (bkz. dosyanın açıklaması) */
export function wordWeights(text: string, words: readonly WordSpan[]): number[] {
  return words.map(({ start, end }) => {
    let letters = 0;
    for (const ch of text.slice(start, end)) if (LETTER.test(ch)) letters++;
    // Kelimenin sonundaki noktalama (tırnak, parantez de olabilir: '"Gel."')
    let k = end;
    while (k > start && !LETTER.test(text[k - 1])) k--;
    const tail = text.slice(k, end);
    const pause = LONG_PAUSE.test(tail)
      ? LONG_PAUSE_WEIGHT
      : SHORT_PAUSE.test(tail)
        ? SHORT_PAUSE_WEIGHT
        : 0;
    return (letters > 0 ? letters + 1 : 0) + pause;
  });
}

/** Sürenin `fraction` payında okunan kelime (ağırlıklara göre); kelime yoksa -1 */
export function wordAtFraction(weights: readonly number[], fraction: number): number {
  if (weights.length === 0) return -1;
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(fraction > 0) || total <= 0) return 0;
  const target = Math.min(1, fraction) * total;
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += weights[i];
    if (target < sum) return i;
  }
  return weights.length - 1;
}

/**
 * Konuşmadaki konumun kelimesi (Web Speech `boundary` olayının `charIndex`i): konum bir kelimenin içindeyse o, iki
 * kelime arasındaysa sonraki, metnin sonundaysa son kelime. Kelime yoksa -1.
 */
export function wordAtChar(words: readonly WordSpan[], charIndex: number): number {
  if (words.length === 0) return -1;
  // İkili arama: `end`i konumdan büyük ilk kelime
  let lo = 0;
  let hi = words.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].end > charIndex) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Konuşmanın tahmini süresi (sn): ağırlık / (harf/sn × hız) */
export function estimateSeconds(weight: number, rate: number, cps = DEFAULT_CPS): number {
  const r = rate > 0 ? rate : 1;
  const c = cps > 0 ? cps : DEFAULT_CPS;
  return Math.max(0.2, weight / (c * r));
}

/** Kelimenin baş ve sonundaki noktalama atılır (vurgu harflerde); kelimede harf yoksa olduğu gibi */
export function trimWord(text: string, w: WordSpan): WordSpan {
  let { start, end } = w;
  while (start < end && !LETTER.test(text[start])) start++;
  while (end > start && !LETTER.test(text[end - 1])) end--;
  return start < end ? { start, end } : w;
}
