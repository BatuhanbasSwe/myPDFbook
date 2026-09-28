/**
 * RSVP (Rapid Serial Visual Presentation, Spritz tarzı) hızlı okumanın kelime işleri: cümleyi kelimelere böler,
 * kelimenin odak harfini (Optimal Recognition Point) ve ekranda kalacağı süreyi bulur. Saf TypeScript; zamanlama
 * hızlı okuma denetleyicisindedir (speedReader.ts, "rsvp" kipi).
 */
import { isAbbreviation } from '../../text/sentences';

/** Dakikada kelime (RSVP) */
export const RSVP_WPM_RANGE = { min: 100, max: 1000, default: 300 } as const;
export const RSVP_WPM_CHOICES = [200, 250, 300, 350, 400, 500, 600, 800] as const;

/** "Yavaş başla": oynatınca ya da duraklatıp sürdürünce ilk bu kadar kelime bu hızdan (oran) başlayıp tam hıza çıkar */
export const RAMP_WORDS = 3;
export const RAMP_FROM = 0.6;

/** Süre çarpanları: cümle sonu, virgül ve benzeri, uzun kelime ya da sayı */
export const SENTENCE_END_FACTOR = 2;
export const CLAUSE_FACTOR = 1.5;
export const LONG_WORD_FACTOR = 1.3;
/** Bundan uzun kelime (harf ve rakam sayısı) uzun sayılır */
export const LONG_WORD = 8;

/** Kapanış tırnağı ve parantezi: noktalamanın ardından gelebilir ("dedi." ya da "dedi.”") */
const CLOSERS = `"'”’»)\\]`;
const SENTENCE_END = new RegExp(`[.!?…][${CLOSERS}]*$`, 'u');
const CLAUSE_END = new RegExp(`[,;:][${CLOSERS}]*$`, 'u');
/** Harf ya da rakam içeren (okunan) parça */
const WORDLIKE = /[\p{L}\p{N}]/u;
/** Yalnızca kapanış işaretlerinden oluşan parça: önceki kelimeye bağlanır ("Tamam ”", "Bekle …") */
const CLOSING_ONLY = /^[\p{Pe}\p{Pf}.,;:!?…]+$/u;

/**
 * Cümlenin kelimeleri: boşluklardan bölünür; tireli bileşik kelime tek kelimedir. Yalnızca noktalamadan oluşan parça
 * tek başına gösterilmez: konuşma çizgisi (– ya da —, kelimeye bitişik uzun tire de) ve açılış tırnağı sonraki
 * kelimeye ("— Nereye"), kapanış tırnağı, üç nokta ve bitiş işareti önceki kelimeye bağlanır ("Tamam ”"); sonraki
 * kelime yoksa öncekine. Aradaki boşluk korunur (tek boşluk olarak). Yumuşak tireler ve görünmez biçim karakterleri
 * atılır.
 */
export function splitWords(text: string): string[] {
  const out: string[] = [];
  /** sonraki kelimeye bağlanacak noktalama (ardındaki boşlukla) */
  let pending = '';
  for (const token of text.replace(/\p{Cf}/gu, '').split(/\s+/)) {
    const parts = token.split(/(—)/).filter(Boolean);
    parts.forEach((part, i) => {
      // parçadan sonra boşluk var mı (kelimenin son parçasıysa)
      const gap = i === parts.length - 1 ? ' ' : '';
      if (WORDLIKE.test(part)) {
        out.push(pending + part);
        pending = '';
      } else if (CLOSING_ONLY.test(part) && out.length > 0 && !pending)
        out[out.length - 1] += ` ${part}`;
      else pending += part + gap;
    });
  }
  const rest = pending.trimEnd();
  if (rest) {
    if (out.length > 0) out[out.length - 1] += ` ${rest}`;
    else out.push(rest);
  }
  return out;
}

/** Görünen harfler (grafemler): birleşik işaretli harf ("ş" = s + çengel) tek harftir */
const graphemer =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

function graphemes(s: string): string[] {
  return graphemer ? Array.from(graphemer.segment(s), (g) => g.segment) : Array.from(s);
}

/**
 * Kelimenin odak harfinin (ORP) yeri (kod birimi olarak [start, end): harf birden çok kod biriminden oluşabilir).
 * Uzunluğa göre (görünen harf sayısı): 1 → 1., 2–5 → 2., 6–9 → 3., 10–13 → 4., daha uzun → 5. harf. Baştaki
 * noktalama, tırnak ve konuşma çizgisi sayılmaz (konum onlardan sonra başlar); uzunluk sondaki noktalamasız
 * hesaplanır.
 */
export function orpRange(word: string): { start: number; end: number } {
  const g = graphemes(word);
  if (g.length === 0) return { start: 0, end: 0 };
  let lead = 0;
  while (lead < g.length && !WORDLIKE.test(g[lead])) lead++;
  let at = 0;
  if (lead < g.length) {
    let tail = g.length;
    while (tail > lead && !WORDLIKE.test(g[tail - 1])) tail--;
    const n = tail - lead;
    at = lead + (n <= 1 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : n <= 13 ? 3 : 4);
  }
  const start = g.slice(0, at).join('').length;
  return { start, end: start + g[at].length };
}

/** Odak harfinin başladığı kod birimi (bkz. orpRange) */
export function orpIndex(word: string): number {
  return orpRange(word).start;
}

/**
 * Kelimenin ekranda kalma süresi (ms, tam hızda): `60000 / wpm`; cümle sonunda (. ! ? …) ×2, virgül, noktalı virgül
 * ve iki noktada ×1,5; uzun kelimede (8 harften uzun) ya da sayıda ayrıca ×1,3. `next` cümlenin sonraki kelimesidir
 * (son kelimede verilmez): nokta bir kısaltmanın ("Dr.", "vb.", "A.", "2.") ise cümle sonu sayılmaz.
 */
export function wordDuration(word: string, wpm: number, next?: string): number {
  let f = 1;
  if (SENTENCE_END.test(word)) {
    if (next === undefined || !word.endsWith('.') || !isAbbreviation(word, next))
      f *= SENTENCE_END_FACTOR;
  } else if (CLAUSE_END.test(word)) f *= CLAUSE_FACTOR;
  if (word.replace(/[^\p{L}\p{N}]/gu, '').length > LONG_WORD || /\p{N}/u.test(word))
    f *= LONG_WORD_FACTOR;
  return (60_000 / wpm) * f;
}

/** "Yavaş başla": oynatmadan sonraki `step`. kelimenin hız oranı (0'dan; RAMP_WORDS ve sonrası tam hız) */
export function rampSpeed(step: number): number {
  if (step >= RAMP_WORDS) return 1;
  return RAMP_FROM + ((1 - RAMP_FROM) * Math.max(0, step)) / RAMP_WORDS;
}

export function clampRsvpWpm(w: number): number {
  if (!Number.isFinite(w)) return RSVP_WPM_RANGE.default;
  return Math.min(RSVP_WPM_RANGE.max, Math.max(RSVP_WPM_RANGE.min, Math.round(w)));
}

/**
 * Cümle sayfa sınırından taşıyorsa (ilk sayfadaki payı `split`, 0–1) son parçanın başladığı kelime: kelimelerin
 * harf sayısına göre. Taşmıyorsa null.
 */
export function splitWord(words: string[], split: number | null): number | null {
  if (split === null || !(split > 0 && split < 1) || words.length < 2) return null;
  const total = words.reduce((n, w) => n + w.length, 0);
  let before = 0;
  for (let i = 0; i < words.length; i++) {
    if (i > 0 && before / total >= split) return i;
    before += words[i].length;
  }
  return null;
}
