import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clampSeconds,
  clampWpm,
  createSpeedReader,
  MIN_SENTENCE_MS,
  PAUSE_MS,
  sentenceDuration,
  type SpeedReaderOptions,
} from '../../src/reader/modes/speedReader';
import { parseSpeedPrefs } from '../../src/reader/modes/speedPrefs';

const TEXTS = ['Bir iki üç.', 'Dört, beş.', 'Altı yedi sekiz dokuz on.', 'On bir.'];
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

function setup(extra: Partial<SpeedReaderOptions> = {}) {
  const sentences: number[] = [];
  const splits: number[] = [];
  const sr = createSpeedReader({
    count: TEXTS.length,
    textOf: (i) => TEXTS[i],
    wordsOf: (i) => words(TEXTS[i]),
    onSentence: (i) => sentences.push(i),
    onSplit: (i) => splits.push(i),
    clock: {
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    },
    ...extra,
  });
  return { sr, sentences, splits };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('sentenceDuration', () => {
  it('sabit süre: ayarlanan saniye (1–30)', () => {
    expect(sentenceDuration('Bir.', 1, { mode: 'fixed', seconds: 5, wpm: 250 })).toBe(5000);
    expect(sentenceDuration('Bir.', 1, { mode: 'fixed', seconds: 0, wpm: 250 })).toBe(1000);
    expect(sentenceDuration('Bir.', 1, { mode: 'fixed', seconds: 99, wpm: 250 })).toBe(30_000);
  });

  it('dakikada kelime: kelime / wpm × 60 sn', () => {
    // 20 kelime, 250 wpm → 4,8 sn; 300 wpm → 4 sn
    expect(sentenceDuration('x', 20, { mode: 'wpm', seconds: 5, wpm: 250 })).toBe(4800);
    expect(sentenceDuration('x', 20, { mode: 'wpm', seconds: 5, wpm: 300 })).toBe(4000);
    expect(sentenceDuration('x', 100, { mode: 'wpm', seconds: 5, wpm: 1000 })).toBe(6000);
  });

  it('virgül, noktalı virgül ve iki nokta başına pay', () => {
    const text = 'Bir, iki; üç: dört beş altı yedi sekiz dokuz on.';
    expect(sentenceDuration(text, 10, { mode: 'wpm', seconds: 5, wpm: 200 })).toBe(
      3000 + 3 * PAUSE_MS,
    );
  });

  it('sayının içindeki virgül ve iki nokta durak sayılmaz; kapanış tırnağından sonraki sayılır', () => {
    const s = { mode: 'wpm', seconds: 5, wpm: 200 } as const;
    // ", " ve "; " ve sondaki ":" durak; "14:30" ve "3,5" değil
    expect(sentenceDuration('Saat 14:30, 3,5 kilo; beş altı yedi sekiz dokuz:', 10, s)).toBe(
      3000 + 3 * PAUSE_MS,
    );
    expect(sentenceDuration('“Gel,” dedi bir iki üç dört beş altı yedi.', 10, s)).toBe(
      3000 + PAUSE_MS,
    );
  });

  it('en kısa süre; virgül payı en kısa sürenin üstüne eklenir', () => {
    expect(sentenceDuration('Evet.', 1, { mode: 'wpm', seconds: 5, wpm: 250 })).toBe(
      MIN_SENTENCE_MS,
    );
    expect(sentenceDuration('Evet, evet.', 2, { mode: 'wpm', seconds: 5, wpm: 250 })).toBe(
      MIN_SENTENCE_MS + PAUSE_MS,
    );
  });

  it('sınırlar', () => {
    expect(clampSeconds(2.345)).toBe(2.3);
    expect(clampSeconds(NaN)).toBe(5);
    expect(clampWpm(50)).toBe(100);
    expect(clampWpm(5000)).toBe(1000);
    expect(clampWpm(NaN)).toBe(250);
  });
});

describe('createSpeedReader', () => {
  it('varsayılan 5 sn: cümleler süreyle ilerler, kitap bitince durur', async () => {
    const { sr, sentences } = setup();
    expect(sr.getState()).toMatchObject({ mode: 'fixed', seconds: 5, wpm: 250 });
    sr.play(0);
    expect(sr.getState()).toMatchObject({ status: 'playing', current: 0, duration: 5000 });
    await vi.advanceTimersByTimeAsync(4999);
    expect(sr.getState().current).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(sr.getState().current).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sr.getState()).toMatchObject({ status: 'playing', current: 3 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(sr.getState()).toMatchObject({ status: 'idle', current: 3 });
    // etkin cümle her değişimde bildirilir (okuyucu vurgular, sayfayı çevirir)
    expect(sentences).toEqual([0, 1, 2, 3]);
  });

  it('dakikada kelime: her cümle kendi süresi kadar kalır', async () => {
    const { sr } = setup({ settings: { mode: 'wpm', wpm: 100 } });
    sr.play(0);
    // 3 kelime / 100 wpm = 1,8 sn
    expect(sr.getState().duration).toBe(1800);
    await vi.advanceTimersByTimeAsync(1800);
    // 2 kelime → 1,2 sn + bir virgül
    expect(sr.getState()).toMatchObject({ current: 1, duration: 1200 + PAUSE_MS });
    await vi.advanceTimersByTimeAsync(1200 + PAUSE_MS);
    // 5 kelime → 3 sn
    expect(sr.getState()).toMatchObject({ current: 2, duration: 3000 });
  });

  it('duraklatınca kalan süre korunur, sürdürünce kalan kadar bekler', async () => {
    const { sr } = setup();
    sr.play(1);
    await vi.advanceTimersByTimeAsync(3000);
    sr.pause();
    expect(sr.getState()).toMatchObject({ status: 'paused', current: 1, elapsed: 3000 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sr.getState()).toMatchObject({ status: 'paused', current: 1 });
    sr.toggle();
    expect(sr.getState().status).toBe('playing');
    await vi.advanceTimersByTimeAsync(1999);
    expect(sr.getState().current).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sr.getState()).toMatchObject({ current: 2, elapsed: 0 });
  });

  it('sonraki ve önceki: sayaç sıfırlanır; duraklamışken oynatmaz', async () => {
    const { sr, sentences } = setup();
    sr.play(0);
    await vi.advanceTimersByTimeAsync(4000);
    sr.next();
    expect(sr.getState().current).toBe(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(sr.getState().current).toBe(1); // yeni cümle tam süre kalır
    sr.prev();
    sr.prev();
    expect(sr.getState().current).toBe(0);
    sr.prev(); // başta
    expect(sr.getState().current).toBe(0);
    sr.pause();
    sr.next();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sr.getState()).toMatchObject({ status: 'paused', current: 1, elapsed: 0 });
    expect(sentences).toEqual([0, 1, 0, 1]);
  });

  it('ayar hemen uygulanır, etkin cümlede geçen süre korunur', async () => {
    const { sr } = setup();
    sr.play(0);
    await vi.advanceTimersByTimeAsync(2000);
    sr.setSeconds(3);
    expect(sr.getState()).toMatchObject({ seconds: 3, duration: 3000, elapsed: 2000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sr.getState().current).toBe(1);
    // geçen süre yeni süreyi aştıysa hemen sonrakine geçilir
    await vi.advanceTimersByTimeAsync(2500);
    sr.setSeconds(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(sr.getState().current).toBe(2);
    // kip değişince süre dakikada kelimeden
    sr.setMode('wpm');
    expect(sr.getState()).toMatchObject({ mode: 'wpm', duration: 1200 });
    sr.setWpm(100);
    expect(sr.getState()).toMatchObject({ wpm: 100, duration: 3000 });
  });

  it('sayfa sınırından taşan cümle: süresinin sayfadaki payı dolunca bildirilir', async () => {
    const { sr, splits } = setup({ splitOf: (i) => (i === 1 ? 0.6 : null) });
    sr.play(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(splits).toEqual([]);
    await vi.advanceTimersByTimeAsync(2999);
    expect(splits).toEqual([]);
    // duraklatıp sürdürünce de payın kalanı beklenir
    sr.pause();
    await vi.advanceTimersByTimeAsync(10_000);
    sr.resume();
    await vi.advanceTimersByTimeAsync(1);
    expect(splits).toEqual([1]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sr.getState().current).toBe(2);
    expect(splits).toEqual([1]);
  });

  it('durdurunca zamanlayıcı kalmaz; durmuşken sürdürmek etkin cümleden başlatır', async () => {
    const { sr } = setup();
    sr.play(2);
    sr.stop();
    expect(sr.getState()).toMatchObject({ status: 'idle', current: 2 });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sr.getState().current).toBe(2);
    sr.resume();
    expect(sr.getState()).toMatchObject({ status: 'playing', current: 2, elapsed: 0 });
    sr.dispose();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sr.getState().current).toBe(2);
  });

  it('boş kitap oynatılmaz', () => {
    const sr = createSpeedReader({ count: 0, textOf: () => '', wordsOf: () => 0 });
    sr.play(0);
    expect(sr.getState().status).toBe('idle');
  });

  it('sayfa sınırından taşan cümlenin payı sonradan bilinince kurulur ya da hemen bildirilir', async () => {
    const { sr, splits } = setup();
    sr.play(1);
    await vi.advanceTimersByTimeAsync(2000);
    // başka cümlenin payı yok sayılır
    sr.setSplit(2, 0.5);
    // payın zamanı henüz gelmedi (0,6 × 5 sn = 3 sn): kurulur
    sr.setSplit(1, 0.6);
    await vi.advanceTimersByTimeAsync(999);
    expect(splits).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(splits).toEqual([1]);
    // bir kez bildirilir
    sr.setSplit(1, 0.7);
    await vi.advanceTimersByTimeAsync(1000);
    expect(splits).toEqual([1]);
    // payın zamanı geçtiyse hemen (0,1 × 5 sn = 0,5 sn; 1 sn geçti)
    await vi.advanceTimersByTimeAsync(6000);
    expect(sr.getState()).toMatchObject({ current: 3, elapsed: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    sr.setSplit(3, 0.1);
    expect(splits).toEqual([1, 3]);
    // duraklamışken bilinen pay sürdürünce kurulur
    sr.play(1);
    await vi.advanceTimersByTimeAsync(1000);
    sr.pause();
    sr.setSplit(1, 0.5);
    await vi.advanceTimersByTimeAsync(5000);
    expect(splits).toEqual([1, 3]);
    sr.resume();
    await vi.advanceTimersByTimeAsync(1499);
    expect(splits).toEqual([1, 3]);
    await vi.advanceTimersByTimeAsync(1);
    expect(splits).toEqual([1, 3, 1]);
  });
});

/**
 * Zamanlayıcıları `late` ms geç çalıştıran saat (tarayıcıda sayfa çevirme ve PDF çizimi sürerken olduğu gibi);
 * `stall` verilirse o sıradaki zamanlayıcı ayrıca `stall.ms` geç çalışır (uzun takılma).
 */
function lateClock(late: number, stall?: { nth: number; ms: number }) {
  let n = 0;
  return {
    now: () => Date.now(),
    setTimeout: (fn: () => void, ms: number) =>
      setTimeout(fn, ms + late + (stall && ++n === stall.nth ? stall.ms : 0)),
    clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
}

describe('zamanlama', () => {
  // 800 kelime/dk: kelime başına 75 ms; noktalamasız uzun bir cümle
  const LONG = Array.from({ length: 2000 }, () => 'ev').join(' ');

  it('RSVP: zamanlayıcı her kelimede geç çalışsa da ortalama hız kaymaz (%1 içinde)', async () => {
    const sr = createSpeedReader({
      count: 1,
      textOf: () => LONG,
      wordsOf: () => 2000,
      settings: { mode: 'rsvp', rsvpWpm: 800, ramp: false },
      clock: lateClock(12),
    });
    sr.play(0);
    await vi.advanceTimersByTimeAsync(60_000);
    // bir dakikada 800 kelime
    expect(Math.abs(sr.getState().word - 800)).toBeLessThanOrEqual(8);
    sr.dispose();
  });

  it('cümle kipleri: zamanlayıcı geç çalışsa da cümleler kaymaz', async () => {
    const sr = createSpeedReader({
      count: 1000,
      textOf: () => 'Bir.',
      wordsOf: () => 1,
      settings: { mode: 'fixed', seconds: 1 },
      clock: lateClock(40),
    });
    sr.play(0);
    await vi.advanceTimersByTimeAsync(200_000);
    expect(Math.abs(sr.getState().current - 200)).toBeLessThanOrEqual(2);
    sr.dispose();
  });

  it('uzun takılmadan sonra kaçırılan kelimeler art arda gösterilmez', async () => {
    const changes: number[] = [];
    let last = -1;
    const sr = createSpeedReader({
      count: 1,
      textOf: () => LONG,
      wordsOf: () => 2000,
      settings: { mode: 'rsvp', rsvpWpm: 800, ramp: false },
      clock: lateClock(0, { nth: 10, ms: 2000 }),
      onChange: (s) => {
        if (s.word !== last) changes.push(Date.now());
        last = s.word;
      },
    });
    sr.play(0);
    await vi.advanceTimersByTimeAsync(5000);
    const gaps = changes.slice(1).map((t, i) => t - changes[i]);
    // takılma bir kez (2 sn); ondan sonra her kelime yine tam 75 ms
    expect(gaps.filter((g) => g > 1000)).toHaveLength(1);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(75);
    // takılmadan sonra hız yine dakikada 800 kelime
    const after = gaps.slice(gaps.findIndex((g) => g > 1000) + 1);
    expect(after.every((g) => g === 75)).toBe(true);
    sr.dispose();
  });
});

describe('parseSpeedPrefs', () => {
  it('varsayılanlar ve bozuk kayıt', () => {
    const defaults = { mode: 'rsvp', seconds: 5, wpm: 250, rsvpWpm: 300, ramp: true, focus: true };
    expect(parseSpeedPrefs(null)).toEqual(defaults);
    expect(
      parseSpeedPrefs({ mode: 'x', seconds: 'a', wpm: 99999, rsvpWpm: 5, ramp: 'y', focus: 1 }),
    ).toEqual({ ...defaults, wpm: 1000, rsvpWpm: 100 });
    expect(
      parseSpeedPrefs({
        mode: 'rsvp',
        seconds: 8,
        wpm: 300,
        rsvpWpm: 600,
        ramp: false,
        focus: false,
      }),
    ).toEqual({ mode: 'rsvp', seconds: 8, wpm: 300, rsvpWpm: 600, ramp: false, focus: false });
  });
});
