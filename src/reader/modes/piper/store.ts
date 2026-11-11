import type { PiperAsset } from './voices';

/**
 * Yapay zekâ seslerinin dosyaları cihazda: Cache Storage (eski Safari'de de var; OPFS'ye yazmak yok). Dosyanın
 * adresi anahtardır. İndirme ilerlemesi bildirilir, iptal edilebilir; SHA-256'sı bilinen dosya denetlenir (bozuk ya
 * da değişmiş dosya saklanmaz).
 */

export const PIPER_CACHE = 'mypdfbook-piper-v1';

export function cacheSupported(): boolean {
  return typeof caches !== 'undefined';
}

const open = () => caches.open(PIPER_CACHE);

const absolute = (url: string) => new URL(url, location.href).href;

/**
 * Cihazda olmayan dosyalar. Önbelleğin anahtarları bir kez okunur (`keys`): WebKit `match`'te kaydın gövdesini de
 * diskten getirir, 63 MB'lık model için her açılışta yavaştı (Plan 13: menü bu sırada "İndir · 96 MB" diyordu).
 */
export async function missing(assets: PiperAsset[]): Promise<PiperAsset[]> {
  const keys = new Set((await (await open()).keys()).map((r) => r.url));
  return assets.filter((a) => !keys.has(absolute(a.url)));
}

/** Dosyaların hepsi cihazda mı */
export async function hasAll(assets: PiperAsset[]): Promise<boolean> {
  return (await missing(assets)).length === 0;
}

/**
 * Adresi değişen dosya (Plan 13: ONNX Runtime WASM'ı Vite'ın hash'li adresinden sürümlü adrese geçti): cihazda
 * yeni anahtarla yoksa ve eski anahtarlardan birinde boyu tutan kayıt varsa yeni anahtara kopyalanır. Eski kayıt
 * burada silinmez (eski sürüm temizliği, `prune`, siler). Taşındıysa true.
 */
export async function adoptRenamed(asset: PiperAsset, legacy: RegExp): Promise<boolean> {
  const cache = await open();
  const reqs = await cache.keys();
  const target = absolute(asset.url);
  if (reqs.some((r) => r.url === target)) return false;
  for (const req of reqs) {
    if (!legacy.test(new URL(req.url).pathname)) continue;
    const res = await cache.match(req);
    if (!res) continue;
    const body = await res.blob();
    // Boyu tutmuyorsa başka sürümün dosyasıdır: taşınmaz (yeni sürüm indirilir)
    if (body.size !== asset.bytes) continue;
    await cache.put(
      asset.url,
      new Response(body, {
        headers: {
          'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream',
          'Content-Length': String(body.size),
        },
      }),
    );
    return true;
  }
  return false;
}

/** Saklanan dosyanın içeriği; yoksa hata */
export async function readAsset(url: string): Promise<ArrayBuffer> {
  const res = await (await open()).match(url);
  if (!res) throw new Error(`Dosya cihazda yok: ${url}`);
  return res.arrayBuffer();
}

export async function removeAssets(urls: string[]): Promise<void> {
  const cache = await open();
  await Promise.all(urls.map((url) => cache.delete(url)));
}

/**
 * Bilinen dosyalar dışındaki kayıtları siler (eski sürümlerin dosyaları yer kaplamasın). `keepAlso`: başka yolla
 * yönetilen kayıtlar (kendi sesleri, customStore.ts) silinmez.
 */
export async function prune(known: string[], keepAlso?: (url: string) => boolean): Promise<void> {
  const cache = await open();
  const keep = new Set(known.map(absolute));
  for (const req of await cache.keys())
    if (!keep.has(req.url) && !keepAlso?.(req.url)) await cache.delete(req);
}

async function sha256(data: ArrayBuffer): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null; // güvenli olmayan bağlam
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface DownloadOptions {
  signal?: AbortSignal;
  /** indirilen bayt ve toplam (dosyaların bilinen boyutlarıyla) */
  onProgress?(loaded: number, total: number): void;
  /** SHA-256 denetimi (testlerde sahte dosyalar için kapatılır) */
  verify?: boolean;
}

/**
 * Cihazda olmayan dosyaları sırayla indirip saklar. Bir dosya bitince toplamda bilinen boyutu kadar sayılır
 * (sunucu boyut bildirmese de ilerleme doğru kalır). İptal edilirse AbortError fırlatır; yarım dosya saklanmaz.
 */
export async function download(assets: PiperAsset[], opts: DownloadOptions = {}): Promise<void> {
  const { signal, onProgress, verify = true } = opts;
  const todo = await missing(assets);
  const total = todo.reduce((s, a) => s + a.bytes, 0);
  let done = 0;
  onProgress?.(0, total);
  const cache = await open();
  for (const asset of todo) {
    const res = await fetch(asset.url, { signal, mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error(`İndirilemedi (${res.status}): ${asset.url}`);
    const chunks: Uint8Array[] = [];
    let got = 0;
    // Akış üzerinde for await eski WebKit'te yok: okuyucuyla okunur
    const reader = res.body?.getReader();
    if (reader) {
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        chunks.push(value);
        got += value.byteLength;
        onProgress?.(done + Math.min(got, asset.bytes), total);
      }
    } else chunks.push(new Uint8Array(await res.arrayBuffer()));
    const blob = new Blob(chunks as BlobPart[]);
    if (verify && asset.sha256) {
      const hash = await sha256(await blob.arrayBuffer());
      if (hash !== null && hash !== asset.sha256)
        throw new Error(`Dosya bozuk indi (SHA-256 uyuşmuyor): ${asset.url}`);
    }
    signal?.throwIfAborted?.();
    await cache.put(
      asset.url,
      new Response(blob, {
        headers: {
          'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream',
          'Content-Length': String(blob.size),
        },
      }),
    );
    done += asset.bytes;
    onProgress?.(done, total);
  }
}
