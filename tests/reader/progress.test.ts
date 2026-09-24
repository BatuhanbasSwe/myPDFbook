import { describe, expect, it } from 'vitest';
import type { Block } from '../../src/convert/types';
import { blockStartFractions } from '../../src/reader/progress';

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
