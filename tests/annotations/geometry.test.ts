import { describe, expect, it } from 'vitest';
import {
  hitTest,
  hitTestSegment,
  roundPoints,
  segmentDistance,
  simplify,
  smoothPath,
  toRelative,
  type Shape,
} from '../../src/annotations/geometry';

describe('toRelative', () => {
  it('ekrandaki noktayı sayfaya göre 0–1 aralığına çevirir', () => {
    const rect = { left: 100, top: 50, width: 400, height: 600 };
    expect(toRelative({ x: 300, y: 200 }, rect)).toEqual({ x: 0.5, y: 0.25 });
    expect(toRelative({ x: 100, y: 650 }, rect)).toEqual({ x: 0, y: 1 });
  });

  it('sayfanın dışındaki nokta kenara çekilir', () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    expect(toRelative({ x: -20, y: 130 }, rect)).toEqual({ x: 0, y: 1 });
  });
});

describe('simplify', () => {
  it('düz çizginin ara noktalarını atar, uçları bırakır', () => {
    const line = [0, 0, 0.1, 0.1, 0.2, 0.2, 0.3, 0.3, 0.4, 0.4];
    expect(simplify(line, 0.001)).toEqual([0, 0, 0.4, 0.4]);
  });

  it('köşeyi korur', () => {
    const corner = [0, 0, 0.25, 0, 0.5, 0, 0.5, 0.25, 0.5, 0.5];
    expect(simplify(corner, 0.001)).toEqual([0, 0, 0.5, 0, 0.5, 0.5]);
  });

  it('eşikten küçük sapmalar atılır, büyükler kalır', () => {
    const wobble = [0, 0, 0.5, 0.0005, 1, 0];
    expect(simplify(wobble, 0.001)).toEqual([0, 0, 1, 0]);
    expect(simplify(wobble, 0.0001)).toEqual(wobble);
  });

  it('uzaklık dik sayfada yüksekliğe göre ölçeklenir', () => {
    // y farkı 0.0008; yükseklik genişliğin 2 katıysa sayfa genişliği biriminde 0.0016
    const pts = [0, 0, 0.5, 0.0008, 1, 0];
    expect(simplify(pts, 0.001, 1)).toEqual([0, 0, 1, 0]);
    expect(simplify(pts, 0.001, 2)).toEqual(pts);
  });

  it('bir ya da iki nokta olduğu gibi kalır', () => {
    expect(simplify([0.3, 0.3], 0.1)).toEqual([0.3, 0.3]);
    expect(simplify([0, 0, 1, 1], 0.1)).toEqual([0, 0, 1, 1]);
  });

  it('uzun gürültülü çizgi belirgin biçimde küçülür', () => {
    const pts: number[] = [];
    for (let i = 0; i <= 200; i++) pts.push(i / 200, 0.5 + Math.sin(i / 10) * 0.05);
    const out = simplify(pts, 0.001);
    expect(out.length).toBeLessThan(pts.length / 3);
    expect(out.slice(0, 2)).toEqual([0, 0.5]);
    expect(out.slice(-2)).toEqual(pts.slice(-2));
  });
});

describe('smoothPath', () => {
  it('boş dizi boş yol', () => {
    expect(smoothPath([])).toBe('');
  });

  it('tek nokta yuvarlak uçla nokta olacak kısa çizgi', () => {
    expect(smoothPath([0.5, 0.25])).toBe('M0.5 0.25l0.0001 0');
  });

  it('iki nokta düz çizgi; y ölçeklenir', () => {
    expect(smoothPath([0, 0.5, 1, 0.5], 1.5)).toBe('M0 0.75L1 0.75');
  });

  it('üç ve daha çok noktada her aralık için bir kübik eğri; eğri noktalardan geçer', () => {
    const d = smoothPath([0, 0, 0.5, 0.5, 1, 0]);
    expect(d.startsWith('M0 0C')).toBe(true);
    expect(d.match(/C/g)).toHaveLength(2);
    expect(d).toContain(' 0.5 0.5C');
    expect(d.endsWith(' 1 0')).toBe(true);
  });

  it('düz çizgide denetim noktaları da çizginin üstünde', () => {
    const d = smoothPath([0, 0, 0.3, 0, 0.6, 0]);
    const numbers = d.match(/-?[\d.]+/g)!.map(Number);
    // y koordinatları (tek sıradakiler) hep 0
    expect(numbers.filter((_, i) => i % 2 === 1).every((v) => v === 0)).toBe(true);
  });
});

describe('silgi (hitTest)', () => {
  const stroke: Shape = { kind: 'ink', points: [0.1, 0.5, 0.9, 0.5], width: 0.004 };
  const highlight: Shape = { kind: 'highlight', points: [0.1, 0.5, 0.9, 0.5], width: 0.04 };
  const pin: Shape = { kind: 'note', points: [0.5, 0.5], width: 0 };

  it('çizginin üstündeki ve yakınındaki nokta değer, uzaktaki değmez', () => {
    expect(hitTest(stroke, 0.5, 0.5, 0.01)).toBe(true);
    expect(hitTest(stroke, 0.5, 0.511, 0.01)).toBe(true); // 0.011 ≤ 0.01 + 0.002
    expect(hitTest(stroke, 0.5, 0.52, 0.01)).toBe(false);
    expect(hitTest(stroke, 0.95, 0.5, 0.01)).toBe(false); // ucun ötesi
  });

  it('kalın fosforlu kalem yarı kalınlığı kadar geniş değer', () => {
    expect(hitTest(highlight, 0.5, 0.525, 0.01)).toBe(true);
    expect(hitTest(stroke, 0.5, 0.525, 0.01)).toBe(false);
  });

  it('uzaklık dik sayfada yüksekliğe göre ölçeklenir', () => {
    expect(hitTest(stroke, 0.5, 0.508, 0.01, 1)).toBe(true);
    expect(hitTest(stroke, 0.5, 0.508, 0.01, 2)).toBe(false);
  });

  it('not iğnesi noktasına yakınsa değer', () => {
    expect(hitTest(pin, 0.505, 0.505, 0.01)).toBe(true);
    expect(hitTest(pin, 0.53, 0.5, 0.01)).toBe(false);
  });

  it('silgi yolu çizgiyi kesiyorsa iki uç uzak olsa da değer', () => {
    expect(hitTestSegment(stroke, { x: 0.5, y: 0.2 }, { x: 0.5, y: 0.8 }, 0.001)).toBe(true);
    expect(hitTestSegment(stroke, { x: 0.5, y: 0.2 }, { x: 0.5, y: 0.4 }, 0.001)).toBe(false);
  });

  it('boş işaret hiçbir şeye değmez', () => {
    expect(hitTest({ kind: 'ink', points: [], width: 0.01 }, 0, 0, 1)).toBe(false);
  });
});

describe('yardımcılar', () => {
  it('segmentDistance: parçaya dik uzaklık ya da en yakın uca uzaklık', () => {
    expect(segmentDistance(0.5, 1, 0, 0, 1, 0)).toBe(1);
    expect(segmentDistance(2, 0, 0, 0, 1, 0)).toBe(1);
    expect(segmentDistance(3, 4, 0, 0, 0, 0)).toBe(5);
  });

  it('roundPoints 5 basamağa yuvarlar', () => {
    expect(roundPoints([0.123456789, 1 / 3])).toEqual([0.12346, 0.33333]);
  });
});
