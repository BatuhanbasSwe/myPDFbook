import { describe, expect, it } from 'vitest';
import type { Block } from '../../src/convert/types';
import {
  blockAtFraction,
  blockStartFractions,
  locatorAtFraction,
  locatorFraction,
  startLocator,
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
