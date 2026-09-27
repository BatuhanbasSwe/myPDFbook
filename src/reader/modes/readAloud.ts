/**
 * Sesli okuma denetleyicisi: cümle dizini üzerinde saf durum makinesi. Konuşma motoru ve saat dışarıdan verilir
 * (tarayıcıda Web Speech API, testlerde sahte motor ve sahte zamanlayıcı). Her cümle ayrı bir konuşmadır (uzun cümle
 * birkaç parça); sonraki cümle önceki bitince başlar. Etkin cümle değişince okuyucuya bildirilir (vurgu ve sayfa
 * çevirme okuyucunun işidir).
 *
 * Tarayıcı motorları olay kaçırır: Chrome uzun konuşmayı ~15 sn'de keser, iOS arka planda ya da kilitlenince susar,
 * WebKit dokunuş dışındaki konuşmayı yok sayabilir, iOS `cancel`dan hemen sonra sahte "interrupted" gönderir. Bu
 * yüzden: uzun cümle kısa parçalarla okunur, bekçi motor sustuğu hâlde bitiş gelmezse konuşmayı sürdürür, erken gelen
 * kesilme bir kez yeniden denenir.
 */

export const RATE_RANGE = { min: 0.5, max: 2, default: 1 } as const;

/** Çubuktaki hız seçenekleri */
export const RATE_CHOICES = [0.75, 1, 1.25, 1.5, 2] as const;

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return RATE_RANGE.default;
  return Math.min(RATE_RANGE.max, Math.max(RATE_RANGE.min, Math.round(rate * 100) / 100));
}

/** Tek konuşmanın en uzun metni (karakter): Chrome daha uzun konuşmayı yarıda keser ve bitiş olayı göndermez */
export const MAX_CHUNK = 250;

/**
 * Konuşma parçaları: `max`tan uzun metin, parçanın ikinci yarısındaki son virgül, noktalı virgül ya da iki noktadan
 * (yoksa son boşluktan, o da yoksa `max`tan) bölünür. Yalnızca okuma içindir: vurgu cümlenin tamamındadır.
 */
export function speechChunks(text: string, max = MAX_CHUNK): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    let cut = -1;
    for (let i = window.length - 1; i >= max / 2; i--) {
      if (/[,;:]/.test(window[i]) && /\s/.test(rest[i + 1] ?? ' ')) {
        cut = i + 1;
        break;
      }
    }
    if (cut < 0) {
      const space = window.lastIndexOf(' ');
      cut = space > 0 ? space : max;
    }
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Motora verilen tek konuşma */
export interface SpeakRequest {
  text: string;
  /** BCP 47: "tr-TR", "en-US" */
  lang: string;
  rate: number;
  /** ses kimliği (voiceURI); null: dilin varsayılan sesi */
  voice: string | null;
}

export interface SpeakHandlers {
  /** konuşma sesli başladı (motor bildirebiliyorsa) */
  start(): void;
  end(): void;
  /** `SpeechSynthesisErrorEvent.error`: "interrupted", "canceled", "not-allowed", "synthesis-failed" … */
  error(code: string): void;
}

/** Konuşma motoru: bir konuşma başlatır ya da süreni keser. */
export interface SpeechEngine {
  speak(req: SpeakRequest, handlers: SpeakHandlers): void;
  cancel(): void;
  /**
   * Motor konuşuyor ya da sırada konuşma var (duraklatılmış değil). Verilirse bekçi bununla takılmayı anlar: motor
   * sustuğu hâlde konuşmanın bitişi gelmediyse konuşma sürdürülür.
   */
  busy?(): boolean;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export type ReadAloudStatus = 'idle' | 'playing' | 'paused';

export interface ReadAloudState {
  status: ReadAloudStatus;
  /** etkin cümle (dizideki indeks); -1: henüz yok */
  current: number;
  rate: number;
  voice: string | null;
  /** uyku zamanlayıcısının dolacağı an (clock.now birimi); null: kapalı */
  sleepAt: number | null;
  /** okuma bir hatayla durdu ("not-allowed": ses izni yok, "failed": ses çalınamıyor); null: hata yok */
  error: 'not-allowed' | 'failed' | null;
}

export interface ReadAloudOptions {
  engine: SpeechEngine;
  /** cümle sayısı */
  count: number;
  /** okunacak metin (boşsa cümle atlanır) */
  textOf(index: number): string;
  lang: string;
  rate?: number;
  voice?: string | null;
  clock?: Clock;
  onChange?(state: ReadAloudState): void;
  /** etkin cümle değişti (oynatma, ilerleme, önceki/sonraki): okuyucu vurgular, gerekirse sayfayı çevirir */
  onSentence?(index: number): void;
}

export interface ReadAloud {
  getState(): ReadAloudState;
  /** `from` cümlesinden okumaya başlar (kullanıcının dokunuşunda doğrudan çağrılmalı: iOS) */
  play(from: number): void;
  pause(): void;
  resume(): void;
  /** oynuyorsa duraklatır; duraklamışsa ya da durmuşsa kaldığı yerden sürdürür */
  toggle(): void;
  stop(): void;
  next(): void;
  prev(): void;
  /** hız hemen uygulanır: okunan cümle yeni hızla baştan okunur */
  setRate(rate: number): void;
  /** `restart` (varsayılan): okunan cümle yeni sesle baştan okunur; değilse ses sonraki konuşmadan geçerli olur */
  setVoice(voice: string | null, restart?: boolean): void;
  /** uyku zamanlayıcısı: dakika sonra (okunan cümle bitince) duraklar; null kapatır */
  setSleep(minutes: number | null): void;
  /** okuyorsa okunan parçayı yeniden okur (sayfa yeniden görünür oldu: iOS arka planda konuşmayı keser) */
  restart(): void;
  dispose(): void;
}

/** Üst üste bu kadar cümle okunamazsa okuma durur (ses yok, motor bozuk): kitap boşuna taranmasın */
const MAX_ERRORS = 3;
/** Bekçinin motoru yokladığı aralık ve motorun konuşmadan susabileceği en uzun süre (ms) */
const WATCH_MS = 500;
const STALL_MS = 1_500;
/** Hiç başlamayan konuşma bu kadar kez yeniden denenir; sonra okuma dokunuş bekler (WebKit, dokunuş dışında) */
const MAX_STALLS = 3;
/** Konuşma başlamadan ya da bizim başlatmamızdan bu kadar süre içinde gelen kesilme sahtedir (iOS, `cancel` sonrası) */
const SPURIOUS_MS = 300;
/** Sahte kesilmeden sonra konuşma bu kadar beklenip bir kez yeniden başlatılır (ms) */
const RETRY_MS = 50;

/** Süren konuşma: cümlenin kaçıncı parçası, sesli başladı mı, ne zaman başlatıldı, yeniden denendi mi */
interface Utterance {
  chunk: number;
  started: boolean;
  at: number;
  retried: boolean;
}

export function createReadAloud(opts: ReadAloudOptions): ReadAloud {
  const { engine, count, textOf, lang } = opts;
  const clock = opts.clock ?? realClock;
  let state: ReadAloudState = {
    status: 'idle',
    current: -1,
    rate: clampRate(opts.rate ?? RATE_RANGE.default),
    voice: opts.voice ?? null,
    sleepAt: null,
    error: null,
  };
  /** her konuşmanın kimliği: kesilen konuşmanın geç gelen olayları yok sayılır */
  let token = 0;
  /** motorda süren konuşma var mı */
  let speaking = false;
  /** etkin cümlenin konuşma parçaları ve süren parça */
  let chunks: string[] = [];
  let utt: Utterance | null = null;
  let errors = 0;
  let stalls = 0;
  let sleepTimer: unknown = null;
  /** uyku süresi doldu: okunan cümle bitince duraklar */
  let sleepDue = false;
  let watchTimer: unknown = null;
  /** motorun konuşmadan sustuğu an (bekçi) */
  let idleSince: number | null = null;

  const set = (patch: Partial<ReadAloudState>) => {
    state = { ...state, ...patch };
    opts.onChange?.(state);
  };

  const halt = () => {
    token++;
    if (speaking) engine.cancel();
    speaking = false;
  };

  const clearSleep = () => {
    if (sleepTimer !== null) clock.clearTimeout(sleepTimer);
    sleepTimer = null;
    sleepDue = false;
  };

  /** Etkin cümleyi değiştirir ve bildirir */
  const moveTo = (index: number) => {
    set({ current: index });
    opts.onSentence?.(index);
  };

  /** Etkin cümlenin `chunk`. parçasını okur */
  const speakChunk = (chunk: number, retried = false) => {
    const my = ++token;
    speaking = true;
    idleSince = null;
    const u: Utterance = { chunk, started: false, at: clock.now(), retried };
    utt = u;
    engine.speak(
      { text: chunks[chunk], lang, rate: state.rate, voice: state.voice },
      {
        start: () => {
          if (my !== token) return;
          u.started = true;
          stalls = 0;
        },
        end: () => {
          if (my === token) onChunkEnd();
        },
        error: (code) => {
          if (my === token) onError(code);
        },
      },
    );
    watch();
  };

  /** Etkin cümleden başlayarak okunacak metni olan ilk cümleyi okur; kitap bittiyse durur. */
  const speakCurrent = () => {
    halt();
    let i = state.current;
    while (i < count && !textOf(i).trim()) i++;
    if (i >= count) {
      finish();
      return;
    }
    if (i !== state.current) moveTo(i);
    chunks = speechChunks(textOf(i));
    speakChunk(0);
  };

  const finish = () => {
    halt();
    clearSleep();
    set({ status: 'idle', sleepAt: null });
  };

  /** Parça bitti: sonraki parça ya da (cümle bittiyse) sonraki cümle */
  const onChunkEnd = () => {
    speaking = false;
    const next = (utt?.chunk ?? chunks.length) + 1;
    if (next < chunks.length) return speakChunk(next);
    errors = 0;
    advance();
  };

  /** Sonraki cümleye geçer (uyku süresi dolduysa duraklar) */
  const advance = () => {
    speaking = false;
    const next = state.current + 1;
    if (next >= count) return finish();
    moveTo(next);
    // Zamanlayıcı arka planda (iOS) geç çalışabilir: süre saatle de denetlenir
    if (sleepDue || (state.sleepAt !== null && clock.now() >= state.sleepAt)) {
      clearSleep();
      set({ status: 'paused', sleepAt: null });
      return;
    }
    speakCurrent();
  };

  const onError = (code: string) => {
    speaking = false;
    if (code === 'interrupted' || code === 'canceled') {
      // Konuşma başlamadan ya da hemen gelen kesilme sahtedir (iOS, cancel sonrası): bir kez yeniden denenir
      const u = utt;
      if (u && !u.retried && (!u.started || clock.now() - u.at < SPURIOUS_MS)) {
        const my = token;
        clock.setTimeout(() => {
          if (my === token && state.status === 'playing') speakChunk(u.chunk, true);
        }, RETRY_MS);
        return;
      }
      // Kesme bizden değilse (başka uygulama sesi aldı, telefon çaldı): duraklar, sürdürülebilir
      return set({ status: 'paused' });
    }
    if (code === 'not-allowed') {
      halt();
      return set({ status: 'paused', error: 'not-allowed' });
    }
    // Okunamayan cümle atlanır; üst üste çok hata varsa ses çalınamıyordur
    if (++errors >= MAX_ERRORS) {
      halt();
      errors = 0;
      return set({ status: 'paused', error: 'failed' });
    }
    advance();
  };

  /**
   * Motor sustu ama konuşmanın bitişi gelmedi: konuşma başlamışsa bitmiş sayılır (sonraki parça), hiç başlamadıysa
   * yeniden okunur. Başlamayan konuşma üst üste MAX_STALLS kez olursa okuma dokunuş bekler.
   */
  const stalled = () => {
    const u = utt;
    if (!u) return;
    if (u.started) {
      token++;
      return onChunkEnd();
    }
    halt();
    if (++stalls >= MAX_STALLS) {
      stalls = 0;
      return set({ status: 'paused', error: 'not-allowed' });
    }
    speakChunk(u.chunk);
  };

  /** Bekçi: okurken motor yoklanır (motor `busy` bildiremiyorsa çalışmaz) */
  const watch = () => {
    if (watchTimer !== null || !engine.busy) return;
    watchTimer = clock.setTimeout(() => {
      watchTimer = null;
      if (state.status !== 'playing') return;
      if (!speaking || engine.busy?.()) idleSince = null;
      else {
        const now = clock.now();
        idleSince ??= now;
        if (now - idleSince >= STALL_MS) {
          idleSince = null;
          stalled();
        }
      }
      watch();
    }, WATCH_MS);
  };

  const stopWatch = () => {
    if (watchTimer !== null) clock.clearTimeout(watchTimer);
    watchTimer = null;
    idleSince = null;
  };

  const clampIndex = (i: number) => Math.min(count - 1, Math.max(0, Math.floor(i)));

  /** `from`dan `dir` yönünde okunacak metni olan ilk cümle; yoksa -1 */
  const spoken = (from: number, dir: 1 | -1): number => {
    for (let i = from; i >= 0 && i < count; i += dir) if (textOf(i).trim()) return i;
    return -1;
  };

  const api: ReadAloud = {
    getState: () => state,

    play(from) {
      if (count === 0) return;
      errors = 0;
      stalls = 0;
      set({ status: 'playing', error: null });
      moveTo(clampIndex(from));
      speakCurrent();
    },

    pause() {
      if (state.status !== 'playing') return;
      halt();
      stopWatch();
      sleepDue = false;
      set({ status: 'paused' });
    },

    resume() {
      if (state.status === 'playing') return;
      api.play(state.current < 0 ? 0 : state.current);
    },

    toggle() {
      if (state.status === 'playing') api.pause();
      else api.resume();
    },

    stop() {
      halt();
      stopWatch();
      clearSleep();
      set({ status: 'idle', sleepAt: null, error: null });
    },

    next() {
      const i = spoken(state.current + 1, 1);
      if (i < 0) return;
      moveTo(i);
      if (state.status === 'playing') speakCurrent();
    },

    prev() {
      const i = spoken(state.current - 1, -1);
      if (i < 0) return;
      moveTo(i);
      if (state.status === 'playing') speakCurrent();
    },

    setRate(rate) {
      const r = clampRate(rate);
      if (r === state.rate) return;
      set({ rate: r });
      if (state.status === 'playing') speakCurrent();
    },

    setVoice(voice, restart = true) {
      if (voice === state.voice) return;
      set({ voice });
      if (restart && state.status === 'playing') speakCurrent();
    },

    setSleep(minutes) {
      clearSleep();
      if (minutes === null || !(minutes > 0)) return set({ sleepAt: null });
      const ms = minutes * 60_000;
      sleepTimer = clock.setTimeout(() => {
        sleepTimer = null;
        set({ sleepAt: null });
        // Duraklamışsa bir şey yapılmaz; okuyorsa okunan cümle bitince durur
        if (state.status === 'playing') sleepDue = true;
      }, ms);
      set({ sleepAt: clock.now() + ms });
    },

    restart() {
      if (state.status !== 'playing' || !utt || chunks.length === 0) return;
      const chunk = utt.chunk;
      halt();
      speakChunk(chunk);
    },

    dispose() {
      halt();
      stopWatch();
      clearSleep();
    },
  };
  return api;
}

/** Tarayıcı sesinin özeti (SpeechSynthesisVoice'tan) */
export interface VoiceInfo {
  /** voiceURI */
  id: string;
  name: string;
  lang: string;
  /** tarayıcının varsayılan sesi */
  isDefault: boolean;
  /** cihazda (çevrimdışı çalışır) */
  local: boolean;
}

/** Kitabın dilinin konuşma dili ("other": belirsiz, tarayıcının dili) */
export function speechLang(lang: string): string {
  if (lang === 'tr') return 'tr-TR';
  if (lang === 'en') return 'en-US';
  return typeof navigator !== 'undefined' ? navigator.language : 'tr-TR';
}

/** Kitabın diline uyan sesler (dil bilinmiyorsa hepsi), ada göre sıralı */
export function voicesFor(voices: VoiceInfo[], lang: string): VoiceInfo[] {
  const prefix = lang === 'tr' || lang === 'en' ? lang : null;
  const norm = (l: string) => l.toLowerCase().replace('_', '-');
  return voices
    .filter((v) => !prefix || norm(v.lang) === prefix || norm(v.lang).startsWith(`${prefix}-`))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

/**
 * Kullanılacak ses: kayıtlı ses bu dilde varsa o; yoksa tarayıcının varsayılanı (bu dildeyse), sonra dilin ana
 * bölgesindeki (tr-TR, en-US) cihaz sesi, sonra ilk ses. Hiç ses yoksa null (konuşma yalnızca dille başlar).
 */
export function pickVoice(voices: VoiceInfo[], lang: string, saved?: string | null): string | null {
  const list = voicesFor(voices, lang);
  if (saved && list.some((v) => v.id === saved)) return saved;
  const region = speechLang(lang).toLowerCase();
  const best =
    list.find((v) => v.isDefault) ??
    list.find((v) => v.local && v.lang.toLowerCase().replace('_', '-') === region) ??
    list.find((v) => v.lang.toLowerCase().replace('_', '-') === region) ??
    list.find((v) => v.local) ??
    list[0];
  return best?.id ?? null;
}

/** Konuşmaya uygun metin: dipnot imleri (¹, †) ve yumuşak tireler okunmaz */
export function speakable(text: string): string {
  return text
    .replace(/\p{Cf}/gu, '') // yumuşak tire, sıfır genişlikli boşluklar
    .replace(/[¹²³⁰-⁹†‡]+/g, '')
    .trim();
}
