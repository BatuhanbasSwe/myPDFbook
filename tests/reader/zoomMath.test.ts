import { describe, expect, it } from 'vitest';
import { toRelative } from '../../src/annotations/geometry';
import {
  clampPan,
  clampScale,
  doubleTapZoom,
  NO_ZOOM,
  panBy,
  pinchZoom,
  sharpPixelWidth,
  sharpZoomLevel,
  stepZoom,
  toBoxFraction,
  toContent,
  toScreen,
  transformRect,
  wheelZoom,
  zoomAt,
  type Zoom,
} from '../../src/reader/zoom/zoomMath';

// 600×800 kitap, 1000×900 okuma alanı: 1×'te kitap alana sığar
const book = { width: 600, height: 800 };
const view = { width: 1000, height: 900 };

const close = (a: Zoom, b: Zoom) => {
  expect(a.scale).toBeCloseTo(b.scale, 6);
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('clampScale', () => {
  it('1× ile 4× arasında kalır; geçersiz sayı 1×', () => {
    expect(clampScale(0.3)).toBe(1);
    expect(clampScale(2.5)).toBe(2.5);
    expect(clampScale(9)).toBe(4);
    expect(clampScale(Number.NaN)).toBe(1);
  });
});

describe('clampPan', () => {
  it('kitap alana sığıyorsa ortada durur', () => {
    expect(clampPan({ scale: 1, x: 120, y: -40 }, book, view)).toEqual(NO_ZOOM);
  });

  it('büyüyen kitap alanı aşınca kenarı alanın içine giremez', () => {
    // 2×: 1200×1600; yatayda (1200 − 1000) / 2 = 100, dikeyde (1600 − 900) / 2 = 350 px kayabilir
    expect(clampPan({ scale: 2, x: 500, y: -500 }, book, view)).toEqual({
      scale: 2,
      x: 100,
      y: -350,
    });
    expect(clampPan({ scale: 2, x: -30, y: 200 }, book, view)).toEqual({
      scale: 2,
      x: -30,
      y: 200,
    });
  });

  it('bir yönde sığıp öbüründe taşarsa yalnızca taşan yönde kayar', () => {
    // 1,5×: 900×1200; yatayda sığar, dikeyde 150 px kayar
    expect(clampPan({ scale: 1.5, x: 80, y: 400 }, book, view)).toEqual({
      scale: 1.5,
      x: 0,
      y: 150,
    });
  });
});

describe('toContent / toScreen', () => {
  it('biri öbürünün tersidir', () => {
    const z = { scale: 2.5, x: 40, y: -70 };
    const p = { x: 123, y: -45 };
    const back = toScreen(toContent(p, z), z);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });
});

describe('zoomAt', () => {
  it('odak noktasının altındaki yer yerinde kalır', () => {
    const focal = { x: 60, y: -120 };
    const z = zoomAt(NO_ZOOM, 2, focal, book, view);
    expect(z.scale).toBe(2);
    const before = toContent(focal, NO_ZOOM);
    const after = toContent(focal, z);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('odak kitabın kenarındaysa kaydırma sınırda durur', () => {
    const z = zoomAt(NO_ZOOM, 2, { x: 450, y: 0 }, book, view);
    expect(z).toEqual({ scale: 2, x: -100, y: 0 });
  });
});

describe('pinchZoom', () => {
  it('parmaklar açıldıkça büyür; ortalarının altındaki yer yerinde kalır', () => {
    const start = { zoom: NO_ZOOM, a: { x: -50, y: 10 }, b: { x: 50, y: 10 } };
    const z = pinchZoom(start, { x: -100, y: 10 }, { x: 100, y: 10 }, book, view);
    expect(z.scale).toBeCloseTo(2, 9);
    // Orta nokta (0, 10) → kitapta (0, 10); 2×'te de ekranda (0, 10)
    const p = toScreen({ x: 0, y: 10 }, z);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(10, 9);
  });

  it('iki parmak birlikte kayınca kitap da kayar', () => {
    const start = { zoom: { scale: 2, x: 0, y: 0 }, a: { x: -50, y: 0 }, b: { x: 50, y: 0 } };
    const z = pinchZoom(start, { x: -80, y: 30 }, { x: 20, y: 30 }, book, view);
    close(z, { scale: 2, x: -30, y: 30 });
  });

  it('4×’ü geçmez, 1×’in altına inmez', () => {
    const start = { zoom: { scale: 3, x: 0, y: 0 }, a: { x: -10, y: 0 }, b: { x: 10, y: 0 } };
    expect(pinchZoom(start, { x: -100, y: 0 }, { x: 100, y: 0 }, book, view).scale).toBe(4);
    expect(pinchZoom(start, { x: -1, y: 0 }, { x: 1, y: 0 }, book, view)).toEqual(NO_ZOOM);
  });
});

describe('doubleTapZoom', () => {
  it('1×’te dokunulan yer 2×’e büyür, yakınken 1×’e döner', () => {
    const focal = { x: -40, y: 100 };
    const z = doubleTapZoom(NO_ZOOM, focal, book, view);
    expect(z.scale).toBe(2);
    const p = toScreen(toContent(focal, NO_ZOOM), z);
    expect(p.x).toBeCloseTo(focal.x, 9);
    expect(p.y).toBeCloseTo(focal.y, 9);
    expect(doubleTapZoom(z, focal, book, view)).toEqual(NO_ZOOM);
  });
});

describe('panBy', () => {
  it('kaydırır, sınırda durur; 1×’te kaymaz', () => {
    const z = { scale: 2, x: 0, y: 0 };
    expect(panBy(z, 40, -60, book, view)).toEqual({ scale: 2, x: 40, y: -60 });
    expect(panBy(z, 400, -600, book, view)).toEqual({ scale: 2, x: 100, y: -350 });
    expect(panBy(NO_ZOOM, 40, 40, book, view)).toEqual(NO_ZOOM);
  });
});

describe('stepZoom', () => {
  it('yarım adımlarla büyür ve küçülür, sınırlarda durur', () => {
    let z = NO_ZOOM;
    const seen: number[] = [];
    for (let i = 0; i < 7; i++) {
      z = stepZoom(z, 1, book, view);
      seen.push(z.scale);
    }
    expect(seen).toEqual([1.5, 2, 2.5, 3, 3.5, 4, 4]);
    expect(stepZoom({ scale: 1.7, x: 0, y: 0 }, 1, book, view).scale).toBe(2);
    expect(stepZoom({ scale: 1.7, x: 0, y: 0 }, -1, book, view).scale).toBe(1.5);
    expect(stepZoom({ scale: 1.5, x: 0, y: 0 }, -1, book, view)).toEqual(NO_ZOOM);
  });
});

describe('wheelZoom', () => {
  it('yukarı tekerlek büyütür, aşağı küçültür', () => {
    expect(wheelZoom(NO_ZOOM, -100, { x: 0, y: 0 }, book, view).scale).toBeGreaterThan(1);
    const z = { scale: 2, x: 0, y: 0 };
    expect(wheelZoom(z, 100, { x: 0, y: 0 }, book, view).scale).toBeLessThan(2);
  });
});

describe('işaret katmanında noktanın yeri', () => {
  // Kitabın ortasına göre büyütülmemiş sayfa kutusu: çift sayfanın sağ sayfası
  const page = { left: 0, top: -400, width: 300, height: 800 };

  it('ekrandaki büyümüş kutuyla ölçülen yer dönüşümün tersiyle bulunanla aynı', () => {
    const z = { scale: 2.5, x: -80, y: 120 };
    const screenBox = transformRect(page, z);
    for (const p of [
      { x: 10, y: -300 },
      { x: 250, y: 90 },
      { x: 400, y: 600 },
    ]) {
      const byRect = toRelative(p, screenBox);
      const byInverse = toBoxFraction(p, page, z);
      // toRelative kenara çeker; içerideki noktalar aynı
      if (byInverse.x >= 0 && byInverse.x <= 1 && byInverse.y >= 0 && byInverse.y <= 1) {
        expect(byRect.x).toBeCloseTo(byInverse.x, 9);
        expect(byRect.y).toBeCloseTo(byInverse.y, 9);
      }
    }
  });

  it('sayfanın ortasına konan nokta yakınlaştırmada da ortada', () => {
    const z = zoomAt(NO_ZOOM, 3, { x: 150, y: 0 }, book, view);
    const center = toScreen({ x: 150, y: 0 }, z);
    const f = toRelative(center, transformRect(page, z));
    expect(f.x).toBeCloseTo(0.5, 9);
    expect(f.y).toBeCloseTo(0.5, 9);
  });
});

describe('keskin çizim', () => {
  it('1,2×’e dek yeniden çizilmez; üstünde yarım adıma yuvarlanır', () => {
    expect(sharpZoomLevel(1)).toBe(1);
    expect(sharpZoomLevel(1.2)).toBe(1);
    expect(sharpZoomLevel(1.21)).toBe(1.5);
    expect(sharpZoomLevel(2)).toBe(2);
    expect(sharpZoomLevel(2.1)).toBe(2.5);
    expect(sharpZoomLevel(4)).toBe(4);
  });

  it('genişlik × yakınlaştırma × piksel oranı; uzun kenar sınırı aşılmaz', () => {
    // 500×700 sayfa, 2×, oran 2: 2000 px; uzun kenar 2800 < 4096
    expect(sharpPixelWidth(500, 700, 2, 2, 4096)).toBe(2000);
    // 4×: 4000 px isterdi; uzun kenar 4096 → genişlik 4096 × 500 / 700
    expect(sharpPixelWidth(500, 700, 4, 2, 4096)).toBe(Math.floor(4096 / 1.4));
    // Piksel oranı en çok 2 sayılır
    expect(sharpPixelWidth(500, 700, 2, 3, 4096)).toBe(2000);
    // Telefonda daha düşük sınır
    expect(sharpPixelWidth(400, 600, 4, 3, 2560)).toBe(Math.floor(2560 / 1.5));
  });
});
