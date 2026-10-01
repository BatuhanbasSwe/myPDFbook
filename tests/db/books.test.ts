import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteBook, markOpened, saveProgress } from '../../src/db/books';
import {
  BOOK_TABLES,
  createDb,
  type BookDB,
  type BookRecord,
  type SessionRecord,
} from '../../src/db/db';

const book = (id: string): BookRecord => ({
  id,
  title: 'T',
  author: '',
  fileName: 't.pdf',
  fileSize: 1,
  pdfPageCount: 1,
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

describe('kitap işlemleri', () => {
  it('deleteBook kitabın tüm verisini siler', async () => {
    await db.books.add(book('a'));
    await db.files.add({ bookId: 'a', data: new ArrayBuffer(1) });
    await db.contents.add({
      bookId: 'a',
      version: 1,
      lang: 'tr',
      blocks: [],
      chapters: [],
      textlessPages: [],
      totalWords: 0,
    });
    await saveProgress(db, 'a', {
      locator: { block: 3, offset: 0 },
      percent: 0.5,
      contentVersion: 1,
    });
    await deleteBook(db, 'a');
    expect(await db.books.count()).toBe(0);
    expect(await db.files.count()).toBe(0);
    expect(await db.contents.count()).toBe(0);
    expect(await db.progress.count()).toBe(0);
  });

  it('markOpened ilk açılışta başlama tarihini ve durumu yazar, sonra korur', async () => {
    await db.books.add(book('a'));
    await markOpened(db, 'a', 1000);
    await markOpened(db, 'a', 2000);
    expect(await db.books.get('a')).toMatchObject({
      startedAt: 1000,
      lastOpenedAt: 2000,
      readingStatus: 'reading',
      journalUpdatedAt: 1000,
    });
  });

  it('saveProgress konumu, oranı ve içerik sürümünü yazar', async () => {
    await saveProgress(
      db,
      'a',
      { locator: { block: 7, offset: 12 }, percent: 0.25, contentVersion: 2 },
      500,
    );
    expect(await db.progress.get('a')).toEqual({
      bookId: 'a',
      locator: { block: 7, offset: 12 },
      percent: 0.25,
      updatedAt: 500,
      contentVersion: 2,
    });
  });

  it('saveProgress sayfa görünümündeki PDF sayfasını da yazar; sonraki kayıt eskisini tümüyle değiştirir', async () => {
    const position = { locator: { block: 4, offset: 0 }, percent: 0.4, contentVersion: 2 };
    await saveProgress(db, 'a', { ...position, pdfPage: 17 }, 600);
    expect(await db.progress.get('a')).toMatchObject({ pdfPage: 17, updatedAt: 600 });
    await saveProgress(db, 'a', position, 700);
    expect((await db.progress.get('a'))?.pdfPage).toBeUndefined();
  });
});

describe('kitap işlemleri — inceleme ekleri', () => {
  it('bitmiş kitabı yeniden açmak durumunu ve başlama tarihini değiştirmez', async () => {
    await db.books.add({ ...book('b'), readingStatus: 'finished', startedAt: 100 });
    await markOpened(db, 'b', 5000);
    expect(await db.books.get('b')).toMatchObject({
      readingStatus: 'finished',
      startedAt: 100,
      lastOpenedAt: 5000,
    });
  });

  it('deleteBook kapağı da siler', async () => {
    await db.books.add(book('c'));
    await db.covers.add({ bookId: 'c', dataUrl: 'data:image/jpeg;base64,AAAA' });
    await deleteBook(db, 'c');
    expect(await db.covers.count()).toBe(0);
    expect(await db.books.count()).toBe(0);
  });
});

describe('şema', () => {
  it('kitap silinirken temizlenen tablolar şemadaki bütün tablolardır', () => {
    // Yeni tablo eklenince: kitaba bağlı ve anahtarı bookId ise BOOK_TABLES'a ekle; anahtarı bookId değilse
    // deleteBook onu where('bookId') ile silmeli ve burada ayrıca listelenir (ör. layouts; testi
    // layoutCache.test.ts'te; annotations: annotations/store.test.ts; bookmarks: bookmarks/store.test.ts);
    // kitaptan bağımsızsa (ör. settings) yine
    // burada listele. Kitap silinince kalanlar (okuma oturumları: okuma geçmişi) `kept`te.
    const byIndex = ['layouts', 'annotations', 'bookmarks'];
    const kept = ['sessions'];
    expect(db.tables.map((t) => t.name).sort()).toEqual(
      [...BOOK_TABLES, ...byIndex, ...kept].sort(),
    );
  });

  it('kitap silinince okuma oturumları kalır (istatistikler değişmez)', async () => {
    await db.books.add(book('a'));
    await db.sessions.add(session('s1', 'a'));
    await deleteBook(db, 'a');
    expect(await db.books.count()).toBe(0);
    expect(await db.sessions.get('s1')).toMatchObject({ bookId: 'a' });
  });

  it('4. sürümdeki veritabanı yükseltilir: kitaplar, işaretler ve yer imleri kalır, oturumlar boş', async () => {
    const name = `test-v4-${crypto.randomUUID()}`;
    const v4 = createDb(name, 4);
    await v4.open();
    await v4.books.add({ ...book('eski'), readingStatus: 'reading', startedAt: 50 });
    await v4.progress.put({
      bookId: 'eski',
      locator: { block: 2, offset: 0 },
      percent: 0.4,
      updatedAt: 1,
    });
    const noteId = await v4.annotations.add({
      bookId: 'eski',
      page: 1,
      kind: 'note',
      color: '#ffd400',
      width: 0,
      points: [0.5, 0.5],
      text: 'not',
      createdAt: 1,
      updatedAt: 1,
    });
    await v4.bookmarks.add({ bookId: 'eski', pdfPage: 3, createdAt: 2 });
    v4.close();

    const v5 = createDb(name);
    try {
      await v5.open();
      expect(v5.verno).toBe(5);
      expect(await v5.books.get('eski')).toMatchObject({ readingStatus: 'reading', startedAt: 50 });
      expect(await v5.progress.get('eski')).toMatchObject({ percent: 0.4 });
      expect(await v5.annotations.get(noteId)).toMatchObject({ text: 'not' });
      expect(await v5.bookmarks.count()).toBe(1);
      expect(await v5.sessions.count()).toBe(0);
      await v5.sessions.put(session('s1', 'eski'));
      expect(await v5.sessions.where('bookId').equals('eski').count()).toBe(1);
    } finally {
      await v5.delete();
    }
  });
});

function session(id: string, bookId: string): SessionRecord {
  return { id, bookId, start: 1000, end: 61_000, activeMs: 60_000, pages: 2, words: 500 };
}
