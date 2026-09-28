import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clampRsvpWpm,
  orpIndex,
  orpRange,
  rampSpeed,
  splitWord,
  splitWords,
  wordDuration,
} from '../../src/reader/modes/rsvp';
import { createSpeedReader, type SpeedReaderOptions } from '../../src/reader/modes/speedReader';

describe('orpIndex', () => {
  it('uzunluğa göre odak harfi', () => {
    expect(orpIndex('a')).toBe(0);
    expect(orpIndex('ev')).toBe(1);
    expect(orpIndex('kitap')).toBe(1);
    expect(orpIndex('kitapçı')).toBe(2); // 7
    expect(orpIndex('kitaplığı')).toBe(2); // 9
    expect(orpIndex('kütüphanede')).toBe(3); // 11
    expect(orpIndex('kütüphanelerden')).toBe(4); // 15
  });

  it('baştaki noktalama ve tırnak sayılmaz, sondaki uzunluğa katılmaz', () => {
    expect(orpIndex('“Işıklar')).toBe(3); // “ + 7 harf → 1 + 2
    expect(orpIndex('(ev')).toBe(2);
    expect(orpIndex('ev,')).toBe(1);
    expect(orpIndex('kitap.”')).toBe(1);
    expect(orpIndex('—')).toBe(0);
    expect(orpIndex('')).toBe(0);
    // konuşma çizgisi kelimeye bağlı: çizgi ve boşluk sayılmaz
    expect(orpIndex('— Nereye')).toBe(4);
  });

  it('harfler görünen harf (grafem) olarak sayılır: birleşik işaretli harf tek harftir', () => {
    // "aşkım" ayrışık yazılmış (s + çengel): 5 harf, 6 kod birimi
    const word = 'aşkım';
    expect(orpIndex(word)).toBe(1);
    expect(orpRange(word)).toEqual({ start: 1, end: 3 });
    expect(orpRange('kitap')).toEqual({ start: 1, end: 2 });
    expect(orpRange('')).toEqual({ start: 0, end: 0 });
  });
});

describe('splitWords', () => {
  it('boşluklardan böler; tireli bileşik tek kelime, uzun tire sonraki kelimeye bağlanır', () => {
    expect(splitWords('— Nereye gidiyorsun? dedi annesi.')).toEqual([
      '— Nereye',
      'gidiyorsun?',
      'dedi',
      'annesi.',
    ]);
    expect(splitWords('dedi—ve  Türk-İslam\nsentezi')).toEqual([
      'dedi',
      '—ve',
      'Türk-İslam',
      'sentezi',
    ]);
  });

  it('yalnızca noktalamadan oluşan parça tek başına gösterilmez', () => {
    // konuşma çizgisi (– ya da —) ve açılış tırnağı sonraki kelimeye
    expect(splitWords('– Evet, dedi. “ Tamam')).toEqual(['– Evet,', 'dedi.', '“ Tamam']);
    expect(splitWords('dedi " Gel')).toEqual(['dedi', '" Gel']);
    // kapanış tırnağı, üç nokta ve bitiş işareti önceki kelimeye
    expect(splitWords('Tamam ” dedi')).toEqual(['Tamam ”', 'dedi']);
    expect(splitWords('Bekle … sonra')).toEqual(['Bekle …', 'sonra']);
    // sonda kalan çizgi önceki kelimeye; yalnızca noktalama varsa o gösterilir
    expect(splitWords('Gel —')).toEqual(['Gel —']);
    expect(splitWords('—')).toEqual(['—']);
  });

  it('yumuşak tireler atılır; boş metin', () => {
    expect(splitWords('kita­bı okudu')).toEqual(['kitabı', 'okudu']);
    expect(splitWords('  ')).toEqual([]);
  });
});

describe('wordDuration', () => {
  // 300 kelime/dk → 200 ms
  it('temel süre ve noktalama çarpanları', () => {
    expect(wordDuration('ev', 300)).toBe(200);
    expect(wordDuration('ev.', 300)).toBe(400);
    expect(wordDuration('ne?', 300)).toBe(400);
    expect(wordDuration('dedi!”', 300)).toBe(400);
    expect(wordDuration('…', 300)).toBe(400);
    expect(wordDuration('ev,', 300)).toBe(300);
    expect(wordDuration('şöyle:', 300)).toBe(300);
    expect(wordDuration('evet;', 300)).toBe(300);
    // sayının içindeki virgül ve iki nokta durak değil
    expect(wordDuration('3,5', 300)).toBeCloseTo(260);
    expect(wordDuration('14:30', 300)).toBeCloseTo(260);
  });

  it('kısaltmadan sonra cümle sonu payı yok (cümlenin son kelimesi değilse)', () => {
    expect(wordDuration('Dr.', 300, 'Ahmet')).toBe(200);
    expect(wordDuration('(vb.', 300, 've')).toBe(200);
    expect(wordDuration('A.', 300, 'Yılmaz')).toBe(200);
    expect(wordDuration('II.', 300, 'Abdülhamit')).toBe(200);
    expect(wordDuration('2.', 300, 'Dünya')).toBeCloseTo(260); // sayı
    expect(wordDuration('s.', 300, '45')).toBe(200);
    // "s." yalnızca sayıdan önce kısaltma; cümlenin son kelimesi (sonraki yok) hep cümle sonu
    expect(wordDuration('s.', 300, 'Sonra')).toBe(400);
    expect(wordDuration('Dr.', 300)).toBe(400);
    expect(wordDuration('ev.', 300, 'Sonra')).toBe(400);
  });

  it('uzun kelime (8 harften uzun) ve sayı ×1,3; noktalamayla çarpılır', () => {
    expect(wordDuration('kitapçıda', 300)).toBeCloseTo(260); // 9 harf
    expect(wordDuration('kitapçıd', 300)).toBe(200); // 8 harf
    expect(wordDuration('1923', 300)).toBeCloseTo(260);
    expect(wordDuration('kütüphanede,', 300)).toBeCloseTo(390);
    expect(wordDuration('1923.', 300)).toBeCloseTo(520);
  });

  it('yavaş başla: ilk üç kelime %60 hızdan tam hıza', () => {
    expect(rampSpeed(0)).toBeCloseTo(0.6);
    expect(rampSpeed(1)).toBeCloseTo(0.7333, 3);
    expect(rampSpeed(2)).toBeCloseTo(0.8667, 3);
    expect(rampSpeed(3)).toBe(1);
    expect(rampSpeed(10)).toBe(1);
  });

  it('sınırlar ve sayfa sınırındaki kelime', () => {
    expect(clampRsvpWpm(20)).toBe(100);
    expect(clampRsvpWpm(2000)).toBe(1000);
    expect(clampRsvpWpm(NaN)).toBe(300);
    // harfler: 4, 4, 5, 5, 3 (21): yarısı üçüncü kelimeden sonra
    const words = ['Altı', 'yedi', 'sekiz', 'dokuz', 'on.'];
    expect(splitWord(words, 0.5)).toBe(3);
    expect(splitWord(words, 0.1)).toBe(1);
    expect(splitWord(words, null)).toBeNull();
    expect(splitWord(['Tek.'], 0.5)).toBeNull();
  });
});

const TEXTS = ['Bir iki üç.', 'Dört, beş.', 'Altı yedi sekiz dokuz on.', 'On bir.'];

function setup(extra: Partial<SpeedReaderOptions> = {}) {
  const sentences: number[] = [];
  const splits: number[] = [];
  const sr = createSpeedReader({
    count: TEXTS.length,
    textOf: (i) => TEXTS[i],
    wordsOf: (i) => TEXTS[i].split(' ').length,
    settings: { mode: 'rsvp', rsvpWpm: 300, ramp: false },
    onSentence: (i) => sentences.push(i),
    onSplit: (i) => splits.push(i),
    clock: {
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    },
    ...extra,
  });
  const shown = () => sr.getState().words[sr.getState().word];
  return { sr, sentences, splits, shown };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createSpeedReader, RSVP', () => {
  it('kelimeler sırayla, her biri kendi süresi kadar; cümle bitince sonraki cümle', async () => {
    const { sr, sentences, shown } = setup();
    sr.play(0);
    expect(sr.getState()).toMatchObject({ status: 'playing', current: 0, word: 0, duration: 200 });
    expect(sr.getState().words).toEqual(['Bir', 'iki', 'üç.']);
    expect(shown()).toBe('Bir');
    await vi.advanceTimersByTimeAsync(199);
    expect(shown()).toBe('Bir');
    await vi.advanceTimersByTimeAsync(1);
    expect(shown()).toBe('iki');
    await vi.advanceTimersByTimeAsync(200);
    // cümle sonu ×2
    expect(sr.getState()).toMatchObject({ word: 2, duration: 400 });
    await vi.advanceTimersByTimeAsync(399);
    expect(sr.getState().current).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    // virgül ×1,5
    expect(sr.getState()).toMatchObject({ current: 1, word: 0, duration: 300 });
    expect(shown()).toBe('Dört,');
    expect(sentences).toEqual([0, 1]);
  });

  it('yavaş başla: oynatınca ilk üç kelime yavaştan hızlanır', async () => {
    const { sr } = setup({ settings: { mode: 'rsvp', rsvpWpm: 300, ramp: true } });
    sr.play(0);
    expect(sr.getState().duration).toBe(333); // 200 / 0,6
    await vi.advanceTimersByTimeAsync(333);
    expect(sr.getState()).toMatchObject({ word: 1, duration: 273 }); // 200 / 0,733
    await vi.advanceTimersByTimeAsync(273);
    expect(sr.getState()).toMatchObject({ word: 2, duration: 462 }); // 400 / 0,867
    await vi.advanceTimersByTimeAsync(462);
    expect(sr.getState()).toMatchObject({ current: 1, word: 0, duration: 300 }); // tam hız
  });

  it('duraklatınca kelime kalır; sürdürünce aynı kelimeden, yeniden yavaş başlayarak', async () => {
    const { sr, shown } = setup({ settings: { mode: 'rsvp', rsvpWpm: 300, ramp: true } });
    sr.play(1);
    await vi.advanceTimersByTimeAsync(500 + 300); // "Dört," (500) ve "beş." başladı
    expect(shown()).toBe('beş.');
    sr.pause();
    expect(sr.getState().status).toBe('paused');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sr.getState()).toMatchObject({ status: 'paused', current: 1, word: 1 });
    sr.toggle();
    // "beş." (400) yeniden, %60 hızla
    expect(sr.getState()).toMatchObject({ status: 'playing', word: 1, duration: 667 });
    await vi.advanceTimersByTimeAsync(666);
    expect(shown()).toBe('beş.');
    await vi.advanceTimersByTimeAsync(1);
    expect(sr.getState()).toMatchObject({ current: 2, word: 0 });
  });

  it('kelime adımı: cümle sınırında komşu cümleye geçer', () => {
    const { sr, sentences, shown } = setup();
    sr.play(0);
    sr.pause();
    sr.stepWord(1);
    sr.stepWord(1);
    expect(shown()).toBe('üç.');
    sr.stepWord(1);
    expect(sr.getState()).toMatchObject({ current: 1, word: 0 });
    sr.stepWord(-1);
    expect(sr.getState()).toMatchObject({ current: 0, word: 2 });
    sr.stepWord(-1);
    expect(shown()).toBe('iki');
    expect(sentences).toEqual([0, 1, 0]);
    expect(sr.getState().status).toBe('paused');
    // cümle adımı kelimeyi başa alır
    sr.next();
    expect(sr.getState()).toMatchObject({ current: 1, word: 0 });
  });

  it('kip değişince etkin cümle baştan; RSVP hızı hemen uygulanır', async () => {
    const { sr, shown } = setup({ settings: { mode: 'fixed', seconds: 5, ramp: false } });
    sr.play(0);
    await vi.advanceTimersByTimeAsync(2000);
    sr.setMode('rsvp');
    expect(sr.getState()).toMatchObject({ mode: 'rsvp', current: 0, word: 0, elapsed: 0 });
    expect(shown()).toBe('Bir');
    sr.setRsvpWpm(600);
    expect(sr.getState()).toMatchObject({ rsvpWpm: 600, duration: 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect(shown()).toBe('iki');
    sr.setMode('fixed');
    expect(sr.getState()).toMatchObject({ mode: 'fixed', words: [], duration: 5000 });
    // RSVP dışında kelime adımı yok
    sr.stepWord(1);
    expect(sr.getState().current).toBe(0);
  });

  it('sayfa sınırından taşan cümle: son parçanın ilk kelimesinde bildirilir', async () => {
    const { sr, splits, shown } = setup({ splitOf: (i) => (i === 2 ? 0.5 : null) });
    sr.play(2);
    await vi.advanceTimersByTimeAsync(600);
    expect(shown()).toBe('dokuz');
    expect(splits).toEqual([2]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(splits).toEqual([2]);
  });

  it('sayfa sınırının payı sonradan bilinince: son parçaya gelinmediyse onun ilk kelimesinde bildirilir', async () => {
    const { sr, splits, shown } = setup();
    sr.play(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(shown()).toBe('yedi');
    // son parça "dokuz" ile başlar
    sr.setSplit(2, 0.5);
    await vi.advanceTimersByTimeAsync(399);
    expect(splits).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(shown()).toBe('dokuz');
    expect(splits).toEqual([2]);
  });

  it('sayfa sınırının payı sonradan bilinince: son parçaya gelindiyse hemen bildirilir', async () => {
    const { sr, splits, shown } = setup();
    sr.play(2);
    await vi.advanceTimersByTimeAsync(800);
    expect(shown()).toBe('on.');
    sr.setSplit(2, 0.5);
    expect(splits).toEqual([2]);
  });

  it('kısaltmada cümle sonu payı yok', () => {
    const sr = createSpeedReader({
      count: 1,
      textOf: () => 'Dr. Ahmet geldi.',
      wordsOf: () => 3,
      settings: { mode: 'rsvp', rsvpWpm: 300, ramp: false },
    });
    sr.play(0);
    expect(sr.getState()).toMatchObject({ word: 0, duration: 200 });
    sr.stepWord(1);
    sr.stepWord(1);
    expect(sr.getState()).toMatchObject({ word: 2, duration: 400 });
    sr.dispose();
  });
});
