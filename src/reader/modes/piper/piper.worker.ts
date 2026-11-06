import * as ort from 'onnxruntime-web/wasm';
import { missingInputs, phonemeIds, runVoice, soundOk, type VoiceConfig } from './piperModel';
import type { CheckCode, WorkerRequest, WorkerResponse } from './synth';

/**
 * Piper sentezi (Web Worker): metin → espeak-ng ses birimleri → VITS modeli (ONNX Runtime Web, WASM) → ses.
 * Dosyalar Cache Storage'dan okunur (store.ts indirdi, customStore.ts kaydetti); ağ kullanılmaz, çevrimdışı
 * çalışır.
 *
 * espeak-ng fonemleyicisi (GPL-3.0) uygulamanın kodunda değildir: ayrı indirilen Emscripten programıdır. Burada
 * komut satırı argümanlarıyla çalıştırılır, çıktısı (JSON) okunur.
 *
 * `check` isteği (kendi sesini ekle): model yüklenir (bellekte kalır: ses seçilince hemen okur), girdileri
 * denetlenir, deneme cümlesi fonemleyiciyle (sesin dili) ve modelle sentezlenir. Hata kodu, hangi adımın
 * olmadığını söyler.
 */

/** Worker'ın genel nesnesi (uygulamanın tsconfig'i DOM kitaplığıyla: yalnızca kullanılan alanlar) */
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
};

/** Emscripten modülü (fonemleyici) */
interface PhonemizerModule {
  callMain(args: string[]): number;
}
type CreatePhonemizer = (opts: Record<string, unknown>) => Promise<PhonemizerModule>;

async function read(cacheName: string, url: string): Promise<ArrayBuffer> {
  const res = await (await caches.open(cacheName)).match(url);
  if (!res) throw new Error(`Dosya cihazda yok: ${url}`);
  return res.arrayBuffer();
}

let phonemizer: Promise<{ module: PhonemizerModule; out: string[] }> | null = null;
interface Loaded {
  key: string;
  session: ort.InferenceSession;
  config: VoiceConfig;
}
let loaded: Loaded | null = null;
let loading: Promise<Loaded> | null = null;
let ortReady: Promise<void> | null = null;

function initOrt(msg: WorkerRequest): Promise<void> {
  ortReady ??= (async () => {
    // Çapraz köken yalıtımı yok (SharedArrayBuffer'sız): tek iş parçacığı. WASM Cache Storage'dan verilir.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmBinary = await read(msg.cache, msg.runtime.ortWasm);
  })();
  // Başarısızsa (dosya yoktu) sonraki sentez yeniden dener
  ortReady.catch(() => {
    ortReady = null;
  });
  return ortReady;
}

function initPhonemizer(msg: WorkerRequest) {
  phonemizer ??= (async () => {
    const [js, wasm, data] = await Promise.all([
      read(msg.cache, msg.runtime.phonemizerJs),
      read(msg.cache, msg.runtime.phonemizerWasm),
      read(msg.cache, msg.runtime.phonemizerData),
    ]);
    // Emscripten betiği `createPiperPhonemize` işlevini tanımlar (klasik betik: module worker'da içe aktarılamaz)
    const source = new TextDecoder().decode(js);
    const create = new Function(`${source}\nreturn createPiperPhonemize;`)() as CreatePhonemizer;
    const out: string[] = [];
    const module = await create({
      wasmBinary: wasm,
      // espeak-ng verisi (Emscripten paketi) indirilmez, önbellekten verilir
      getPreloadedPackage: () => data,
      locateFile: (f: string) => f,
      print: (line: string) => out.push(line),
      printErr: () => undefined,
      noInitialRun: true,
    });
    return { module, out };
  })();
  phonemizer.catch(() => {
    phonemizer = null;
  });
  return phonemizer;
}

function loadVoice(msg: WorkerRequest): Promise<Loaded> {
  if (loaded?.key === msg.voice.key) return Promise.resolve(loaded);
  if (loading) return loading;
  const p = (async (): Promise<Loaded> => {
    await initOrt(msg);
    const [model, configBytes] = await Promise.all([
      read(msg.cache, msg.voice.model),
      read(msg.cache, msg.voice.config),
    ]);
    const config = JSON.parse(new TextDecoder().decode(configBytes)) as VoiceConfig;
    await loaded?.session.release();
    loaded = null;
    const session = await ort.InferenceSession.create(new Uint8Array(model), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    loaded = { key: msg.voice.key, session, config };
    return loaded;
  })();
  loading = p;
  const clear = () => {
    if (loading === p) loading = null;
  };
  p.then(clear, clear);
  return p;
}

async function phonemize(msg: WorkerRequest, voice: string): Promise<string[]> {
  const { module, out } = await initPhonemizer(msg);
  out.length = 0;
  const rc = module.callMain([
    '-l',
    voice,
    '--input',
    JSON.stringify([{ text: msg.text }]),
    '--espeak_data',
    '/espeak-ng-data',
  ]);
  if (rc !== 0 || out.length === 0) throw new Error(`Fonemleyici çalışmadı (${rc})`);
  const phonemes: string[] = [];
  for (const line of out) phonemes.push(...(JSON.parse(line) as { phonemes: string[] }).phonemes);
  return phonemes;
}

async function synthesize(msg: WorkerRequest): Promise<WorkerResponse> {
  const t0 = performance.now();
  const [{ session, config }] = await Promise.all([loadVoice(msg), initPhonemizer(msg)]);
  const ids = phonemeIds(await phonemize(msg, config.espeak.voice), config.phoneme_id_map);
  const pcm = await runVoice(session, config, ids, msg.lengthScale);
  return { id: msg.id, pcm, sampleRate: config.audio.sample_rate, ms: performance.now() - t0 };
}

/** Denemenin bir adımının hatası, koduyla (ana iş parçacığı Türkçe iletiye çevirir) */
class StepError extends Error {
  readonly code: CheckCode;
  constructor(code: CheckCode, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.code = code;
  }
}

async function step<T>(code: CheckCode, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    throw e instanceof StepError ? e : new StepError(code, e);
  }
}

/** Kendi sesinin denenmesi: ses motoru → model → girdiler → dil (fonemleyici) → kısa bir sentez */
async function check(msg: WorkerRequest): Promise<WorkerResponse> {
  const t0 = performance.now();
  await step('runtime', () => initOrt(msg));
  const { session, config } = await step('model', () => loadVoice(msg));
  const missing = missingInputs(session.inputNames, config);
  if (missing.length > 0)
    throw new StepError('inputs', `Modelde olmayan girdiler: ${missing.join(', ')}`);
  let ids = phonemeIds([], config.phoneme_id_map);
  if (msg.text) {
    await step('runtime', () => initPhonemizer(msg));
    const phonemes = await step('language', () => phonemize(msg, config.espeak.voice)).catch(
      (e: unknown) => {
        // Bilinmeyen dilde fonemleyici (Emscripten programı) yarıda kalmış olabilir: sonraki iş yeniden kurar
        phonemizer = null;
        throw e;
      },
    );
    ids = phonemeIds(phonemes, config.phoneme_id_map);
  }
  const pcm = await step('inference', () => runVoice(session, config, ids, 1));
  if (!soundOk(pcm)) throw new StepError('inference', 'Model ses üretmedi');
  return {
    id: msg.id,
    pcm: new Float32Array(0),
    sampleRate: config.audio.sample_rate,
    ms: performance.now() - t0,
  };
}

// İşler sırayla yapılır (tek model oturumu)
let queue: Promise<unknown> = Promise.resolve();
scope.onmessage = (e) => {
  const msg = e.data;
  queue = queue.then(async () => {
    try {
      const res = await (msg.check ? check(msg) : synthesize(msg));
      if ('pcm' in res) scope.postMessage(res, [res.pcm.buffer]);
      else scope.postMessage(res);
    } catch (err) {
      scope.postMessage({
        id: msg.id,
        error: err instanceof Error ? err.message : String(err),
        ...(err instanceof StepError ? { code: err.code } : {}),
      });
    }
  });
};
