import { describe, expect, it } from 'vitest';
import type { Block } from '../../src/convert/types';
import { blockAtFraction, blockStartFractions, startBlock } from '../../src/reader/progress';

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

describe('startBlock', () => {
  const blocks: Block[] = [
    { kind: 'para', text: 'a'.repeat(100), srcPage: 0 },
    { kind: 'para', text: 'b'.repeat(100), srcPage: 1 },
    { kind: 'para', text: 'c'.repeat(800), srcPage: 2 },
  ];

  it('kayıt yoksa baştan başlar', () => {
    expect(startBlock(null, blocks, 2)).toBe(0);
  });

  it('kayıt aynı içerik sürümüne aitse kayıtlı bloğu kullanır', () => {
    const saved = { locator: { block: 1, offset: 0 }, percent: 0.9, contentVersion: 2 };
    expect(startBlock(saved, blocks, 2)).toBe(1);
  });

  it('kitap yeniden dönüştürüldüyse okuma oranına denk gelen bloğa gider', () => {
    const saved = { locator: { block: 1, offset: 0 }, percent: 0.5, contentVersion: 1 };
    expect(startBlock(saved, blocks, 2)).toBe(2);
  });

  it('sürümsüz kayıt ilk sürüme aittir', () => {
    const saved = { locator: { block: 1, offset: 0 }, percent: 0.5 };
    expect(startBlock(saved, blocks, 1)).toBe(1);
    expect(startBlock(saved, blocks, 2)).toBe(2);
  });
});
