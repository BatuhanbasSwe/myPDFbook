/**
 * Piper yapay zekâ sesleri ve çalışma zamanı dosyaları (plan 6, görev 2). Dosyalar ilk kullanımda bir kez indirilir,
 * Cache Storage'da saklanır (store.ts); uygulama paketine ve service worker önbelleğine (precache) konmaz.
 *
 * - Sesler: Hugging Face `rhasspy/piper-voices`, değişmesin diye sabit bir sürümden (commit). CORS açık.
 * - Fonemleyici (metin → ses birimleri): espeak-ng + piper-phonemize'ın WASM derlemesi. espeak-ng GPL-3.0
 *   lisanslıdır: uygulamanın koduna ve yayınına konmaz, jsDelivr'den (npm paketi) ayrı bir dosya olarak indirilir
 *   ve ayrı bir program gibi çalıştırılır (komut satırı argümanları, çıktısı JSON). Bkz. plan belgesi.
 * - ONNX Runtime Web (MIT): JS'i uygulamayla gelir (worker paketi), WASM'ı (~14 MB) uygulamanın kendi adresinden
 *   ilk kullanımda indirilir. Adresi paketin sürümüyle sürümlüdür (`ort/<sürüm>/`, Plan 13): uygulama her
 *   güncellendiğinde değil, yalnızca onnxruntime-web sürümü değişince yeniden iner.
 */

/**
 * Kurulu onnxruntime-web sürümü: WASM `public/ort/<sürüm>/` altına kurulumda kopyalanır (scripts/copy-ort-wasm.mjs,
 * depoya girmez). Paket güncellenince bu da değişmeli (test kurulu paketle karşılaştırır).
 */
export const ORT_VERSION = '1.30.0';
const ORT_WASM = 'ort-wasm-simd-threaded.wasm';

/**
 * Plan 13'ten önceki sürümlerin motor adresi (Vite'ın hash'li adresi, `?url` içe aktarması): cihazda bu anahtarla
 * duran motor yeni anahtara taşınır (manager.ts, `ensure`), yeniden indirilmez.
 */
export const LEGACY_ORT_WASM = /\/assets\/ort-wasm-simd-threaded-[\w-]+\.wasm$/;

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
  /** "medium"… (bilgi için) */
  quality?: string;
  /** kendi sesin (kullanıcı ekledi, yalnızca bu cihazda): dosyaları Cache Storage'da, uygulamanın adresinde */
  custom?: CustomVoiceInfo;
}

/** Kendi sesinin ek bilgileri (customStore.ts'teki kaydından) */
export interface CustomVoiceInfo {
  /** eklenme zamanı (ms) */
  addedAt: number;
  /** espeak sesi ("tr") */
  espeakVoice: string;
  /** dilin adı ("Türkçe"), ayar dosyasında varsa */
  languageName?: string;
  /** "medium"… */
  quality?: string;
  /** seçilen model dosyasının adı */
  fileName?: string;
}

export const PIPER_PREFIX = 'piper:';

export function isPiperVoice(id: string | null | undefined): id is string {
  return !!id && id.startsWith(PIPER_PREFIX);
}

/**
 * Uygulamayla birlikte yayınlanan (kendi adresinden indirilen) bir katalog sesi: dosyaları `public/voices/<klasör>/`
 * altında durur, Vercel'de uygulamanın adresinden sunulur. Service worker önbelleğine (precache) girmez
 * (`vite.config.ts`: `globIgnores`), DFKI gibi ancak "İndir"e dokunulunca iner ve SHA-256'sı denetlenir. Klasör adı
 * sürümlüdür (`batuhan-v1`): model değişince yeni klasör, eski adresler önbellekte bayatlamaz (Vercel'de uzun önbellek).
 */
export interface SameOriginVoiceDef {
  /** dosya adının kökü: `tr_TR-batuhan-medium` (→ `.onnx`, `.onnx.json`) */
  key: string;
  /** `public/voices/` altındaki klasör */
  dir: string;
  name: string;
  lang: string;
  quality: string;
  license: string;
  model: { bytes: number; sha256: string };
  config: { bytes: number; sha256: string };
}

export function sameOriginVoice(def: SameOriginVoiceDef): PiperVoice {
  const base = `${import.meta.env.BASE_URL}voices/${def.dir}/${def.key}`;
  return {
    id: `${PIPER_PREFIX}${def.key}`,
    name: def.name,
    lang: def.lang,
    quality: def.quality,
    license: def.license,
    model: { url: `${base}.onnx`, ...def.model },
    config: { url: `${base}.onnx.json`, ...def.config },
  };
}

/**
 * Batuhan'ın sesi (DFKI Türkçe sesinden ince ayar, 2026-11-11): dosyaları `public/voices/batuhan-v1/` altında
 * (lisans ve atıf: `LICENSE.txt`). Model değişirse yeni klasör (`batuhan-v2`) ve yeni boy/SHA-256 (Plan 12 belgesi).
 */
export const BATUHAN_VOICE: SameOriginVoiceDef = {
  key: 'tr_TR-batuhan-medium',
  dir: 'batuhan-v1',
  name: 'Batuhan',
  lang: 'tr',
  quality: 'medium',
  license: 'CC BY-NC-SA 4.0 (ticari olmayan kullanım) · DFKI Türkçe sesinden türetildi',
  model: {
    bytes: 63_516_050,
    sha256: '51078f8fce247557f036f010569c5289994af9b82fdfac3b06d252335a5931f6',
  },
  config: {
    bytes: 5_843,
    sha256: '302fae2396eb15ff17afd069ed5bee226ecc686840b069dc80961d70f9424f7a',
  },
};

/** Dosyaları yayında olan (boyu ve SHA-256'sı yazılmış) kendi adresimizdeki sesler */
export function publishedVoices(defs: SameOriginVoiceDef[]): PiperVoice[] {
  return defs
    .filter((d) => /^[0-9a-f]{64}$/.test(d.model.sha256) && /^[0-9a-f]{64}$/.test(d.config.sha256))
    .map(sameOriginVoice);
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
  ...publishedVoices([BATUHAN_VOICE]),
];

/** Bütün seslerin ortak çalışma zamanı dosyaları */
export interface PiperRuntime {
  ortWasm: PiperAsset;
  phonemizerJs: PiperAsset;
  phonemizerWasm: PiperAsset;
  phonemizerData: PiperAsset;
}

export const PIPER_RUNTIME: PiperRuntime = {
  // Uygulamanın kendi dosyası (onnxruntime-web paketiyle aynı sürüm). Boyu ve SHA-256'sı denetlenir: dosya sunucuda
  // yoksa yönlendirmenin döndürdüğü sayfa motor diye saklanmasın (test paketteki dosyayla karşılaştırır)
  ortWasm: {
    url: `${import.meta.env.BASE_URL}ort/${ORT_VERSION}/${ORT_WASM}`,
    bytes: 14_239_897,
    sha256: '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2',
  },
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

/** "96 MB" */
export function formatMb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1_000_000)).toLocaleString('tr-TR')} MB`;
}

export const voiceAssets = (v: PiperVoice): PiperAsset[] => [v.config, v.model];

/** Cihazdaki kendi sesleri (manager.ts okur ve günceller) */
let customVoices: PiperVoice[] = [];

export function setCustomVoices(list: PiperVoice[]): void {
  customVoices = list;
}

export function customPiperVoices(): PiperVoice[] {
  return customVoices;
}

/** Katalog sesleri ve kendi sesleri */
export function allPiperVoices(): PiperVoice[] {
  return [...PIPER_VOICES, ...customVoices];
}

export function piperVoice(id: string | null | undefined): PiperVoice | undefined {
  return PIPER_VOICES.find((v) => v.id === id) ?? customVoices.find((v) => v.id === id);
}

/**
 * Ses bu dildeki kitapta listelenir mi: dili aynıysa. Dili tanınmayan kitapta ("other") kendi seslerinin hepsi
 * (kullanıcı kendi sesini her kitapta seçebilsin); katalog sesleri yalnızca kendi dilinde.
 */
export function voiceFitsLang(v: PiperVoice, lang: string): boolean {
  return v.lang === lang || (lang === 'other' && !!v.custom);
}

/** Kitabın dilindeki yapay zekâ sesleri: önce katalog, sonra kendi sesleri (eklenme sırasıyla) */
export function piperVoicesFor(lang: string): PiperVoice[] {
  return allPiperVoices().filter((v) => voiceFitsLang(v, lang));
}
