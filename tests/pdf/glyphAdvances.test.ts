import { describe, expect, it } from 'vitest';
import { glyphAdvances, unicodeToCode, type FontMetrics } from '../../src/pdf/glyphAdvances';

/** Basit font: a=500, b=250, boşluk yok (pdf.js ekler) */
const font: FontMetrics = {
  widths: { 97: 500, 98: 250 },
  defaultWidth: 0,
  toUnicode: { _map: Object.assign([], { 97: 'a', 98: 'b' }) },
};

describe('unicodeToCode', () => {
  it('ToUnicode eşlemesini ters çevirir', () => {
    expect([...unicodeToCode(font)!]).toEqual([
      ['a', 97],
      ['b', 98],
    ]);
  });
  it('kimlik eşlemesi; bileşik fontta yalnızca kimlik CMap', () => {
    const identity: FontMetrics = { widths: [], toUnicode: { firstChar: 65, lastChar: 66 } };
    expect(unicodeToCode(identity)?.get('B')).toBe(66);
    const cid = { ...identity, composite: true };
    expect(unicodeToCode({ ...cid, cMap: { name: 'Identity-H' } })).not.toBeNull();
    expect(
      unicodeToCode({ ...cid, cMap: { name: '', _map: [], codespaceRanges: [[], [0, 0xffff]] } }),
    ).not.toBeNull();
    expect(unicodeToCode({ ...cid, cMap: { name: 'UniJIS-UCS2-H', _map: [1, 2] } })).toBeNull();
    expect(unicodeToCode({ ...identity, isType3Font: true })).toBeNull();
  });
});

describe('glyphAdvances', () => {
  const codes = unicodeToCode(font)!;

  it('glif genişliklerini punto ile ölçekler, toplamı öğe genişliği', () => {
    // 10 pt: a = 5, b = 2,5
    expect(glyphAdvances('ab', 7.5, 10, font, codes)).toEqual([5, 2.5]);
  });

  it('fontta olmayan boşluk kalan genişliği alır (iki yana yaslı satır)', () => {
    const adv = glyphAdvances('a b', 12.5, 10, font, codes)!;
    expect(adv).toEqual([5, 5, 2.5]);
  });

  it('harf aralığı: toplam öğe genişliğine orantılı eşitlenir', () => {
    const adv = glyphAdvances('ab', 9, 10, font, codes)!;
    expect(adv[0] / adv[1]).toBeCloseTo(2);
    expect(adv[0] + adv[1]).toBeCloseTo(9);
  });

  it('glifler öğeden belirgin genişse (yanlış eşleme) ya da hiçbiri bilinmiyorsa undefined', () => {
    expect(glyphAdvances('ab', 3, 10, font, codes)).toBeUndefined();
    expect(glyphAdvances('xyz', 10, 10, font, codes)).toBeUndefined();
  });
});
