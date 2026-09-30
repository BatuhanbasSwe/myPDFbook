import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportBackup, PDF_CHUNK_BYTES } from '../../src/backup/exportBackup';
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  backupFileName,
  BackupError,
} from '../../src/backup/format';
import { applyBackup, inspectBackup } from '../../src/backup/importBackup';
import { saveProgress } from '../../src/db/books';
import { createDb, type BookDB, type BookRecord } from '../../src/db/db';
import {
  attachPdf,
  importBook,
  resumeConversions,
  type ImportDeps,
  type OpenedPdf,
} from '../../src/import/importBook';
import { createPdfSource } from '../../src/pdf/pdfSource';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function fixture(name: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; id: string }> {
  const bytes = new Uint8Array(await readFile(new URL(`../fixtures/${name}`, import.meta.url)));
  return { bytes, id: sha256(bytes) };
}

const arrayBufferOf = (bytes: Uint8Array) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const bookRecord = (id: string, overrides: Partial<BookRecord> = {}): BookRecord => ({
  id,
  title: 'Kitap',
  author: 'Yazar',
  fileName: 'kitap.pdf',
  fileSize: 100,
  pdfPageCount: 6,
  lang: 'tr',
  addedAt: 1000,
  convert: { state: 'done', progress: 1, version: 2 },
  readingStatus: 'reading',
  startedAt: 1100,
  lastOpenedAt: 1200,
  totalWords: 3,
  ...overrides,
});

const content = (words = 3) => ({
  version: 2,
  lang: 'tr' as const,
  blocks: [
    { kind: 'heading' as const, level: 1 as const, text: 'Bölüm', srcPage: 0 },
    { kind: 'para' as const, text: 'bir iki üç', srcPage: 0 },
  ],
  chapters: [{ title: 'Bölüm', block: 0, level: 1 }],
  textlessPages: [],
  totalWords: words,
});

/** Kitabı PDF'i, kapağı ve metniyle ekler (`undefined` verilen alan kayıtta olmaz) */
async function seedBook(
  db: BookDB,
  bytes: Uint8Array,
  id: string,
  overrides: Partial<BookRecord> = {},
) {
  const record = bookRecord(id, { fileSize: bytes.length, ...overrides });
  for (const key of Object.keys(record) as (keyof BookRecord)[])
    if (record[key] === undefined) delete record[key];
  await db.books.add(record);
  await db.files.add({ bookId: id, data: arrayBufferOf(bytes) });
  await db.covers.add({ bookId: id, dataUrl: 'data:image/jpeg;base64,AAAA' });
  await db.contents.add({ bookId: id, ...content(), lang: record.lang });
}

const highlight = (bookId: string, page: number, x: number, at: number) => ({
  bookId,
  page,
  kind: 'highlight' as const,
  color: '#ffd400',
  width: 0.028,
  points: [x, 0.5, x + 0.3, 0.5],
  createdAt: at,
  updatedAt: at,
});

const note = (bookId: string, page: number, text: string, at: number) => ({
  bookId,
  page,
  kind: 'note' as const,
  color: '#f59e0b',
  width: 0,
  points: [0.4, 0.4],
  text,
  createdAt: at,
  updatedAt: at,
});

function memoryStorage(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

/** Ayarı olmayan cihaz (Node'un kendi localStorage'ına dokunulmasın) */
const storage = memoryStorage();

async function nodeOpenPdf(bytes: Uint8Array, password?: string): Promise<OpenedPdf> {
  const doc = await getDocument({ data: bytes, password }).promise;
  return {
    source: createPdfSource(doc),
    renderCover: async () => undefined,
    close: () => doc.loadingTask.destroy(),
  };
}

/** Kayıtların anahtarsız, sıralı hali (iki veritabanı karşılaştırılır) */
async function dump(db: BookDB) {
  // Anahtarlar cihaza özel; noktalar yuvarlanır (aynı işaretin iki cihazdaki kayan nokta farkı)
  const strip = <T extends { id?: number; points?: number[] }>(rows: T[]) =>
    rows
      .map((row) => {
        const copy: Partial<T> = { ...row };
        delete copy.id;
        if (row.points) copy.points = row.points.map((p) => Math.round(p * 1e6) / 1e6);
        return copy;
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const files = await db.files.toArray();
  return {
    books: (await db.books.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
    files: files.map((f) => ({ bookId: f.bookId, hash: sha256(new Uint8Array(f.data)) })),
    covers: await db.covers.toArray(),
    contents: await db.contents.toArray(),
    progress: await db.progress.toArray(),
    annotations: strip(await db.annotations.toArray()),
    bookmarks: strip(await db.bookmarks.toArray()),
  };
}

const asFile = (blob: Blob, name = 'yedek.mypdfbook') => new File([blob], name);

const dbs: BookDB[] = [];
async function newDb() {
  const db = createDb(`test-${crypto.randomUUID()}`);
  await db.open();
  dbs.push(db);
  return db;
}
let a: BookDB;
let b: BookDB;
beforeEach(async () => {
  a = await newDb();
  b = await newDb();
});
afterEach(async () => {
  await Promise.all(dbs.splice(0).map((db) => db.delete()));
});

describe('yedek: dışa ve içe aktarma', () => {
  it('dışa aktarılan yedek boş cihaza birebir aynı yüklenir (PDF, kapak, metin, yer, işaret, yer imi, ayar)', async () => {
    const novel = await fixture('novel-tr.pdf');
    const english = await fixture('english.pdf');
    await seedBook(a, novel.bytes, novel.id, { title: 'Roman', password: 'gizli' });
    await seedBook(a, english.bytes, english.id, {
      title: 'English',
      lang: 'en',
      lastOpenedAt: undefined,
      startedAt: undefined,
      readingStatus: 'unread',
    });
    await saveProgress(
      a,
      novel.id,
      { locator: { block: 1, offset: 4 }, percent: 0.4, contentVersion: 2, pdfPage: 3 },
      5000,
    );
    await a.annotations.bulkAdd([
      highlight(novel.id, 2, 0.1, 2000),
      note(novel.id, 3, 'Güzel', 2100),
    ]);
    await a.bookmarks.add({
      bookId: novel.id,
      pdfPage: 3,
      locator: { block: 1, offset: 0 },
      createdAt: 2200,
    });
    const settings = memoryStorage({
      'mypdfbook:theme': 'sepia',
      'mypdfbook:typography': '{"size":22}',
      'mypdfbook:install-card': '{"dismissed":true}',
      'mypdfbook:last-backup': '{"at":1}',
    });

    const progress: number[] = [];
    const out = await exportBackup(a, {
      includePdfs: true,
      includeContents: true,
      storage: settings,
      now: new Date(2026, 8, 30, 10).getTime(),
      device: 'iPad',
      onProgress: (p) => progress.push(p.done / p.total),
    });
    expect(out.fileName).toBe('mypdfbook-yedek-2026-09-30.mypdfbook');
    expect(out.manifest).toMatchObject({
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      device: 'iPad',
      counts: { books: 2, pdfs: 2, contents: 2, annotations: 2, bookmarks: 1 },
    });
    expect(progress.at(-1)).toBe(1);

    const file = asFile(out.blob);
    const summary = await inspectBackup(b, file);
    expect(summary).toMatchObject({
      books: { total: 2, new: 2 },
      pdfs: { total: 2, needed: 2 },
      awaitingPdf: 0,
      annotations: { total: 2, new: 2 },
      bookmarks: { total: 1, new: 1 },
      contents: 2,
      hasSettings: true,
    });

    const target = memoryStorage();
    const result = await applyBackup(b, file, { applySettings: true, storage: target });
    expect(result).toMatchObject({
      booksAdded: 2,
      pdfsAdded: 2,
      contentsAdded: 2,
      annotationsAdded: 2,
      bookmarksAdded: 1,
      progressUpdated: 1,
      awaitingPdf: 0,
    });
    expect(await dump(b)).toEqual(await dump(a));
    // Yalnızca taşınabilir ayarlar: kurulum kartı ve hatırlatıcı cihaza özel
    expect(Object.fromEntries(target.map)).toEqual({
      'mypdfbook:theme': 'sepia',
      'mypdfbook:typography': '{"size":22}',
    });
  });

  it('ayarlar istenmedikçe uygulanmaz', async () => {
    const english = await fixture('english.pdf');
    await seedBook(a, english.bytes, english.id);
    const out = await exportBackup(a, {
      includePdfs: false,
      includeContents: false,
      storage: memoryStorage({ 'mypdfbook:theme': 'dark' }),
    });
    const target = memoryStorage({ 'mypdfbook:theme': 'light' });
    const result = await applyBackup(b, asFile(out.blob), { storage: target });
    expect(result.settingsApplied).toEqual([]);
    expect(target.map.get('mypdfbook:theme')).toBe('light');
  });

  it('iki cihaz: iki yönlü birleştirmede ikileşme yok, en yeni okuma yeri ve en yeni not düzenlemesi kalıyor', async () => {
    const shared = await fixture('novel-tr.pdf');
    const onlyA = await fixture('english.pdf');
    const onlyB = await fixture('mixed.pdf');
    await seedBook(a, shared.bytes, shared.id, { lastOpenedAt: 3000 });
    await seedBook(a, onlyA.bytes, onlyA.id);
    await seedBook(b, shared.bytes, shared.id, {
      lastOpenedAt: 9000,
      title: 'Yeni başlık',
      readingStatus: 'finished',
    });
    await seedBook(b, onlyB.bytes, onlyB.id);
    // Ortak kitapta: aynı işaret iki cihazda (önceki bir taşımadan), birer de yalnızca kendisinde
    const common = highlight(shared.id, 1, 0.2, 1500);
    await a.annotations.bulkAdd([
      common,
      highlight(shared.id, 2, 0.1, 2000),
      note(shared.id, 4, 'eski', 2500),
    ]);
    await b.annotations.bulkAdd([
      // kayan nokta farkı: parmak izi aynı
      { ...common, points: common.points.map((p) => p + 1e-9) },
      highlight(shared.id, 5, 0.3, 2600),
      // A'daki not B'de sonradan düzenlendi (oluşturulma anı aynı)
      { ...note(shared.id, 4, 'yeni', 2500), updatedAt: 7000 },
    ]);
    await a.bookmarks.add({ bookId: shared.id, pdfPage: 1, createdAt: 10 });
    await b.bookmarks.bulkAdd([
      { bookId: shared.id, pdfPage: 1, createdAt: 20 },
      { bookId: shared.id, pdfPage: 8, createdAt: 30 },
    ]);
    await saveProgress(
      a,
      shared.id,
      { locator: { block: 1, offset: 0 }, percent: 0.2, contentVersion: 2 },
      4000,
    );
    await saveProgress(
      b,
      shared.id,
      { locator: { block: 1, offset: 7 }, percent: 0.7, contentVersion: 2 },
      8000,
    );

    const move = async (from: BookDB, to: BookDB) => {
      const out = await exportBackup(from, { includePdfs: true, includeContents: true, storage });
      return applyBackup(to, asFile(out.blob));
    };
    const aToB = await move(a, b);
    expect(aToB).toMatchObject({
      booksAdded: 1,
      annotationsAdded: 1,
      bookmarksAdded: 0,
      progressUpdated: 0,
    });
    const bToA = await move(b, a);
    expect(bToA).toMatchObject({
      booksAdded: 1,
      booksUpdated: 1,
      annotationsAdded: 1,
      annotationsUpdated: 1,
      bookmarksAdded: 1,
      progressUpdated: 1,
    });
    // Aynı yedekler yeniden yüklenince hiçbir şey değişmez
    expect(await move(a, b)).toMatchObject({
      booksAdded: 0,
      booksUpdated: 0,
      annotationsAdded: 0,
      annotationsUpdated: 0,
      bookmarksAdded: 0,
      progressUpdated: 0,
      pdfsAdded: 0,
    });
    expect(await move(b, a)).toMatchObject({
      annotationsAdded: 0,
      annotationsUpdated: 0,
      bookmarksAdded: 0,
    });

    const [da, db_] = [await dump(a), await dump(b)];
    expect(da.annotations).toEqual(db_.annotations);
    expect(da.annotations).toHaveLength(4);
    expect(da.annotations.filter((x) => x.kind === 'note')).toEqual([
      expect.objectContaining({ text: 'yeni', updatedAt: 7000 }),
    ]);
    expect(da.bookmarks.map((x) => x.pdfPage).sort()).toEqual([1, 8]);
    expect(db_.bookmarks).toHaveLength(2);
    expect(da.progress).toEqual(db_.progress);
    expect(await a.progress.get(shared.id)).toMatchObject({ percent: 0.7, updatedAt: 8000 });
    expect(await a.books.count()).toBe(3);
    expect(await b.books.count()).toBe(3);
    expect(await a.books.get(shared.id)).toMatchObject({
      title: 'Yeni başlık',
      readingStatus: 'finished',
      lastOpenedAt: 9000,
    });
    expect((await a.files.toArray()).map((f) => f.bookId).sort()).toEqual(
      (await b.files.toArray()).map((f) => f.bookId).sort(),
    );
  });

  it('PDF\'siz yedek: kitap "PDF bekleniyor" olur, dönüştürülmez; aynı PDF eklenince tamamlanır', async () => {
    const novel = await fixture('novel-tr.pdf');
    const english = await fixture('english.pdf');
    await seedBook(a, novel.bytes, novel.id, { title: 'Roman' });
    // Metni yedeğe girmeyen kitap (dönüştürülmemiş)
    await seedBook(a, english.bytes, english.id);
    await a.contents.delete(english.id);
    await a.annotations.add(highlight(novel.id, 1, 0.1, 1000));
    const out = await exportBackup(a, { includePdfs: false, includeContents: true, storage });
    expect(out.stats.pdfChunks).toBe(0);

    const file = asFile(out.blob);
    expect(await inspectBackup(b, file)).toMatchObject({
      pdfs: { total: 0, needed: 0 },
      awaitingPdf: 2,
    });
    const result = await applyBackup(b, file);
    expect(result).toMatchObject({ booksAdded: 2, pdfsAdded: 0, awaitingPdf: 2, contentsAdded: 1 });
    expect(await b.files.count()).toBe(0);
    expect(await b.books.get(novel.id)).toMatchObject({
      pdfMissing: true,
      convert: { state: 'done' },
    });
    expect(await b.books.get(english.id)).toMatchObject({
      pdfMissing: true,
      convert: { state: 'pending' },
    });

    // Açılışta dönüştürme sürdürülür: PDF'i olmayan kitap "dönüştürülemedi" olmamalı
    const deps: ImportDeps = { db: b, openPdf: nodeOpenPdf };
    await resumeConversions(deps);
    expect((await b.books.get(english.id))?.convert.state).toBe('pending');

    // Başka PDF bu kitaba eklenemez
    await expect(
      attachPdf(new File([english.bytes], 'yanlis.pdf'), novel.id, deps),
    ).rejects.toMatchObject({ code: 'pdf-mismatch' });
    expect(await b.files.count()).toBe(0);

    // Kartın "PDF'i ekle"si: metni yedekten gelmiş, yeniden dönüştürülmez
    const attached = await attachPdf(new File([novel.bytes], 'roman.pdf'), novel.id, deps);
    expect(attached.status).toBe('completed');
    await attached.done;
    const book = await b.books.get(novel.id);
    expect(book?.pdfMissing).toBeUndefined();
    expect(book).toMatchObject({ title: 'Roman', convert: { state: 'done' } });
    expect(await b.annotations.count()).toBe(1);

    // Kütüphanenin "PDF ekle"si: aynı PDF bekleyen kitabı tamamlar ve dönüştürür
    const imported = await importBook(new File([english.bytes], 'english.pdf'), deps);
    expect(imported).toMatchObject({ status: 'completed', bookId: english.id });
    await imported.done;
    expect(await b.books.get(english.id)).toMatchObject({ convert: { state: 'done' } });
    expect((await b.books.get(english.id))?.pdfMissing).toBeUndefined();
    expect(await b.files.count()).toBe(2);
    // Artık tam: ikinci kez eklenmez
    expect((await importBook(new File([english.bytes], 'english.pdf'), deps)).status).toBe(
      'exists',
    );

    // PDF'li yedek de bekleyen kitabı tamamlar
    const c = await newDb();
    await applyBackup(c, file);
    const withPdfs = await exportBackup(a, { includePdfs: true, includeContents: false, storage });
    const res = await applyBackup(c, asFile(withPdfs.blob));
    expect(res).toMatchObject({ booksAdded: 0, pdfsAdded: 2, awaitingPdf: 0 });
    expect((await c.books.toArray()).every((x) => !x.pdfMissing)).toBe(true);
  });
});

describe('yedek: hatalı dosyalar', () => {
  const code = async (db: BookDB, file: Blob) => {
    try {
      await inspectBackup(db, file);
    } catch (e) {
      expect(e).toBeInstanceOf(BackupError);
      return { code: (e as BackupError).code, message: (e as BackupError).message };
    }
    throw new Error('hata beklenirdi');
  };
  const manifest = (overrides: Record<string, unknown> = {}) => ({
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: '0.1.0',
    createdAt: 1,
    device: 'iPad',
    counts: { books: 0, pdfs: 0, contents: 0, annotations: 0, bookmarks: 0 },
    ...overrides,
  });
  const emptyData = {
    books: [],
    covers: [],
    progress: [],
    annotations: [],
    bookmarks: [],
    settings: {},
  };
  const zipOf = (files: Record<string, unknown>) =>
    new Blob([
      zipSync(
        Object.fromEntries(
          Object.entries(files).map(([k, v]) => [
            k,
            strToU8(typeof v === 'string' ? v : JSON.stringify(v)),
          ]),
        ),
      ) as Uint8Array<ArrayBuffer>,
    ]);

  it('ZIP olmayan dosya ve yedek olmayan ZIP: "yedek değil"', async () => {
    expect(await code(b, new Blob(['%PDF-1.7 merhaba dünya, bu bir yedek değil']))).toMatchObject({
      code: 'not-backup',
      message: expect.stringContaining('mypdfbook yedeği değil'),
    });
    expect((await code(b, new Blob([]))).code).toBe('not-backup');
    expect((await code(b, zipOf({ 'readme.txt': 'merhaba' }))).code).toBe('not-backup');
    expect(
      (await code(b, zipOf({ 'manifest.json': { format: 'baska' }, 'data.json': emptyData }))).code,
    ).toBe('not-backup');
  });

  it('daha yeni biçim sürümü: "uygulamayı güncelle"', async () => {
    const err = await code(
      b,
      zipOf({ 'manifest.json': manifest({ formatVersion: 99 }), 'data.json': emptyData }),
    );
    expect(err.code).toBe('too-new');
    expect(err.message).toContain('daha yeni bir sürümüyle');
  });

  it('bozuk yedekler: yarım dosya, bozuk bayt, eksik ya da geçersiz kayıtlar', async () => {
    const english = await fixture('english.pdf');
    await seedBook(a, english.bytes, english.id);
    const out = new Uint8Array(
      await (
        await exportBackup(a, { includePdfs: true, includeContents: true, storage })
      ).blob.arrayBuffer(),
    );

    // Yarıda kesilmiş (indirme ya da kopyalama yarım kaldı)
    expect((await code(b, new Blob([out.slice(0, out.length - 100)]))).code).toBe('corrupt');
    // data.json'un sıkıştırılmış baytları bozuk
    const damaged = out.slice();
    const dataAt = findName(damaged, 'data.json') + 'data.json'.length + 10;
    for (let i = 0; i < 8; i++) damaged[dataAt + i] ^= 0xff;
    expect((await code(b, new Blob([damaged]))).code).toBe('corrupt');

    expect((await code(b, zipOf({ 'manifest.json': manifest() }))).code).toBe('corrupt');
    expect((await code(b, zipOf({ 'manifest.json': '{bozuk', 'data.json': emptyData }))).code).toBe(
      'corrupt',
    );
    expect(
      (
        await code(
          b,
          zipOf({ 'manifest.json': manifest({ formatVersion: 0 }), 'data.json': emptyData }),
        )
      ).code,
    ).toBe('corrupt');
    const badBook = { ...emptyData, books: [{ id: '../../x', title: 1 }] };
    expect((await code(b, zipOf({ 'manifest.json': manifest(), 'data.json': badBook }))).code).toBe(
      'corrupt',
    );
    expect(await b.books.count()).toBe(0);
  });

  it('PDF\'i bozulmuş yedek: o PDF yazılmaz, kitap "PDF bekleniyor" kalır', async () => {
    const english = await fixture('english.pdf');
    await seedBook(a, english.bytes, english.id);
    const out = new Uint8Array(
      await (
        await exportBackup(a, { includePdfs: true, includeContents: true, storage })
      ).blob.arrayBuffer(),
    );
    // PDF sıkıştırılmadan saklanır: içindeki bir bayt değiştirilir (boy aynı)
    const pdfAt = findName(out, `pdf/${english.id}.pdf`) + `pdf/${english.id}.pdf`.length + 200;
    out[pdfAt] ^= 0xff;
    const result = await applyBackup(b, new Blob([out]));
    expect(result).toMatchObject({ booksAdded: 1, pdfsAdded: 0, pdfsRejected: 1, awaitingPdf: 1 });
    expect(await b.files.count()).toBe(0);
  });
});

/** Yerel başlıktaki girdi adının yeri */
function findName(bytes: Uint8Array, name: string): number {
  const needle = strToU8(name);
  outer: for (let i = 30; i < bytes.length; i++) {
    for (let k = 0; k < needle.length; k++) if (bytes[i + k] !== needle[k]) continue outer;
    return i;
  }
  throw new Error(`${name} bulunamadı`);
}

describe("yedek: büyük PDF'ler (akış)", () => {
  it("toplam 200 MB PDF parça parça aktarılır; PDF'ler bellekte iki kez birikmez; geri yüklenir", async () => {
    const MB = 2 ** 20;
    const size = 25 * MB;
    const ids: string[] = [];
    for (let n = 0; n < 8; n++) {
      const pdf = new Uint8Array(size);
      // Düz olmayan içerik; içine ZIP imzaları da konur (akışlı çözücü girdiyi orada bölerdi)
      for (let i = 0; i < size; i += 4096) pdf[i] = (i + n) & 0xff;
      pdf.set(strToU8('%PDF-1.7\n'), 0);
      pdf.set([0x50, 0x4b, 0x03, 0x04, 0x50, 0x4b, 0x07, 0x08], 1234567 + n);
      const id = sha256(pdf);
      ids.push(id);
      await a.books.add(bookRecord(id, { fileSize: size, addedAt: n }));
      await a.files.add({ bookId: id, data: pdf.buffer });
    }

    const used = () => process.memoryUsage().arrayBuffers / MB;
    const start = used();
    let peak = start;
    let reports = 0;
    const out = await exportBackup(a, {
      includePdfs: true,
      includeContents: true,
      storage,
      onProgress: () => {
        reports++;
        peak = Math.max(peak, used());
      },
    });
    // Parça parça: her parça en çok 1 MB, ilerleme her parçada bildirilir
    expect(out.stats.pdfChunks).toBe((8 * size) / PDF_CHUNK_BYTES);
    expect(out.stats.largestChunk).toBe(PDF_CHUNK_BYTES);
    expect(reports).toBeGreaterThan(200);
    expect(out.blob.size).toBeGreaterThan(8 * size);
    // Bellekte: üretilen yedek (200 MB) + o an okunan tek PDF (25 MB). PDF'lerin hepsi birden okunsaydı ya da ZIP
    // ayrıca tek tamponda birikseydi en az 400 MB olurdu.
    expect(peak - start).toBeLessThan(330);

    // Geri yükleme de dosyayı bütün olarak okumaz: her PDF kendi aralığından okunur. Artış: veritabanına yazılan
    // PDF'ler (fake-indexeddb bellekte tutar, 200 MB) + o an okunan tek PDF. Dosya bütün okunsaydı 400 MB'ı aşardı.
    const beforeApply = used();
    let applyPeak = beforeApply;
    const result = await applyBackup(b, asFile(out.blob), {
      onProgress: () => {
        applyPeak = Math.max(applyPeak, used());
      },
    });
    expect(result).toMatchObject({ pdfsAdded: 8, pdfsRejected: 0 });
    expect(applyPeak - beforeApply).toBeLessThan(330);
    for (const id of ids) {
      const stored = await b.files.get(id);
      expect(stored?.data.byteLength).toBe(size);
      expect(sha256(new Uint8Array(stored!.data))).toBe(id);
    }
  }, 120_000);
});

describe('dosya adı', () => {
  it('yerel tarihle', () => {
    expect(backupFileName(new Date(2027, 0, 5, 23, 59))).toBe(
      'mypdfbook-yedek-2027-01-05.mypdfbook',
    );
  });
});
