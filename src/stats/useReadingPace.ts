import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { readingPace } from './aggregate';

/**
 * Kalan süre tahmininde kullanılan hız (sayfa/dk): bu kitabınki, yoksa bütün kitaplarınki; veri azsa null,
 * yüklenirken undefined. Süren oturum dakikada bir yazıldıkça güncellenir.
 */
export function useReadingPace(bookId: string): number | null | undefined {
  return useLiveQuery(async () => readingPace(await db.sessions.toArray(), bookId), [bookId]);
}
