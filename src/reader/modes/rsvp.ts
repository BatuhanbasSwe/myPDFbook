/**
 * RSVP (Rapid Serial Visual Presentation, Spritz tarzı) hızlı okumanın kelime işleri: cümleyi kelimelere böler,
 * kelimenin odak harfini (Optimal Recognition Point) ve ekranda kalacağı süreyi bulur. Saf TypeScript; zamanlama
 * hızlı okuma denetleyicisindedir (speedReader.ts, "rsvp" kipi).
 */

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
const LEAD = /^[^\p{L}\p{N}]+/u;
const TRAIL = /[^\p{L}\p{N}]+$/u;

/**
 * Cümlenin kelimeleri: boşluklardan bölünür; tireli bileşik kelime tek kelimedir, uzun tire (—) ayrı bir kelimedir.
 * Yumuşak tireler ve görünmez biçim karakterleri atılır.
 */
export function splitWords(text: string): string[] {
  const out: string[] = [];
  for (const token of text.replace(/\p{Cf}/gu, '').split(/\s+/)) {
    for (const part of token.split(/(—)/)) if (part) out.push(part);
  }
  return out;
}

/**
 * Kelimenin odak harfinin (ORP) konumu. Uzunluğa göre: 1 → 0, 2–5 → 1, 6–9 → 2, 10–13 → 3, daha uzun → 4. Baştaki
 * noktalama ve tırnaklar sayılmaz (konum onlardan sonra başlar); uzunluk sondaki noktalamasız hesaplanır.
 */
export function orpIndex(word: string): number {
  const lead = LEAD.exec(word)?.[0].length ?? 0;
  if (lead >= word.length) return 0;
  const n = word.slice(lead).replace(TRAIL, '').length;
  const k = n <= 1 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : n <= 13 ? 3 : 4;
  return lead + k;
}

/**
 * Kelimenin ekranda kalma süresi (ms, tam hızda): `60000 / wpm`; cümle sonunda (. ! ? …) ×2, virgül, noktalı virgül
 * ve iki noktada ×1,5; uzun kelimede (8 harften uzun) ya da sayıda ayrıca ×1,3.
 */
export function wordDuration(word: string, wpm: number): number {
  let f = 1;
  if (SENTENCE_END.test(word)) f *= SENTENCE_END_FACTOR;
  else if (CLAUSE_END.test(word)) f *= CLAUSE_FACTOR;
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
