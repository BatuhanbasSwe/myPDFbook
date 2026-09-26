import { describe, expect, it } from 'vitest';
import { DEFAULT_ASPECT, pdfPageLayout } from '../../src/layout/pdfPageBox';

/** A5 kitap sayfası (148 × 210 mm) */
const A5 = 148 / 210;

describe('pdfPageLayout', () => {
  it('telefonda dikey: tek sayfa, genişliğe sığar, oran korunur', () => {
    const l = pdfPageLayout({ width: 400, height: 800 }, A5, 'auto');
    expect(l.spread).toBe(false);
    expect(l.pageWidth).toBe(400);
    expect(l.pageHeight).toBe(Math.floor(400 / A5));
    expect(l.pageHeight).toBeLessThanOrEqual(800);
  });

  it('iPad yatay: çift sayfa, yüksekliğe sığar, iki sayfa yan yana alanın içinde', () => {
    const vp = { width: 1182, height: 814 };
    const l = pdfPageLayout(vp, A5, 'auto');
    expect(l.spread).toBe(true);
    expect(l.pageHeight).toBe(814);
    expect(l.pageWidth).toBe(Math.floor(814 * A5));
    expect(l.pageWidth * 2).toBeLessThanOrEqual(vp.width);
  });

  it('tek sayfa ayarında, dar ya da dikey ekranda çift sayfa yok', () => {
    expect(pdfPageLayout({ width: 1182, height: 814 }, A5, 'single').spread).toBe(false);
    expect(pdfPageLayout({ width: 880, height: 600 }, A5, 'auto').spread).toBe(false);
    expect(pdfPageLayout({ width: 822, height: 1170 }, A5, 'auto').spread).toBe(false);
  });

  it('yatık sayfa (sunum) yan yana çok küçüleceği için tek sayfa kalır', () => {
    const l = pdfPageLayout({ width: 1182, height: 814 }, 16 / 9, 'auto');
    expect(l.spread).toBe(false);
    expect(l.pageWidth).toBe(1182);
    expect(l.pageHeight).toBe(Math.floor(1182 / (16 / 9)));
  });

  it('tek sayfa geniş ekranda yüksekliğe sığar ve ortalanabilir boyutta kalır', () => {
    const l = pdfPageLayout({ width: 1268, height: 700 }, A5, 'single');
    expect(l.pageHeight).toBe(700);
    expect(l.pageWidth).toBeLessThan(1268);
  });

  it('geçersiz oran yerine A serisi oranı kullanılır; boyutlar tam sayı', () => {
    const l = pdfPageLayout({ width: 500.5, height: 900.25 }, Number.NaN, 'auto');
    expect(l).toEqual(pdfPageLayout({ width: 500.5, height: 900.25 }, DEFAULT_ASPECT, 'auto'));
    expect(Number.isInteger(l.pageWidth) && Number.isInteger(l.pageHeight)).toBe(true);
    expect(l.pageWidth).toBeLessThanOrEqual(500.5);
  });
});
