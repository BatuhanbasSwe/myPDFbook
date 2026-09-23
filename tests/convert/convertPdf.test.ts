import { describe, expect, it } from 'vitest';
import { convertPdf } from '../../src/convert/convertPdf';
import type { PdfSource, RawTextItem } from '../../src/convert/types';

const textItem = (str: string, y: number): RawTextItem => ({
  str,
  transform: [10, 0, 0, 10, 40, y],
  width: str.length * 5,
  height: 10,
});

function fakeSource(pages: string[][], imagePages: Set<number>): PdfSource {
  return {
    numPages: pages.length,
    getPageText: async (i) => ({ width: 420, height: 595, items: pages[i].map((s, k) => textItem(s, 500 - k * 15)) }),
    hasImages: async (i) => imagePages.has(i),
    getOutline: async () => [],
    getMetadata: async () => ({}),
  };
}

describe('convertPdf', () => {
  it('görsel kontrolü sırasında da ilerleme bildirir; ilerleme artarak 1 ile biter', async () => {
    const body = ['Bu sayfada yeterince uzun bir metin satırı bulunuyor ve devam ediyor.'];
    const pages = [body, [], body, [], body, body, body, body];
    const seen: number[] = [];
    const content = await convertPdf(fakeSource(pages, new Set([1, 3])), { onProgress: (p) => seen.push(p) });
    expect(content.textlessPages).toEqual([1, 3]);
    expect(seen.some((p) => p > 0.95 && p < 1)).toBe(true);
    expect(seen.every((p, i) => i === 0 || p >= seen[i - 1])).toBe(true);
    expect(seen[seen.length - 1]).toBe(1);
  });
});
