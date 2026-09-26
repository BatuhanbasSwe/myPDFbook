import { describe, expect, it } from 'vitest';
import { pageLayout } from '../../src/layout/pageBox';
import { pageOf } from '../../src/layout/paginator';
import { DEFAULT_TYPOGRAPHY, parseTypography } from '../../src/layout/typography';

describe('pageLayout', () => {
  it('telefonda tek sayfa; metin kutusu sayfanın içinde', () => {
    const l = pageLayout({ width: 390, height: 844 }, DEFAULT_TYPOGRAPHY);
    expect(l.spread).toBe(false);
    expect(l.pageWidth).toBe(390);
    expect(l.box.width).toBeLessThan(390);
    expect(l.padLeft * 2 + l.box.width).toBeLessThanOrEqual(390);
    expect(l.padTop + l.box.height).toBeLessThan(844);
  });

  it('iPad yatayda çift sayfa, dikeyde tek sayfa; tek sayfa ayarı çift sayfayı kapatır', () => {
    expect(pageLayout({ width: 1194, height: 834 }, DEFAULT_TYPOGRAPHY).spread).toBe(true);
    expect(pageLayout({ width: 834, height: 1194 }, DEFAULT_TYPOGRAPHY).spread).toBe(false);
    expect(
      pageLayout({ width: 1194, height: 834 }, { ...DEFAULT_TYPOGRAPHY, spread: 'single' }).spread,
    ).toBe(false);
  });

  it('geniş ekranda satır uzunluğu sınırlı (yaklaşık 70 karakter)', () => {
    const l = pageLayout({ width: 1400, height: 900 }, { ...DEFAULT_TYPOGRAPHY, spread: 'single' });
    expect(l.box.width).toBeLessThanOrEqual(34 * DEFAULT_TYPOGRAPHY.size);
  });

  it('aynı girdi aynı tam sayı kutuyu verir', () => {
    const a = pageLayout({ width: 1023.5, height: 767.25 }, DEFAULT_TYPOGRAPHY);
    const b = pageLayout({ width: 1023.5, height: 767.25 }, DEFAULT_TYPOGRAPHY);
    expect(a).toEqual(b);
    expect(Number.isInteger(a.box.width) && Number.isInteger(a.box.height)).toBe(true);
  });
});

describe('parseTypography', () => {
  it('bozuk ya da sınır dışı değerleri geçerli ayarlara çevirir', () => {
    expect(parseTypography(null)).toEqual(DEFAULT_TYPOGRAPHY);
    expect(parseTypography({ font: 'comic', size: 99, lineHeight: 0.5, align: 'center' })).toEqual({
      ...DEFAULT_TYPOGRAPHY,
      size: 30,
      lineHeight: 1.3,
    });
  });
});

describe('pageOf', () => {
  const starts = [
    { block: 0, offset: 0 },
    { block: 3, offset: 0 },
    { block: 3, offset: 120 },
    { block: 7, offset: 0 },
  ];
  it('konumun bulunduğu sayfayı bulur', () => {
    expect(pageOf(starts, { block: 0, offset: 0 })).toBe(0);
    expect(pageOf(starts, { block: 2, offset: 50 })).toBe(0);
    expect(pageOf(starts, { block: 3, offset: 0 })).toBe(1);
    expect(pageOf(starts, { block: 3, offset: 119 })).toBe(1);
    expect(pageOf(starts, { block: 3, offset: 120 })).toBe(2);
    expect(pageOf(starts, { block: 99, offset: 0 })).toBe(3);
  });
});
