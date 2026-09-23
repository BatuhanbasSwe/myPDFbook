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

describe('buildChapters — inceleme düzeltmeleri', () => {
  it('yalnızca "Kapak" içeren içindekiler, başlıklardan bulunan bölümleri gölgelemez', () => {
    const book: Block[] = [
      { kind: 'para', text: 'Kapak sayfası.', srcPage: 0 },
      { kind: 'heading', level: 1, text: 'BİRİNCİ BÖLÜM', srcPage: 1 },
      { kind: 'para', text: 'Metin.', srcPage: 1 },
      { kind: 'heading', level: 1, text: 'İKİNCİ BÖLÜM', srcPage: 3 },
      { kind: 'para', text: 'Metin.', srcPage: 3 },
    ];
    expect(buildChapters(book, [{ title: 'Kapak', pageIndex: 0, level: 1 }])).toEqual([
      { title: 'BİRİNCİ BÖLÜM', block: 1, level: 1 },
      { title: 'İKİNCİ BÖLÜM', block: 3, level: 1 },
    ]);
  });

  it('aynı sayfadaki ikinci içindekiler girişi kullanılmamış bir sonraki bloğa bağlanır', () => {
    const book: Block[] = [
      { kind: 'heading', level: 1, text: 'GİRİŞ', srcPage: 0 },
      { kind: 'para', text: 'Metin.', srcPage: 0 },
      { kind: 'para', text: 'Metin.', srcPage: 1 },
    ];
    const outline = [
      { title: '1. Bölüm: Giriş', pageIndex: 0, level: 1 },
      { title: 'Alt Başlık', pageIndex: 0, level: 2 },
    ];
    expect(buildChapters(book, outline)).toEqual([
      { title: '1. Bölüm: Giriş', block: 0, level: 1 },
      { title: 'Alt Başlık', block: 1, level: 2 },
    ]);
  });

  it('art arda gelen iki alt başlığı da bölüm adına ekler', () => {
    const book: Block[] = [
      { kind: 'heading', level: 1, text: 'BİRİNCİ BÖLÜM', srcPage: 0 },
      { kind: 'heading', level: 2, text: 'Sisli Sabah', srcPage: 0 },
      { kind: 'heading', level: 2, text: 'Yazan: Biri', srcPage: 0 },
      { kind: 'para', text: 'Metin.', srcPage: 0 },
    ];
    expect(buildChapters(book, [])).toEqual([
      { title: 'BİRİNCİ BÖLÜM — Sisli Sabah — Yazan: Biri', block: 0, level: 1 },
    ]);
  });
});
