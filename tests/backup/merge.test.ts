import { describe, expect, it } from 'vitest';
import {
  annotationFingerprint,
  mergeBook,
  newerProgress,
  planAnnotations,
  planBookmarks,
  planSessions,
} from '../../src/backup/merge';
import type { AnnotationRecord, BookRecord } from '../../src/db/db';

const ink = (overrides: Partial<AnnotationRecord> = {}): AnnotationRecord => ({
  bookId: 'k',
  page: 2,
  kind: 'ink',
  color: '#1D4ED8',
  width: 0.004,
  points: [0.1, 0.2, 0.3, 0.4],
  createdAt: 100,
  updatedAt: 100,
  ...overrides,
});

const book = (overrides: Partial<BookRecord> = {}): BookRecord => ({
  id: 'k',
  title: 'Başlık',
  author: 'Yazar',
  fileName: 'k.pdf',
  fileSize: 1,
  pdfPageCount: 1,
  lang: 'tr',
  addedAt: 10,
  convert: { state: 'done', progress: 1, version: 2 },
  readingStatus: 'reading',
  totalWords: 5,
  ...overrides,
});

describe('birleştirme kuralları', () => {
  it('parmak izi: renk büyük/küçük harfi ve kayan nokta farkı aynı; nokta, sayfa ya da not metni farkı ayrı', () => {
    const base = annotationFingerprint(ink());
    expect(
      annotationFingerprint(ink({ color: '#1d4ed8', points: [0.10000001, 0.2, 0.3, 0.4] })),
    ).toBe(base);
    expect(annotationFingerprint(ink({ points: [0.1, 0.2, 0.3, 0.41] }))).not.toBe(base);
    expect(annotationFingerprint(ink({ page: 3 }))).not.toBe(base);
    const pin = ink({ kind: 'note', width: 0, points: [0.5, 0.5], text: 'a' });
    expect(annotationFingerprint({ ...pin, text: 'b' })).not.toBe(annotationFingerprint(pin));
  });

  it('aynı işaret (oluşturulma anı) daha yeni düzenlemesiyle güncellenir, eskisiyle güncellenmez', () => {
    const device = [ink({ id: 7, updatedAt: 500 })];
    const newer = ink({ color: '#dc2626', updatedAt: 900 });
    expect(planAnnotations(device, [newer])).toEqual({
      add: [],
      update: [
        {
          id: 7,
          changes: {
            color: '#dc2626',
            width: newer.width,
            points: newer.points,
            text: undefined,
            updatedAt: 900,
          },
        },
      ],
    });
    expect(planAnnotations(device, [ink({ color: '#dc2626', updatedAt: 300 })])).toEqual({
      add: [],
      update: [],
    });
  });

  it('aynı anda oluşturulmuş iki işaret kimlikle karışmaz; yedeğin kendi içindeki ikiler bir kez eklenir', () => {
    const device = [ink({ id: 1 }), ink({ id: 2, points: [0.5, 0.5, 0.6, 0.6] })];
    const other = ink({ points: [0.7, 0.7, 0.8, 0.8], updatedAt: 999 });
    const plan = planAnnotations(device, [ink(), other, other]);
    expect(plan.update).toEqual([]);
    expect(plan.add).toEqual([other]);
  });

  it('yedekte aynı anda oluşturulmuş iki işaret: cihazdaki tek işaretin üzerine yazılmaz, ikincisi eklenir', () => {
    const x1 = ink({ id: 7, createdAt: 500, updatedAt: 500 });
    const x2 = ink({ points: [0.5, 0.5, 0.6, 0.6], createdAt: 500, updatedAt: 900 });
    const backupX1 = { ...x1 };
    delete backupX1.id;
    for (const incoming of [
      [backupX1, x2],
      [x2, backupX1],
    ]) {
      const plan = planAnnotations([x1], incoming);
      // X1 olduğu gibi kalır (X2 onun düzenlemesi sanılmaz), X2 eklenir: hiçbir işaret kaybolmaz
      expect(plan.update).toEqual([]);
      expect(plan.add).toEqual([x2]);
    }
    // Yedekteki tek kayıt aynı işaretin daha yeni düzenlemesiyse yine güncellenir
    const edited = { ...backupX1, color: '#dc2626', updatedAt: 900 };
    expect(planAnnotations([x1], [edited]).update).toEqual([
      expect.objectContaining({ id: 7, changes: expect.objectContaining({ color: '#dc2626' }) }),
    ]);
  });

  it('yer imi kitap + PDF sayfası başına bir tane', () => {
    const incoming = [
      { bookId: 'k', pdfPage: 1, createdAt: 1 },
      { bookId: 'k', pdfPage: 2, createdAt: 2 },
      { bookId: 'k', pdfPage: 2, createdAt: 3 },
    ];
    expect(planBookmarks([{ bookId: 'k', pdfPage: 1 }], incoming)).toEqual([incoming[1]]);
  });

  it('okuma yeri: yalnızca daha yenisi', () => {
    const p = (updatedAt: number) => ({
      bookId: 'k',
      locator: { block: 0, offset: 0 },
      percent: 0,
      updatedAt,
    });
    expect(newerProgress(undefined, p(1))).toEqual(p(1));
    expect(newerProgress(p(5), p(6))).toEqual(p(6));
    expect(newerProgress(p(5), p(5))).toBeNull();
  });

  it('kitap: daha yakın zamanda açılmışın başlığı ve durumu; tarihlerin en eskisi/en yenisi; metin bilgisi cihazın', () => {
    const device = book({ lastOpenedAt: 100, startedAt: 50 });
    const incoming = book({
      title: 'Düzeltilmiş',
      readingStatus: 'finished',
      lastOpenedAt: 200,
      startedAt: 20,
      addedAt: 5,
      totalWords: 999,
      password: 'p',
    });
    expect(mergeBook(device, incoming)).toEqual({
      lastOpenedAt: 200,
      title: 'Düzeltilmiş',
      readingStatus: 'finished',
      startedAt: 20,
      addedAt: 5,
      password: 'p',
    });
    expect(
      mergeBook(book({ lastOpenedAt: 300 }), {
        ...incoming,
        readingStatus: 'reading',
        startedAt: undefined,
        addedAt: 10,
        password: undefined,
      }),
    ).toBeNull();
  });

  it("günlük: telefonda bir kez açılan kitabın yedeği iPad'deki puanı, incelemeyi ve 'Bitti'yi silmez", () => {
    const ipad = book({
      lastOpenedAt: 950,
      startedAt: 100,
      readingStatus: 'finished',
      finishedAt: 900,
      rating: 4.5,
      review: 'harika',
      journalEdits: { readingStatus: 900, finishedAt: 900, rating: 910, review: 920 },
    });
    // Telefon kitabı sonra bir kez açtı: kendiliğinden "okunuyor" ve başlama tarihi, düzenleme yok
    const phone = book({ lastOpenedAt: 2000, startedAt: 2000, readingStatus: 'reading' });
    expect(mergeBook(ipad, phone)).toEqual({ lastOpenedAt: 2000 });
    // Ters yönde de: telefona iPad'in günlüğü gelir, başlama tarihinin en eskisi
    expect(mergeBook(phone, ipad)).toEqual({
      readingStatus: 'finished',
      finishedAt: 900,
      rating: 4.5,
      review: 'harika',
      startedAt: 100,
      journalEdits: { readingStatus: 900, finishedAt: 900, rating: 910, review: 920 },
    });
  });

  it('günlük: iki cihazda ayrı alanlar düzenlendi: ikisi de kalır', () => {
    const a = book({ rating: 4, journalEdits: { rating: 100 } });
    const b = book({ review: 'güzel', journalEdits: { review: 200 } });
    expect(mergeBook(a, b)).toEqual({
      review: 'güzel',
      journalEdits: { rating: 100, review: 200 },
    });
    expect(mergeBook(b, a)).toEqual({ rating: 4, journalEdits: { review: 200, rating: 100 } });
  });

  it('günlük: her alanda daha yeni düzenleme kazanır; temizlenen alan temizlik olarak gelir', () => {
    const device = book({ rating: 4, review: 'eski', journalEdits: { rating: 300, review: 100 } });
    // Yedekte puan daha eski (kalmaz), inceleme daha yeni temizlenmiş (silinir)
    expect(
      mergeBook(device, book({ rating: 2, journalEdits: { rating: 200, review: 400 } })),
    ).toEqual({ review: undefined, journalEdits: { rating: 300, review: 400 } });
  });

  it('günlük: başlama tarihinin en eskisi kalır, okur düzenlemediyse', () => {
    expect(mergeBook(book({ startedAt: 50 }), book({ startedAt: 20 }))).toEqual({ startedAt: 20 });
    // Cihazda okur düzenledi: kendiliğinden daha eski tarih onu değiştirmez
    expect(
      mergeBook(book({ startedAt: 50, journalEdits: { startedAt: 60 } }), book({ startedAt: 20 })),
    ).toBeNull();
    // Yedekte okur düzenledi (daha geç bir gün seçti): o kazanır
    expect(
      mergeBook(book({ startedAt: 50 }), book({ startedAt: 70, journalEdits: { startedAt: 500 } })),
    ).toEqual({ startedAt: 70, journalEdits: { startedAt: 500 } });
    // Okurun temizlediği başlama tarihi kendiliğinden tarihle dolmaz
    expect(
      mergeBook(book({ journalEdits: { startedAt: 60 } }), book({ startedAt: 20 })),
    ).toBeNull();
  });

  it('günlük: düzenlenmemiş durumda ileridekisi kalır (okunacak < okunuyor)', () => {
    expect(
      mergeBook(book({ readingStatus: 'unread' }), book({ readingStatus: 'reading' })),
    ).toEqual({ readingStatus: 'reading' });
    expect(
      mergeBook(book({ readingStatus: 'reading' }), book({ readingStatus: 'unread' })),
    ).toBeNull();
    // Okur "Okunacak"ı seçtiyse kendiliğinden "okunuyor" onu değiştirmez
    expect(
      mergeBook(
        book({ readingStatus: 'unread', journalEdits: { readingStatus: 5 } }),
        book({ readingStatus: 'reading' }),
      ),
    ).toBeNull();
  });

  it('oturum: yoksa eklenir; varsa bitişi daha sonra olan kalır', () => {
    const s = (id: string, end: number) => ({
      id,
      bookId: 'k',
      start: 0,
      end,
      activeMs: end,
      pages: 1,
      words: 1,
    });
    const plan = planSessions([{ id: 'a', end: 50 }, undefined], [s('a', 40), s('b', 10)]);
    expect(plan.map((x) => x.id)).toEqual(['b']);
    expect(planSessions([{ id: 'a', end: 50 }], [s('a', 60)])).toEqual([s('a', 60)]);
  });
});
