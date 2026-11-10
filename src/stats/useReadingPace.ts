import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { readingPace, roundPace } from './aggregate';

/**
 * Kalan süre tahmininde kullanılan hız (sayfa/dk): bu kitabınki, yoksa bütün kitaplarınki; veri azsa null,
 * yüklenirken undefined. Süren oturum dakikada bir yazıldıkça yeniden hesaplanır; iki basamağa yuvarlandığı için
 * değer (ve okuyucu) ancak hız gerçekten değişince değişir.
 */
export function useReadingPace(bookId: string): number | null | undefined {
  return useLiveQuery(
    async () => roundPace(readingPace(await db.sessions.toArray(), bookId)),
    [bookId],
  );
}
