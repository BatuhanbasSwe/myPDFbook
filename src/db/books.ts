import type { Locator } from '../convert/types';
import { BOOK_TABLES, type BookDB, type BookRecord } from './db';

export async function deleteBook(db: BookDB, id: string): Promise<void> {
  const tables = BOOK_TABLES.map((name) => db.table(name));
  await db.transaction('rw', [...tables, db.layouts, db.annotations, db.bookmarks], async () => {
    await Promise.all([
      ...tables.map((table) => table.delete(id)),
      // Sayfalamaların anahtarı [bookId+signature], işaretlerin ve yer imlerininki sayı: kitabın hepsi dizinle
      // bulunur
      db.layouts.where('bookId').equals(id).delete(),
      db.annotations.where('bookId').equals(id).delete(),
      db.bookmarks.where('bookId').equals(id).delete(),
    ]);
  });
}

/**
 * "PDF bekleniyor" durumundaki kitabın PDF'ini yazar ve kitabı tamamlar. Veri kitabın kimliğiyle (SHA-256)
 * eşleşmeli; bunu çağıran denetler. Kitap yoksa ya da PDF'i zaten varsa hiçbir şey yazmaz ve false döner.
 */
export async function completeBookFile(
  db: BookDB,
  id: string,
  data: ArrayBuffer,
): Promise<boolean> {
  return db.transaction('rw', [db.books, db.files], async () => {
    const book = await db.books.get(id);
    if (!book) return false;
    const hasFile = (await db.files.where('bookId').equals(id).count()) > 0;
    if (!hasFile) await db.files.add({ bookId: id, data });
    // undefined alanı siler (Dexie)
    if (book.pdfMissing) await db.books.update(id, { pdfMissing: undefined });
    return !hasFile;
  });
}

/** Kitap açıldığında: son açılma zamanı; ilk açılışta başlama tarihi ve "okunuyor" durumu. */
export async function markOpened(db: BookDB, id: string, now = Date.now()): Promise<void> {
  await db.transaction('rw', db.books, async () => {
    const book = await db.books.get(id);
    if (!book) return;
    const patch: Partial<BookRecord> = { lastOpenedAt: now };
    if (!book.startedAt) patch.startedAt = now;
    if (book.readingStatus === 'unread') patch.readingStatus = 'reading';
    await db.books.update(id, patch);
  });
}

/** Okuma konumunu yazar; konum hangi içerik sürümünün bloklarına göreyse o sürümle birlikte (varsa PDF sayfasıyla). */
export async function saveProgress(
  db: BookDB,
  bookId: string,
  position: { locator: Locator; percent: number; contentVersion: number; pdfPage?: number },
  now = Date.now(),
): Promise<void> {
  await db.progress.put({ ...position, bookId, updatedAt: now });
}
