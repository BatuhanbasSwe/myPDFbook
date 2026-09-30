import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

/**
 * Piper yapay zekâ sesleri ve çalışma zamanı dosyaları (plan 6, görev 2). Dosyalar ilk kullanımda bir kez indirilir,
 * Cache Storage'da saklanır (store.ts); uygulama paketine ve service worker önbelleğine (precache) konmaz.
 *
 * - Sesler: Hugging Face `rhasspy/piper-voices`, değişmesin diye sabit bir sürümden (commit). CORS açık.
 * - Fonemleyici (metin → ses birimleri): espeak-ng + piper-phonemize'ın WASM derlemesi. espeak-ng GPL-3.0
 *   lisanslıdır: uygulamanın koduna ve yayınına konmaz, jsDelivr'den (npm paketi) ayrı bir dosya olarak indirilir
 *   ve ayrı bir program gibi çalıştırılır (komut satırı argümanları, çıktısı JSON). Bkz. plan belgesi.
 * - ONNX Runtime Web (MIT): JS'i uygulamayla gelir (worker paketi), WASM'ı (~14 MB) uygulamanın kendi adresinden
 *   ilk kullanımda indirilir.
 */

/** Hugging Face'teki ses deposunun sabit sürümü (2026-09-17) */
export const HF_REVISION = 'c10ece1aade47bb51c153c893d14e5bf8e5b7117';
const HF = `https://huggingface.co/rhasspy/piper-voices/resolve/${HF_REVISION}`;
/** espeak-ng fonemleyicisinin WASM derlemesi (npm: @diffusionstudio/piper-wasm@1.0.0, değişmez sürüm) */
const PHONEMIZER =
  'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';

/** İndirilecek bir dosya: boyutu ilerleme için, SHA-256'sı bütünlük denetimi için (bilinmiyorsa denetlenmez) */
export interface PiperAsset {
  url: string;
  bytes: number;
  sha256?: string;
}

export interface PiperVoice {
  /** ses menüsündeki kimlik ("piper:" ile başlar: sistem seslerinden ayrılır) */
  id: string;
  /** menüdeki adı */
  name: string;
  /** kitabın dili ("tr", "en") */
  lang: string;
  model: PiperAsset;
  config: PiperAsset;
  /** eğitim verisinin lisansı (model kartından) */
  license: string;
}

export const PIPER_PREFIX = 'piper:';

export function isPiperVoice(id: string | null | undefined): id is string {
  return !!id && id.startsWith(PIPER_PREFIX);
}

export const PIPER_VOICES: PiperVoice[] = [
  {
    id: `${PIPER_PREFIX}tr_TR-dfki-medium`,
    name: 'DFKI',
    lang: 'tr',
    model: {
      url: `${HF}/tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx`,
      bytes: 63_201_294,
      sha256: '2844717f524ab965d3fe86e60562cbb601d3e456836efcc2196cc3a14112a8fb',
    },
    config: {
      url: `${HF}/tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx.json`,
      bytes: 4_960,
      sha256: '13ebd7810f1b61b5027583cf3131a0a233b6ea81c38f2200ebc4ff41c3cca039',
    },
    license: 'CC BY-NC-SA 4.0 (ticari olmayan kullanım)',
  },
  {
    id: `${PIPER_PREFIX}en_US-ljspeech-medium`,
    name: 'LJSpeech',
    lang: 'en',
    model: {
      url: `${HF}/en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx`,
      bytes: 63_531_379,
      sha256: '6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22',
    },
    config: {
      url: `${HF}/en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx.json`,
      bytes: 4_972,
      sha256: '141d612cc0a95ed7efc1ca936b845c2364967f2e9217c5dbfcf69fc4d6c65860',
    },
    license: 'Kamu malı (LJ Speech)',
  },
];

/** Bütün seslerin ortak çalışma zamanı dosyaları */
export interface PiperRuntime {
  ortWasm: PiperAsset;
  phonemizerJs: PiperAsset;
  phonemizerWasm: PiperAsset;
  phonemizerData: PiperAsset;
}

export const PIPER_RUNTIME: PiperRuntime = {
  // Uygulamanın kendi dosyası (onnxruntime-web paketiyle aynı sürüm): SHA-256 gerekmez
  ortWasm: { url: ortWasmUrl, bytes: 14_239_897 },
  phonemizerJs: {
    url: `${PHONEMIZER}.js`,
    bytes: 120_714,
    sha256: 'fef0c2fc442d24fdef5c7c7cc37d5da2314407640fe11ab1bfe347c723dff19b',
  },
  phonemizerWasm: {
    url: `${PHONEMIZER}.wasm`,
    bytes: 635_212,
    sha256: 'b777cd107a91d2bcc6a1ea46f2c26a662a7407394fe84589198aeaa83dd7a9d6',
  },
  phonemizerData: {
    url: `${PHONEMIZER}.data`,
    bytes: 18_077_249,
    sha256: '29f1025eb23a5b5c192cd14a6efbce4509402ff265405072ee6f7d1a09b78f8c',
  },
};

export const runtimeAssets = (): PiperAsset[] => Object.values(PIPER_RUNTIME);

export const voiceAssets = (v: PiperVoice): PiperAsset[] => [v.config, v.model];

export function piperVoice(id: string | null | undefined): PiperVoice | undefined {
  return PIPER_VOICES.find((v) => v.id === id);
}

/** Kitabın dilindeki yapay zekâ sesleri */
export function piperVoicesFor(lang: string): PiperVoice[] {
  return PIPER_VOICES.filter((v) => v.lang === lang);
}
