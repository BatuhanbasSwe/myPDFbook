import { describe, expect, it } from 'vitest';
import { BackupError, parseContent, parseData } from '../../src/backup/format';

const ID = 'a'.repeat(64);

const content = (overrides: Record<string, unknown> = {}) => ({
  version: 2,
  lang: 'tr',
  blocks: [
    { kind: 'heading', level: 1, text: 'Bölüm', srcPage: 0 },
    { kind: 'para', text: 'bir iki üç', srcPage: 1 },
    { kind: 'pageImage', srcPage: 2 },
  ],
  chapters: [{ title: 'Bölüm', block: 0, level: 1 }],
  textlessPages: [2],
  totalWords: 3,
  ...overrides,
});

const book = {
  id: ID,
  title: 'Kitap',
  author: 'Yazar',
  fileName: 'kitap.pdf',
  fileSize: 100,
  pdfPageCount: 3,
  lang: 'tr',
  addedAt: 1,
  readingStatus: 'reading',
  totalWords: 3,
};

const data = (progress: Record<string, unknown>[]) => ({
  books: [book],
  covers: [],
  progress,
  annotations: [],
  bookmarks: [],
  settings: {},
});

const progress = (percent: number) => ({
  bookId: ID,
  locator: { block: 1, offset: 0 },
  percent,
  updatedAt: 5,
});

describe('yedek biçimi: metin doğrulama', () => {
  it('sağlam metin okunur; bloklar yalnızca bilinen alanlarıyla kurulur', () => {
    const raw = content();
    (raw.blocks[0] as Record<string, unknown>).extra = { html: '<script>' };
    (raw.blocks[2] as Record<string, unknown>).text = 'görsel sayfada metin olmaz';
    const parsed = parseContent(raw, ID, 3);
    expect(parsed.blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Bölüm', srcPage: 0 },
      { kind: 'para', text: 'bir iki üç', srcPage: 1 },
      { kind: 'pageImage', srcPage: 2 },
    ]);
    expect(parsed).toMatchObject({ bookId: ID, version: 2, textlessPages: [2] });
  });

  it.each([
    ['bilinmeyen blok türü', content({ blocks: [{ kind: 'video', srcPage: 0 }] })],
    ['metni olmayan paragraf', content({ blocks: [{ kind: 'para', srcPage: 0 }] })],
    [
      'başlık düzeyi 3',
      content({ blocks: [{ kind: 'heading', level: 3, text: 'x', srcPage: 0 }] }),
    ],
    [
      'kitabın sayfa sayısını aşan kaynak sayfası',
      content({ blocks: [{ kind: 'break', srcPage: 3 }] }),
    ],
    ['negatif kaynak sayfası', content({ blocks: [{ kind: 'break', srcPage: -1 }] })],
    [
      'olmayan bloğa işaret eden bölüm',
      content({ chapters: [{ title: 'x', block: 3, level: 1 }] }),
    ],
    [
      'bloksuz metinde bölüm',
      content({ blocks: [], chapters: [{ title: 'x', block: 0, level: 1 }] }),
    ],
    ['kitapta olmayan görsel sayfa', content({ textlessPages: [7] })],
  ])('bozuk: %s', (_, raw) => {
    expect(() => parseContent(raw, ID, 3)).toThrow(expect.objectContaining({ code: 'corrupt' }));
  });

  it('okuma yüzdesi 0–1 arasına sıkıştırılır', () => {
    expect(parseData(data([progress(1.7)])).progress[0].percent).toBe(1);
    expect(parseData(data([progress(-0.2)])).progress[0].percent).toBe(0);
    expect(parseData(data([progress(0.4)])).progress[0].percent).toBe(0.4);
  });
});

describe('yedek biçimi: oturumlar ve kitap günlüğü', () => {
  const session = (overrides: Record<string, unknown> = {}) => ({
    id: '0123456789abcdef',
    bookId: ID,
    start: 1000,
    end: 61_000,
    activeMs: 60_000,
    pages: 2,
    words: 500,
    ...overrides,
  });

  it('eski yedekte oturum yok: boş', () => {
    expect(parseData(data([])).sessions).toEqual([]);
  });

  it('oturumlar yalnızca bilinen alanlarıyla; kitabı yedekte olmayan oturum kalır; aynı kimlikte sonuncusu', () => {
    const other = 'b'.repeat(64);
    const parsed = parseData({
      ...data([]),
      sessions: [
        session({ extra: 'x' }),
        session({ id: 'ffffffffffff', bookId: other }),
        session({ end: 90_000, activeMs: 80_000 }),
      ],
    });
    expect(parsed.sessions).toEqual([
      { ...session(), end: 90_000, activeMs: 80_000 },
      { ...session(), id: 'ffffffffffff', bookId: other },
    ]);
  });

  it('bozuk oturum yedeği reddettirmez, atlanır; sağlamları okunur', () => {
    const bad = [
      session({ id: 'a b' }),
      session({ bookId: 'x' }),
      session({ end: 10 }),
      session({ activeMs: -1 }),
      session({ pages: 1.5 }),
      session({ words: '3' }),
      'oturum değil',
    ];
    const good = session({ id: 'sagl4m0001' });
    expect(parseData({ ...data([]), sessions: [...bad, good] }).sessions).toEqual([good]);
    // Oturum listesinin kendisi bozuksa yedek bozuktur
    expect(() => parseData({ ...data([]), sessions: {} })).toThrow(BackupError);
  });

  it('oturumun aralığı 24 saatle, süresi aralıkla sınırlanır', () => {
    const day = 86_400_000;
    const [long, over] = parseData({
      ...data([]),
      sessions: [
        session({ id: 'uzun000001', start: 0, end: 30 * day, activeMs: 30 * day }),
        session({ id: 'fazla00001', start: 0, end: 60_000, activeMs: 3_600_000 }),
      ],
    }).sessions;
    expect(long).toMatchObject({ start: 0, end: day, activeMs: day });
    expect(over).toMatchObject({ end: 60_000, activeMs: 60_000 });
  });

  it('kitap günlüğü okunur; puan yarım adıma yuvarlanır, aralık dışı puan atılır', () => {
    const journal = {
      readingStatus: 'finished',
      startedAt: 10,
      finishedAt: 20,
      rating: 4.5,
      review: 'Güzel',
      journalEdits: { rating: 30, review: 31 },
    };
    const read = (extra: Record<string, unknown>) =>
      parseData({ ...data([]), books: [{ ...book, ...journal, ...extra }] }).books[0];
    expect(read({})).toMatchObject(journal);
    expect(read({ rating: 3.3 }).rating).toBe(3.5);
    expect(read({ rating: 9 }).rating).toBeUndefined();
    expect('rating' in read({ rating: null })).toBe(false);
    expect(() => read({ rating: 'beş' })).toThrow(BackupError);
    expect(() => read({ review: 5 })).toThrow(BackupError);
    expect(() => read({ readingStatus: 'okundu' })).toThrow(BackupError);
    // Düzenleme anları: bilinmeyen alan ve sayı olmayan değer atlanır
    expect(
      read({ journalEdits: { rating: 5, bilinmeyen: 9, review: 'x', startedAt: -1 } }).journalEdits,
    ).toEqual({ rating: 5 });
    expect(() => read({ journalEdits: 'x' })).toThrow(BackupError);
  });
});
