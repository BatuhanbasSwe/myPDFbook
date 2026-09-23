import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type BookDB } from '../../src/db/db';
import { importBook, resumeConversions, type ImportDeps, type OpenedPdf } from '../../src/import/importBook';
import { createPdfSource } from '../../src/pdf/pdfSource';

async function nodeOpenPdf(bytes: Uint8Array, password?: string): Promise<OpenedPdf> {
  const doc = await getDocument({ data: bytes, password }).promise;
  return { source: createPdfSource(doc), renderCover: async () => undefined, close: () => doc.loadingTask.destroy() };
}

async function fixtureFile(name: string, as = name): Promise<File> {
  const bytes = await readFile(new URL(`../fixtures/${name}`, import.meta.url));
  return new File([bytes], as, { type: 'application/pdf' });
}

let db: BookDB;
let deps: ImportDeps;
beforeEach(async () => {
  db = createDb(`test-${crypto.randomUUID()}`);
  await db.open();
  deps = { db, openPdf: nodeOpenPdf };
});
afterEach(async () => {
  await db.delete();
});

describe('importBook', () => {
  it('kitabı ekler, dosyayı saklar ve dönüştürür', async () => {
    const res = await importBook(await fixtureFile('novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf'), deps);
    expect(res.status).toBe('added');
    await res.done;
    const book = await db.books.get(res.bookId);
    expect(book).toMatchObject({
      title: 'Kayıp Şehrin Işıkları',
      author: 'Deniz Aksoy',
      pdfPageCount: 6,
      lang: 'tr',
      readingStatus: 'unread',
    });
    expect(book?.convert).toMatchObject({ state: 'done', progress: 1 });
    expect(await db.files.get(res.bookId)).toBeDefined();
    expect((await db.contents.get(res.bookId))?.blocks.length).toBeGreaterThan(10);
  });

  it('aynı dosyayı ikinci kez eklemez', async () => {
    const first = await importBook(await fixtureFile('novel-tr.pdf'), deps);
    await first.done;
    const second = await importBook(await fixtureFile('novel-tr.pdf', 'baska-ad.pdf'), deps);
    expect(second).toMatchObject({ status: 'exists', bookId: first.bookId });
    expect(await db.books.count()).toBe(1);
  });

  it('PDF olmayan dosyayı reddeder ve hiçbir şey kaydetmez', async () => {
    const bad = new File([new TextEncoder().encode('merhaba')], 'not.pdf');
    await expect(importBook(bad, deps)).rejects.toMatchObject({ code: 'invalid-pdf' });
    expect(await db.books.count()).toBe(0);
  });

  it('yarıda kalan dönüştürmeyi yeniden başlatır', async () => {
    const res = await importBook(await fixtureFile('novel-tr.pdf'), deps);
    await res.done;
    await db.books.update(res.bookId, { convert: { state: 'running', progress: 0.3, version: 1 } });
    await db.contents.clear();
    await resumeConversions(deps);
    expect((await db.books.get(res.bookId))?.convert.state).toBe('done');
    expect(await db.contents.get(res.bookId)).toBeDefined();
  });
});
