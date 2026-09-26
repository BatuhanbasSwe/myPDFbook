import { describe, expect, it } from 'vitest';
import type { Block } from '../../src/convert/types';
import {
  blockAtFraction,
  blockStartFractions,
  locatorAtFraction,
  locatorFraction,
  locatorOfPdfPage,
  pdfPageOfLocator,
  startLocator,
  startPosition,
} from '../../src/reader/progress';

describe('blockStartFractions', () => {
  it('blokların başlangıç oranını metin uzunluğuna göre hesaplar (görsel sayfa = 400 karakter)', () => {
    const blocks: Block[] = [
      { kind: 'para', text: 'a'.repeat(100), srcPage: 0 },
      { kind: 'pageImage', srcPage: 1 },
      { kind: 'para', text: 'b'.repeat(500), srcPage: 2 },
    ];
    expect(blockStartFractions(blocks)).toEqual([0, 0.1, 0.5]);
  });

  it('boş kitapta boş liste döner', () => {
    expect(blockStartFractions([])).toEqual([]);
  });
});

describe('blockAtFraction', () => {
  it('orana denk gelen bloğu bulur (sınırda sonraki blok)', () => {
    const f = [0, 0.1, 0.5];
    expect(blockAtFraction(f, 0)).toBe(0);
    expect(blockAtFraction(f, 0.3)).toBe(1);
    expect(blockAtFraction(f, 0.5)).toBe(2);
    expect(blockAtFraction(f, 1)).toBe(2);
  });
});

describe('locatorFraction / locatorAtFraction / startLocator', () => {
  const blocks: Block[] = [
    { kind: 'para', text: 'a'.repeat(100), srcPage: 0 },
    { kind: 'para', text: 'b'.repeat(300), srcPage: 1 },
    { kind: 'para', text: 'c'.repeat(600), srcPage: 2 },
  ];
  const f = blockStartFractions(blocks); // [0, 0.1, 0.4]

  it('blok içindeki konumu da oranlar', () => {
    expect(locatorFraction(blocks, f, { block: 1, offset: 150 })).toBeCloseTo(0.25);
    expect(locatorFraction(blocks, f, { block: 2, offset: 600 })).toBeCloseTo(1);
  });

  it('orandan konuma ve geri', () => {
    expect(locatorAtFraction(blocks, f, 0.25)).toEqual({ block: 1, offset: 150 });
    expect(locatorAtFraction(blocks, f, 1)).toEqual({ block: 2, offset: 599 });
  });

  it('aynı sürümde kayıtlı konum (blok içindeki yer dahil); farklı sürümde orandan', () => {
    const saved = { locator: { block: 1, offset: 42 }, percent: 0.7, contentVersion: 2 };
    expect(startLocator(saved, blocks, 2)).toEqual({ block: 1, offset: 42 });
    expect(startLocator(saved, blocks, 3)).toEqual({ block: 2, offset: 300 });
  });
});

describe('pdfPageOfLocator / locatorOfPdfPage / startPosition', () => {
  // PDF sayfaları: 0 kapak (görsel), 1 boş, 2–3 metin (3. sayfada paragraf 2'den sürer), 4 metin, 5 boş arka kapak
  const blocks: Block[] = [
    { kind: 'pageImage', srcPage: 0 },
    { kind: 'heading', level: 1, text: 'Bir', srcPage: 2 },
    { kind: 'para', text: 'a'.repeat(900), srcPage: 2 },
    { kind: 'para', text: 'b'.repeat(100), srcPage: 3 },
    { kind: 'para', text: 'c'.repeat(100), srcPage: 4 },
  ];

  it('metindeki konumun PDF sayfası bloğun başladığı sayfadır', () => {
    expect(pdfPageOfLocator(blocks, { block: 0, offset: 0 })).toBe(0);
    expect(pdfPageOfLocator(blocks, { block: 2, offset: 800 })).toBe(2);
    expect(pdfPageOfLocator(blocks, { block: 4, offset: 0 })).toBe(4);
    expect(pdfPageOfLocator(blocks, { block: 99, offset: 0 })).toBe(4);
    expect(pdfPageOfLocator([], { block: 0, offset: 0 })).toBe(0);
  });

  it('PDF sayfasının konumu o sayfadaki ilk blok; metinsiz sayfada sonraki ilk blok; sonda son blok', () => {
    expect(locatorOfPdfPage(blocks, 0)).toEqual({ block: 0, offset: 0 });
    expect(locatorOfPdfPage(blocks, 1)).toEqual({ block: 1, offset: 0 }); // boş sayfa
    expect(locatorOfPdfPage(blocks, 2)).toEqual({ block: 1, offset: 0 });
    expect(locatorOfPdfPage(blocks, 3)).toEqual({ block: 3, offset: 0 });
    expect(locatorOfPdfPage(blocks, 4)).toEqual({ block: 4, offset: 0 });
    expect(locatorOfPdfPage(blocks, 5)).toEqual({ block: 4, offset: 0 }); // son sayfa, metinsiz
    expect(locatorOfPdfPage([], 3)).toEqual({ block: 0, offset: 0 });
  });

  it('sayfadan metne, metinden sayfaya dönünce aynı sayfa (metinli sayfalarda)', () => {
    for (const page of [0, 2, 3, 4]) {
      expect(pdfPageOfLocator(blocks, locatorOfPdfPage(blocks, page))).toBe(page);
    }
  });

  it('açılış: kayıtlı PDF sayfası önce (metinsiz sayfa da), yoksa konumun sayfası; sayfa sayısıyla sınırlı', () => {
    const base = { locator: { block: 2, offset: 500 }, percent: 0.5, contentVersion: 1 };
    expect(startPosition(base, blocks, 1, 6)).toEqual({ locator: base.locator, pdfPage: 2 });
    expect(startPosition({ ...base, pdfPage: 5 }, blocks, 1, 6)).toEqual({
      locator: base.locator,
      pdfPage: 5,
    });
    expect(startPosition({ ...base, pdfPage: 40 }, blocks, 1, 6).pdfPage).toBe(5);
    expect(startPosition(null, blocks, 1, 6)).toEqual({
      locator: { block: 0, offset: 0 },
      pdfPage: 0,
    });
  });
});
