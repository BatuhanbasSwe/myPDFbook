/**
 * Hızlı okuma denetleyicisi: cümle dizini üzerinde saf durum makinesi, saat dışarıdan verilir (testlerde sahte
 * zamanlayıcı). Her cümle belli bir süre etkin kalır, süre dolunca sonrakine geçilir. Süre sabittir (1–30 sn) ya da
 * dakikada kelimeden hesaplanır (en kısa süre ve virgül payıyla). Etkin cümle değişince okuyucuya bildirilir
 * (vurgu ve sayfa çevirme okuyucunun işidir). Sayfa sınırından taşan cümlede, süresinin sayfadaki payı dolunca
 * okuyucuya ayrıca haber verilir: sayfa cümlenin ortasında çevrilir.
 */
import { realClock, type Clock } from './clock';

export type SpeedMode = 'fixed' | 'wpm';

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
}

/**
 * Cümlenin süresi (ms). Sabit kipte ayarlanan süre; dakikada kelimede `kelime / wpm × 60 sn`, en az
 * MIN_SENTENCE_MS, üstüne her virgül, noktalı virgül ve iki nokta için PAUSE_MS.
 */
export function sentenceDuration(text: string, words: number, s: SpeedSettings): number {
  if (s.mode === 'fixed') return clampSeconds(s.seconds) * 1000;
  const pauses = text.match(/[,;:]/g)?.length ?? 0;
  const read = (Math.max(0, words) / clampWpm(s.wpm)) * 60_000;
  return Math.round(Math.max(MIN_SENTENCE_MS, read) + pauses * PAUSE_MS);
}

export type SpeedStatus = 'idle' | 'playing' | 'paused';

export interface SpeedState extends SpeedSettings {
  status: SpeedStatus;
  /** etkin cümle (dizideki indeks); -1: henüz yok */
  current: number;
  /** etkin cümlenin süresi (ms) */
  duration: number;
  /** etkin cümlede geçen süre, son başlatılışa dek (ms) */
  elapsed: number;
  /** oynuyorsa sayacın son başladığı an (clock.now); değilse null. Geçen süre: elapsed + (now - since) */
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
   * Cümle sayfa sınırından taşıyorsa ilk sayfadaki payı (0–1, ör. harf oranı); taşmıyorsa null. Cümle etkin
   * olunca sorulur; süresinin bu payı dolunca `onSplit` çağrılır (sayfa cümlenin ortasında çevrilir).
   */
  splitOf?(index: number): number | null;
  onSplit?(index: number): void;
}

export interface SpeedReader {
  getState(): SpeedState;
  /** `from` cümlesinden başlar */
  play(from: number): void;
  /** kalan süre korunur */
  pause(): void;
  /** duraklamışsa kalan süreyle sürer; durmuşsa etkin cümleden baştan başlar */
  resume(): void;
  toggle(): void;
  stop(): void;
  next(): void;
  prev(): void;
  /** Ayar hemen uygulanır: etkin cümlenin süresi yeniden hesaplanır, geçen süre korunur */
  setMode(mode: SpeedMode): void;
  setSeconds(seconds: number): void;
  setWpm(wpm: number): void;
  dispose(): void;
}

export function createSpeedReader(opts: SpeedReaderOptions): SpeedReader {
  const { count, textOf, wordsOf } = opts;
  const clock = opts.clock ?? realClock;
  let state: SpeedState = {
    status: 'idle',
    current: -1,
    mode: opts.settings?.mode === 'wpm' ? 'wpm' : 'fixed',
    seconds: clampSeconds(opts.settings?.seconds ?? SECONDS_RANGE.default),
    wpm: clampWpm(opts.settings?.wpm ?? WPM_RANGE.default),
    duration: 0,
    elapsed: 0,
    since: null,
  };
  let timer: unknown = null;
  let splitTimer: unknown = null;
  /** etkin cümlenin ilk sayfadaki payı (0–1) ve o anın bildirilip bildirilmediği */
  let split: number | null = null;
  let splitDone = false;

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

  const durationOf = (i: number, s: SpeedSettings = state) =>
    sentenceDuration(textOf(i), wordsOf(i), s);

  /** Geçen süre (oynuyorsa şu ana dek) */
  const elapsedNow = () =>
    state.elapsed + (state.since !== null ? Math.max(0, clock.now() - state.since) : 0);

  const fireSplit = () => {
    splitTimer = null;
    if (splitDone) return;
    splitDone = true;
    opts.onSplit?.(state.current);
  };

  /** Etkin cümlenin kalan süresini kurar (oynarken) */
  const schedule = () => {
    clearTimers();
    const elapsed = state.elapsed;
    timer = clock.setTimeout(advance, Math.max(0, state.duration - elapsed));
    if (split !== null && !splitDone) {
      const at = split * state.duration - elapsed;
      if (at <= 0) fireSplit();
      else splitTimer = clock.setTimeout(fireSplit, at);
    }
    set({ since: clock.now() });
  };

  /** Etkin cümleyi değiştirir ve bildirir; sayaç sıfırlanır (oynuyorsa yeniden kurulur) */
  const moveTo = (index: number) => {
    clearTimers();
    splitDone = false;
    set({ current: index, duration: durationOf(index), elapsed: 0, since: null });
    opts.onSentence?.(index);
    const f = opts.splitOf?.(index) ?? null;
    split = f !== null && f > 0 && f < 1 ? f : null;
    if (state.status === 'playing') schedule();
  };

  const finish = () => {
    clearTimers();
    set({ status: 'idle', since: null, elapsed: 0 });
  };

  function advance() {
    timer = null;
    const next = state.current + 1;
    if (next >= count) return finish();
    moveTo(next);
  }

  const clampIndex = (i: number) => Math.min(count - 1, Math.max(0, Math.floor(i)));

  /** Ayar değişti: etkin cümlenin süresi yeniden hesaplanır, geçen süre korunur */
  const apply = (patch: Partial<SpeedSettings>) => {
    const next = { ...state, ...patch };
    if (next.mode === state.mode && next.seconds === state.seconds && next.wpm === state.wpm)
      return;
    const playing = state.status === 'playing';
    const elapsed = elapsedNow();
    set({
      ...patch,
      duration: state.current >= 0 ? durationOf(state.current, next) : 0,
      elapsed,
      since: null,
    });
    if (playing) schedule();
  };

  const api: SpeedReader = {
    getState: () => state,

    play(from) {
      if (count === 0) return;
      clearTimers();
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
      schedule();
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

    setMode: (mode) => apply({ mode }),
    setSeconds: (seconds) => apply({ seconds: clampSeconds(seconds) }),
    setWpm: (wpm) => apply({ wpm: clampWpm(wpm) }),

    dispose() {
      clearTimers();
    },
  };
  return api;
}
