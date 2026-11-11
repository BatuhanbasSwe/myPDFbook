import { describe, expect, it } from 'vitest';
import {
  createReadAloud,
  type Clock,
  type SpeakHandlers,
  type SpeakRequest,
  type SpeechEngine,
} from '../../src/reader/modes/readAloud';
import { DEFAULT_CPS, speechWords, wordWeights } from '../../src/reader/modes/wordTiming';

/** Elle sürülen motor: olaylar testten gönderilir */
class ManualEngine implements SpeechEngine {
  spoken: { req: SpeakRequest; h: SpeakHandlers }[] = [];
  speak(req: SpeakRequest, h: SpeakHandlers) {
    this.spoken.push({ req, h });
  }
  cancel() {}
  get last() {
    return this.spoken[this.spoken.length - 1];
  }
}

/** Elle ilerleyen saat (zamanlayıcılar çalışmaz: bekçi yok) */
function manualClock(): Clock & { t: number } {
  const c = {
    t: 0,
    now: () => c.t,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  };
  return c;
}

const TEXTS = ['Bir iki üç dört.', 'Beş altı.'];

function setup(texts = TEXTS) {
  const engine = new ManualEngine();
  const clock = manualClock();
  const ra = createReadAloud({
    engine,
    count: texts.length,
    textOf: (i) => texts[i],
    lang: 'tr-TR',
    clock,
  });
  return { engine, clock, ra };
}

/** Okunan kelime (okunan metinde) */
const wordOf = (texts: string[], p: { index: number; offset: number } | null) => {
  if (!p) return null;
  const text = texts[p.index];
  const w = speechWords(text).find((x) => x.end > p.offset);
  return w ? text.slice(w.start, w.end) : null;
};

describe('okunan kelime (progress)', () => {
  it('okuma yokken null; konuşma başlamadan cümlenin ilk kelimesi', () => {
    const { ra } = setup();
    expect(ra.progress()).toBeNull();
    ra.play(0);
    expect(ra.progress()).toEqual({ index: 0, offset: 0 });
  });

  it('sistem sesi: kelime sınırı (charIndex) gelince o kelime', () => {
    const { ra, engine } = setup();
    ra.play(0);
    engine.last.h.start();
    engine.last.h.boundary?.(8); // "üç"
    expect(wordOf(TEXTS, ra.progress())).toBe('üç');
    engine.last.h.boundary?.(4);
    expect(wordOf(TEXTS, ra.progress())).toBe('iki');
  });

  it('sistem sesi, kelime sınırı yok: tahmini süreyle ilerler; cümle bitince ölçülen hızla düzelir', () => {
    const { ra, engine, clock } = setup();
    ra.play(0);
    engine.last.h.start();
    const weights = wordWeights(TEXTS[0], speechWords(TEXTS[0]));
    const total = weights.reduce((a, b) => a + b);
    const seconds = total / DEFAULT_CPS;
    expect(wordOf(TEXTS, ra.progress())).toBe('Bir');
    clock.t = seconds * 1000 * 0.99;
    expect(wordOf(TEXTS, ra.progress())).toBe('dört.');
    // Gerçekte cümle iki kat uzun sürdü: sonraki cümlede tahmin yavaşlar
    clock.t = seconds * 2000;
    engine.last.h.end();
    expect(ra.getState().current).toBe(1);
    engine.last.h.start();
    const start = clock.t;
    const w2 = wordWeights(TEXTS[1], speechWords(TEXTS[1]));
    const s2 = w2.reduce((a, b) => a + b) / DEFAULT_CPS;
    // Eski hızla ikinci kelimede olurdu (%40); ölçülen (yarı) hızla hâlâ ilkinde (%20)
    clock.t = start + s2 * 1000 * 0.4;
    expect(wordOf(TEXTS, ra.progress())).toBe('Beş');
  });

  it('hız tahmini kısaltır', () => {
    const { ra, engine, clock } = setup();
    ra.setRate(2);
    ra.play(0);
    engine.last.h.start();
    const total = wordWeights(TEXTS[0], speechWords(TEXTS[0])).reduce((a, b) => a + b);
    clock.t = ((total / DEFAULT_CPS) * 1000 * 0.99) / 2;
    expect(wordOf(TEXTS, ra.progress())).toBe('dört.');
  });

  it("Piper: sesin saatinden (elapsed / süre) ağırlıklı kelime; saat durunca kelime de durur", () => {
    const { ra, engine } = setup();
    ra.play(0);
    let elapsed = 0;
    engine.last.h.timing?.(2, () => elapsed);
    engine.last.h.start();
    expect(wordOf(TEXTS, ra.progress())).toBe('Bir');
    elapsed = 1.95;
    expect(wordOf(TEXTS, ra.progress())).toBe('dört.');
    // Ağırlık: "Bir"4 "iki"4 "üç"3 "dört."5+6=11 → toplam 22; %40 = 8,8 → "üç"
    elapsed = 0.8;
    expect(wordOf(TEXTS, ra.progress())).toBe('üç');
  });

  it('duraklatınca son kelimede durur; sonraki cümleye geçince ilk kelime; durunca null', () => {
    const { ra, engine } = setup();
    ra.play(0);
    engine.last.h.start();
    engine.last.h.boundary?.(8);
    ra.pause();
    expect(wordOf(TEXTS, ra.progress())).toBe('üç');
    ra.next();
    expect(ra.progress()).toEqual({ index: 1, offset: 0 });
    ra.stop();
    expect(ra.progress()).toBeNull();
  });

  it('uzun cümle parçalarla okunur: kelime sınırı parçanın içindeki konumdur, cümledeki yere çevrilir', () => {
    const long = `${'kelime '.repeat(40).trim()}, ${'son '.repeat(30).trim()} bitti.`;
    const { ra, engine } = setup([long]);
    ra.play(0);
    expect(engine.spoken.length).toBe(1);
    const first = engine.last.req.text;
    expect(first.length).toBeLessThan(long.length);
    engine.last.h.start();
    engine.last.h.end();
    // İkinci parça
    const second = engine.last.req.text;
    engine.last.h.start();
    engine.last.h.boundary?.(second.indexOf('bitti'));
    const p = ra.progress()!;
    expect(long.slice(p.offset, p.offset + 5)).toBe('bitti');
  });

  it('kesilen konuşmanın geç gelen kelime sınırı yok sayılır', () => {
    const { ra, engine } = setup();
    ra.play(0);
    const old = engine.last.h;
    old.start();
    ra.next();
    engine.last.h.start();
    old.boundary?.(8);
    expect(ra.progress()).toEqual({ index: 1, offset: 0 });
  });
});
