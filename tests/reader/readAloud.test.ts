import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clampRate,
  classifyVoice,
  createReadAloud,
  hasEnhancedVoice,
  voiceGroups,
  MAX_CHUNK,
  pickVoice,
  speakable,
  speechChunks,
  voicesFor,
  type ReadAloudOptions,
  type SpeakHandlers,
  type SpeakRequest,
  type SpeechEngine,
  type VoiceInfo,
} from '../../src/reader/modes/readAloud';
import { parseReadAloudPrefs } from '../../src/reader/modes/readAloudPrefs';

/**
 * Sahte motor: her konuşma bir an sonra başlar ve `ms` sonra biter (sahte zamanlayıcıyla); kesilen konuşma
 * "interrupted" hatası verir. Tarayıcı motorlarının aksaklıkları da taklit edilir: konuşmayı yok saymak (`drop`),
 * başlayıp bitişini göndermemek (`missingEnd`), kesilince hata yerine bitiş göndermek (`endOnCancel`).
 */
class FakeEngine implements SpeechEngine {
  spoken: SpeakRequest[] = [];
  cancels = 0;
  private current: { handlers: SpeakHandlers; timer?: ReturnType<typeof setTimeout> } | null = null;
  /** bu metinler okunamaz ("synthesis-failed") */
  failing = new Set<string>();
  /** sonraki bu kadar konuşma yok sayılır: hiç başlamaz, olay gelmez (WebKit, dokunuş dışında) */
  drop = 0;
  /** konuşmalar başlar, `ms` sonra susar ama bitiş olayı gelmez (Chrome ~15 sn, iOS kilit) */
  missingEnd = false;
  /** kesilen konuşma hata yerine bitiş gönderir */
  endOnCancel = false;
  /** bir konuşmanın süresi (ms) */
  private ms: number;

  constructor(ms = 100) {
    this.ms = ms;
  }

  speak(req: SpeakRequest, handlers: SpeakHandlers) {
    this.spoken.push(req);
    if (this.drop > 0) {
      this.drop--;
      return;
    }
    const cur: { handlers: SpeakHandlers; timer?: ReturnType<typeof setTimeout> } = { handlers };
    this.current = cur;
    setTimeout(() => {
      if (this.current === cur) handlers.start();
    }, 0);
    cur.timer = setTimeout(() => {
      if (this.current !== cur) return;
      this.current = null;
      if (this.missingEnd) return;
      if (this.failing.has(req.text)) handlers.error('synthesis-failed');
      else handlers.end();
    }, this.ms);
  }

  cancel() {
    this.cancels++;
    const cur = this.current;
    this.current = null;
    if (!cur) return;
    clearTimeout(cur.timer);
    // Tarayıcılar kesilen konuşmanın olayını sonradan gönderir
    if (this.endOnCancel) setTimeout(() => cur.handlers.end(), 0);
    else setTimeout(() => cur.handlers.error('interrupted'), 0);
  }

  busy() {
    return this.current !== null;
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
    // konuşma başladıktan epey sonra gelen kesilme gerçektir
    engine.speak = (req, handlers) => {
      speak(req, handlers);
      setTimeout(() => handlers.error('interrupted'), 50);
    };
    ra.resume();
    expect(ra.getState().error).toBeNull();
    await vi.advanceTimersByTimeAsync(40);
    expect(ra.getState().status).toBe('playing');
    const spoken = engine.texts.length;
    vi.setSystemTime(Date.now() + 400); // konuşma 400 ms sürdü
    await vi.advanceTimersByTimeAsync(20);
    expect(ra.getState()).toMatchObject({ status: 'paused', current: 0 });
    expect(engine.texts).toHaveLength(spoken); // yeniden denenmedi
  });

  it('konuşma başlamadan ya da hemen gelen kesilme sahtedir: bir kez yeniden denenir (iOS, cancel sonrası)', async () => {
    const { engine, ra } = setup();
    const speak = engine.speak.bind(engine);
    let interrupts = 1;
    engine.speak = (req, handlers) => {
      if (interrupts-- > 0) {
        engine.spoken.push(req);
        setTimeout(() => handlers.error('interrupted'), 5); // başlamadan
      } else speak(req, handlers);
    };
    ra.play(0);
    await vi.advanceTimersByTimeAsync(10);
    expect(ra.getState().status).toBe('playing');
    await vi.advanceTimersByTimeAsync(50);
    expect(engine.texts).toEqual(['Bir.', 'Bir.']);
    expect(ra.getState()).toMatchObject({ status: 'playing', current: 0 });
    await vi.advanceTimersByTimeAsync(100);
    expect(engine.texts).toEqual(['Bir.', 'Bir.', 'İki.']);

    // yeniden denenen de kesilirse duraklar
    interrupts = 2;
    ra.next();
    await vi.advanceTimersByTimeAsync(200);
    expect(ra.getState()).toMatchObject({ status: 'paused', current: 3 });
    expect(engine.texts.slice(3)).toEqual(['Üç.', 'Üç.']);

    // yeniden denemeyi beklerken duraklatılırsa okunmaz
    interrupts = 1;
    ra.resume();
    await vi.advanceTimersByTimeAsync(10);
    ra.pause();
    await vi.advanceTimersByTimeAsync(500);
    expect(engine.texts.slice(5)).toEqual(['Üç.']);
  });

  it('bekçi: hiç başlamayan konuşma (yok sayıldı) 1,5 sn sonra yeniden okunur; üç kez olursa dokunuş bekler', async () => {
    const { engine, ra } = setup();
    engine.drop = 1;
    ra.play(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(engine.texts).toEqual(['Bir.']);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(engine.texts).toEqual(['Bir.', 'Bir.']);
    await vi.advanceTimersByTimeAsync(100);
    expect(engine.texts).toEqual(['Bir.', 'Bir.', 'İki.']);
    expect(ra.getState()).toMatchObject({ status: 'playing', current: 1, error: null });

    engine.drop = 10;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ra.getState()).toMatchObject({ status: 'paused', error: 'not-allowed' });
    const n = engine.texts.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(engine.texts).toHaveLength(n); // durdu, boşuna denemez
  });

  it('bekçi: başlayıp bitişi gelmeyen konuşma bitmiş sayılır, okuma sürer', async () => {
    const { engine, ra, sentences } = setup();
    engine.missingEnd = true;
    ra.play(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(engine.texts).toEqual(['Bir.']);
    await vi.advanceTimersByTimeAsync(2_500);
    expect(engine.texts.slice(0, 2)).toEqual(['Bir.', 'İki.']);
    expect(sentences.slice(0, 2)).toEqual([0, 1]);
    expect(ra.getState().status).toBe('playing');
  });

  it('kesilen konuşmanın geç gelen bitişi okumayı ilerletmez', async () => {
    const { engine, ra } = setup();
    engine.endOnCancel = true;
    ra.play(0);
    await vi.advanceTimersByTimeAsync(50);
    ra.setRate(1.5); // "Bir." kesilir, bitiş olayı gelir
    await vi.advanceTimersByTimeAsync(10);
    expect(ra.getState().current).toBe(0);
    expect(engine.texts).toEqual(['Bir.', 'Bir.']);
    ra.pause();
    await vi.advanceTimersByTimeAsync(500);
    expect(ra.getState()).toMatchObject({ status: 'paused', current: 0 });
  });

  it('sayfa yeniden görünür olunca okunan parça yeniden okunur', async () => {
    const { engine, ra } = setup({ engine: new FakeEngine(10_000) });
    ra.restart(); // okumuyorken bir şey yapmaz
    expect(engine.texts).toEqual([]);
    ra.play(1);
    await vi.advanceTimersByTimeAsync(3_000);
    ra.restart();
    expect(engine.texts).toEqual(['İki.', 'İki.']);
    expect(ra.getState()).toMatchObject({ status: 'playing', current: 1 });
  });

  it('uzun cümle parçalarla okunur (vurgu cümlede kalır); parçalar virgülden ya da boşluktan bölünür', async () => {
    const long = `${'Bu çok uzun bir cümlenin ilk kısmıdır ve devam eder, '.repeat(7)}sonunda da biter.`;
    const engine = new FakeEngine();
    const sentences: number[] = [];
    const ra = createReadAloud({
      engine,
      count: 2,
      textOf: (i) => [long, 'Kısa.'][i],
      lang: 'tr-TR',
      onSentence: (i) => sentences.push(i),
    });
    ra.play(0);
    await vi.advanceTimersByTimeAsync(1_000);
    const chunks = speechChunks(long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(engine.texts).toEqual([...chunks, 'Kısa.']);
    expect(sentences).toEqual([0, 1]);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(MAX_CHUNK);
    expect(chunks[0].endsWith(',')).toBe(true);
    expect(chunks.join(' ')).toBe(long);
    // virgül yoksa boşluktan, boşluk da yoksa sınırdan
    expect(speechChunks('aaaa bbbb cccc', 9)).toEqual(['aaaa bbbb', 'cccc']);
    expect(speechChunks('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(speechChunks('Kısa cümle.')).toEqual(['Kısa cümle.']);
  });

  it('ses ilk kez atanınca (sesler geç yüklendi) okunan cümle baştan okunmaz', () => {
    const { engine, ra } = setup();
    ra.play(0);
    ra.setVoice('tr-yelda', false);
    expect(engine.texts).toEqual(['Bir.']);
    expect(ra.getState().voice).toBe('tr-yelda');
  });

  it('uyku zamanlayıcısı arka planda geç çalışsa da süre dolunca cümle sonunda duraklar', async () => {
    let now = 0;
    const timers: (() => void)[] = [];
    const engine = new FakeEngine(100);
    const ra = createReadAloud({
      engine,
      count: TEXTS.length,
      textOf: (i) => TEXTS[i],
      lang: 'tr-TR',
      // zamanlayıcılar hiç çalışmaz (iOS arka planda), saat ilerler
      clock: {
        now: () => now,
        setTimeout: (fn) => timers.push(fn),
        clearTimeout: () => undefined,
      },
    });
    ra.play(0);
    ra.setSleep(1);
    now = 61_000;
    await vi.advanceTimersByTimeAsync(100); // "Bir." bitti
    expect(ra.getState()).toMatchObject({ status: 'paused', current: 1, sleepAt: null });
    expect(engine.texts).toEqual(['Bir.']);
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

  // Gerçek tarayıcılardaki ses kimlikleri (voiceURI) ve adları
  const REAL: [id: string, name: string, quality: string][] = [
    // iOS/iPadOS 17–18 Safari (adın eki sistem diline göre)
    ['com.apple.voice.compact.tr-TR.Yelda', 'Yelda', 'default'],
    ['com.apple.voice.enhanced.tr-TR.Yelda', 'Yelda (Gelişmiş)', 'enhanced'],
    ['com.apple.voice.enhanced.tr-TR.Yelda', 'Yelda (Enhanced)', 'enhanced'],
    ['com.apple.voice.premium.en-US.Zoe', 'Zoe (Premium)', 'premium'],
    ['com.apple.ttsbundle.siri_Aaron_en-US_compact', 'Aaron', 'default'],
    ['com.apple.eloquence.en-US.Eddy', 'Eddy (İngilizce (ABD))', 'default'],
    // iOS 16 ve öncesi: gelişmiş sesin kimliği "-premium"
    ['com.apple.ttsbundle.Yelda-compact', 'Yelda', 'default'],
    ['com.apple.ttsbundle.Samantha-premium', 'Samantha (Enhanced)', 'premium'],
    // macOS Safari ve Chrome (Chrome'da kimlik ad ile aynı)
    ['com.apple.speech.synthesis.voice.Alex', 'Alex', 'default'],
    ['com.apple.speech.synthesis.voice.Bubbles', 'Bubbles', 'default'],
    ['Yelda (Enhanced)', 'Yelda (Enhanced)', 'enhanced'],
    ['Anna (Erweitert)', 'Anna (Erweitert)', 'enhanced'],
    // Chrome (Google ağ sesleri), Windows ve Edge
    ['Google Türkçe', 'Google Türkçe', 'default'],
    ['Microsoft Tolga - Turkish (Turkey)', 'Microsoft Tolga - Turkish (Turkey)', 'default'],
    [
      'Microsoft Emel Online (Natural) - Turkish (Turkey)',
      'Microsoft Emel Online (Natural) - Turkish (Turkey)',
      'premium',
    ],
    // Android Chrome
    ['tr-TR-language', 'Türkçe Türkiye', 'default'],
  ];

  it('ses kalitesi ad ve kimlikten anlaşılır (iOS, macOS, Chrome, Windows, Android)', () => {
    for (const [id, name, quality] of REAL)
      expect(classifyVoice({ id, name }), `${id} / ${name}`).toBe(quality);
  });

  it('ses seçilmemişse dilin en iyi cihaz sesi; eğlence sesleri en sonda', () => {
    const ipad = [
      v('com.apple.voice.compact.tr-TR.Yelda', 'tr-TR', { name: 'Yelda' }),
      v('com.apple.voice.enhanced.tr-TR.Yelda', 'tr-TR', { name: 'Yelda (Gelişmiş)' }),
      v('com.apple.voice.compact.en-US.Samantha', 'en-US', { name: 'Samantha', isDefault: true }),
      v('com.apple.voice.premium.en-US.Zoe', 'en-US', { name: 'Zoe (Premium)' }),
      v('com.apple.speech.synthesis.voice.Bubbles', 'en-US', { name: 'Bubbles' }),
    ];
    expect(pickVoice(ipad, 'tr')).toBe('com.apple.voice.enhanced.tr-TR.Yelda');
    // premium, tarayıcının varsayılanından önce
    expect(pickVoice(ipad, 'en')).toBe('com.apple.voice.premium.en-US.Zoe');
    // kayıtlı ses korunur
    expect(pickVoice(ipad, 'tr', 'com.apple.voice.compact.tr-TR.Yelda')).toBe(
      'com.apple.voice.compact.tr-TR.Yelda',
    );
    // ağ sesi (Edge'in doğal sesi) cihaz sesinden önce seçilmez: çevrimdışı da okunmalı
    const edge = [
      v('Microsoft Emel Online (Natural) - Turkish (Turkey)', 'tr-TR', { local: false }),
      v('Microsoft Tolga - Turkish (Turkey)', 'tr-TR'),
    ];
    expect(pickVoice(edge, 'tr')).toBe('Microsoft Tolga - Turkish (Turkey)');
    expect(pickVoice(edge.slice(0, 1), 'tr')).toBe(
      'Microsoft Emel Online (Natural) - Turkish (Turkey)',
    );
    // eşit kalitede eğlence sesi seçilmez
    const mac = [
      v('com.apple.speech.synthesis.voice.Bubbles', 'en-US', { name: 'Bubbles' }),
      v('com.apple.speech.synthesis.voice.Alex', 'en-US', { name: 'Alex' }),
    ];
    expect(pickVoice(mac, 'en')).toBe('com.apple.speech.synthesis.voice.Alex');
  });

  it('menü grupları: gelişmiş (önce premium) ve standart; gelişmiş cihaz sesi var mı', () => {
    const list = [
      v('a', 'tr-TR', { name: 'Yelda' }),
      v('b', 'tr-TR', { name: 'Yelda (Gelişmiş)' }),
      v('c', 'tr-TR', { name: 'Emel Online (Natural)', local: false }),
    ];
    const groups = voiceGroups(list);
    expect(groups.enhanced.map((x) => x.id)).toEqual(['c', 'b']);
    expect(groups.standard.map((x) => x.id)).toEqual(['a']);
    expect(hasEnhancedVoice(list)).toBe(true);
    // ağ sesi sayılmaz: çevrimdışı çalışmaz
    expect(hasEnhancedVoice([list[0], list[2]])).toBe(false);
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
