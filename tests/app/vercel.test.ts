import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * vercel.json'un SPA yönlendirmesi: uygulamanın adresleri index.html'e gider; ses motoru (`/ort/`) ve yayınlanan
 * sesler (`/voices/`) gitmez — dosya sunucuda yoksa 404 döner, index.html motor diye saklanmaz (Plan 13).
 */
const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  rewrites: { source: string; destination: string }[];
};
const [rewrite] = config.rewrites;
// Vercel kaynağı path-to-regexp: tek parantezli grup ve bakış ifadesi JS düzenli ifadesiyle aynı
const spa = new RegExp(`^${rewrite.source}$`);

describe('vercel.json yönlendirmesi', () => {
  it("uygulamanın adresleri index.html'e", () => {
    expect(rewrite.destination).toBe('/index.html');
    for (const path of ['/', '/read/12', '/library', '/oruç/x', '/voicesx', '/ortak'])
      expect(spa.test(path)).toBe(true);
  });

  it('ses motoru ve yayınlanan sesler yönlendirilmez', () => {
    for (const path of [
      '/ort/1.30.0/ort-wasm-simd-threaded.wasm',
      '/voices/batuhan-v1/tr_TR-batuhan-medium.onnx',
      '/voices/batuhan-v1/tr_TR-batuhan-medium.onnx.json',
    ])
      expect(spa.test(path)).toBe(false);
  });
});
