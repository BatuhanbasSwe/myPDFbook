import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteBook, markOpened, saveProgress } from '../../src/db/books';
import { BOOK_TABLES, createDb, type BookDB, type BookRecord } from '../../src/db/db';

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
    await saveProgress(db, 'a', { block: 3, offset: 0 }, 0.5);
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
    });
  });

  it('saveProgress konumu ve oranı yazar', async () => {
    await saveProgress(db, 'a', { block: 7, offset: 12 }, 0.25, 500);
    expect(await db.progress.get('a')).toEqual({
      bookId: 'a',
      locator: { block: 7, offset: 12 },
      percent: 0.25,
      updatedAt: 500,
    });
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
    // Yeni tablo eklenince: kitaba bağlıysa BOOK_TABLES'a ekle (anahtarı bookId değilse deleteBook onu
    // where('bookId') ile silmeli); kitaptan bağımsızsa (ör. settings) burada ayrıca listele.
    expect(db.tables.map((t) => t.name).sort()).toEqual([...BOOK_TABLES].sort());
  });
});
