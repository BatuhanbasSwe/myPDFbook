import { CUSTOM_CACHE } from './customStore';
import { PIPER_CACHE } from './store';
import { PIPER_RUNTIME, type PiperVoice } from './voices';

/** Sentezlenen ses: tek kanal, [-1, 1] örnekler */
export interface Clip {
  pcm: Float32Array;
  sampleRate: number;
}

export interface SynthRequest {
  voice: PiperVoice;
  text: string;
  /** konuşma süresinin çarpanı (Piper `length_scale`, sesin kendi değeriyle çarpılır): 1 / hız */
  lengthScale: number;
}

/**
 * Sesin denenmesinde olmayan adım: ses motoru yüklenemedi, model açılamadı, girdileri Piper'ınki değil,
 * fonemleyici sesin dilini tanımıyor ya da model ses üretmedi
 */
export type CheckCode = 'runtime' | 'model' | 'inputs' | 'language' | 'inference';

/** Denemenin hatası: `code` hangi adımın olmadığını söyler (worker kapandıysa yok: "canceled") */
export type CheckError = Error & { code?: CheckCode };

/** Metinden ses üreten sentezleyici (tarayıcıda Web Worker; testlerde sahte) */
export interface PiperSynth {
  synthesize(req: SynthRequest): Promise<Clip>;
  /**
   * Sesi dener (kendi sesini ekle): model yüklenir ve bellekte kalır, girdileri denetlenir, `text` fonemleyiciyle
   * (sesin dili) ve modelle sentezlenir (`text` boşsa fonemleyicisiz). Olmazsa `CheckError` ile reddeder.
   */
  check(voice: PiperVoice, text: string): Promise<void>;
  /** belleği bırakır (model yüklüyse atılır); sonraki sentez yeniden yükler */
  dispose(): void;
}

/** Worker'a giden ve gelen iletiler */
export type WorkerRequest = {
  id: number;
  cache: string;
  /** sesin dosyaları ve önbelleği (kendi sesleri ayrı önbellekte) */
  voice: { key: string; model: string; config: string; cache: string };
  runtime: {
    ortWasm: string;
    phonemizerJs: string;
    phonemizerWasm: string;
    phonemizerData: string;
  };
  text: string;
  lengthScale: number;
  /** sentez değil deneme (kendi sesini ekle) */
  check?: boolean;
};
export type WorkerResponse =
  | { id: number; pcm: Float32Array; sampleRate: number; ms: number }
  | { id: number; error: string; code?: CheckCode };

/**
 * Web Worker'da Piper: ONNX Runtime Web (WASM, tek iş parçacığı) ve espeak-ng fonemleyicisi. Dosyaları worker Cache
 * Storage'dan kendisi okur (ana iş parçacığı yüzlerce MB'ı taşımaz). Worker ilk sentezde kurulur.
 */
export function createWorkerSynth(): PiperSynth {
  let worker: Worker | null = null;
  let next = 1;
  const pending = new Map<number, { resolve(c: Clip): void; reject(e: Error): void }>();

  const failAll = (message: string) => {
    for (const p of pending.values()) p.reject(new Error(message));
    pending.clear();
  };

  const ensure = (): Worker => {
    if (worker) return worker;
    const w = new Worker(new URL('./piper.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if ('error' in msg) p.reject(Object.assign(new Error(msg.error), { code: msg.code }));
      else p.resolve({ pcm: msg.pcm, sampleRate: msg.sampleRate });
    };
    w.onerror = (e) => {
      failAll(e.message || 'Piper worker hatası');
      w.terminate();
      if (worker === w) worker = null;
    };
    worker = w;
    return w;
  };

  const send = (voice: PiperVoice, text: string, lengthScale: number, check = false) => {
    const id = next++;
    const msg: WorkerRequest = {
      id,
      cache: PIPER_CACHE,
      voice: {
        key: voice.id,
        model: voice.model.url,
        config: voice.config.url,
        cache: voice.custom ? CUSTOM_CACHE : PIPER_CACHE,
      },
      runtime: {
        ortWasm: new URL(PIPER_RUNTIME.ortWasm.url, location.href).href,
        phonemizerJs: PIPER_RUNTIME.phonemizerJs.url,
        phonemizerWasm: PIPER_RUNTIME.phonemizerWasm.url,
        phonemizerData: PIPER_RUNTIME.phonemizerData.url,
      },
      text,
      lengthScale,
      ...(check ? { check } : {}),
    };
    return new Promise<Clip>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ensure().postMessage(msg);
    });
  };

  return {
    synthesize: ({ voice, text, lengthScale }) => send(voice, text, lengthScale),
    check: async (voice, text) => {
      await send(voice, text, 1, true);
    },
    dispose() {
      failAll('canceled');
      worker?.terminate();
      worker = null;
    },
  };
}
