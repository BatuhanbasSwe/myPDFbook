import { PIPER_CACHE } from './store';
import { PIPER_PREFIX, type PiperVoice } from './voices';

/**
 * Kendi seslerinin cihazdaki yeri: yapay zekâ seslerinin Cache Storage'ı (`mypdfbook-piper-v1`), uygulamanın
 * adresinin altında `piper-custom/<kimlik>/`. Bu adresler ağdan istenmez; yalnızca anahtardır (Cache Storage http(s)
 * adresi ister). Yedeğe girmez (yedek IndexedDB ve ayarları yazar), Workbox'ın önbelleklerine karışmaz.
 *
 * Bir ses üç kayıttır: `model.onnx`, `model.onnx.json` (ayar dosyası, olduğu gibi) ve en son yazılan `voice.json`
 * (ad, dil, boyut). `voice.json` yoksa ses yoktur: ekleme yarıda kalırsa (sayfa kapandı, yer kalmadı, deneme
 * olmadı) ses listede görünmez, artıkları `pruneCustom` siler.
 */

export const CUSTOM_PREFIX = `${PIPER_PREFIX}custom-`;
const DIR = 'piper-custom/';

export function isCustomVoiceId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(CUSTOM_PREFIX);
}

/** Kayıtların kökü: `https://…/piper-custom/` (uygulamanın alt yolu dahil) */
function root(): string {
  return new URL(`${import.meta.env.BASE_URL}${DIR}`, location.origin).href;
}

export function isCustomUrl(url: string): boolean {
  return url.startsWith(root());
}

export interface CustomFiles {
  model: string;
  config: string;
  meta: string;
}

/** Sesin kayıtlarının adresleri */
export function customFiles(id: string): CustomFiles {
  const dir = `${root()}${encodeURIComponent(id.slice(PIPER_PREFIX.length))}/`;
  return { model: `${dir}model.onnx`, config: `${dir}model.onnx.json`, meta: `${dir}voice.json` };
}

/** Yeni, benzersiz kimlik (aynı adla iki ses olabilir) */
export function newCustomId(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${CUSTOM_PREFIX}${Date.now().toString(36)}${random}`;
}

/** `voice.json`: sesin cihazdaki kaydı */
export interface CustomVoiceMeta {
  v: 1;
  id: string;
  name: string;
  /** kitabın diliyle eşleşen dil ("tr", "en", "de") */
  lang: string;
  espeakVoice: string;
  sampleRate: number;
  modelBytes: number;
  configBytes: number;
  addedAt: number;
  quality?: string;
  languageName?: string;
  /** seçilen model dosyasının adı */
  fileName?: string;
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optStr = (v: unknown) => (isStr(v) ? v : undefined);

/** Okunan `voice.json` (bozuksa null) */
export function parseCustomMeta(raw: unknown): CustomVoiceMeta | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || !isStr(o.id) || !isCustomVoiceId(o.id) || !isStr(o.name)) return null;
  if (!isStr(o.lang) || !isStr(o.espeakVoice)) return null;
  if (![o.sampleRate, o.modelBytes, o.configBytes, o.addedAt].every(isNum)) return null;
  return {
    v: 1,
    id: o.id,
    name: o.name,
    lang: o.lang,
    espeakVoice: o.espeakVoice,
    sampleRate: o.sampleRate as number,
    modelBytes: o.modelBytes as number,
    configBytes: o.configBytes as number,
    addedAt: o.addedAt as number,
    quality: optStr(o.quality),
    languageName: optStr(o.languageName),
    fileName: optStr(o.fileName),
  };
}

/** Kayıttan sesin tanımı (motor ve menü bunu kullanır) */
export function customPiperVoice(meta: CustomVoiceMeta): PiperVoice {
  const files = customFiles(meta.id);
  return {
    id: meta.id,
    name: meta.name,
    lang: meta.lang,
    model: { url: files.model, bytes: meta.modelBytes },
    config: { url: files.config, bytes: meta.configBytes },
    license: 'Kendi sesin',
    custom: {
      addedAt: meta.addedAt,
      espeakVoice: meta.espeakVoice,
      languageName: meta.languageName,
      quality: meta.quality,
      fileName: meta.fileName,
    },
  };
}

const open = () => caches.open(PIPER_CACHE);

const octets = { 'Content-Type': 'application/octet-stream' };
const jsonType = { 'Content-Type': 'application/json' };

/**
 * Modeli ve ayar dosyasını yazar. Model Blob olarak verilir (seçilen dosya ya da ZIP'in parçaları): tarayıcı onu
 * diskten okuyarak saklar, JS belleğine kopyalanmaz. Yer kalmazsa `QuotaExceededError` fırlar.
 */
export async function saveCustomFiles(id: string, model: Blob, configText: string): Promise<void> {
  const cache = await open();
  const files = customFiles(id);
  await cache.put(
    files.model,
    new Response(model, { headers: { ...octets, 'Content-Length': String(model.size) } }),
  );
  await cache.put(files.config, new Response(configText, { headers: jsonType }));
}

/** `voice.json`'u yazar: ses bundan sonra vardır (ad değiştirmek de bunu yeniden yazar) */
export async function writeCustomMeta(meta: CustomVoiceMeta): Promise<void> {
  await (
    await open()
  ).put(customFiles(meta.id).meta, new Response(JSON.stringify(meta), { headers: jsonType }));
}

async function readMeta(cache: Cache, url: string): Promise<CustomVoiceMeta | null> {
  try {
    const res = await cache.match(url);
    return res ? parseCustomMeta(await res.json()) : null;
  } catch {
    return null;
  }
}

/** Kaydın kimliği adresinden (`…/piper-custom/custom-abc/model.onnx` → `piper:custom-abc`) */
function idOfUrl(url: string): string | null {
  if (!isCustomUrl(url)) return null;
  const key = decodeURIComponent(url.slice(root().length).split('/')[0] ?? '');
  return key ? `${PIPER_PREFIX}${key}` : null;
}

/** Kendi seslerinin kayıtları: kimlik → adresler */
async function customEntries(cache: Cache): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (const req of await cache.keys()) {
    const id = idOfUrl(req.url);
    if (!id) continue;
    const set = out.get(id) ?? new Set<string>();
    set.add(req.url);
    out.set(id, set);
  }
  return out;
}

/** Tam kaydı olan sesler (üç kayıt da var, `voice.json` okunuyor): eklenme sırasıyla */
export async function listCustomVoices(): Promise<CustomVoiceMeta[]> {
  const cache = await open();
  const out: CustomVoiceMeta[] = [];
  for (const [id, urls] of await customEntries(cache)) {
    const files = customFiles(id);
    if (!urls.has(files.meta) || !urls.has(files.model) || !urls.has(files.config)) continue;
    const meta = await readMeta(cache, files.meta);
    if (meta && meta.id === id) out.push(meta);
  }
  return out.sort((a, b) => a.addedAt - b.addedAt || a.id.localeCompare(b.id));
}

/** Sesin kayıtlarını siler: önce `voice.json` (silme yarıda kalsa da ses listede görünmez) */
export async function removeCustomFiles(id: string): Promise<void> {
  const cache = await open();
  const files = customFiles(id);
  await cache.delete(files.meta);
  await Promise.all([cache.delete(files.model), cache.delete(files.config)]);
}

/**
 * Yarım kalan eklemelerin artıklarını siler: `voice.json`'u, modeli ya da ayarı olmayan (ya da `voice.json`'u
 * okunamayan) seslerin bütün kayıtları. `busy`: şu an eklenmekte olan sesler (dokunulmaz).
 */
export async function pruneCustom(busy: ReadonlySet<string> = new Set()): Promise<void> {
  const cache = await open();
  for (const [id, urls] of await customEntries(cache)) {
    if (busy.has(id)) continue;
    const files = customFiles(id);
    const complete =
      urls.has(files.meta) &&
      urls.has(files.model) &&
      urls.has(files.config) &&
      (await readMeta(cache, files.meta))?.id === id;
    if (!complete) await Promise.all([...urls].map((url) => cache.delete(url)));
  }
}
