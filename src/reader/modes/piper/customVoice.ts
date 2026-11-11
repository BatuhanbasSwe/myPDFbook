import { Inflate } from 'fflate';
import { BackupError } from '../../../backup/format';
import { readZipIndex, type ZipEntry } from '../../../backup/zip';

/**
 * Kendi sesini ekle (plan 12): kullanıcının bilgisayarında eğittiği Piper sesinin dosyaları. Burada yalnızca saf
 * işler var: seçilen dosyaların sınıflanması, ZIP'ten çıkarma, Piper ayar dosyasının denetimi ve varsayılan ad.
 * Saklama `customStore.ts`'te, ekleme sırası `manager.ts`'te.
 *
 * Büyük dosya (~60 MB, en çok 150 MB): JS tarafında gereksiz kopya yapılmaz. Seçilen dosya Blob olarak kalır; ZIP'te
 * sıkıştırmasız girdi `Blob.slice` ile alınır, sıkıştırılmış girdi parça parça açılıp küçük Blob'larla birleştirilir
 * (bellekte model boyu kadar). Yine de eklerken bellekte birkaç kopya olur: WebKit'in Cache Storage'ı gövdeyi
 * yazmadan önce toplar, deneme modeli worker'a okur, ONNX Runtime kendi belleğine kopyalar. En kötü durumda
 * (ZIP) model boyunun 3–4 katı; bu yüzden ZIP'ten açılan model saklanır saklanmaz bırakılır (manager.ts).
 */

/** Kullanıcıya gösterilen (Türkçe) hata; `cancelled`: kullanıcı vazgeçti (hata gibi gösterilmez) */
export class CustomVoiceError extends Error {
  readonly cancelled: boolean;
  constructor(message: string, options?: { cause?: unknown; cancelled?: boolean }) {
    super(message, { cause: options?.cause });
    this.name = 'CustomVoiceError';
    this.cancelled = options?.cancelled ?? false;
  }
}

/** Yer kalmadı hatası (Cache Storage: `QuotaExceededError`; eski WebKit: kod 22) */
export function isQuotaError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const err = e as { name?: unknown; code?: unknown; message?: unknown };
  return (
    err.name === 'QuotaExceededError' ||
    err.code === 22 ||
    (typeof err.message === 'string' && /quota/i.test(err.message))
  );
}

/**
 * Model en çok bu kadar olabilir (Piper "medium" ~63 MB, "high" ~110 MB). Eklerken ve ilk okumada model bellekte
 * birkaç kez durur (ZIP'ten açılan, Cache Storage'ın yazarken topladığı, worker'ın okuduğu, ONNX Runtime'ın
 * belleği): en kötü 3–4 katı. iPad'de Safari sekmesi bundan büyüğünde kapanabilir.
 */
export const MAX_MODEL_BYTES = 150_000_000;

/** Model çok büyük iletisi */
function tooLarge(name: string, bytes: number): string {
  return `${name} çok büyük (${Math.round(bytes / 1_000_000)} MB): en çok ${
    MAX_MODEL_BYTES / 1_000_000
  } MB olabilir. Bundan büyük bir ses iPad'in belleğine sığmayabilir; "medium" kalitede bir ses seçin.`;
}
/** Ayar dosyası en çok bu kadar olabilir (Piper ayarı ~5 kB) */
export const MAX_CONFIG_BYTES = 2_000_000;

// ————————————————————————————————————————————————————————— Ayar dosyası

/** Ayar dosyasından sesin bilgileri */
export interface PiperConfigInfo {
  sampleRate: number;
  /** espeak-ng sesi ("tr", "en-us"): fonemleyici bununla çalışır */
  espeakVoice: string;
  /** sesin dili: kitabın diliyle eşleşir ("tr", "en"; başka dillerde espeak'in dil kodu: "de") */
  lang: string;
  numSpeakers: number;
  /** "medium", "high"… */
  quality?: string;
  /** eğitim verisinin adı (`dataset`) */
  dataset?: string;
  /** ayardaki ad (`name`, varsa) */
  name?: string;
  /** dilin kendi dilindeki adı ("Türkçe", "English") */
  languageName?: string;
}

export type ConfigCheck =
  { ok: true; info: PiperConfigInfo; warnings: string[] } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);
const text = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;

/** espeak sesinden kitabın dili: "tr" → "tr", "en-us" → "en", "pt-br" → "pt" */
export function voiceLang(espeakVoice: string): string {
  return espeakVoice.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

/**
 * Piper ayar dosyası (`.onnx.json`) denetimi. Sentezin kullandığı alanlar zorunludur: `audio.sample_rate`,
 * `espeak.voice`, `phoneme_id_map`, `num_speakers` ve `inference` (`noise_scale`, `length_scale`, `noise_w`).
 * Eksik ve yanlış türdeki alanların hepsi birlikte yazılır. Ses birimleri espeak değilse (`phoneme_type: "text"`)
 * reddedilir: fonemleyici espeak'tir. Türkçe olmayan ses uyarıyla kabul edilir.
 */
export function checkPiperConfig(raw: unknown): ConfigCheck {
  if (!isObj(raw))
    return {
      ok: false,
      errors: ['Ayar dosyası bir Piper ayarı değil (JSON nesnesi bekleniyordu).'],
    };
  const errors: string[] = [];
  const missing = (path: string) => errors.push(`${path} eksik.`);
  const wrong = (path: string, expected: string) => errors.push(`${path} ${expected} olmalı.`);

  const audio = raw.audio;
  const sampleRate = isObj(audio) ? audio.sample_rate : undefined;
  if (!isObj(audio) || sampleRate === undefined) missing('audio.sample_rate');
  else if (!isInt(sampleRate) || sampleRate < 8000 || sampleRate > 192_000)
    wrong('audio.sample_rate', 'bir örnekleme hızı (ör. 22050)');

  const espeak = raw.espeak;
  const espeakVoice = isObj(espeak) ? espeak.voice : undefined;
  if (!isObj(espeak) || espeakVoice === undefined) missing('espeak.voice');
  else if (!text(espeakVoice) || !/^[A-Za-z0-9_+-]+$/.test(String(espeakVoice).trim()))
    wrong('espeak.voice', 'bir espeak dil kodu (ör. "tr")');

  const map = raw.phoneme_id_map;
  if (map === undefined) missing('phoneme_id_map');
  else if (!isObj(map)) wrong('phoneme_id_map', 'bir nesne (ses birimi → kimlikler)');
  else if (Object.keys(map).length === 0) errors.push('phoneme_id_map boş.');
  else {
    const bad = Object.entries(map).find(
      ([, ids]) =>
        !Array.isArray(ids) || ids.length === 0 || !ids.every((id) => isInt(id) && id >= 0),
    );
    if (bad) wrong(`phoneme_id_map["${bad[0]}"]`, 'bir kimlik listesi (ör. [3])');
  }

  const speakers = raw.num_speakers;
  if (speakers === undefined) missing('num_speakers');
  else if (!isInt(speakers) || speakers < 1)
    wrong('num_speakers', '1 ya da daha büyük bir tam sayı');

  const inference = raw.inference;
  if (inference === undefined) missing('inference');
  else if (!isObj(inference)) wrong('inference', 'bir nesne (noise_scale, length_scale, noise_w)');
  else {
    for (const key of ['noise_scale', 'length_scale', 'noise_w'] as const) {
      const v = inference[key];
      if (v === undefined) missing(`inference.${key}`);
      else if (!isNum(v) || v < 0 || (key === 'length_scale' && v === 0))
        wrong(`inference.${key}`, key === 'length_scale' ? 'sıfırdan büyük bir sayı' : 'bir sayı');
    }
  }

  const phonemeType = raw.phoneme_type;
  if (phonemeType !== undefined && phonemeType !== 'espeak')
    errors.push(
      `Bu ses espeak ses birimleri kullanmıyor (phoneme_type: ${JSON.stringify(phonemeType)}): desteklenmiyor.`,
    );

  if (errors.length > 0) return { ok: false, errors };

  const voice = String(espeakVoice).trim();
  const language = isObj(raw.language) ? raw.language : {};
  const info: PiperConfigInfo = {
    sampleRate: sampleRate as number,
    espeakVoice: voice,
    lang: voiceLang(voice),
    numSpeakers: speakers as number,
    quality: isObj(audio) ? text(audio.quality) : undefined,
    dataset: text(raw.dataset),
    name: text(raw.name),
    languageName: text(language.name_native) ?? text(language.name_english),
  };
  const warnings: string[] = [];
  if (info.lang !== 'tr') {
    const label = info.languageName ? `${info.languageName}, ${voice}` : voice;
    warnings.push(
      `Bu ses Türkçe değil (${label}). Türkçe kitaplarda listelenmez; ${
        info.lang === 'en'
          ? 'İngilizce kitaplarda'
          : 'dili Türkçe ya da İngilizce olmayan kitaplarda'
      } seçilebilir.`,
    );
  }
  if (info.numSpeakers > 1)
    warnings.push(`Bu seste ${info.numSpeakers} konuşmacı var: ilk konuşmacının sesi kullanılır.`);
  return { ok: true, info, warnings };
}

// ————————————————————————————————————————————————————————— Ad

/** Plan 6 kataloğundaki seslerin eğitim verileri: ince ayarda ayar dosyası çoğu zaman bunlardan kopyalanır */
const BASE_DATASETS = new Set(['dfki', 'fahrettin', 'fettah', 'ljspeech', 'lessac', 'libritts']);
/** Piper dosya adı: `tr_TR-batuhan-medium` */
const PIPER_FILE = /^[a-z]{2,3}_[A-Z]{2}-(.+)-(x_low|low|medium|high)$/;
/** Ad en çok bu kadar karakter olabilir */
export const MAX_NAME_LENGTH = 40;

/** "batuhan_v2" → "Batuhan v2"; Türkçe büyük harf ("ışık" → "Işık") */
function prettify(raw: string): string {
  const spaced = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!spaced) return '';
  return (spaced[0].toLocaleUpperCase('tr') + spaced.slice(1)).slice(0, MAX_NAME_LENGTH);
}

/** Dosya adından sesin adı: "tr_TR-batuhan-medium.onnx" → "batuhan" */
function nameFromFile(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const stem = base.replace(/\.(onnx\.json|onnx|json|zip)$/i, '');
  return PIPER_FILE.exec(stem)?.[1] ?? stem;
}

/**
 * Ekleme penceresindeki adın varsayılanı: ayardaki `name`, sonra `dataset` ("batuhan" → "Batuhan"), sonra dosya
 * adı ("tr_TR-batuhan-medium.onnx" → "Batuhan"), yoksa "Kendi sesim". `dataset` katalog seslerinden biriyse ("dfki":
 * ayar dosyası ince ayar yapılan sesten kopyalanmış) dosya adı önce gelir.
 */
export function defaultVoiceName(
  info: Pick<PiperConfigInfo, 'name' | 'dataset'>,
  fileName?: string,
): string {
  const fromFile = fileName ? prettify(nameFromFile(fileName)) : '';
  const fromDataset = info.dataset ? prettify(nameFromFile(info.dataset)) : '';
  const baseDataset = !!info.dataset && BASE_DATASETS.has(info.dataset.toLowerCase());
  const candidates = [
    info.name ? info.name.trim().slice(0, MAX_NAME_LENGTH) : '',
    baseDataset ? fromFile : fromDataset,
    baseDataset ? fromDataset : fromFile,
  ];
  return candidates.find((c) => c !== '') ?? 'Kendi sesim';
}

/** Kullanıcının yazdığı ad: boşluklar sadeleşir, uzunluk sınırlanır; boşsa null */
export function cleanVoiceName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim();
  return name === '' ? null : name;
}

// ————————————————————————————————————————————————————————— Dosyalar

export type VoiceFileKind = 'model' | 'config' | 'zip' | 'other';

/** Dosyanın türü adından (iOS dosya seçicisi tür vermeyebilir) */
export function voiceFileKind(name: string): VoiceFileKind {
  if (/\.json$/i.test(name)) return 'config';
  if (/\.onnx$/i.test(name)) return 'model';
  if (/\.zip$/i.test(name)) return 'zip';
  return 'other';
}

/** Seçilen bir dosya (ZIP'ten çıkarılanın adı ZIP'teki adıdır) */
export interface VoiceFile {
  blob: Blob;
  /** boyu (blob bırakıldıysa: ZIP'ten açılan model saklanınca) */
  bytes?: number;
  name: string;
  /** ZIP'ten geldiyse ZIP'in adı */
  zip?: string;
}

/** Penceredeki seçim: model ve ayar ayrı ayrı (ya da bir ZIP'le birlikte) seçilebilir */
export interface VoiceSelection {
  model?: VoiceFile;
  config?: VoiceFile;
}

/**
 * Yeni seçilen dosyaları önceki seçimle birleştirir: model modelin, ayar ayarın yerine geçer; ZIP ikisini birden
 * verir. Tanınmayan dosya ve birden çok model hata olarak yazılır (seçim yine güncellenir).
 */
export async function addVoiceFiles(
  prev: VoiceSelection,
  files: File[],
): Promise<{ selection: VoiceSelection; errors: string[] }> {
  const selection = { ...prev };
  const errors: string[] = [];
  const kinds = files.map((f) => voiceFileKind(f.name));
  if (kinds.filter((k) => k === 'model' || k === 'zip').length > 1)
    errors.push('Birden çok model seçildi: tek bir ses seçin.');
  for (const [i, file] of files.entries()) {
    const kind = kinds[i];
    if (kind === 'model') selection.model = { blob: file, name: file.name };
    else if (kind === 'config') selection.config = { blob: file, name: file.name };
    else if (kind === 'zip') {
      try {
        const z = await readZipVoice(file);
        selection.model = { blob: z.model, name: z.modelName, zip: file.name };
        if (z.config) selection.config = { blob: z.config, name: z.configName!, zip: file.name };
        else errors.push(`${file.name} içinde ayar dosyası (.onnx.json) yok: onu ayrıca seçin.`);
      } catch (e) {
        errors.push(e instanceof CustomVoiceError ? e.message : `${file.name} okunamadı.`);
      }
    } else errors.push(`Tanınmayan dosya: ${file.name}. .onnx, .onnx.json ya da .zip seçin.`);
  }
  return { selection, errors };
}

/** Eklenmeye hazır ses: dosyalar okunmuş, ayar denetlenmiş */
export interface PreparedVoice {
  /**
   * Modelin dosyası. ZIP'ten açıldıysa bellektedir: yönetici onu sakladıktan sonra boş bir Blob'la değiştirir
   * (`fromZip`), deneme sırasında bellekte bir kopya daha durmasın. Yeniden eklemek için dosya yeniden seçilir.
   */
  model: Blob;
  /** modelin boyu (model bırakılınca da) */
  modelBytes: number;
  /** model ZIP'ten açıldı (bellekte) */
  fromZip: boolean;
  modelName: string;
  /** ayar dosyasının metni (olduğu gibi saklanır) */
  configText: string;
  info: PiperConfigInfo;
  warnings: string[];
  defaultName: string;
}

const ICLOUD = "Dosya iCloud'da kalmış olabilir: Dosyalar'da açıp indirin, sonra yeniden seçin.";
const UNREADABLE = `okunamadı. ${ICLOUD}`;

async function readHead(blob: Blob, name: string, bytes: number): Promise<Uint8Array> {
  try {
    return new Uint8Array(await blob.slice(0, bytes).arrayBuffer());
  } catch (e) {
    throw new CustomVoiceError(`${name} ${UNREADABLE}`, { cause: e });
  }
}

/**
 * Seçimi eklemeye hazırlar: ayar dosyası okunur ve denetlenir, model ONNX gibi mi bakılır (ONNX'in protobuf'ı
 * `ir_version` alanıyla, 0x08 baytıyla başlar). Model belleğe okunmaz. Sorunların hepsi birlikte döner.
 */
export async function prepareVoice(
  selection: VoiceSelection,
): Promise<{ ok: true; voice: PreparedVoice } | { ok: false; errors: string[] }> {
  const { model, config } = selection;
  const errors: string[] = [];
  if (!model) errors.push('Model dosyası (.onnx) seçilmedi.');
  if (!config) errors.push('Ayar dosyası (.onnx.json) seçilmedi.');
  if (!model || !config) return { ok: false, errors };

  if (model.blob.size === 0) errors.push(`${model.name} boş. ${ICLOUD}`);
  else if (model.blob.size > MAX_MODEL_BYTES) errors.push(tooLarge(model.name, model.blob.size));
  else {
    try {
      const head = await readHead(model.blob, model.name, 1);
      if (head[0] !== 0x08) errors.push(`${model.name} bir ONNX modeli değil ya da bozuk.`);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  let check: ConfigCheck | null = null;
  let configText = '';
  if (config.blob.size === 0) errors.push(`${config.name} boş. ${ICLOUD}`);
  else if (config.blob.size > MAX_CONFIG_BYTES)
    errors.push(`${config.name} bir Piper ayar dosyası değil (çok büyük).`);
  else {
    try {
      configText = await config.blob.text();
    } catch {
      errors.push(`${config.name} ${UNREADABLE}`);
    }
    if (configText) {
      let raw: unknown;
      try {
        raw = JSON.parse(configText);
      } catch {
        errors.push(`${config.name} okunamadı: geçerli bir JSON değil.`);
      }
      if (raw !== undefined) {
        check = checkPiperConfig(raw);
        if (!check.ok) errors.push(...check.errors);
      }
    }
  }
  if (errors.length > 0 || !check?.ok) return { ok: false, errors };
  return {
    ok: true,
    voice: {
      model: model.blob,
      modelBytes: model.blob.size,
      fromZip: !!model.zip,
      modelName: model.name,
      configText,
      info: check.info,
      warnings: check.warnings,
      defaultName: defaultVoiceName(check.info, model.name),
    },
  };
}

/** Denemede okunan kısa cümle (sesin diline göre) */
export function checkSentence(lang: string): string {
  if (lang === 'tr') return 'Merhaba, bu benim sesim.';
  if (lang === 'en') return 'Hello, this is my voice.';
  return '1 2 3';
}

// ————————————————————————————————————————————————————————— ZIP

/** macOS'un eklediği artıklar ("__MACOSX/", "._model.onnx") ve klasör girdileri */
const zipJunk = (name: string) =>
  name.endsWith('/') || name.startsWith('__MACOSX/') || /(^|\/)\._/.test(name);

const baseName = (name: string) => name.split('/').pop() ?? name;

/** Akışla okunan parça (8 MB): büyük girdi tek tampona okunmaz */
const CHUNK = 8 << 20;

let crcTable: Uint32Array | undefined;
/** CRC-32'yi parça parça günceller (başlangıç 0) */
export function crc32Update(crc: number, bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const zipCorrupt = (zipName: string, cause?: unknown) =>
  new CustomVoiceError(`${zipName} bozuk ya da desteklenmeyen bir ZIP.`, { cause });

async function slice(blob: Blob, start: number, end: number, zipName: string) {
  try {
    return new Uint8Array(await blob.slice(start, end).arrayBuffer());
  } catch (e) {
    throw new CustomVoiceError(`${zipName} ${UNREADABLE}`, { cause: e });
  }
}

/**
 * ZIP girdisinin içeriği Blob olarak. STORE: dosyanın kendi aralığı (`Blob.slice`, kopya yok). DEFLATE: 8 MB'lık
 * parçalarla açılır, açılan parçalar 8 MB'lık Blob'lara toplanır (açılmış girdinin tamamı tek tamponda durmaz).
 * İkisinde de CRC-32 ve boy denetlenir.
 */
async function entryBlob(zip: Blob, entry: ZipEntry, zipName: string): Promise<Blob> {
  const header = await slice(zip, entry.headerOffset, entry.headerOffset + 30, zipName);
  const hv = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (header.length < 30 || hv.getUint32(0, true) !== 0x04034b50) throw zipCorrupt(zipName);
  const start = entry.headerOffset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
  const end = start + entry.compressedSize;
  if (end > zip.size) throw zipCorrupt(zipName);

  let crc = 0;
  let out: Blob;
  if (entry.method === 0) {
    if (entry.size !== entry.compressedSize) throw zipCorrupt(zipName);
    for (let p = start; p < end; p += CHUNK)
      crc = crc32Update(crc, await slice(zip, p, Math.min(end, p + CHUNK), zipName));
    out = zip.slice(start, end);
  } else if (entry.method === 8) {
    const parts: Blob[] = [];
    let pending: Uint8Array[] = [];
    let pendingBytes = 0;
    let size = 0;
    const flush = () => {
      if (pending.length) parts.push(new Blob(pending as BlobPart[]));
      pending = [];
      pendingBytes = 0;
    };
    const inflater = new Inflate((chunk) => {
      size += chunk.length;
      if (size > entry.size) throw zipCorrupt(zipName);
      crc = crc32Update(crc, chunk);
      pending.push(chunk);
      pendingBytes += chunk.length;
      if (pendingBytes >= CHUNK) flush();
    });
    try {
      if (start === end) inflater.push(new Uint8Array(0), true);
      for (let p = start; p < end; p += CHUNK) {
        const last = p + CHUNK >= end;
        inflater.push(await slice(zip, p, Math.min(end, p + CHUNK), zipName), last);
      }
    } catch (e) {
      throw e instanceof CustomVoiceError ? e : zipCorrupt(zipName, e);
    }
    flush();
    if (size !== entry.size) throw zipCorrupt(zipName);
    out = new Blob(parts);
  } else {
    throw new CustomVoiceError(
      `${zipName}: desteklenmeyen sıkıştırma (yalnızca ZIP'in olağan biçimi).`,
    );
  }
  if (crc !== entry.crc) throw zipCorrupt(zipName);
  return out;
}

/**
 * ZIP'ten sesin dosyaları: tek bir `.onnx` (alt klasörde de olabilir) ve ayar dosyası (önce `<model>.json`, yoksa
 * ZIP'teki tek `.json`). macOS artıkları atlanır. Ayar yoksa `config` boş döner (ayrıca seçilebilir).
 */
export async function readZipVoice(zip: File): Promise<{
  model: Blob;
  modelName: string;
  config?: Blob;
  configName?: string;
}> {
  let index: Map<string, ZipEntry>;
  try {
    index = await readZipIndex(zip);
  } catch (e) {
    if (e instanceof BackupError && e.code === 'unreadable')
      throw new CustomVoiceError(`${zip.name} ${UNREADABLE}`, { cause: e });
    if (e instanceof BackupError && e.code === 'not-backup')
      throw new CustomVoiceError(`${zip.name} bir ZIP dosyası değil.`, { cause: e });
    throw zipCorrupt(zip.name, e);
  }
  const entries = [...index.values()].filter((e) => !zipJunk(e.name));
  const models = entries.filter((e) => voiceFileKind(e.name) === 'model');
  if (models.length === 0)
    throw new CustomVoiceError(`${zip.name} içinde .onnx model dosyası yok.`);
  if (models.length > 1)
    throw new CustomVoiceError(
      `${zip.name} içinde birden çok model var: tek ses içeren bir ZIP seçin.`,
    );
  const model = models[0];
  if (model.size > MAX_MODEL_BYTES)
    throw new CustomVoiceError(tooLarge(baseName(model.name), model.size));
  const configs = entries.filter((e) => voiceFileKind(e.name) === 'config');
  const config =
    configs.find((e) => e.name === `${model.name}.json`) ??
    (configs.length === 1 ? configs[0] : undefined);
  if (config && config.size > MAX_CONFIG_BYTES)
    throw new CustomVoiceError(
      `${baseName(config.name)} bir Piper ayar dosyası değil (çok büyük).`,
    );
  return {
    model: await entryBlob(zip, model, zip.name),
    modelName: baseName(model.name),
    ...(config
      ? { config: await entryBlob(zip, config, zip.name), configName: baseName(config.name) }
      : {}),
  };
}
