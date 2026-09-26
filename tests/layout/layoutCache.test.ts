import { Dexie } from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Locator } from '../../src/convert/types';
import { deleteBook } from '../../src/db/books';
import { createDb, type BookDB, type BookRecord } from '../../src/db/db';
import {
  engineToken,
  layoutSignature,
  LAYOUTS_PER_BOOK,
  loadLayout,
  saveLayout,
  type SignatureInput,
} from '../../src/layout/layoutCache';
import { PAGINATOR_VERSION } from '../../src/layout/paginator';
import { DEFAULT_TYPOGRAPHY } from '../../src/layout/typography';

const book = (id: string): BookRecord => ({
  id,
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
});

const starts = (n: number): Locator[] =>
  Array.from({ length: n }, (_, i) => ({ block: i * 3, offset: i % 2 ? 40 : 0 }));

let db: BookDB;
beforeEach(async () => {
  db = createDb(`test-${crypto.randomUUID()}`);
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

describe('sayfalama önbelleği', () => {
  it('kaydedilen sayfalama aynı imzayla okunur, son kullanım zamanı güncellenir', async () => {
    await saveLayout(db, 'a', 'imza', starts(5), 100);
    expect(await loadLayout(db, 'a', 'imza', 200)).toEqual(starts(5));
    expect((await db.layouts.get(['a', 'imza']))?.usedAt).toBe(200);
  });

  it('farklı imza ya da farklı kitap bulunmaz', async () => {
    await saveLayout(db, 'a', 'imza', starts(5));
    expect(await loadLayout(db, 'a', 'başka')).toBeUndefined();
    expect(await loadLayout(db, 'b', 'imza')).toBeUndefined();
  });

  it('aynı imza yeniden yazılınca kayıt güncellenir, çoğalmaz', async () => {
    await saveLayout(db, 'a', 'imza', starts(5), 1);
    await saveLayout(db, 'a', 'imza', starts(7), 2);
    expect(await db.layouts.count()).toBe(1);
    expect(await loadLayout(db, 'a', 'imza')).toEqual(starts(7));
  });

  it('dokuzuncu kayıtta en uzun süredir kullanılmayan silinir; başka kitabın kayıtlarına dokunulmaz', async () => {
    expect(LAYOUTS_PER_BOOK).toBe(8);
    await saveLayout(db, 'b', 's0', starts(2), 0);
    for (let i = 1; i <= 8; i++) await saveLayout(db, 'a', `s${i}`, starts(3), i);
    // s1 okunur: artık en eski s2'dir
    expect(await loadLayout(db, 'a', 's1', 20)).toBeDefined();
    await saveLayout(db, 'a', 's9', starts(3), 21);
    const kept = (await db.layouts.where('bookId').equals('a').toArray()).map((r) => r.signature);
    expect(kept.sort()).toEqual(['s1', 's3', 's4', 's5', 's6', 's7', 's8', 's9']);
    expect(await loadLayout(db, 'b', 's0')).toEqual(starts(2));
  });

  it('aynı anda yazılan kayıtlarda yeni yazılan silinmez', async () => {
    for (let i = 1; i <= 9; i++) await saveLayout(db, 'a', `s${i}`, starts(3), 5);
    expect(await db.layouts.where('bookId').equals('a').count()).toBe(8);
    expect(await loadLayout(db, 'a', 's9')).toBeDefined();
  });

  it('deleteBook kitabın sayfalamalarını da siler', async () => {
    await db.books.add(book('a'));
    await db.books.add(book('b'));
    await saveLayout(db, 'a', 's1', starts(3));
    await saveLayout(db, 'a', 's2', starts(3));
    await saveLayout(db, 'b', 's1', starts(3));
    await deleteBook(db, 'a');
    expect(await db.layouts.where('bookId').equals('a').count()).toBe(0);
    expect(await db.layouts.where('bookId').equals('b').count()).toBe(1);
    expect(await db.books.count()).toBe(1);
  });

  it('veritabanı hatası yutulur: okuma undefined döner, yazma hata vermez', async () => {
    db.close({ disableAutoOpen: true });
    await expect(loadLayout(db, 'a', 'imza')).resolves.toBeUndefined();
    await expect(saveLayout(db, 'a', 'imza', starts(3))).resolves.toBeUndefined();
    await db.open(); // afterEach silebilsin
  });
});

describe('şema yükseltmesi', () => {
  it('sürüm 1 veritabanı sürüm 2 ile açılınca kitaplar yerinde kalır, sayfalama tablosu gelir', async () => {
    const name = `test-${crypto.randomUUID()}`;
    // Sürüm 1'in (yayımlanmış) tanımı
    const v1 = new Dexie(name);
    v1.version(1).stores({
      books: 'id, addedAt, lastOpenedAt',
      files: 'bookId',
      covers: 'bookId',
      contents: 'bookId',
      progress: 'bookId',
    });
    await v1.table('books').add(book('eski'));
    await v1.table('progress').put({
      bookId: 'eski',
      locator: { block: 4, offset: 0 },
      percent: 0.1,
      updatedAt: 1,
    });
    v1.close();

    const v2 = createDb(name);
    try {
      await v2.open();
      expect(v2.verno).toBe(2);
      expect(await v2.books.get('eski')).toMatchObject({ id: 'eski', title: 'T' });
      expect(await v2.progress.get('eski')).toMatchObject({ locator: { block: 4, offset: 0 } });
      await saveLayout(v2, 'eski', 'imza', starts(3));
      expect(await loadLayout(v2, 'eski', 'imza')).toEqual(starts(3));
    } finally {
      await v2.delete();
    }
  });
});

describe('sayfalama imzası', () => {
  const base: SignatureInput = {
    lang: 'tr',
    typography: DEFAULT_TYPOGRAPHY,
    box: { width: 600, height: 800, sink: 90 },
    contentVersion: 3,
    engine: 'blink',
  };

  it('aynı girdiler aynı imzayı verir; sayfalayıcı sürümünü içerir', () => {
    expect(layoutSignature({ ...base })).toBe(layoutSignature(base));
    expect(layoutSignature(base).startsWith(`p${PAGINATOR_VERSION}|`)).toBe(true);
  });

  it('satır kırılımını etkileyen her girdi imzayı değiştirir', () => {
    const t = DEFAULT_TYPOGRAPHY;
    const variants: SignatureInput[] = [
      { ...base, lang: 'en' },
      { ...base, lang: '' },
      { ...base, engine: 'webkit' },
      { ...base, engine: 'gecko' },
      { ...base, contentVersion: 4 },
      { ...base, box: { ...base.box, width: 601 } },
      { ...base, box: { ...base.box, height: 801 } },
      { ...base, box: { ...base.box, sink: 91 } },
      { ...base, typography: { ...t, font: 'inter' } },
      { ...base, typography: { ...t, size: t.size + 1 } },
      { ...base, typography: { ...t, lineHeight: 1.7 } },
      { ...base, typography: { ...t, align: 'left' } },
      { ...base, typography: { ...t, hyphenate: !t.hyphenate } },
    ];
    const all = [base, ...variants].map(layoutSignature);
    expect(new Set(all).size).toBe(all.length);
  });

  it('kenar boşluğu ve tek/çift sayfa ayarı imzaya girmez (kutuyu değiştirirler)', () => {
    const t = DEFAULT_TYPOGRAPHY;
    expect(layoutSignature({ ...base, typography: { ...t, margin: 'wide' } })).toBe(
      layoutSignature(base),
    );
    expect(layoutSignature({ ...base, typography: { ...t, spread: 'single' } })).toBe(
      layoutSignature(base),
    );
  });
});

describe('tarayıcı motoru', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      'blink',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
      'blink',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
      'blink',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      'webkit',
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'webkit',
    ],
    // iOS'ta Chrome ve Firefox da WebKit'tir
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
      'webkit',
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15',
      'webkit',
    ],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0', 'gecko'],
  ])('%s → %s', (ua, engine) => {
    expect(engineToken(ua)).toBe(engine);
  });
});
