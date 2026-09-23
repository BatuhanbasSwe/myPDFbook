import type { Locator } from '../convert/types';
import { BOOK_TABLES, type BookDB, type BookRecord } from './db';

export async function deleteBook(db: BookDB, id: string): Promise<void> {
  const tables = BOOK_TABLES.map((name) => db.table(name));
  await db.transaction('rw', tables, async () => {
    await Promise.all(tables.map((table) => table.delete(id)));
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

export async function saveProgress(db: BookDB, bookId: string, locator: Locator, percent: number, now = Date.now()): Promise<void> {
  await db.progress.put({ bookId, locator, percent, updatedAt: now });
}
