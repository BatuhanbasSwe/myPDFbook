import { describe, expect, it } from 'vitest';
import { speakable, speakableMap } from '../../src/reader/modes/readAloud';
import {
  estimateSeconds,
  speechWords,
  trimWord,
  wordAtChar,
  wordAtFraction,
  wordWeights,
} from '../../src/reader/modes/wordTiming';

const words = (text: string) => speechWords(text).map((w) => text.slice(w.start, w.end));

describe('kelime zamanlaması', () => {
  it('kelimeler boşlukla ayrılır; noktalama ve kesme işareti kelimeyi bölmez', () => {
    expect(words("  Türkiye'nin başkenti, Ankara'dır.  ")).toEqual([
      "Türkiye'nin",
      'başkenti,',
      "Ankara'dır.",
    ]);
    expect(speechWords('')).toEqual([]);
    expect(speechWords('   ')).toEqual([]);
  });

  it('ağırlık: harf sayısı + 1; virgülden sonra kısa, noktadan sonra uzun duraklama', () => {
    const text = 'Bir, iki. Üç';
    const w = wordWeights(text, speechWords(text));
    // "Bir," 3 harf + 1 + virgül 3; "iki." 3 + 1 + nokta 6; "Üç" 2 + 1
    expect(w).toEqual([7, 10, 3]);
    // Tırnak ya da parantezle biten cümle sonu da uzun duraklama
    const quoted = '"Gel." dedi';
    expect(wordWeights(quoted, speechWords(quoted))[0]).toBe(3 + 1 + 6);
    // Soru, ünlem, üç nokta da cümle sonu; noktalı virgül ve iki nokta kısa duraklama
    for (const [t, pause] of [
      ['a?', 6],
      ['a!', 6],
      ['a…', 6],
      ['a;', 3],
      ['a:', 3],
      ['a —', 3],
    ] as const)
      expect(wordWeights(t, speechWords(t)).reduce((x, y) => x + y)).toBe(1 + 1 + pause);
  });

  it('zamanın payından kelime: ağırlığa göre; sınırlar ilk ve son kelime', () => {
    const weights = [7, 10, 3]; // toplam 20
    expect(wordAtFraction(weights, -1)).toBe(0);
    expect(wordAtFraction(weights, 0)).toBe(0);
    expect(wordAtFraction(weights, 0.34)).toBe(0);
    expect(wordAtFraction(weights, 0.36)).toBe(1);
    expect(wordAtFraction(weights, 0.84)).toBe(1);
    expect(wordAtFraction(weights, 0.86)).toBe(2);
    expect(wordAtFraction(weights, 1)).toBe(2);
    expect(wordAtFraction(weights, 5)).toBe(2);
    expect(wordAtFraction(weights, Number.NaN)).toBe(0);
    expect(wordAtFraction([], 0.5)).toBe(-1);
  });

  it('kelime sınırı (charIndex) → kelime: aradaki boşluk sonraki kelimeye, metnin sonu son kelimeye', () => {
    const text = 'Bir iki  üç';
    const list = speechWords(text);
    expect(wordAtChar(list, 0)).toBe(0);
    expect(wordAtChar(list, 2)).toBe(0);
    expect(wordAtChar(list, 3)).toBe(1); // boşluk
    expect(wordAtChar(list, 4)).toBe(1);
    expect(wordAtChar(list, 7)).toBe(2); // iki boşluk
    expect(wordAtChar(list, 9)).toBe(2);
    expect(wordAtChar(list, 99)).toBe(2);
    expect(wordAtChar(list, -5)).toBe(0);
    expect(wordAtChar([], 0)).toBe(-1);
  });

  it('süre tahmini: ağırlık / (harf/sn × hız)', () => {
    expect(estimateSeconds(28, 1, 14)).toBe(2);
    expect(estimateSeconds(28, 2, 14)).toBe(1);
    // Bozuk değerlerde de pozitif bir süre
    expect(estimateSeconds(28, 0, 14)).toBeGreaterThan(0);
    expect(estimateSeconds(0, 1, 14)).toBeGreaterThan(0);
  });

  it('kelimenin baş ve sonundaki noktalama vurgulanmaz (yalnızca noktalamaysa olduğu gibi)', () => {
    const text = '«Merhaba,» dedi —';
    const [a, b, c] = speechWords(text);
    expect(text.slice(...span(trimWord(text, a)))).toBe('Merhaba');
    expect(text.slice(...span(trimWord(text, b)))).toBe('dedi');
    expect(text.slice(...span(trimWord(text, c)))).toBe('—');
  });
});

const span = (w: { start: number; end: number }) => [w.start, w.end] as const;

describe('okunan metin eşlemesi', () => {
  it('okunan metnin her harfinin cümle metnindeki yeri: dipnot imleri, görünmez karakterler ve baştaki boşluk atlanır', () => {
    const raw = '  Kitap¹ okun­du.† ';
    const { text, map } = speakableMap(raw);
    expect(text).toBe('Kitap okundu.');
    expect(text).toBe(speakable(raw));
    // "okundu" okunan metinde 6. harfte başlar, cümle metninde 9.
    expect(map[text.indexOf('okundu')]).toBe(raw.indexOf('okun'));
    // yumuşak tireden sonraki harf
    expect(map[text.indexOf('du')]).toBe(raw.indexOf('du'));
    // metnin sonu: son harfin ardı
    expect(map[text.length]).toBe(raw.indexOf('.') + 1);
  });

  it('BMP dışı harfler (emoji) iki kod birimi sayılır', () => {
    const raw = 'a 😀 b';
    const { text, map } = speakableMap(raw);
    expect(text).toBe(raw);
    expect(map[text.indexOf('b')]).toBe(raw.indexOf('b'));
  });
});
