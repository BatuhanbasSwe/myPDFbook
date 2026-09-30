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

/** Metinden ses üreten sentezleyici (tarayıcıda Web Worker; testlerde sahte) */
export interface PiperSynth {
  synthesize(req: SynthRequest): Promise<Clip>;
  /** belleği bırakır (model yüklüyse atılır); sonraki sentez yeniden yükler */
  dispose(): void;
}

/** Worker'a giden ve gelen iletiler */
export type WorkerRequest = {
  id: number;
  cache: string;
  voice: { key: string; model: string; config: string };
  runtime: {
    ortWasm: string;
    phonemizerJs: string;
    phonemizerWasm: string;
    phonemizerData: string;
  };
  text: string;
  lengthScale: number;
};
export type WorkerResponse =
  { id: number; pcm: Float32Array; sampleRate: number; ms: number } | { id: number; error: string };

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
      if ('error' in msg) p.reject(new Error(msg.error));
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

  return {
    synthesize({ voice, text, lengthScale }) {
      const id = next++;
      const msg: WorkerRequest = {
        id,
        cache: PIPER_CACHE,
        voice: { key: voice.id, model: voice.model.url, config: voice.config.url },
        runtime: {
          ortWasm: new URL(PIPER_RUNTIME.ortWasm.url, location.href).href,
          phonemizerJs: PIPER_RUNTIME.phonemizerJs.url,
          phonemizerWasm: PIPER_RUNTIME.phonemizerWasm.url,
          phonemizerData: PIPER_RUNTIME.phonemizerData.url,
        },
        text,
        lengthScale,
      };
      return new Promise<Clip>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ensure().postMessage(msg);
      });
    },
    dispose() {
      failAll('canceled');
      worker?.terminate();
      worker = null;
    },
  };
}
