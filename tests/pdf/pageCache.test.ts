import { describe, expect, it } from 'vitest';
import { PageCache, type Quality } from '../../src/pdf/pageCache';

const blob = (bytes: number) => new Blob([new Uint8Array(bytes)]);

function cache(budget: Partial<Record<Quality, number>> = {}) {
  const revoked: string[] = [];
  let n = 0;
  const c = new PageCache({
    budget: { sharp: 1000, preview: 100, ...budget },
    createUrl: () => `blob:${++n}`,
    revokeUrl: (url) => revoked.push(url),
  });
  return { c, revoked };
}

describe('PageCache', () => {
  it('bayt bütçesini aşınca okuma yerine en uzak sayfayı çıkarır, adresini bırakır', () => {
    const { c, revoked } = cache();
    c.setFocus({ pages: [10, 11], width: 800 });
    const far = c.put(2, 800, 'sharp', blob(400));
    c.put(12, 800, 'sharp', blob(400));
    c.put(13, 800, 'sharp', blob(400)); // 1200 > 1000: 2. sayfa (en uzak) çıkar
    expect(c.has(2, 800, 'sharp')).toBe(false);
    expect(c.has(12, 800, 'sharp')).toBe(true);
    expect(c.has(13, 800, 'sharp')).toBe(true);
    expect(revoked).toEqual([far.url]);
    expect(c.stats()).toMatchObject({ sharp: 2, sharpBytes: 800 });
  });

  it('eşit uzaklıkta en eski kullanılan çıkar; kullanılan (best) tazelenir', () => {
    const { c } = cache();
    c.setFocus({ pages: [10], width: 800 });
    c.put(8, 800, 'sharp', blob(400));
    c.put(12, 800, 'sharp', blob(400));
    c.best(8, 800); // 8 yeni kullanıldı: 12 daha eski
    c.put(10, 800, 'sharp', blob(400));
    expect(c.has(8, 800, 'sharp')).toBe(true);
    expect(c.has(12, 800, 'sharp')).toBe(false);
  });

  it('ekranda gösterilen (iğnelenmiş) giriş çıkmaz; iğne kalkınca bütçeye sığdırılır', () => {
    const { c } = cache();
    c.setFocus({ pages: [50], width: 800 });
    const pinned = c.put(0, 800, 'sharp', blob(600));
    c.pin(pinned);
    c.put(50, 800, 'sharp', blob(600)); // 1200: 0. sayfa uzak ama iğneli
    expect(c.has(0, 800, 'sharp')).toBe(true);
    expect(c.stats().sharpBytes).toBe(1200);
    c.unpin(pinned);
    expect(c.has(0, 800, 'sharp')).toBe(false);
    expect(c.stats().sharpBytes).toBe(600);
  });

  it('okuma yerinin genişliğinden farklı genişlikteki keskin girişler (ekran döndü) önce çıkar', () => {
    const { c } = cache();
    c.setFocus({ pages: [5], width: 800 });
    c.put(5, 1200, 'sharp', blob(400)); // eski genişlik, açık sayfa
    c.put(30, 800, 'sharp', blob(400));
    c.put(6, 800, 'sharp', blob(400));
    expect(c.has(5, 1200, 'sharp')).toBe(false);
    expect(c.has(30, 800, 'sharp')).toBe(true);
  });

  it('önizleme ve keskin bütçeleri ayrı', () => {
    const { c } = cache({ sharp: 1000, preview: 100 });
    c.setFocus({ pages: [0], width: 800 });
    c.put(1, 800, 'sharp', blob(900));
    c.put(1, 200, 'preview', blob(60));
    c.put(2, 200, 'preview', blob(60)); // önizleme bütçesi: 1. sayfanınki çıkar
    expect(c.has(1, 800, 'sharp')).toBe(true);
    expect(c.has(1, 200, 'preview')).toBe(false);
    expect(c.has(2, 200, 'preview')).toBe(true);
  });

  it('best: aynı genişlikte keskin; yoksa başka genişlikteki keskin ya da önizleme (önizleme gibi)', () => {
    const { c } = cache();
    c.setFocus({ pages: [0], width: 800 });
    expect(c.best(3, 800)).toBeUndefined();
    const preview = c.put(3, 200, 'preview', blob(10));
    expect(c.best(3, 800)).toMatchObject({ url: preview.url, quality: 'preview' });
    const other = c.put(3, 1200, 'sharp', blob(10));
    expect(c.best(3, 800)).toMatchObject({ url: other.url, quality: 'preview' });
    const exact = c.put(3, 800, 'sharp', blob(10));
    expect(c.best(3, 800)).toMatchObject({ url: exact.url, quality: 'sharp' });
  });

  it('fits: yer yoksa yalnızca daha uzak girişler çıkarılarak sığıyorsa', () => {
    const { c } = cache();
    c.setFocus({ pages: [10], width: 800 });
    c.put(20, 800, 'sharp', blob(500)); // uzaklık 10
    c.put(11, 800, 'sharp', blob(500)); // uzaklık 1
    expect(c.fits('sharp', 400, 5)).toBe(true); // 20. sayfa çıkarılabilir
    expect(c.fits('sharp', 400, 15)).toBe(false); // daha uzak sayfa için yakınlar çıkmaz
    expect(c.fits('preview', 50, 15)).toBe(true);
  });

  it('aynı giriş yeniden konunca eskisinin adresi bırakılır; clear hepsini bırakır', () => {
    const { c, revoked } = cache();
    const a = c.put(1, 800, 'sharp', blob(10));
    const b = c.put(1, 800, 'sharp', blob(20));
    expect(revoked).toEqual([a.url]);
    expect(c.stats()).toMatchObject({ entries: 1, sharpBytes: 20 });
    c.clear();
    expect(revoked).toEqual([a.url, b.url]);
    expect(c.stats()).toMatchObject({ entries: 0, bytes: 0 });
  });
});
