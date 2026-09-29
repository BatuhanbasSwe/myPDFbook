import { Dexie } from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addBookmark,
  bookBookmarks,
  deleteBookmark,
  toggleBookmark,
} from '../../src/bookmarks/store';
import { deleteBook } from '../../src/db/books';
import { createDb, type BookDB, type BookRecord } from '../../src/db/db';

const book = (id: string): BookRecord => ({
  id,
  title: 'T',
  author: '',
  fileName: 't.pdf',
  fileSize: 1,
  pdfPageCount: 10,
  lang: 'tr',
  addedAt: 1,
  convert: { state: 'done', progress: 1, version: 1 },
  readingStatus: 'unread',
  totalWords: 0,
});

let db: BookDB;
beforeEach(async () => {
  db = createDb(`test-${crypto.randomUUID()}`);
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

describe('yer imleri', () => {
  it('ekler, sayfa sırasıyla listeler, siler', async () => {
    const b = await addBookmark(db, 'a', { pdfPage: 7 }, 100);
    const a = await addBookmark(db, 'a', { pdfPage: 2, locator: { block: 4, offset: 12 } }, 200);
    await addBookmark(db, 'b', { pdfPage: 1 }, 300);
    expect(await bookBookmarks(db, 'a')).toEqual([
      { id: a.id, bookId: 'a', pdfPage: 2, locator: { block: 4, offset: 12 }, createdAt: 200 },
      { id: b.id, bookId: 'a', pdfPage: 7, createdAt: 100 },
    ]);
    await deleteBookmark(db, a.id);
    expect((await bookBookmarks(db, 'a')).map((x) => x.pdfPage)).toEqual([7]);
  });

  it('toggleBookmark: yoksa ilk sayfaya ekler, açık sayfalardan birinde varsa hepsini kaldırır', async () => {
    expect(await toggleBookmark(db, 'a', [{ pdfPage: 4 }, { pdfPage: 5 }], 10)).toBe(true);
    expect(await bookBookmarks(db, 'a')).toMatchObject([{ pdfPage: 4, createdAt: 10 }]);
    // Çift sayfanın sağındaki sayfada yer imi (tek sayfa görünümünde konmuş): sol sayfayla birlikte kalkar
    await addBookmark(db, 'a', { pdfPage: 5 });
    expect(await toggleBookmark(db, 'a', [{ pdfPage: 4 }, { pdfPage: 5 }])).toBe(false);
    expect(await bookBookmarks(db, 'a')).toEqual([]);
    // Metin görünümü: konum da saklanır; öteki kitabın aynı sayfası etkilenmez
    await addBookmark(db, 'b', { pdfPage: 3 });
    await toggleBookmark(db, 'a', [{ pdfPage: 3, locator: { block: 9, offset: 0 } }]);
    expect(await bookBookmarks(db, 'a')).toMatchObject([
      { pdfPage: 3, locator: { block: 9, offset: 0 } },
    ]);
    expect(await bookBookmarks(db, 'b')).toHaveLength(1);
    expect(await toggleBookmark(db, 'a', [])).toBe(false);
  });

  it('deleteBook kitabın yer imlerini de siler (ötekilere dokunmaz)', async () => {
    await db.books.add(book('a'));
    await addBookmark(db, 'a', { pdfPage: 1 });
    await addBookmark(db, 'a', { pdfPage: 2 });
    await addBookmark(db, 'b', { pdfPage: 1 });
    await deleteBook(db, 'a');
    expect(await bookBookmarks(db, 'a')).toEqual([]);
    expect(await bookBookmarks(db, 'b')).toHaveLength(1);
  });
});

describe('şema yükseltmesi (yer imleri)', () => {
  it('sürüm 3 veritabanı sürüm 4 ile açılınca kitaplar ve işaretler yerinde kalır, yer imi tablosu gelir', async () => {
    const name = `test-${crypto.randomUUID()}`;
    // Sürüm 1–3'ün (yayımlanmış) tanımı
    const v3 = new Dexie(name);
    v3.version(1).stores({
      books: 'id, addedAt, lastOpenedAt',
      files: 'bookId',
      covers: 'bookId',
      contents: 'bookId',
      progress: 'bookId',
    });
    v3.version(2).stores({ layouts: '[bookId+signature], bookId, usedAt' });
    v3.version(3).stores({ annotations: '++id, [bookId+page], bookId, updatedAt' });
    await v3.table('books').add(book('eski'));
    await v3.table('progress').put({
      bookId: 'eski',
      locator: { block: 2, offset: 0 },
      percent: 0.2,
      updatedAt: 1,
    });
    const noteId = await v3.table('annotations').add({
      bookId: 'eski',
      page: 3,
      kind: 'note',
      color: '#ffd400',
      width: 0,
      points: [0.5, 0.5],
      text: 'not',
      createdAt: 1,
      updatedAt: 1,
    });
    v3.close();

    const v4 = createDb(name);
    try {
      await v4.open();
      expect(v4.verno).toBeGreaterThanOrEqual(4);
      expect(await v4.books.get('eski')).toMatchObject({ id: 'eski', title: 'T' });
      expect(await v4.progress.get('eski')).toMatchObject({ percent: 0.2 });
      expect(await v4.annotations.get(noteId as number)).toMatchObject({ text: 'not', page: 3 });
      expect(await bookBookmarks(v4, 'eski')).toEqual([]);
      await toggleBookmark(v4, 'eski', [{ pdfPage: 3 }]);
      expect(await bookBookmarks(v4, 'eski')).toMatchObject([{ pdfPage: 3 }]);
    } finally {
      await v4.delete();
    }
  });
});
