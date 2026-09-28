/**
 * Hızlı okuma denetleyicisi: cümle dizini üzerinde saf durum makinesi, saat dışarıdan verilir (testlerde sahte
 * zamanlayıcı). Üç kip:
 * - "fixed": her cümle ayarlanan süre (1–30 sn) etkin kalır;
 * - "wpm": cümlenin süresi dakikada kelimeden hesaplanır (en kısa süre ve virgül payıyla);
 * - "rsvp": cümlenin kelimeleri tek tek gösterilir (Spritz tarzı), her kelimenin süresi dakikada kelimeden ve
 *   noktalamadan (rsvp.ts); "yavaş başla" açıksa oynatınca ilk kelimeler yavaştan tam hıza çıkar.
 *
 * Etkin cümle değişince okuyucuya bildirilir (vurgu ve sayfa çevirme okuyucunun işidir). Sayfa sınırından taşan
 * cümlede, cümlenin sayfadaki payı bitince okuyucuya ayrıca haber verilir: sayfa cümlenin ortasında çevrilir.
 */
import { realClock, type Clock } from './clock';
import {
  clampRsvpWpm,
  rampSpeed,
  RSVP_WPM_RANGE,
  splitWord,
  splitWords,
  wordDuration,
} from './rsvp';

export type SpeedMode = 'fixed' | 'wpm' | 'rsvp';

/** Sabit süre (saniye, cümle başına) */
export const SECONDS_RANGE = { min: 1, max: 30, default: 5 } as const;
/** Dakikada kelime */
export const WPM_RANGE = { min: 100, max: 1000, default: 250 } as const;

/** Çubuktaki seçenekler */
export const SECONDS_CHOICES = [1, 2, 3, 5, 8, 10, 15, 20, 30] as const;
export const WPM_CHOICES = [150, 200, 250, 300, 400, 500] as const;

/** Dakikada kelimede bir cümlenin en kısa süresi ve her virgül, noktalı virgül, iki nokta için eklenen süre (ms) */
export const MIN_SENTENCE_MS = 1_200;
export const PAUSE_MS = 150;

export function clampSeconds(s: number): number {
  if (!Number.isFinite(s)) return SECONDS_RANGE.default;
  return Math.min(SECONDS_RANGE.max, Math.max(SECONDS_RANGE.min, Math.round(s * 10) / 10));
}

export function clampWpm(w: number): number {
  if (!Number.isFinite(w)) return WPM_RANGE.default;
  return Math.min(WPM_RANGE.max, Math.max(WPM_RANGE.min, Math.round(w)));
}

export interface SpeedSettings {
  mode: SpeedMode;
  seconds: number;
  wpm: number;
  /** RSVP'de dakikada kelime */
  rsvpWpm: number;
  /** RSVP'de "yavaş başla" */
  ramp: boolean;
}

/** Durak: arkasından boşluk ya da metnin sonu gelen virgül, noktalı virgül, iki nokta ("3,5" ve "14:30" değil) */
const PAUSE = /[,;:][”’»"')\]]*(?=\s|$)/gu;

/**
 * Cümlenin süresi (ms; cümle kipleri). Sabit kipte ayarlanan süre; dakikada kelimede `kelime / wpm × 60 sn`, en az
 * MIN_SENTENCE_MS, üstüne her virgül, noktalı virgül ve iki nokta için PAUSE_MS (sayının içindekiler sayılmaz).
 */
export function sentenceDuration(
  text: string,
  words: number,
  s: Pick<SpeedSettings, 'mode' | 'seconds' | 'wpm'>,
): number {
  if (s.mode === 'fixed') return clampSeconds(s.seconds) * 1000;
  const pauses = text.match(PAUSE)?.length ?? 0;
  const read = (Math.max(0, words) / clampWpm(s.wpm)) * 60_000;
  return Math.round(Math.max(MIN_SENTENCE_MS, read) + pauses * PAUSE_MS);
}

export type SpeedStatus = 'idle' | 'playing' | 'paused';

export interface SpeedState extends SpeedSettings {
  status: SpeedStatus;
  /** etkin cümle (dizideki indeks); -1: henüz yok */
  current: number;
  /** RSVP: etkin cümlenin kelimeleri ve gösterilen kelime; cümle kiplerinde boş ve 0 */
  words: string[];
  word: number;
  /** etkin cümlenin (RSVP'de gösterilen kelimenin) süresi (ms) */
  duration: number;
  /** etkin cümlede (kelimede) geçen süre, son başlatılışa dek (ms) */
  elapsed: number;
  /**
   * oynuyorsa sayacın son başladığı an (clock.now); değilse null. Geçen süre: elapsed + (now - since). Kendiliğinden
   * geçilen birimde önceki birimin bitmesi gereken an (zamanlayıcının gecikmesi birikmez), yani şimdiden biraz önce
   * olabilir.
   */
  since: number | null;
}

export interface SpeedReaderOptions {
  /** cümle sayısı */
  count: number;
  /** cümlenin metni ve kelime sayısı (dakikada kelimede süre) */
  textOf(index: number): string;
  wordsOf(index: number): number;
  settings?: Partial<SpeedSettings>;
  clock?: Clock;
  onChange?(state: SpeedState): void;
  /** etkin cümle değişti (oynatma, ilerleme, önceki/sonraki): okuyucu vurgular, gerekirse sayfayı çevirir */
  onSentence?(index: number): void;
  /**
   * Cümle sayfa sınırından taşıyorsa ilk sayfadaki payı (0–1, ör. harf oranı); taşmıyorsa ya da henüz bilinmiyorsa
   * null. Cümle etkin olunca sorulur (sonradan bilinirse `setSplit` ile verilir); cümlenin bu payı bitince (süresinin
   * payı dolunca, RSVP'de son parçanın ilk kelimesinde) `onSplit` çağrılır (sayfa cümlenin ortasında çevrilir).
   */
  splitOf?(index: number): number | null;
  onSplit?(index: number): void;
}

export interface SpeedReader {
  getState(): SpeedState;
  /** `from` cümlesinden başlar */
  play(from: number): void;
  /** kalan süre korunur (RSVP'de sürdürünce kelime yeniden, "yavaş başla" ile gösterilir) */
  pause(): void;
  /** duraklamışsa kalan süreyle sürer; durmuşsa etkin cümleden baştan başlar */
  resume(): void;
  toggle(): void;
  stop(): void;
  next(): void;
  prev(): void;
  /** RSVP: bir kelime ileri ya da geri (cümle sınırında komşu cümleye geçer) */
  stepWord(dir: 1 | -1): void;
  /** Ayar hemen uygulanır: etkin cümlenin (kelimenin) süresi yeniden hesaplanır, geçen süre korunur */
  setMode(mode: SpeedMode): void;
  setSeconds(seconds: number): void;
  setWpm(wpm: number): void;
  setRsvpWpm(wpm: number): void;
  setRamp(ramp: boolean): void;
  /**
   * Etkin cümlenin sayfa sınırından taştığı sonradan bilindi (yeri bulundu): payı `fraction` (0–1). Payın zamanı
   * henüz gelmediyse kurulur, geçtiyse hemen bildirilir. Başka cümle etkinse ya da pay zaten biliniyorsa yok sayılır.
   */
  setSplit(index: number, fraction: number): void;
  dispose(): void;
}

export function createSpeedReader(opts: SpeedReaderOptions): SpeedReader {
  const { count, textOf, wordsOf } = opts;
  const clock = opts.clock ?? realClock;
  const init = opts.settings ?? {};
  let state: SpeedState = {
    status: 'idle',
    current: -1,
    mode: init.mode === 'wpm' || init.mode === 'rsvp' ? init.mode : 'fixed',
    seconds: clampSeconds(init.seconds ?? SECONDS_RANGE.default),
    wpm: clampWpm(init.wpm ?? WPM_RANGE.default),
    rsvpWpm: clampRsvpWpm(init.rsvpWpm ?? RSVP_WPM_RANGE.default),
    ramp: init.ramp ?? true,
    words: [],
    word: 0,
    duration: 0,
    elapsed: 0,
    since: null,
  };
  let timer: unknown = null;
  let splitTimer: unknown = null;
  /** etkin cümlenin ilk sayfadaki payı (0–1) ve o anın bildirilip bildirilmediği */
  let split: number | null = null;
  let splitDone = false;
  /** RSVP: son parçanın ilk kelimesi; oynatmadan beri gösterilen kelime sayısı ve gösterilen kelimenin hız oranı */
  let splitAt: number | null = null;
  let rampStep = 0;
  let speed = 1;
  /**
   * Zamanlayıcıyla geçilen birimin (kelime, cümle) sayacının başlayacağı an: önceki birimin bitmesi gereken an.
   * Zamanlayıcı her seferinde biraz geç çalışır (tarayıcı sayfa çevirirken, PDF çizerken); yeni birim gerçek çalışma
   * anından sayılırsa gecikme birikir, okuma yavaşlar. Elle geçilince, sürdürünce ve ayar değişince null (şimdiden).
   */
  let carry: number | null = null;
  /** gösterilen birimin bitmesi gereken an (oynarken; clock.now) */
  let deadline = 0;

  const set = (patch: Partial<SpeedState>) => {
    state = { ...state, ...patch };
    opts.onChange?.(state);
  };

  const clearTimers = () => {
    if (timer !== null) clock.clearTimeout(timer);
    if (splitTimer !== null) clock.clearTimeout(splitTimer);
    timer = null;
    splitTimer = null;
  };

  const rsvp = () => state.mode === 'rsvp';

  /** Gösterilen birimin (cümle kiplerinde cümle, RSVP'de kelime) süresi */
  const durationNow = (s: SpeedState = state): number => {
    if (s.current < 0) return 0;
    if (s.mode === 'rsvp') {
      const w = s.words[s.word];
      // sonraki kelime: kısaltmanın noktası cümle sonu sayılmasın (son kelimede yok)
      const next = s.words[s.word + 1] as string | undefined;
      return Math.round(wordDuration(w ?? '', clampRsvpWpm(s.rsvpWpm), next) / speed);
    }
    return sentenceDuration(textOf(s.current), wordsOf(s.current), s);
  };

  /** Geçen süre (oynuyorsa şu ana dek) */
  const elapsedNow = () =>
    state.elapsed + (state.since !== null ? Math.max(0, clock.now() - state.since) : 0);

  const fireSplit = () => {
    splitTimer = null;
    if (splitDone) return;
    splitDone = true;
    opts.onSplit?.(state.current);
  };

  /** Cümle kiplerinde sayfa sınırından taşan cümlenin payı dolunca bildirim (oynarken; geçtiyse hemen) */
  const armSplit = () => {
    if (splitTimer !== null) clock.clearTimeout(splitTimer);
    splitTimer = null;
    if (rsvp() || split === null || splitDone || state.since === null) return;
    const at = state.since + split * state.duration - state.elapsed - clock.now();
    if (at <= 0) fireSplit();
    else splitTimer = clock.setTimeout(fireSplit, at);
  };

  /**
   * Gösterilen birimin kalan süresini kurar (oynarken). Zamanlayıcıyla geçildiyse sayaç önceki birimin bitmesi
   * gereken andan başlar (gecikme birikmez); ancak gecikme birimin süresini aştıysa (uzun takılma: sekme arka planda,
   * ağır çizim) şimdiden başlar: kaçırılan kelimeler art arda gösterilmez.
   */
  const schedule = () => {
    clearTimers();
    const now = clock.now();
    let start = carry ?? now;
    carry = null;
    if (now - start > state.duration) start = now;
    deadline = start + state.duration - state.elapsed;
    timer = clock.setTimeout(onTimer, Math.max(0, deadline - now));
    set({ since: start });
    armSplit();
  };

  /** RSVP: `word`. kelimeyi gösterir (oynuyorsa "yavaş başla" hızıyla ve zamanlayıcıyla) */
  const showWord = (word: number) => {
    clearTimers();
    const playing = state.status === 'playing';
    speed = playing && state.ramp ? rampSpeed(rampStep) : 1;
    if (playing) rampStep++;
    set({ word, elapsed: 0, since: null });
    set({ duration: durationNow() });
    if (splitAt !== null && word >= splitAt && !splitDone) fireSplit();
    if (playing) schedule();
  };

  /**
   * Etkin cümleyi değiştirir ve bildirir; sayaç sıfırlanır (oynuyorsa yeniden kurulur). RSVP'de `word` kelimesinden
   * (-1: son kelime) başlar.
   */
  const moveTo = (index: number, word = 0, notify = true) => {
    clearTimers();
    splitDone = false;
    const words = rsvp() ? splitWords(textOf(index)) : [];
    if (rsvp() && words.length === 0) words.push('');
    set({ current: index, words, word: 0, elapsed: 0, since: null });
    if (notify) opts.onSentence?.(index);
    const f = opts.splitOf?.(index) ?? null;
    split = f !== null && f > 0 && f < 1 ? f : null;
    splitAt = rsvp() ? splitWord(words, split) : null;
    if (rsvp()) return showWord(word < 0 ? words.length - 1 : Math.min(word, words.length - 1));
    set({ duration: durationNow() });
    if (state.status === 'playing') schedule();
  };

  const finish = () => {
    clearTimers();
    set({ status: 'idle', since: null, elapsed: 0 });
  };

  function advance() {
    const next = state.current + 1;
    if (next >= count) return finish();
    moveTo(next);
  }

  /** Zamanlayıcı: gösterilen birimin süresi doldu. Sonraki birim bu birimin bitmesi gereken andan sayılır. */
  function onTimer() {
    timer = null;
    carry = deadline;
    try {
      if (rsvp() && state.word + 1 < state.words.length) showWord(state.word + 1);
      else advance();
    } finally {
      carry = null;
    }
  }

  const clampIndex = (i: number) => Math.min(count - 1, Math.max(0, Math.floor(i)));

  /** Süre ayarı değişti: gösterilen birimin süresi yeniden hesaplanır, geçen süre korunur */
  const apply = (patch: Partial<SpeedSettings>) => {
    const playing = state.status === 'playing';
    const elapsed = elapsedNow();
    set({ ...patch, elapsed, since: null });
    set({ duration: durationNow() });
    if (playing) schedule();
  };

  const api: SpeedReader = {
    getState: () => state,

    play(from) {
      if (count === 0) return;
      clearTimers();
      rampStep = 0;
      set({ status: 'playing' });
      moveTo(clampIndex(from));
    },

    pause() {
      if (state.status !== 'playing') return;
      const elapsed = elapsedNow();
      clearTimers();
      set({ status: 'paused', elapsed, since: null });
    },

    resume() {
      if (state.status === 'playing') return;
      if (state.status === 'idle' || state.current < 0)
        return api.play(state.current < 0 ? 0 : state.current);
      set({ status: 'playing' });
      if (!rsvp()) return schedule();
      // RSVP: duraklatılan kelime yeniden gösterilir, "yavaş başla" baştan
      rampStep = 0;
      showWord(state.word);
    },

    toggle() {
      if (state.status === 'playing') api.pause();
      else api.resume();
    },

    stop() {
      clearTimers();
      set({ status: 'idle', since: null, elapsed: 0 });
    },

    next() {
      if (state.current + 1 >= count) return;
      moveTo(state.current + 1);
    },

    prev() {
      if (state.current <= 0) return;
      moveTo(state.current - 1);
    },

    stepWord(dir) {
      if (!rsvp() || state.current < 0) return;
      const word = state.word + dir;
      if (word >= 0 && word < state.words.length) return showWord(word);
      const next = state.current + dir;
      if (next < 0 || next >= count) return;
      moveTo(next, dir > 0 ? 0 : -1);
    },

    setMode(mode) {
      if (mode === state.mode) return;
      const words = mode === 'rsvp' || state.mode === 'rsvp';
      if (!words || state.current < 0) return apply({ mode });
      // RSVP'ye geçince ya da RSVP'den çıkınca etkin cümle baştan
      set({ mode });
      rampStep = 0;
      speed = 1;
      moveTo(state.current, 0, false);
    },
    setSeconds(seconds) {
      const s = clampSeconds(seconds);
      if (s !== state.seconds) apply({ seconds: s });
    },
    setWpm(wpm) {
      const w = clampWpm(wpm);
      if (w !== state.wpm) apply({ wpm: w });
    },
    setRsvpWpm(wpm) {
      const w = clampRsvpWpm(wpm);
      if (w !== state.rsvpWpm) apply({ rsvpWpm: w });
    },
    setRamp(ramp) {
      if (ramp !== state.ramp) set({ ramp });
    },

    setSplit(index, fraction) {
      if (index !== state.current || split !== null || splitDone) return;
      if (!(fraction > 0 && fraction < 1)) return;
      split = fraction;
      if (!rsvp()) return armSplit();
      // RSVP: son parçanın ilk kelimesine gelindiyse hemen (kelime adımında da, showWord gibi)
      splitAt = splitWord(state.words, split);
      if (splitAt !== null && state.word >= splitAt) fireSplit();
    },

    dispose() {
      clearTimers();
    },
  };
  return api;
}
