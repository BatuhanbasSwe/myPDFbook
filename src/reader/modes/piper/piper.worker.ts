import * as ort from 'onnxruntime-web/wasm';
import type { WorkerRequest, WorkerResponse } from './synth';

/**
 * Piper sentezi (Web Worker): metin → espeak-ng ses birimleri → VITS modeli (ONNX Runtime Web, WASM) → ses.
 * Dosyalar Cache Storage'dan okunur (store.ts indirdi); ağ kullanılmaz, çevrimdışı çalışır.
 *
 * espeak-ng fonemleyicisi (GPL-3.0) uygulamanın kodunda değildir: ayrı indirilen Emscripten programıdır. Burada
 * komut satırı argümanlarıyla çalıştırılır, çıktısı (JSON) okunur.
 */

/** Worker'ın genel nesnesi (uygulamanın tsconfig'i DOM kitaplığıyla: yalnızca kullanılan alanlar) */
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
};

interface VoiceConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  num_speakers: number;
  phoneme_id_map: Record<string, number[]>;
}

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

/** Metnin ses birimleri → modelin kimlikleri: ^ _ (birim _)* $ (Piper'ın `phonemes_to_ids`'i) */
function phonemeIds(phonemes: string[], map: Record<string, number[]>): number[] {
  const pad = map._?.[0] ?? 0;
  const ids = [...(map['^'] ?? [1]), pad];
  for (const p of phonemes) {
    const id = map[p];
    if (!id) continue; // modelde olmayan birim atlanır
    ids.push(...id, pad);
  }
  ids.push(...(map.$ ?? [2]));
  return ids;
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
  const { noise_scale, length_scale, noise_w } = config.inference;
  const feeds: Record<string, ort.Tensor> = {
    input: new ort.Tensor(
      'int64',
      BigInt64Array.from(ids, (x) => BigInt(x)),
      [1, ids.length],
    ),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor(
      'float32',
      Float32Array.from([noise_scale, length_scale * msg.lengthScale, noise_w]),
      [3],
    ),
  };
  if (config.num_speakers > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
  const result = await session.run(feeds);
  const output = result[session.outputNames[0]];
  const pcm = new Float32Array(output.data as Float32Array);
  output.dispose?.();
  return { id: msg.id, pcm, sampleRate: config.audio.sample_rate, ms: performance.now() - t0 };
}

// İşler sırayla yapılır (tek model oturumu)
let queue: Promise<unknown> = Promise.resolve();
scope.onmessage = (e) => {
  const msg = e.data;
  queue = queue.then(async () => {
    try {
      const res = await synthesize(msg);
      if ('pcm' in res) scope.postMessage(res, [res.pcm.buffer]);
      else scope.postMessage(res);
    } catch (err) {
      scope.postMessage({ id: msg.id, error: err instanceof Error ? err.message : String(err) });
    }
  });
};
