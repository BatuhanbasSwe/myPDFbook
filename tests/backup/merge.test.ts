import { describe, expect, it } from 'vitest';
import {
  annotationFingerprint,
  mergeBook,
  newerProgress,
  planAnnotations,
  planBookmarks,
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
        startedAt: undefined,
        addedAt: 10,
        password: undefined,
      }),
    ).toBeNull();
  });
});
