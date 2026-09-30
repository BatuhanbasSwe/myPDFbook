import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioOut } from '../../src/reader/modes/piper/audio';
import { combineSpeech } from '../../src/reader/modes/piper/combined';
import { createPiperEngine, lengthScale } from '../../src/reader/modes/piper/piperEngine';
import type { Clip, PiperSynth, SynthRequest } from '../../src/reader/modes/piper/synth';
import { PIPER_VOICES } from '../../src/reader/modes/piper/voices';
import {
  createReadAloud,
  type SpeakHandlers,
  type SpeakRequest,
  type SpeechEngine,
} from '../../src/reader/modes/readAloud';
import type { WebSpeech } from '../../src/reader/modes/webSpeech';

const VOICE = PIPER_VOICES[0].id;

/** Sahte sentezleyici: her istek elle bitirilir (`finish`) ya da hata verir (`fail`) */
class FakeSynth implements PiperSynth {
  calls: SynthRequest[] = [];
  private waiting: { req: SynthRequest; resolve(c: Clip): void; reject(e: Error): void }[] = [];
  disposed = 0;

  synthesize(req: SynthRequest) {
    this.calls.push(req);
    return new Promise<Clip>((resolve, reject) => this.waiting.push({ req, resolve, reject }));
  }
  /** süren (en eski) sentezi bitirir: `ms` uzunluğunda ses */
  async finish(ms = 1000) {
    const w = this.waiting.shift()!;
    w.resolve({ pcm: new Float32Array((22_050 * ms) / 1000), sampleRate: 22_050 });
    await flush();
  }
  async fail() {
    this.waiting.shift()!.reject(new Error('bozuk'));
    await flush();
  }
  get texts() {
    return this.calls.map((c) => c.text);
  }
  dispose() {
    this.disposed++;
  }
}

/** Sahte ses çıkışı: çalınanlar kaydedilir, `end` çalanı bitirir */
class FakeAudio implements AudioOut {
  played: number[] = [];
  stops = 0;
  primes = 0;
  isRunning = true;
  private current: { onEnd(): void } | null = null;
  prime() {
    this.primes++;
  }
  play(clip: Clip, onStart: () => void, onEnd: () => void) {
    this.played.push(clip.pcm.length);
    const cur = { onEnd };
    this.current = cur;
    queueMicrotask(onStart);
    return () => {
      this.stops++;
      if (this.current === cur) this.current = null;
    };
  }
  async end() {
    const cur = this.current;
    this.current = null;
    cur?.onEnd();
    await flush();
  }
  running() {
    return this.isRunning;
  }
  dispose() {}
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const req = (text: string, rate = 1, voice: string | null = VOICE): SpeakRequest => ({
  text,
  lang: 'tr-TR',
  rate,
  voice,
});

const handlers = (): SpeakHandlers & { log: string[] } => {
  const log: string[] = [];
  return {
    log,
    start: () => log.push('start'),
    end: () => log.push('end'),
    error: (code) => log.push(`error:${code}`),
  };
};

function setup(lookahead = 2) {
  const synth = new FakeSynth();
  const audio = new FakeAudio();
  const engine = createPiperEngine({ synth, audio, lookahead });
  return { synth, audio, engine };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Piper motoru', () => {
  it('hız length_scale olur (1 / hız): perde değişmez, süre kısalır', () => {
    expect(lengthScale(1)).toBe(1);
    expect(lengthScale(2)).toBe(0.5);
    expect(lengthScale(0.5)).toBe(2);
    expect(lengthScale(1.25)).toBeCloseTo(0.8);
    const { synth, engine } = setup();
    engine.speak(req('Bir.', 1.5), handlers());
    expect(synth.calls[0]).toMatchObject({ text: 'Bir.', voice: PIPER_VOICES[0] });
    expect(synth.calls[0].lengthScale).toBeCloseTo(1 / 1.5);
  });

  it('konuşma sentezlenir, çalınır; başlangıç ve bitiş bildirilir; sentez sürerken ve çalarken meşgul', async () => {
    const { synth, audio, engine } = setup();
    const h = handlers();
    engine.speak(req('Bir.'), h);
    expect(engine.busy?.()).toBe(true); // sentezleniyor
    await synth.finish(500);
    expect(audio.played).toEqual([22_050 / 2]);
    expect(h.log).toEqual(['start']);
    expect(engine.busy?.()).toBe(true); // çalıyor
    // Ses bağlamı askıda (iOS): meşgul sayılmaz, bekçi yeniden dener
    audio.isRunning = false;
    expect(engine.busy?.()).toBe(false);
    audio.isRunning = true;
    await audio.end();
    expect(h.log).toEqual(['start', 'end']);
    expect(engine.busy?.()).toBe(false);
  });

  it('önceden sentez: okunan konuşma önce, sıradakiler okunma sırasıyla birer birer; hazır ses hemen çalınır', async () => {
    const { synth, audio, engine } = setup(2);
    engine.speak(req('Bir.'), handlers());
    engine.prefetch?.([req('İki.'), req('Üç.'), req('Dört.')]);
    // Aynı anda tek sentez; önceden hazırlanacaklar en çok `lookahead` kadar
    expect(synth.texts).toEqual(['Bir.']);
    await synth.finish();
    expect(synth.texts).toEqual(['Bir.', 'İki.']);
    await synth.finish();
    expect(synth.texts).toEqual(['Bir.', 'İki.', 'Üç.']);
    await audio.end(); // "Bir." bitti

    // "İki." hazır: yeniden sentezlenmez, hemen çalınır
    const h = handlers();
    engine.speak(req('İki.'), h);
    await flush();
    expect(h.log).toEqual(['start']);
    expect(audio.played).toHaveLength(2);
    expect(synth.texts).toEqual(['Bir.', 'İki.', 'Üç.']);
    // Süren sentez ("Üç.") bitince sonraki bildirilen sentezlenir
    engine.prefetch?.([req('Üç.'), req('Dört.')]);
    await synth.finish();
    expect(synth.texts).toEqual(['Bir.', 'İki.', 'Üç.', 'Dört.']);
  });

  it('başka yere atlanınca sıradaki önceden sentezler bırakılır, okunacak olan öne geçer', async () => {
    const { synth, engine } = setup(3);
    engine.speak(req('Bir.'), handlers());
    engine.prefetch?.([req('İki.'), req('Üç.')]);
    const h = handlers();
    engine.speak(req('On.'), h); // okur ileri atladı
    await synth.finish(); // "Bir." (süren sentez) biter, sonuç saklanır
    expect(synth.texts).toEqual(['Bir.', 'On.']);
    await synth.finish();
    expect(h.log).toEqual(['start']);
  });

  it('hız değişince ses yeniden sentezlenir (önbellekteki eski hızla okunmaz)', async () => {
    const { synth, engine } = setup();
    engine.speak(req('Bir.', 1), handlers());
    await synth.finish();
    engine.speak(req('Bir.', 2), handlers());
    expect(synth.calls.map((c) => c.lengthScale)).toEqual([1, 0.5]);
  });

  it('iptal: çalan ses durur, bitiş gelmez; sıradaki sentezler bırakılır', async () => {
    const { synth, audio, engine } = setup(2);
    const h = handlers();
    engine.speak(req('Bir.'), h);
    engine.prefetch?.([req('İki.'), req('Üç.')]);
    await synth.finish();
    expect(h.log).toEqual(['start']);
    engine.cancel();
    expect(audio.stops).toBe(1);
    expect(engine.busy?.()).toBe(false);
    await synth.finish(); // süren "İki." biter
    await flush();
    // "Üç." hiç sentezlenmedi; kesilen konuşmanın olayı gelmez
    expect(synth.texts).toEqual(['Bir.', 'İki.']);
    await audio.end();
    expect(h.log).toEqual(['start']);
  });

  it('sentezlenirken iptal edilen konuşma sonradan çalınmaz', async () => {
    const { synth, audio, engine } = setup();
    const h = handlers();
    engine.speak(req('Bir.'), h);
    engine.cancel();
    await synth.finish();
    expect(audio.played).toEqual([]);
    expect(h.log).toEqual([]);
  });

  it('hata: sentez başarısızsa ya da ses bilinmiyorsa "synthesis-failed"', async () => {
    const { synth, engine } = setup();
    const h = handlers();
    engine.speak(req('Bir.'), h);
    await synth.fail();
    expect(h.log).toEqual(['error:synthesis-failed']);
    // Başarısız sentez önbellekte kalmaz: yeniden denenir
    engine.speak(req('Bir.'), handlers());
    expect(synth.texts).toEqual(['Bir.', 'Bir.']);

    const unknown = handlers();
    engine.speak(req('İki.', 1, 'piper:yok'), unknown);
    await flush();
    expect(unknown.log).toEqual(['error:synthesis-failed']);
  });

  it('okunacak ses hazırlanırken bildirilir (oynat düğmesinde gösterilir)', async () => {
    const { synth, engine } = setup();
    const states: boolean[] = [];
    engine.onPreparing((p) => states.push(p));
    engine.speak(req('Bir.'), handlers());
    await synth.finish();
    expect(states).toEqual([true, false]);
  });

  it('sentez yavaşsa (gerçek zaman oranı yüksek) daha çok konuşma önceden hazırlanır', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { synth, engine } = setup(2);
    expect(engine.lookahead).toBe(2);
    for (const text of ['Bir.', 'İki.', 'Üç.']) {
      engine.speak(req(text), handlers());
      now += 1200; // 1 sn'lik ses 1,2 sn'de
      await synth.finish(1000);
    }
    expect(engine.lookahead).toBe(4);
  });

  it('dispose: sentezleyici ve kuyruk bırakılır', () => {
    const { synth, engine } = setup();
    engine.speak(req('Bir.'), handlers());
    engine.dispose();
    expect(synth.disposed).toBe(1);
    expect(engine.busy?.()).toBe(false);
  });
});

describe('denetleyiciyle', () => {
  /** Önceden hazırlama isteyen sahte motor: konuşmalar hemen biter */
  class PrefetchEngine implements SpeechEngine {
    lookahead = 3;
    prefetched: string[][] = [];
    spoken: string[] = [];
    speak(r: SpeakRequest, h: SpeakHandlers) {
      this.spoken.push(r.text);
      this.last = h;
    }
    last: SpeakHandlers | null = null;
    prefetch(next: SpeakRequest[]) {
      this.prefetched.push(next.map((n) => n.text));
    }
    cancel() {}
  }

  it('sıradaki konuşmalar bildirilir: cümlenin kalan parçaları, sonra sonraki cümleler (boşlar atlanır)', () => {
    const long = `${'kelime '.repeat(30)}son, ${'öteki '.repeat(30)}bitti.`;
    const texts = ['Bir.', long, '', 'Üç.', 'Dört.'];
    const engine = new PrefetchEngine();
    const ra = createReadAloud({
      engine,
      count: texts.length,
      textOf: (i) => texts[i],
      lang: 'tr-TR',
    });
    ra.play(0);
    expect(engine.prefetched[0]).toHaveLength(3);
    const [first, second, third] = engine.prefetched[0];
    expect(`${first} ${second}`.replace(/\s+/g, ' ')).toBe(long.trim().replace(/\s+/g, ' '));
    expect(third).toBe('Üç.');
    engine.last?.end(); // "Bir." bitti: uzun cümlenin ilk parçası okunur
    expect(engine.spoken[1]).toBe(first);
    expect(engine.prefetched[1]).toEqual([second, 'Üç.', 'Dört.']);
    ra.dispose();
  });
});

describe('birleşik motor', () => {
  it('konuşma sesine göre yönlenir: "piper:" sesleri Piper\'a, öbürleri tarayıcıya', async () => {
    const webSpoken: string[] = [];
    let webCancels = 0;
    let webPrimes = 0;
    const web: WebSpeech = {
      speak: (r) => webSpoken.push(r.text),
      cancel: () => webCancels++,
      busy: () => true,
      voices: () => [],
      onVoices: () => () => undefined,
      prime: () => webPrimes++,
    };
    const { synth, audio, engine: piper } = setup();
    const both = combineSpeech(web, piper)!;
    both.speak(req('Sistem.', 1, 'tr-yelda'), handlers());
    expect(webSpoken).toEqual(['Sistem.']);
    expect(both.lookahead).toBe(0);
    both.speak(req('Doğal.'), handlers());
    expect(synth.texts).toEqual(['Doğal.']);
    // Motor değişince eskisi susturulur
    expect(webCancels).toBe(1);
    expect(both.lookahead).toBe(2);
    both.prime(VOICE);
    both.prime('tr-yelda');
    expect([audio.primes, webPrimes]).toEqual([1, 1]);
    await synth.finish();
    both.cancel();
    expect(audio.stops).toBe(1);
  });
});
