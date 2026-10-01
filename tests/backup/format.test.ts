import { describe, expect, it } from 'vitest';
import { parseContent, parseData } from '../../src/backup/format';

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
