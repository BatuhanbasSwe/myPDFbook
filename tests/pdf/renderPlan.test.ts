import { describe, expect, it } from 'vitest';
import { renderPlan, turnDirection } from '../../src/pdf/renderPlan';

const ids = (plan: ReturnType<typeof renderPlan>) =>
  plan.map((p) => `${p.quality === 'sharp' ? 'S' : 'p'}${p.page}`);

describe('renderPlan', () => {
  it('açık sayfalar, yakın önizlemeler, sonraki iki açılış, önceki açılış; sonra uzaklar', () => {
    const plan = ids(renderPlan([10, 11], 100, 1));
    // Açık sayfalar önce
    expect(plan.slice(0, 2)).toEqual(['S10', 'S11']);
    // Yakındaki sayfaların önizlemesi (ileride 4, geride 2): keskinlerinden önce
    expect(plan.slice(2, 8).sort()).toEqual(['p12', 'p13', 'p14', 'p15', 'p8', 'p9'].sort());
    // Sonra okuma yönünde keskin sayfalar, geridekiler daha geç
    expect(plan.slice(8, 14)).toEqual(['S12', 'S13', 'S9', 'S14', 'S8', 'S15']);
    // Her sayfanın keskin ve önizleme işi bir kez
    expect(new Set(plan).size).toBe(plan.length);
    expect(plan.filter((p) => p.startsWith('S'))).toHaveLength(100);
    expect(plan.filter((p) => p.startsWith('p'))).toHaveLength(98);
  });

  it('uzak önizlemeler keskin sayfalardan çok daha uzağa uzanır', () => {
    const plan = ids(renderPlan([0], 300, 1));
    const sharp20 = plan.indexOf('S20');
    // Keskin sayfa 20'ye varmadan önizlemeler 60 sayfa ileriyi kaplar
    expect(plan.indexOf('p60')).toBeLessThan(sharp20);
    expect(plan.indexOf('p120')).toBeGreaterThan(sharp20);
  });

  it('geri okunuyorsa öncekiler önce', () => {
    const plan = ids(renderPlan([10], 100, -1));
    expect(plan[0]).toBe('S10');
    expect(plan.slice(7, 10)).toEqual(['S9', 'S8', 'S11']);
  });

  it('kitabın sınırları ve boş okuma yeri', () => {
    expect(renderPlan([], 10, 1)).toEqual([]);
    expect(renderPlan([0], 0, 1)).toEqual([]);
    const plan = renderPlan([0], 3, 1);
    expect(plan.every((p) => p.page >= 0 && p.page < 3)).toBe(true);
  });
});

describe('turnDirection', () => {
  it('geri gidince -1, ileri ya da ilk açılışta 1', () => {
    expect(turnDirection(null, [4])).toBe(1);
    expect(turnDirection([4, 5], [6, 7])).toBe(1);
    expect(turnDirection([4, 5], [2, 3])).toBe(-1);
  });
});
