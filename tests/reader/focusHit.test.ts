import { describe, expect, it } from 'vitest';
import {
  clientToPage,
  rectDistance,
  sentenceAtOffset,
  sentenceAtPoint,
  type SentenceRects,
} from '../../src/reader/modes/focusHit';
import { buildSentenceIndex } from '../../src/text/sentences';

describe('clientToPage', () => {
  it('sayfa kutunun ortasında, oranı korunarak (xMidYMid meet) ölçeklenir', () => {
    // 600×800 sayfa, 300×800 kutu: ölçek 0,5; sayfa dikeyde ortada (üstte 200 px boşluk)
    const box = { left: 10, top: 20, width: 300, height: 800 };
    expect(clientToPage(box, 600, 800, 10, 220)).toEqual({ x: 0, y: 0, unit: 2 });
    expect(clientToPage(box, 600, 800, 160, 420)).toEqual({ x: 300, y: 400, unit: 2 });
    // yatayda ortalanan sayfa
    const wide = { left: 0, top: 0, width: 1000, height: 400 };
    expect(clientToPage(wide, 300, 400, 350, 0)).toEqual({ x: 0, y: 0, unit: 1 });
  });

  it('boş kutu ya da sayfa: null', () => {
    expect(clientToPage({ left: 0, top: 0, width: 0, height: 10 }, 10, 10, 0, 0)).toBeNull();
    expect(clientToPage({ left: 0, top: 0, width: 10, height: 10 }, 0, 10, 0, 0)).toBeNull();
  });
});

describe('sentenceAtPoint', () => {
  const r = (x: number, y: number, width: number, height = 10) => ({ x, y, width, height });
  // İki satır: ilk satırda A ve B'nin başı, ikinci satırda B'nin sonu ve C
  const items: SentenceRects[] = [
    { id: 4, rects: [r(0, 0, 100)] },
    { id: 5, rects: [r(110, 0, 90), r(0, 14, 60)] },
    { id: 6, rects: [r(70, 14, 130)] },
  ];

  it('dikdörtgenin içindeki nokta o cümlenin', () => {
    expect(sentenceAtPoint(items, 50, 5, 4)).toBe(4);
    expect(sentenceAtPoint(items, 150, 5, 4)).toBe(5);
    expect(sentenceAtPoint(items, 30, 20, 4)).toBe(5);
    expect(sentenceAtPoint(items, 199, 23, 4)).toBe(6);
  });

  it('kelime ve satır arasındaki boşlukta en yakın cümle', () => {
    // A ile B arası: A'ya 2, B'ye 8 birim
    expect(sentenceAtPoint(items, 102, 5, 4)).toBe(4);
    expect(sentenceAtPoint(items, 108, 5, 4)).toBe(5);
    // satır arası (y 10–14): üst satıra daha yakın
    expect(sentenceAtPoint(items, 150, 11, 4)).toBe(5);
    expect(sentenceAtPoint(items, 150, 13.5, 4)).toBe(6);
  });

  it('tolerans dışındaki nokta: null; boş liste null', () => {
    expect(sentenceAtPoint(items, 150, 40, 4)).toBeNull();
    expect(sentenceAtPoint(items, 150, 40, 20)).toBe(6);
    expect(sentenceAtPoint(items, -10, 5, 4)).toBeNull();
    expect(sentenceAtPoint([], 0, 0, 100)).toBeNull();
  });

  it('rectDistance: içte 0, köşeye çapraz uzaklık', () => {
    expect(rectDistance(r(0, 0, 10), 5, 5)).toBe(0);
    expect(rectDistance(r(0, 0, 10), 13, 14)).toBe(5);
  });
});

describe('sentenceAtOffset', () => {
  const blocks = [
    { kind: 'para' as const, text: 'Bir. İki cümle.  ', srcPage: 0 },
    { kind: 'para' as const, text: 'Üç.', srcPage: 0 },
  ];
  const list = buildSentenceIndex(blocks, 'tr');

  it('konumu içeren cümle; cümle arası ve blok sonundaki boşlukta önceki cümle', () => {
    expect(list.map((s) => s.id)).toEqual([0, 1, 2]);
    expect(sentenceAtOffset(list, { block: 0, offset: 0 })?.id).toBe(0);
    expect(sentenceAtOffset(list, { block: 0, offset: 3 })?.id).toBe(0);
    // "Bir." ile "İki" arasındaki boşluk
    expect(sentenceAtOffset(list, { block: 0, offset: 4 })?.id).toBe(0);
    expect(sentenceAtOffset(list, { block: 0, offset: 6 })?.id).toBe(1);
    // bloğun sonundaki boşluk: sonraki bloğun cümlesi değil
    expect(sentenceAtOffset(list, { block: 0, offset: 16 })?.id).toBe(1);
    expect(sentenceAtOffset(list, { block: 1, offset: 1 })?.id).toBe(2);
  });

  it('cümlesi olmayan blok: null', () => {
    expect(sentenceAtOffset(list, { block: 5, offset: 0 })).toBeNull();
    expect(sentenceAtOffset([], { block: 0, offset: 0 })).toBeNull();
  });
});
