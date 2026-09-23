import { describe, expect, it } from 'vitest';
import { buildChapters } from '../../src/convert/chapters';
import type { Block } from '../../src/convert/types';

const blocks: Block[] = [
  { kind: 'heading', level: 1, text: 'KAYIP ŞEHRİN IŞIKLARI', srcPage: 0 },
  { kind: 'heading', level: 1, text: 'BİRİNCİ BÖLÜM', srcPage: 2 },
  { kind: 'heading', level: 2, text: 'Sisli Sabah', srcPage: 2 },
  { kind: 'para', text: 'Metin.', srcPage: 2 },
  { kind: 'heading', level: 1, text: 'İKİNCİ BÖLÜM', srcPage: 5 },
  { kind: 'para', text: 'Metin.', srcPage: 5 },
];

describe('buildChapters', () => {
  it('PDF içindekilerini başlık bloklarına eşler (büyük/küçük harf farkı önemsiz)', () => {
    const outline = [
      { title: 'BİRİNCİ BÖLÜM', pageIndex: 2, level: 1 },
      { title: 'Sisli Sabah', pageIndex: 2, level: 2 },
      { title: 'İkinci Bölüm', pageIndex: 5, level: 1 },
    ];
    expect(buildChapters(blocks, outline)).toEqual([
      { title: 'BİRİNCİ BÖLÜM', block: 1, level: 1 },
      { title: 'Sisli Sabah', block: 2, level: 2 },
      { title: 'İkinci Bölüm', block: 4, level: 1 },
    ]);
  });

  it('içindekiler yoksa başlıklardan üretir ve alt başlığı birleştirir', () => {
    expect(buildChapters(blocks, [])).toEqual([
      { title: 'KAYIP ŞEHRİN IŞIKLARI', block: 0, level: 1 },
      { title: 'BİRİNCİ BÖLÜM — Sisli Sabah', block: 1, level: 1 },
      { title: 'İKİNCİ BÖLÜM', block: 4, level: 1 },
    ]);
  });
});
