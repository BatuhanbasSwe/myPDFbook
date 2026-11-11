import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { download, PIPER_CACHE } from '../../src/reader/modes/piper/store';
import { PIPER_RUNTIME } from '../../src/reader/modes/piper/voices';
import { createFakeCaches, type FakeCaches } from '../helpers/fakeCaches';

/**
 * Ses dosyalarının indirilmesi (store.ts): sunucuda dosya yoksa Vercel'in yönlendirmesi index.html'i 200 ile
 * döndürebilir — HTML ses motoru diye saklanırsa kalıcı bozuk olurdu (Plan 13 incelemesi).
 */

let fake: FakeCaches;
beforeEach(() => {
  fake = createFakeCaches();
  vi.stubGlobal('caches', fake.caches);
  vi.stubGlobal('location', new URL('http://localhost:5174/read/1'));
});
afterEach(() => vi.unstubAllGlobals());

const html = '<!doctype html><html><body>uygulama</body></html>';

describe('download', () => {
  it('boyu tutmayan yanıt (ör. 200 ile dönen index.html) saklanmaz', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(html, { headers: { 'Content-Type': 'text/html' } })),
    );
    const asset = { url: '/ort/1.30.0/ort-wasm-simd-threaded.wasm', bytes: 14_239_897 };
    await expect(download([asset])).rejects.toThrow(/boyu/i);
    expect(fake.urls(PIPER_CACHE)).toEqual([]);
  });

  it('SHA-256 tutmayan dosya saklanmaz (boyu tutsa da)', async () => {
    const body = new Uint8Array(8);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body)),
    );
    const asset = { url: '/x.bin', bytes: 8, sha256: '0'.repeat(64) };
    await expect(download([asset])).rejects.toThrow(/SHA-256/);
    expect(fake.urls(PIPER_CACHE)).toEqual([]);
  });

  it("boyu ve SHA-256'sı tutan dosya saklanır", async () => {
    const body = new Uint8Array([1, 2, 3]);
    const sha256 = createHash('sha256').update(body).digest('hex');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body)),
    );
    await download([{ url: '/y.bin', bytes: 3, sha256 }]);
    expect(fake.urls(PIPER_CACHE)).toEqual(['http://localhost:5174/y.bin']);
  });
});

describe('ses motorunun dosyası', () => {
  it("boyu ve SHA-256'sı kurulu onnxruntime-web paketindeki dosyayla aynı", () => {
    const file = readFileSync('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm');
    expect(PIPER_RUNTIME.ortWasm.bytes).toBe(file.length);
    expect(PIPER_RUNTIME.ortWasm.sha256).toBe(createHash('sha256').update(file).digest('hex'));
  });
});
