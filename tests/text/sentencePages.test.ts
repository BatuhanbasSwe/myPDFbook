import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { convertPdf } from '../../src/convert/convertPdf';
import type { BookContent, PageText, RawTextItem } from '../../src/convert/types';
import { createPdfSource } from '../../src/pdf/pdfSource';
import { createSentencePages, sentenceText } from '../../src/text/sentencePages';
import { buildSentenceIndex, type Sentence } from '../../src/text/sentences';

describe('createSentencePages (novel-tr.pdf)', () => {
  let content: BookContent;
  let pages: PageText[];
  let sentences: Sentence[];
  const text = (s: Sentence) => sentenceText(content.blocks, s);
  const withText = (part: string) => sentences.find((s) => text(s).includes(part))!;
  const create = (reads: number[] = []) =>
    createSentencePages({
      blocks: content.blocks,
      sentences,
      pageCount: pages.length,
      getPageText: async (p) => {
        reads.push(p);
        return pages[p];
      },
    });

  beforeAll(async () => {
    const data = new Uint8Array(
      await readFile(new URL('../fixtures/novel-tr.pdf', import.meta.url)),
    );
    const doc = await getDocument({ data }).promise;
    try {
      const source = createPdfSource(doc);
      content = await convertPdf(source);
      pages = [];
      for (let p = 0; p < source.numPages; p++) pages.push(await source.getPageText(p));
      sentences = buildSentenceIndex(content.blocks, content.lang);
    } finally {
      await doc.loadingTask.destroy();
    }
  });

  it('kitabın her cümlesi sırayla okununca yerini bulur; sayfalar birer kez okunur', async () => {
    const reads: number[] = [];
    const sp = create(reads);
    const missing: string[] = [];
    for (const s of sentences) {
      const parts = await sp.locate(s);
      if (parts.length === 0) missing.push(text(s));
      for (const p of parts) expect(p.rects.length).toBeGreaterThan(0);
    }
    expect(missing).toEqual([]);
    expect(new Set(reads).size).toBe(reads.length);
  });

  it('sayfa sınırından taşan cümle: baş parçası bir sayfada, son parçası sonrakinde', async () => {
    const sp = create();
    const s = withText('söylemiyormuş gibiydi ve bu sessizlik');
    const parts = await sp.locate(s);
    expect(parts.map((p) => [p.page, p.part])).toEqual([
      [2, 'head'],
      [3, 'tail'],
    ]);
    // aynı sonuç önbellekten gelir
    expect(await sp.locate(s)).toBe(parts);
  });

  it('sayfanın ilk cümlesi: önceki sayfadan taşan cümle; blok başıyla açılan sayfada ilk bloğun ilk cümlesi', async () => {
    const sp = create();
    const crossing = withText('söylemiyormuş gibiydi ve bu sessizlik');
    expect((await sp.firstOnPage(3))?.id).toBe(crossing.id);
    // bu cümle o sayfadan aranır: yalnızca sayfadaki son parçası
    expect((await sp.locate(crossing)).map((p) => [p.page, p.part])).toEqual([[3, 'tail']]);

    const para = content.blocks.findIndex((b) => b.kind === 'para' && b.srcPage === 2);
    const first = await sp.firstOnPage(2);
    expect(first && content.blocks[first.block].srcPage).toBe(2);
    expect(first!.id).toBeLessThanOrEqual(sentences.find((s) => s.block === para)!.id);
  });

  it('bulunamayan cümle boş sonuç verir; okunamayan sayfa sonra yeniden denenir', async () => {
    let fail = true;
    const sp = createSentencePages({
      blocks: content.blocks,
      sentences,
      pageCount: pages.length,
      getPageText: async (p) => {
        if (fail) throw new Error('okunamadı');
        return pages[p];
      },
    });
    const s = withText('kitabı tutuyordu');
    await expect(sp.locate(s)).rejects.toThrow();
    fail = false;
    expect((await sp.locate(s))[0]?.part).toBe('whole');
  });
});

describe('createSentencePages (yapay sayfa)', () => {
  const item = (str: string, x: number, y: number, width: number): RawTextItem => ({
    str,
    transform: [10, 0, 0, 10, x, y],
    width,
    height: 10,
  });

  it('aynı kısa cümle sayfada iki kez geçse de sırayla okununca her biri kendi yerinde bulunur', async () => {
    const text = 'Evet. Bunu dedi o. Evet.';
    const blocks = [{ kind: 'para' as const, text, srcPage: 0 }];
    const sentences = buildSentenceIndex(blocks, 'tr');
    expect(sentences).toHaveLength(3);
    const sp = createSentencePages({
      blocks,
      sentences,
      pageCount: 1,
      getPageText: async () => ({
        width: 400,
        height: 800,
        items: [item('Evet. Bunu dedi o.', 100, 700, 180), item('Evet.', 100, 685, 50)],
      }),
    });
    const [first] = await sp.locate(sentences[0]);
    await sp.locate(sentences[1]);
    const [last] = await sp.locate(sentences[2]);
    // ilk satır: y = 800 − 700 − 9; ikinci satır 15 birim aşağıda
    expect(first.rects[0].y).toBe(91);
    expect(last.rects[0].y).toBe(106);
  });
});
