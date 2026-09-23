import type { Locator } from '../convert/types';
import type { BookDB, BookRecord } from './db';

export async function deleteBook(db: BookDB, id: string): Promise<void> {
  await db.transaction('rw', [db.books, db.files, db.contents, db.progress], async () => {
    await Promise.all([db.books.delete(id), db.files.delete(id), db.contents.delete(id), db.progress.delete(id)]);
  });
}

/** Kitap açıldığında: son açılma zamanı; ilk açılışta başlama tarihi ve "okunuyor" durumu. */
export async function markOpened(db: BookDB, id: string, now = Date.now()): Promise<void> {
  const book = await db.books.get(id);
  if (!book) return;
  const patch: Partial<BookRecord> = { lastOpenedAt: now };
  if (!book.startedAt) patch.startedAt = now;
  if (book.readingStatus === 'unread') patch.readingStatus = 'reading';
  await db.books.update(id, patch);
}

export async function saveProgress(db: BookDB, bookId: string, locator: Locator, percent: number, now = Date.now()): Promise<void> {
  await db.progress.put({ bookId, locator, percent, updatedAt: now });
}
