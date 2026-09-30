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

import { realClock, type Clock } from './clock';

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
  /**
   * Kaç konuşma önceden hazırlansın (sinir ağı sesi sentezi zaman alır). Verilirse denetleyici her konuşmayı
   * başlattıktan sonra sıradaki bu kadar konuşmayı `prefetch` ile bildirir.
   */
  readonly lookahead?: number;
  /** sıradaki konuşmalar (okunma sırasıyla): motor önceden hazırlayabilir */
  prefetch?(next: SpeakRequest[]): void;
}

export type { Clock } from './clock';

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
    const ahead = engine.lookahead ?? 0;
    if (ahead > 0 && engine.prefetch) engine.prefetch(upcoming(chunk, ahead));
    watch();
  };

  /** Etkin cümlenin `chunk`. parçasından sonra okunacak en çok `n` konuşma (sonraki cümlelere de geçer) */
  const upcoming = (chunk: number, n: number): SpeakRequest[] => {
    const out: SpeakRequest[] = [];
    const req = (text: string) => ({ text, lang, rate: state.rate, voice: state.voice });
    for (let c = chunk + 1; c < chunks.length && out.length < n; c++) out.push(req(chunks[c]));
    // Boş cümleler atlanır; çok uzağa bakılmaz
    for (let i = state.current + 1; i < count && i <= state.current + 20 && out.length < n; i++) {
      const text = textOf(i);
      if (!text.trim()) continue;
      for (const part of speechChunks(text)) {
        if (out.length >= n) break;
        out.push(req(part));
      }
    }
    return out;
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

/**
 * Sistem sesinin kalitesi: "premium" (Apple Premium, Edge/Windows doğal sesleri), "enhanced" (Apple Gelişmiş),
 * "default" (sıkıştırılmış ya da eski sesler)
 */
export type VoiceQuality = 'premium' | 'enhanced' | 'default';

/** Adda ya da kimlikte premium işaretleri: Apple "(Premium)", ".premium.", Edge "Online (Natural)", Azure "Neural" */
const PREMIUM = /premium|\bnatural\b|\bneural\b/i;
/** Gelişmiş ses işaretleri: Apple ".enhanced." ve sistem diline göre ad eki ("(Enhanced)", "(Gelişmiş)" …) */
const ENHANCED =
  /enhanced|geli[şs]mi[şs]|geli[şs]tirilmi[şs]|erweitert|am[ée]lior[ée]e?|mejorad[ao]|avanzat[ao]|ottimizzat[ao]|melhorad[ao]|verbeterd|f[öo]rb[äa]ttrad|forbedret|parannettu|ulepszon[ya]/i;
/**
 * Okumaya uygun olmayan sesler: macOS'un eğlence sesleri (Bubbles, Zarvox …) ve Eloquence sesleri (Eddy, Flo …).
 * Kalitesi "default" sayılır, en sona konur.
 */
const NOVELTY =
  /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|pipe organ|superstar|trinoids|whisper|wobble|zarvox|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b|eloquence/i;

/** Sesin kalitesi: ad ve kimlikteki işaretlerden (iOS, macOS, Chrome, Edge/Windows biçimleri) */
export function classifyVoice(v: Pick<VoiceInfo, 'id' | 'name'>): VoiceQuality {
  const text = `${v.id} ${v.name}`;
  if (PREMIUM.test(text)) return 'premium';
  if (ENHANCED.test(text)) return 'enhanced';
  return 'default';
}

/** Daha iyi ses önce: kalite, okumaya uygunluk */
function voiceScore(v: VoiceInfo): number {
  const quality = { premium: 2, enhanced: 1, default: 0 }[classifyVoice(v)];
  return quality * 10 - (NOVELTY.test(`${v.id} ${v.name}`) ? 5 : 0);
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
 * Kullanılacak ses: kayıtlı ses bu dilde varsa o; yoksa bu dilin en iyi cihaz sesi (cihazda ses yoksa en iyi ağ
 * sesi). Eşit kalitede önce tarayıcının varsayılanı, sonra dilin ana bölgesindeki (tr-TR, en-US) ses. Hiç ses yoksa
 * null (konuşma yalnızca dille başlar).
 */
export function pickVoice(voices: VoiceInfo[], lang: string, saved?: string | null): string | null {
  const list = voicesFor(voices, lang);
  if (saved && list.some((v) => v.id === saved)) return saved;
  const region = speechLang(lang).toLowerCase();
  const local = list.filter((v) => v.local);
  const pool = local.length > 0 ? local : list;
  const score = (v: VoiceInfo) =>
    voiceScore(v) * 4 +
    (v.isDefault ? 2 : 0) +
    (v.lang.toLowerCase().replace('_', '-') === region ? 1 : 0);
  // Sıralama kararlı: eşitlikte ada göre (voicesFor)
  const best = [...pool].sort((a, b) => score(b) - score(a))[0];
  return best?.id ?? null;
}

/** Ses menüsünün grupları: gelişmiş (premium ve gelişmiş) ve standart sesler; gruplar içinde iyi ses önce */
export function voiceGroups(voices: VoiceInfo[]): { enhanced: VoiceInfo[]; standard: VoiceInfo[] } {
  const sorted = [...voices].sort((a, b) => voiceScore(b) - voiceScore(a));
  return {
    enhanced: sorted.filter((v) => classifyVoice(v) !== 'default'),
    standard: sorted.filter((v) => classifyVoice(v) === 'default'),
  };
}

/** Bu dilde cihazda gelişmiş (ya da premium) bir ses var mı: yoksa menüde indirme yolu gösterilir */
export function hasEnhancedVoice(voices: VoiceInfo[]): boolean {
  return voices.some((v) => v.local && classifyVoice(v) !== 'default');
}

/** Konuşmaya uygun metin: dipnot imleri (¹, †) ve yumuşak tireler okunmaz */
export function speakable(text: string): string {
  return text
    .replace(/\p{Cf}/gu, '') // yumuşak tire, sıfır genişlikli boşluklar
    .replace(/[¹²³⁰-⁹†‡]+/g, '')
    .trim();
}
