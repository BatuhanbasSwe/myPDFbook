import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeCaches, type FakeCaches } from '../helpers/fakeCaches';

/**
 * Uygulama güncellemesi (Plan 13, görev 1): yeni derlemede indirilmiş ses ve ses motoru cihazda kalır, yeniden
 * inmez. Her "derleme" modüllerin yeniden yüklenmesidir (aynı Cache Storage ile). Eski sürümler motoru Vite'ın hash'li
 * adresinde saklıyordu (`/assets/ort-wasm-simd-threaded-<hash>.wasm`): o kayıt testte elle konur.
 */

const CACHE = 'mypdfbook-piper-v1';
const DFKI = 'piper:tr_TR-dfki-medium';

let fake: FakeCaches;
let fetched: string[];

async function build() {
  vi.resetModules();
  const manager = await import('../../src/reader/modes/piper/manager');
  const voices = await import('../../src/reader/modes/piper/voices');
  return { ...manager, ...voices };
}

beforeEach(() => {
  fake = createFakeCaches();
  fetched = [];
  vi.stubGlobal('caches', fake.caches);
  vi.stubGlobal('location', new URL('http://localhost:5174/read/1'));
  vi.stubGlobal('window', { __mypdfbookPiper: { verify: false } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetched.push(String(url));
      return new Response('x');
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uygulama güncellemesi', () => {
  it('iki ardışık derleme: DFKI cihazda kalır, ses motoru ve model yeniden inmez, silinmez', async () => {
    const first = await build();
    await first.piperManager.ensure();
    expect(await first.piperManager.install(DFKI)).toBe(true);
    const before = fake.urls(CACHE).sort();
    expect(before.length).toBe(6); // motor (4) + model ve ayar
    fetched = [];

    const second = await build();
    await second.piperManager.ensure();
    expect(second.piperManager.get()[DFKI]).toMatchObject({ status: 'ready', need: 0 });
    expect(fetched).toEqual([]);
    expect(fake.urls(CACHE).sort()).toEqual(before);
  });

  it("eski sürümün hash'li adresindeki motor yeni (sürümlü) anahtara taşınır, yeniden inmez", async () => {
    const m = await build();
    const cache = await fake.caches.open(CACHE);
    const wasm = new Uint8Array(m.PIPER_RUNTIME.ortWasm.bytes);
    wasm[0] = 7;
    const old = 'http://localhost:5174/assets/ort-wasm-simd-threaded-DcHrbrbl.wasm';
    await cache.put(old, new Response(wasm));
    for (const a of [...m.runtimeAssets(), ...m.voiceAssets(m.piperVoice(DFKI)!)])
      if (a !== m.PIPER_RUNTIME.ortWasm) await cache.put(a.url, new Response('x'));

    await m.piperManager.ensure();
    expect(m.piperManager.get()[DFKI]).toMatchObject({ status: 'ready', need: 0 });
    const moved = await cache.match(m.PIPER_RUNTIME.ortWasm.url);
    expect(new Uint8Array(await moved!.arrayBuffer())[0]).toBe(7);
    expect(fake.urls(CACHE)).not.toContain(old);
    expect(fetched).toEqual([]);
  });

  it('boyu tutmayan eski kayıt taşınmaz (başka sürümün motoru): silinir, motor eksik sayılır', async () => {
    const m = await build();
    const cache = await fake.caches.open(CACHE);
    const old = 'http://localhost:5174/assets/ort-wasm-simd-threaded-Zzzzzzzz.wasm';
    await cache.put(old, new Response(new Uint8Array(10)));
    await m.piperManager.ensure();
    expect(fake.urls(CACHE)).toEqual([]);
    expect(m.piperManager.get()[DFKI].status).toBe('absent');
    expect(m.piperManager.get()[DFKI].need).toBe(
      [...m.runtimeAssets(), ...m.voiceAssets(m.piperVoice(DFKI)!)].reduce(
        (s, a) => s + a.bytes,
        0,
      ),
    );
  });

  it('ses motorunun adresi onnxruntime-web sürümüyle sürümlü; sürüm kurulu paketinkiyle aynı', async () => {
    const m = await build();
    const pkg = JSON.parse(readFileSync('node_modules/onnxruntime-web/package.json', 'utf8')) as {
      version: string;
    };
    expect(m.ORT_VERSION).toBe(pkg.version);
    expect(m.PIPER_RUNTIME.ortWasm.url).toBe(`/ort/${pkg.version}/ort-wasm-simd-threaded.wasm`);
  });

  it('durum okunmadan önce "unknown": menü indirme boyutu değil "Denetleniyor…" der', async () => {
    const m = await build();
    expect(m.piperManager.get()[DFKI].status).toBe('unknown');
    expect(m.installNote('unknown', m.piperManager.get()[DFKI].need, false)).toBe('Denetleniyor…');
    expect(m.installNote('absent', 96_274_366, false)).toBe('İndir · 96 MB');
    expect(m.installNote('absent', 14_239_897, true)).toBe(
      'Kendi sesin · ses motorunu indir · 14 MB',
    );
    expect(m.installNote('error', 0, false)).toMatch(/İndirilemedi/);
  });

  it('önbellek okunamazsa "Denetleniyor…"da kalınmaz: durum "absent"', async () => {
    const m = await build();
    vi.stubGlobal('caches', {
      ...fake.caches,
      has: async () => false,
      open: async () => {
        throw new Error('okunamadı');
      },
    });
    await m.piperManager.ensure();
    expect(m.piperManager.get()[DFKI].status).toBe('absent');
  });
});
