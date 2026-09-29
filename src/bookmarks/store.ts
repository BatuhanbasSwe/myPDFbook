import { Dexie } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Locator } from '../convert/types';
import { db as appDb, type BookDB, type BookmarkRecord } from '../db/db';

/** Kaydedilmiş yer imi (anahtarı belli) */
export type SavedBookmark = BookmarkRecord & { id: number };

/** Yer iminin konacağı yer: PDF sayfası ve (metin görünümünde) sayfanın metindeki başı */
export interface BookmarkTarget {
  pdfPage: number;
  locator?: Locator;
}

/** Kitabın yer imleri, PDF sayfası sırasıyla */
export function bookBookmarks(db: BookDB, bookId: string): Promise<SavedBookmark[]> {
  return db.bookmarks
    .where('[bookId+pdfPage]')
    .between([bookId, Dexie.minKey], [bookId, Dexie.maxKey])
    .toArray() as Promise<SavedBookmark[]>;
}

/** Yer imi ekler; kaydı anahtarıyla döndürür */
export async function addBookmark(
  db: BookDB,
  bookId: string,
  target: BookmarkTarget,
  now = Date.now(),
): Promise<SavedBookmark> {
  const record: BookmarkRecord = { bookId, pdfPage: target.pdfPage, createdAt: now };
  if (target.locator) record.locator = { ...target.locator };
  const id = (await db.bookmarks.add(record)) as number;
  return { ...record, id };
}

export async function deleteBookmark(db: BookDB, id: number): Promise<void> {
  await db.bookmarks.delete(id);
}

/**
 * Açık sayfa(lar)ın yer imini açıp kapar: sayfalardan birinde yer imi varsa hepsinin yer imi kalkar, yoksa ilk
 * sayfaya yer imi konur (çift sayfada sol sayfa). Yer imi eklendiyse true.
 */
export async function toggleBookmark(
  db: BookDB,
  bookId: string,
  targets: readonly BookmarkTarget[],
  now = Date.now(),
): Promise<boolean> {
  if (targets.length === 0) return false;
  return db.transaction('rw', db.bookmarks, async () => {
    const found = await db.bookmarks
      .where('[bookId+pdfPage]')
      .anyOf(targets.map((t) => [bookId, t.pdfPage]))
      .primaryKeys();
    if (found.length > 0) {
      await db.bookmarks.bulkDelete(found);
      return false;
    }
    await addBookmark(db, bookId, targets[0], now);
    return true;
  });
}

/** Kitabın yer imleri; değişince yeniden çizilir. undefined: okunuyor */
export function useBookmarks(bookId: string): SavedBookmark[] | undefined {
  return useLiveQuery(() => bookBookmarks(appDb, bookId), [bookId]);
}
