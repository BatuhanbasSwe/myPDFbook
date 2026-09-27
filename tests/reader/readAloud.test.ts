import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clampRate,
  createReadAloud,
  pickVoice,
  speakable,
  voicesFor,
  type ReadAloudOptions,
  type SpeakHandlers,
  type SpeakRequest,
  type SpeechEngine,
  type VoiceInfo,
} from '../../src/reader/modes/readAloud';
import { parseReadAloudPrefs } from '../../src/reader/modes/readAloudPrefs';

/** Sahte motor: her konuşma `ms` sonra biter (sahte zamanlayıcıyla); kesilen konuşma "interrupted" hatası verir */
class FakeEngine implements SpeechEngine {
  spoken: SpeakRequest[] = [];
  cancels = 0;
  private current: { handlers: SpeakHandlers; timer: ReturnType<typeof setTimeout> } | null = null;
  /** bu metinler okunamaz ("synthesis-failed") */
  failing = new Set<string>();
  /** bir konuşmanın süresi (ms) */
  private ms: number;

  constructor(ms = 100) {
    this.ms = ms;
  }

  speak(req: SpeakRequest, handlers: SpeakHandlers) {
    this.spoken.push(req);
    const timer = setTimeout(() => {
      this.current = null;
      if (this.failing.has(req.text)) handlers.error('synthesis-failed');
      else handlers.end();
    }, this.ms);
    this.current = { handlers, timer };
  }

  cancel() {
    this.cancels++;
    const cur = this.current;
    this.current = null;
    if (!cur) return;
    clearTimeout(cur.timer);
    // Tarayıcılar kesilen konuşmanın hata olayını sonradan gönderir
    setTimeout(() => cur.handlers.error('interrupted'), 0);
  }

  get texts() {
    return this.spoken.map((s) => s.text);
  }
}

const TEXTS = ['Bir.', 'İki.', '', 'Üç.', 'Dört.'];

function setup({
  engine = new FakeEngine(),
  ...extra
}: Partial<Omit<ReadAloudOptions, 'engine'>> & { engine?: FakeEngine } = {}) {
  const sentences: number[] = [];
  const ra = createReadAloud({
    engine,
    count: TEXTS.length,
    textOf: (i) => TEXTS[i],
    lang: 'tr-TR',
    onSentence: (i) => sentences.push(i),
    clock: {
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    },
    ...extra,
  });
  return { engine, ra, sentences };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createReadAloud', () => {
  it('cümleleri sırayla okur, boş cümleyi atlar, kitap bitince durur', async () => {
    const { engine, ra, sentences } = setup();
    ra.play(0);
    expect(ra.getState()).toMatchObject({ status: 'playing', current: 0 });
    expect(engine.texts).toEqual(['Bir.']);
    expect(engine.spoken[0]).toMatchObject({ lang: 'tr-TR', rate: 1, voice: null });

    await vi.advanceTimersByTimeAsync(100);
    expect(engine.texts).toEqual(['Bir.', 'İki.']);
    await vi.advanceTimersByTimeAsync(400);
    expect(engine.texts).toEqual(['Bir.', 'İki.', 'Üç.', 'Dört.']);
    // etkin cümle her değişimde bildirilir (boş cümle de: sayfa çevirme ona göre)
    expect(sentences).toEqual([0, 1, 2, 3, 4]);
    expect(ra.getState()).toMatchObject({ status: 'idle', current: 4 });
  });

  it('duraklatınca susar, sürdürünce kalan cümleyi baştan okur', async () => {
    const { engine, ra } = setup();
    ra.play(0);
    await vi.advanceTimersByTimeAsync(150); // "İki." okunuyor
    ra.pause();
    expect(ra.getState().status).toBe('paused');
    expect(engine.cancels).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    // kesilen konuşmanın geç gelen hatası yok sayılır
    expect(engine.texts).toEqual(['Bir.', 'İki.']);
    expect(ra.getState()).toMatchObject({ status: 'paused', current: 1, error: null });

    ra.toggle();
    expect(ra.getState().status).toBe('playing');
    expect(engine.texts).toEqual(['Bir.', 'İki.', 'İki.']);
    ra.toggle();
    expect(ra.getState().status).toBe('paused');
  });

  it('sonraki ve önceki cümle: okurken hemen o cümleye geçer, duraklamışken yalnızca yer değişir', async () => {
    const { engine, ra, sentences } = setup();
    ra.play(1);
    ra.next();
    // boş cümle atlanır
    expect(ra.getState().current).toBe(3);
    expect(engine.texts).toEqual(['İki.', 'Üç.']);
    ra.prev();
    expect(ra.getState().current).toBe(1);
    expect(engine.texts.at(-1)).toBe('İki.');
    ra.pause();
    ra.prev();
    ra.prev(); // başta: değişmez
    expect(ra.getState().current).toBe(0);
    expect(engine.texts).toHaveLength(3);
    expect(sentences).toEqual([1, 3, 1, 0]);
    await vi.advanceTimersByTimeAsync(500);
    expect(engine.texts).toHaveLength(3);
  });

  it('hız 0,5–2 arasında kalır; okurken değişince okunan cümle yeni hızla baştan okunur', async () => {
    const { engine, ra } = setup({ rate: 1.25 });
    expect(ra.getState().rate).toBe(1.25);
    ra.setRate(1.5); // durmuşken yalnızca ayar
    expect(engine.spoken).toHaveLength(0);
    ra.play(0);
    expect(engine.spoken[0].rate).toBe(1.5);
    await vi.advanceTimersByTimeAsync(50);
    ra.setRate(9);
    expect(ra.getState().rate).toBe(2);
    expect(engine.spoken.map((s) => [s.text, s.rate])).toEqual([
      ['Bir.', 1.5],
      ['Bir.', 2],
    ]);
    ra.setRate(2); // aynı hız: yeniden başlamaz
    expect(engine.spoken).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(engine.spoken.at(-1)).toMatchObject({ text: 'İki.', rate: 2 });
    expect(clampRate(0.1)).toBe(0.5);
    expect(clampRate(Number.NaN)).toBe(1);
  });

  it('ses değişince okunan cümle yeni sesle baştan okunur', () => {
    const { engine, ra } = setup({ voice: 'a' });
    ra.play(0);
    ra.setVoice('b');
    expect(engine.spoken.map((s) => s.voice)).toEqual(['a', 'b']);
  });

  it('okunamayan cümle atlanır; üst üste üç hata okumayı durdurur', async () => {
    const { engine, ra } = setup();
    engine.failing.add('İki.');
    ra.play(0);
    await vi.advanceTimersByTimeAsync(250);
    expect(engine.texts).toEqual(['Bir.', 'İki.', 'Üç.']);
    expect(ra.getState()).toMatchObject({ status: 'playing', current: 3, error: null });
    ra.stop();

    // Hiçbir cümle okunamıyor: üçüncü hatada durur (kitabın sonuna kadar taranmaz)
    const broken = setup();
    broken.engine.failing = new Set(TEXTS);
    broken.ra.play(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(broken.engine.texts).toEqual(['Bir.', 'İki.', 'Üç.']);
    expect(broken.ra.getState()).toMatchObject({ status: 'paused', current: 3, error: 'failed' });
    // Sürdürünce hata silinir, aynı cümleden yeniden denenir
    broken.ra.resume();
    expect(broken.ra.getState().error).toBeNull();
    expect(broken.engine.texts.at(-1)).toBe('Üç.');
  });

  it('izin yoksa (iOS, dokunuş dışında) duraklar ve hatayı bildirir; dışarıdan kesilen konuşma duraklatır', async () => {
    const { engine, ra } = setup();
    const speak = engine.speak.bind(engine);
    engine.speak = (req, handlers) => {
      speak(req, handlers);
      handlers.error('not-allowed');
    };
    ra.play(0);
    expect(ra.getState()).toMatchObject({ status: 'paused', error: 'not-allowed' });
    engine.speak = (req, handlers) => {
      speak(req, handlers);
      setTimeout(() => handlers.error('interrupted'), 10);
    };
    ra.resume();
    expect(ra.getState().error).toBeNull();
    await vi.advanceTimersByTimeAsync(20);
    expect(ra.getState()).toMatchObject({ status: 'paused', current: 0 });
  });

  it('uyku zamanlayıcısı: süre dolunca okunan cümle bitince duraklar; kapatılabilir', async () => {
    const { ra } = setup({ engine: new FakeEngine(40_000) });
    ra.play(0);
    ra.setSleep(1);
    expect(ra.getState().sleepAt).toBe(Date.now() + 60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    // süre doldu: "İki." okunuyor, bitince durur
    expect(ra.getState()).toMatchObject({ status: 'playing', current: 1, sleepAt: null });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ra.getState()).toMatchObject({ status: 'paused', current: 2 });

    ra.resume();
    ra.setSleep(15);
    ra.setSleep(null);
    expect(ra.getState().sleepAt).toBeNull();
    await vi.advanceTimersByTimeAsync(16 * 60_000);
    expect(ra.getState().status).toBe('idle'); // kitap bitti, uyku zamanlayıcısı durdurmadı
  });

  it('durdurunca susar; kaldığı yer korunur', async () => {
    const { engine, ra } = setup();
    ra.play(3);
    ra.setSleep(30);
    ra.stop();
    expect(ra.getState()).toMatchObject({ status: 'idle', current: 3, sleepAt: null });
    await vi.advanceTimersByTimeAsync(1000);
    expect(engine.texts).toEqual(['Üç.']);
    ra.resume();
    expect(engine.texts).toEqual(['Üç.', 'Üç.']);
    ra.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(engine.texts).toHaveLength(2);
  });
});

describe('ses seçimi', () => {
  const v = (id: string, lang: string, extra: Partial<VoiceInfo> = {}): VoiceInfo => ({
    id,
    name: id,
    lang,
    isDefault: false,
    local: true,
    ...extra,
  });
  const voices = [
    v('Samantha', 'en-US', { isDefault: true }),
    v('Yelda', 'tr-TR'),
    v('Daniel', 'en-GB'),
    v('Online TR', 'tr_TR', { local: false }),
    v('Anna', 'de-DE'),
  ];

  it('kitabın diline uyan sesler', () => {
    expect(voicesFor(voices, 'tr').map((x) => x.id)).toEqual(['Online TR', 'Yelda']);
    expect(voicesFor(voices, 'en').map((x) => x.id)).toEqual(['Daniel', 'Samantha']);
    expect(voicesFor(voices, 'other')).toHaveLength(5);
  });

  it('kayıtlı ses varsa o; yoksa varsayılan, sonra dilin bölgesindeki cihaz sesi; ses yoksa null', () => {
    expect(pickVoice(voices, 'tr', 'Online TR')).toBe('Online TR');
    expect(pickVoice(voices, 'tr', 'Samantha')).toBe('Yelda'); // başka dilin sesi
    expect(pickVoice(voices, 'tr')).toBe('Yelda');
    expect(pickVoice(voices, 'en')).toBe('Samantha');
    expect(pickVoice(voices.slice(1), 'en')).toBe('Daniel');
    expect(pickVoice([], 'tr')).toBeNull();
  });

  it('okunacak metinden dipnot imleri ve görünmez karakterler çıkar', () => {
    const shy = String.fromCharCode(0xad);
    expect(speakable(`O eski kita${shy}bı tutuyordu.¹ `)).toBe('O eski kitabı tutuyordu.');
  });

  it('tercihler: bozuk kayıt varsayılana döner, hız sınırlanır', () => {
    expect(parseReadAloudPrefs(null)).toEqual({ rate: 1, voices: {} });
    expect(parseReadAloudPrefs({ rate: 5, voices: { tr: 'Yelda', en: 3 } })).toEqual({
      rate: 2,
      voices: { tr: 'Yelda' },
    });
  });
});
