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

/** Dosyaların hepsi cihazda mı */
export async function hasAll(assets: PiperAsset[]): Promise<boolean> {
  const cache = await open();
  for (const a of assets) if (!(await cache.match(a.url))) return false;
  return true;
}

/** Cihazda olmayan dosyalar */
export async function missing(assets: PiperAsset[]): Promise<PiperAsset[]> {
  const cache = await open();
  const out: PiperAsset[] = [];
  for (const a of assets) if (!(await cache.match(a.url))) out.push(a);
  return out;
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

/** Bilinen dosyalar dışındaki kayıtları siler (eski sürümlerin dosyaları yer kaplamasın) */
export async function prune(known: string[]): Promise<void> {
  const cache = await open();
  const keep = new Set(known.map((u) => new URL(u, location.href).href));
  for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
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
