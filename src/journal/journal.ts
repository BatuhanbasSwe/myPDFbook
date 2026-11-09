import type { BookDB, BookRecord, JournalEdits, JournalField, ReadingStatus } from '../db/db';

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
 * Okurun günlük düzenlemesi. Değişen her alanın düzenleme anı `journalEdits`'e yazılır (temizlenen alanınki de:
 * temizlik yedekle öteki cihaza geçer, başlama tarihi yeniden doldurulmaz). "Bitti" seçilince bitiş tarihi bugün,
 * başka duruma geçince silinir (ikisi de düzenleme sayılır). "Okunuyor" ya da "Bitti" seçilince başlama tarihi
 * yoksa (ve okur onu temizlememişse) bugün: bu kendiliğindendir, düzenleme sayılmaz. `undefined` alanı siler.
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
    const changes: Partial<BookRecord> = { ...patch };
    if ('rating' in patch) changes.rating = normalizeRating(patch.rating);
    if ('review' in patch) changes.review = patch.review?.trim() ? patch.review : undefined;
    const status = patch.readingStatus;
    if (status !== undefined && !('finishedAt' in patch)) {
      // Bitiş tarihi yalnızca bitmiş kitapta: "Bitti" seçilince bugün, başka durumda silinir
      if (status !== 'finished') {
        if (book.finishedAt !== undefined) changes.finishedAt = undefined;
      } else if (book.readingStatus !== 'finished' || book.finishedAt === undefined)
        changes.finishedAt = now;
    }
    const edits: JournalEdits = { ...book.journalEdits };
    for (const key of Object.keys(changes) as JournalField[]) edits[key] = now;
    changes.journalEdits = edits;
    // Kendiliğinden başlama tarihi: düzenleme anı yazılmaz (en eskisi kazanır)
    if (
      (status === 'reading' || status === 'finished') &&
      !book.startedAt &&
      !('startedAt' in patch) &&
      book.journalEdits?.startedAt === undefined
    )
      changes.startedAt = now;
    await db.books.update(id, changes);
  });
}

/** "Kitabı bitirdin mi?" → Evet: bir daha sorulmaz */
export async function markFinishAsked(db: BookDB, id: string): Promise<void> {
  await db.books.update(id, { finishAsked: true });
}

/** "Henüz değil" bu kadar kez denince soru bir daha sorulmaz */
export const FINISH_DECLINE_LIMIT = 2;

/** "Kitabı bitirdin mi?" → Henüz değil: sonraki okumada yeniden sorulur, ikinciden sonra sorulmaz */
export async function declineFinish(db: BookDB, id: string): Promise<void> {
  await db.transaction('rw', db.books, async () => {
    const book = await db.books.get(id);
    if (!book) return;
    const declined = (book.finishDeclined ?? 0) + 1;
    await db.books.update(id, {
      finishDeclined: declined,
      ...(declined >= FINISH_DECLINE_LIMIT ? { finishAsked: true } : {}),
    });
  });
}

/** Başlama bitişten sonra olamaz (ikisi de varsa) */
export const datesInOrder = (start: number | undefined, finish: number | undefined) =>
  start === undefined || finish === undefined || dayStart(start) <= dayStart(finish);

const dayStart = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

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
