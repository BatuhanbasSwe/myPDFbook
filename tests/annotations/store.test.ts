import { Dexie } from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addAnnotation,
  bookAnnotations,
  deleteAnnotation,
  deleteAnnotations,
  onAnnotationsDeleted,
  pageAnnotations,
  restoreAnnotation,
  restoreAnnotations,
  updateAnnotation,
  type NewAnnotation,
} from '../../src/annotations/store';
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

const highlight = (bookId: string, page: number, x = 0.1): NewAnnotation => ({
  bookId,
  page,
  kind: 'highlight',
  color: '#ffd400',
  width: 0.028,
  points: [x, 0.5, x + 0.3, 0.5],
});

const note = (bookId: string, page: number, text: string): NewAnnotation => ({
  bookId,
  page,
  kind: 'note',
  color: '#f2b705',
  width: 0,
  points: [0.4, 0.4],
  text,
});

let db: BookDB;
beforeEach(async () => {
  db = createDb(`test-${crypto.randomUUID()}`);
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

describe('işaret deposu', () => {
  it('eklenen işaret anahtarı ve zamanlarıyla döner, sayfasında okunur', async () => {
    const saved = await addAnnotation(db, highlight('a', 3), 100);
    expect(saved.id).toBeTypeOf('number');
    expect(saved).toMatchObject({ createdAt: 100, updatedAt: 100, page: 3, kind: 'highlight' });
    expect(await pageAnnotations(db, 'a', 3)).toEqual([saved]);
    expect(await pageAnnotations(db, 'a', 4)).toEqual([]);
    expect(await pageAnnotations(db, 'b', 3)).toEqual([]);
  });

  it('not metni güncellenir; güncelleme zamanı değişir, oluşturma zamanı kalır', async () => {
    const saved = await addAnnotation(db, note('a', 0, 'ilk'), 100);
    await updateAnnotation(db, saved.id, { text: 'ikinci' }, 200);
    expect(await db.annotations.get(saved.id)).toMatchObject({
      text: 'ikinci',
      createdAt: 100,
      updatedAt: 200,
    });
  });

  it('güncelleme değişen kayıt sayısını döndürür: silinmiş not için 0', async () => {
    const saved = await addAnnotation(db, note('a', 0, 'ilk'));
    expect(await updateAnnotation(db, saved.id, { text: 'ikinci' })).toBe(1);
    await deleteAnnotation(db, saved.id);
    expect(await updateAnnotation(db, saved.id, { text: 'üçüncü' })).toBe(0);
    expect(await db.annotations.get(saved.id)).toBeUndefined();
  });

  it('birlikte silinenler birlikte geri konur; silinen anahtarlar dinleyiciye bildirilir', async () => {
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await addAnnotation(db, highlight('a', 4, i / 10))).id);
    const records = await pageAnnotations(db, 'a', 4);
    const heard: number[][] = [];
    const stop = onAnnotationsDeleted((deleted) => heard.push([...deleted]));
    await deleteAnnotations(db, [ids[0], ids[2]]);
    expect((await pageAnnotations(db, 'a', 4)).map((a) => a.id)).toEqual([ids[1]]);
    await deleteAnnotation(db, ids[1]);
    stop();
    await restoreAnnotations(db, records);
    expect(heard).toEqual([[ids[0], ids[2]], [ids[1]]]);
    expect((await pageAnnotations(db, 'a', 4)).map((a) => a.id)).toEqual(ids);
  });

  it('silinen işaret gider; geri konunca aynı anahtarla aynı sırada döner', async () => {
    const first = await addAnnotation(db, highlight('a', 1, 0.1));
    const second = await addAnnotation(db, highlight('a', 1, 0.2));
    await deleteAnnotation(db, first.id);
    expect((await pageAnnotations(db, 'a', 1)).map((a) => a.id)).toEqual([second.id]);
    await restoreAnnotation(db, first);
    expect((await pageAnnotations(db, 'a', 1)).map((a) => a.id)).toEqual([first.id, second.id]);
  });

  it('sayfanın işaretleri eklenme sırasıyla gelir', async () => {
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push((await addAnnotation(db, highlight('a', 2, i / 10))).id);
    expect((await pageAnnotations(db, 'a', 2)).map((a) => a.id)).toEqual(ids);
  });

  it('kitabın işaretleri sayfa sırasıyla gelir (sayfa içinde eklenme sırasıyla), başka kitabınkiler gelmez', async () => {
    const p9 = await addAnnotation(db, highlight('a', 9));
    const p2a = await addAnnotation(db, note('a', 2, 'not'));
    const p10 = await addAnnotation(db, highlight('a', 10));
    const p2b = await addAnnotation(db, highlight('a', 2));
    await addAnnotation(db, highlight('b', 1));
    await addAnnotation(db, highlight('aa', 0));
    const all = await bookAnnotations(db, 'a');
    // Sayfa sayı olarak sıralanır (10, 9'dan sonra gelir)
    expect(all.map((a) => a.id)).toEqual([p2a.id, p2b.id, p9.id, p10.id]);
  });

  it('deleteBook kitabın işaretlerini de siler, başka kitabınkilere dokunmaz', async () => {
    await db.books.add(book('a'));
    await db.books.add(book('b'));
    await addAnnotation(db, highlight('a', 0));
    await addAnnotation(db, note('a', 5, 'x'));
    const other = await addAnnotation(db, highlight('b', 0));
    await deleteBook(db, 'a');
    expect(await bookAnnotations(db, 'a')).toEqual([]);
    expect(await bookAnnotations(db, 'b')).toEqual([other]);
  });
});

describe('şema yükseltmesi (işaretler)', () => {
  it('sürüm 2 veritabanı sürüm 3 ile açılınca kitaplar ve sayfalamalar yerinde kalır, işaret tablosu gelir', async () => {
    const name = `test-${crypto.randomUUID()}`;
    // Sürüm 1 ve 2'nin (yayımlanmış) tanımı
    const v2 = new Dexie(name);
    v2.version(1).stores({
      books: 'id, addedAt, lastOpenedAt',
      files: 'bookId',
      covers: 'bookId',
      contents: 'bookId',
      progress: 'bookId',
    });
    v2.version(2).stores({ layouts: '[bookId+signature], bookId, usedAt' });
    await v2.table('books').add(book('eski'));
    await v2.table('layouts').put({ bookId: 'eski', signature: 's', starts: [], usedAt: 1 });
    v2.close();

    const v3 = createDb(name);
    try {
      await v3.open();
      expect(v3.verno).toBeGreaterThanOrEqual(3);
      expect(await v3.books.get('eski')).toMatchObject({ id: 'eski', title: 'T' });
      expect(await v3.layouts.get(['eski', 's'])).toMatchObject({ usedAt: 1 });
      const saved = await addAnnotation(v3, highlight('eski', 0));
      expect(await pageAnnotations(v3, 'eski', 0)).toEqual([saved]);
    } finally {
      await v3.delete();
    }
  });
});
