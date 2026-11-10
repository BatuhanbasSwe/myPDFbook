import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type BookDB, type BookRecord } from '../../src/db/db';
import {
  dateInputValue,
  datesInOrder,
  declineFinish,
  markFinishAsked,
  normalizeRating,
  parseDateInput,
  updateJournal,
} from '../../src/journal/journal';

const book = (overrides: Partial<BookRecord> = {}): BookRecord => ({
  id: 'k',
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
  ...overrides,
});

let db: BookDB;
beforeEach(async () => {
  db = createDb(`test-${crypto.randomUUID()}`);
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

describe('kitap günlüğü', () => {
  it('"Bitti": bitiş tarihi bugün (başlama yoksa o da); başka duruma geçince bitiş silinir', async () => {
    await db.books.add(book());
    await updateJournal(db, 'k', { readingStatus: 'finished' }, 5000);
    expect(await db.books.get('k')).toMatchObject({
      readingStatus: 'finished',
      finishedAt: 5000,
      startedAt: 5000,
      // Okurun düzenlediği alanların anı; kendiliğinden başlama tarihinin anı yok
      journalEdits: { readingStatus: 5000, finishedAt: 5000 },
    });
    // Yeniden "Bitti" seçmek tarihi değiştirmez
    await updateJournal(db, 'k', { readingStatus: 'finished' }, 6000);
    expect((await db.books.get('k'))?.finishedAt).toBe(5000);
    await updateJournal(db, 'k', { readingStatus: 'reading' }, 7000);
    const b = await db.books.get('k');
    expect(b?.finishedAt).toBeUndefined();
    expect(b).toMatchObject({
      readingStatus: 'reading',
      startedAt: 5000,
      // Bitişin silinmesi de düzenlemedir (öteki cihaza geçer)
      journalEdits: { readingStatus: 7000, finishedAt: 7000 },
    });
  });

  it('temizlenen alan işaretli kalır: başlama tarihi yeniden doldurulmaz; boş inceleme silinir', async () => {
    await db.books.add(book({ readingStatus: 'reading', startedAt: 10, review: 'x' }));
    await updateJournal(db, 'k', { startedAt: undefined, review: '   ' }, 100);
    let b = await db.books.get('k');
    expect(b?.startedAt).toBeUndefined();
    expect(b?.review).toBeUndefined();
    expect(b?.journalEdits).toEqual({ startedAt: 100, review: 100 });
    await updateJournal(db, 'k', { readingStatus: 'finished' }, 200);
    b = await db.books.get('k');
    expect(b?.startedAt).toBeUndefined();
    expect(b?.finishedAt).toBe(200);
  });

  it('tarihler elle değişir; puan yarım adımlı, silinebilir; inceleme yazılır', async () => {
    await db.books.add(book({ readingStatus: 'reading', startedAt: 10 }));
    await updateJournal(db, 'k', { startedAt: 3, rating: 3.7, review: 'iyi' }, 100);
    expect(await db.books.get('k')).toMatchObject({ startedAt: 3, rating: 3.5, review: 'iyi' });
    await updateJournal(db, 'k', { readingStatus: 'finished', finishedAt: 50 }, 200);
    expect((await db.books.get('k'))?.finishedAt).toBe(50);
    await updateJournal(db, 'k', { rating: undefined }, 300);
    expect('rating' in ((await db.books.get('k')) ?? {})).toBe(false);
  });

  it('olmayan kitap: hiçbir şey yazılmaz', async () => {
    await updateJournal(db, 'yok', { rating: 4 });
    expect(await db.books.count()).toBe(0);
  });

  it('"bitirdin mi?": Evet bir daha sordurmaz; "Henüz değil" ikinci kez denince sordurmaz', async () => {
    await db.books.add(book());
    await markFinishAsked(db, 'k');
    expect((await db.books.get('k'))?.finishAsked).toBe(true);

    await db.books.add(book({ id: 'm' }));
    await declineFinish(db, 'm');
    expect(await db.books.get('m')).toMatchObject({ finishDeclined: 1 });
    expect((await db.books.get('m'))?.finishAsked).toBeUndefined();
    await declineFinish(db, 'm');
    expect(await db.books.get('m')).toMatchObject({ finishDeclined: 2, finishAsked: true });
  });

  it('tarih sırası: başlama bitişten sonra olamaz (aynı gün olabilir)', () => {
    const d = (day: number, h = 12) => new Date(2026, 9, day, h).getTime();
    expect(datesInOrder(d(1), d(5))).toBe(true);
    expect(datesInOrder(d(5, 23), d(5, 1))).toBe(true);
    expect(datesInOrder(d(6), d(5))).toBe(false);
    expect(datesInOrder(undefined, d(5))).toBe(true);
    expect(datesInOrder(d(6), undefined)).toBe(true);
  });

  it('puan ve tarih kutusu', () => {
    expect(normalizeRating(4.4)).toBe(4.5);
    expect(normalizeRating(0.2)).toBeUndefined();
    expect(normalizeRating(5.2)).toBe(5);
    expect(normalizeRating(6)).toBeUndefined();
    expect(normalizeRating(NaN)).toBeUndefined();
    const t = parseDateInput('2026-10-02');
    expect(t).toBe(new Date(2026, 9, 2, 12).getTime());
    expect(dateInputValue(t)).toBe('2026-10-02');
    expect(parseDateInput('')).toBeUndefined();
    expect(parseDateInput('02.10.2026')).toBeUndefined();
    expect(dateInputValue(undefined)).toBe('');
  });
});
