import type { BookDB, BookRecord, ReadingStatus } from '../db/db';

/** Günlükteki durumların adları (kütüphanede ve günlükte) */
export const STATUS_LABELS: Record<ReadingStatus, string> = {
  unread: 'Okunacak',
  reading: 'Okunuyor',
  finished: 'Bitti',
  abandoned: 'Yarım bırakıldı',
};

/** Günlüğün değişen alanları */
export type JournalPatch = Partial<
  Pick<BookRecord, 'readingStatus' | 'startedAt' | 'finishedAt' | 'rating' | 'review'>
>;

/** Puan: 0,5 ile 5 arası, yarım adımlı; geçersizse puan yok */
export function normalizeRating(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const r = Math.round(v * 2) / 2;
  return r >= 0.5 && r <= 5 ? r : undefined;
}

/**
 * Günlüğü değiştirir. "Bitti" seçilince bitiş tarihi bugün (başka duruma geçince silinir), başlama tarihi yoksa o
 * da; "Okunuyor" seçilince başlama tarihi (yoksa) bugün. `undefined` alanı siler (Dexie). `journalUpdatedAt` yazılır: yedek
 * birleştirilirken daha yeni günlük kazanır.
 */
export async function updateJournal(
  db: BookDB,
  id: string,
  patch: JournalPatch,
  now = Date.now(),
): Promise<void> {
  await db.transaction('rw', db.books, async () => {
    const book = await db.books.get(id);
    if (!book) return;
    const changes: Partial<BookRecord> = { ...patch, journalUpdatedAt: now };
    if ('rating' in patch) changes.rating = normalizeRating(patch.rating);
    const status = patch.readingStatus;
    if (status !== undefined && !('finishedAt' in patch)) {
      // Bitiş tarihi yalnızca bitmiş kitapta: "Bitti" seçilince bugün, başka durumda silinir
      if (status !== 'finished') changes.finishedAt = undefined;
      else if (book.readingStatus !== 'finished' || book.finishedAt === undefined)
        changes.finishedAt = now;
    }
    if ((status === 'reading' || status === 'finished') && !book.startedAt && !patch.startedAt)
      changes.startedAt = now;
    await db.books.update(id, changes);
  });
}

/** "Kitabı bitirdin mi?" yanıtlandı (bir kez sorulur) */
export async function markFinishAsked(db: BookDB, id: string): Promise<void> {
  await db.books.update(id, { finishAsked: true });
}

/** Yerel tarih kutusunun değeri ("2026-10-02") */
export function dateInputValue(t: number | undefined): string {
  if (t === undefined) return '';
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Tarih kutusundan gelen yerel gün (öğlen: saat dilimi değişse de aynı güne düşsün); boşsa undefined. Eski Safari
 * tarih kutusu göstermezse metin olarak yazılan "2026-10-02" de okunur.
 */
export function parseDateInput(value: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return Number.isNaN(d.getTime()) ? undefined : d.getTime();
}
