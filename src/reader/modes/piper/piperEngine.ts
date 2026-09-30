import type { SpeakHandlers, SpeakRequest, SpeechEngine } from '../readAloud';
import type { AudioOut } from './audio';
import type { Clip, PiperSynth } from './synth';
import { piperVoice, type PiperVoice } from './voices';

/**
 * Piper konuşma motoru: denetleyicinin (readAloud.ts) bir konuşması sentezlenir (worker) ve Web Audio ile çalınır.
 * Okunan konuşma çalarken sıradakiler önceden sentezlenir (`prefetch`): cümleler arasında boşluk olmaz.
 *
 * - Sentez sırası: okunacak konuşma her zaman önce; önceden hazırlananlar okunma sırasıyla, birer birer.
 * - `cancel`: çalan ses durur, sıradaki sentezler bırakılır (sürmekte olan tek sentez biter, sonucu saklanır).
 * - `busy`: okunacak ses sentezleniyor ya da ses bağlamı çalışırken çalıyor. Bağlam askıdaysa (iOS) meşgul
 *   sayılmaz: denetleyicinin bekçisi konuşmayı yeniden dener, olmazsa dokunuş bekler.
 * - Hız: `length_scale = 1 / hız` (perde değişmez).
 */

export interface PiperEngine extends SpeechEngine {
  prime(): void;
  /** belleği bırakır (worker ve ses bağlamı) */
  dispose(): void;
  /** önceden sentezlenecek konuşma sayısı: sentez yavaşsa (gerçek zaman oranı yüksek) artar */
  readonly lookahead: number;
  /** okunacak ses hazırlanıyor mu (ilk cümlede model de yüklenir): değişince bildirilir */
  onPreparing(listener: ((preparing: boolean) => void) | null): void;
}

export interface PiperEngineOptions {
  synth: PiperSynth;
  audio: AudioOut;
  /** sesin tanımı (bilinmiyorsa konuşma hata verir) */
  voice?(id: string): PiperVoice | undefined;
  /** önceden sentezlenecek konuşma sayısı */
  lookahead?: number;
  /** sentez süresi (ms) ve üretilen sesin süresi (ms): ölçüm için */
  onTiming?(synthMs: number, audioMs: number): void;
}

/** Hız → Piper `length_scale` */
export function lengthScale(rate: number): number {
  return rate > 0 ? 1 / rate : 1;
}

/** Önbellekte en çok bu kadar hazır ses tutulur (22 kHz'de ~10 sn'lik ses ~1 MB) */
const MAX_CLIPS = 8;
/** Sentez bu gerçek zaman oranını (sentez süresi / ses süresi) aşarsa daha çok konuşma önceden hazırlanır */
const SLOW_RTF = 0.75;
const SLOW_LOOKAHEAD = 4;

interface Job {
  key: string;
  voice: PiperVoice;
  text: string;
  scale: number;
  resolve(c: Clip): void;
  reject(e: Error): void;
}

export function createPiperEngine(opts: PiperEngineOptions): PiperEngine {
  const { synth, audio } = opts;
  const findVoice = opts.voice ?? piperVoice;
  const clips = new Map<string, Promise<Clip>>();
  const queue: Job[] = [];
  let running: Job | null = null;
  /** okunan konuşma: `ready` ses hazır mı, `stop` çalıyorsa durdurma */
  let current: { token: number; ready: boolean; stop: (() => void) | null } | null = null;
  let token = 0;
  const baseLookahead = opts.lookahead ?? 2;
  /** gerçek zaman oranının yürüyen ortalaması (ilk sentez model yüklemesini de içerdiği için sayılmaz) */
  let rtf: number | null = null;
  let timings = 0;
  let preparingListener: ((preparing: boolean) => void) | null = null;
  let preparing = false;
  const setPreparing = (value: boolean) => {
    if (value === preparing) return;
    preparing = value;
    preparingListener?.(value);
  };

  const keyOf = (req: SpeakRequest) =>
    `${req.voice}\u0000${lengthScale(req.rate)}\u0000${req.text}`;

  const pump = () => {
    if (running || queue.length === 0) return;
    const job = queue.shift()!;
    running = job;
    const t0 = performance.now();
    synth
      .synthesize({ voice: job.voice, text: job.text, lengthScale: job.scale })
      .then(
        (clip) => {
          const synthMs = performance.now() - t0;
          const audioMs = (clip.pcm.length / clip.sampleRate) * 1000;
          opts.onTiming?.(synthMs, audioMs);
          if (timings++ > 0 && audioMs > 0) {
            const r = synthMs / audioMs;
            rtf = rtf === null ? r : rtf * 0.7 + r * 0.3;
          }
          job.resolve(clip);
        },
        (err: unknown) => {
          clips.delete(job.key);
          job.reject(err instanceof Error ? err : new Error(String(err)));
        },
      )
      .finally(() => {
        running = null;
        pump();
      });
  };

  /** Konuşmanın sesi: hazırsa önbellekten, değilse sıraya (öne ya da arkaya) konur */
  const request = (req: SpeakRequest, urgent: boolean): Promise<Clip> | null => {
    const key = keyOf(req);
    const known = clips.get(key);
    if (known) {
      // Sırada bekliyorsa öne alınır
      const i = queue.findIndex((j) => j.key === key);
      if (urgent && i > 0) queue.unshift(...queue.splice(i, 1));
      return known;
    }
    const voice = req.voice ? findVoice(req.voice) : undefined;
    if (!voice) return null;
    let job!: Job;
    const promise = new Promise<Clip>((resolve, reject) => {
      job = { key, voice, text: req.text, scale: lengthScale(req.rate), resolve, reject };
    });
    promise.catch(() => undefined); // bırakılan iş: bekleyen yok
    clips.set(key, promise);
    while (clips.size > MAX_CLIPS) clips.delete(clips.keys().next().value!);
    if (urgent) queue.unshift(job);
    else queue.push(job);
    pump();
    return promise;
  };

  /** Sıradaki (başlamamış) sentezleri bırakır */
  const dropQueue = () => {
    for (const job of queue.splice(0)) {
      clips.delete(job.key);
      job.reject(new Error('canceled'));
    }
  };

  const engine: PiperEngine = {
    get lookahead() {
      return rtf !== null && rtf > SLOW_RTF
        ? Math.max(baseLookahead, SLOW_LOOKAHEAD)
        : baseLookahead;
    },

    onPreparing(listener) {
      preparingListener = listener;
    },

    speak(req, handlers: SpeakHandlers) {
      engine.cancel();
      const my = ++token;
      const cur: NonNullable<typeof current> = { token: my, ready: false, stop: null };
      current = cur;
      // Önceden hazırlanmamış sıradaki işler bırakılır: okunacak olan hemen sentezlensin
      const promise = request(req, true);
      if (!promise) {
        current = null;
        setPreparing(false);
        queueMicrotask(() => handlers.error('synthesis-failed'));
        return;
      }
      setPreparing(true);
      promise.then(
        (clip) => {
          if (current !== cur) return;
          cur.ready = true;
          setPreparing(false);
          try {
            cur.stop = audio.play(
              clip,
              () => {
                if (current === cur) handlers.start();
              },
              () => {
                if (current !== cur) return;
                current = null;
                handlers.end();
              },
            );
          } catch {
            // Ses çalınamıyor (Web Audio yok ya da bozuk)
            current = null;
            handlers.error('audio-failed');
          }
        },
        () => {
          if (current !== cur) return;
          current = null;
          setPreparing(false);
          handlers.error('synthesis-failed');
        },
      );
    },

    prefetch(next) {
      for (const req of next.slice(0, engine.lookahead)) request(req, false);
    },

    cancel() {
      token++;
      const cur = current;
      current = null;
      cur?.stop?.();
      setPreparing(false);
      dropQueue();
    },

    busy() {
      if (!current) return false;
      return !current.ready || audio.running();
    },

    prime() {
      audio.prime();
    },

    dispose() {
      engine.cancel();
      clips.clear();
      synth.dispose();
      audio.dispose();
    },
  };
  return engine;
}
