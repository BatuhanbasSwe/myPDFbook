import { convertPdf } from '../convert/convertPdf';
import { CONVERTER_VERSION, type PdfSource } from '../convert/types';
import type { BookDB, BookRecord } from '../db/db';
import { chooseTitle } from './fileName';
import { sha256Hex } from './hash';

export interface OpenedPdf {
  source: PdfSource;
  /** 1. sayfayı kapak olarak çizer (data URL); ortam desteklemiyorsa undefined. */
  renderCover(width: number): Promise<string | undefined>;
  close(): Promise<void>;
}

export interface ImportDeps {
  db: BookDB;
  openPdf(bytes: Uint8Array, password?: string): Promise<OpenedPdf>;
  /** Şifre sorar; kullanıcı vazgeçerse null. */
  askPassword?(retry: boolean): Promise<string | null>;
}

export type ImportErrorCode = 'invalid-pdf' | 'password-cancelled' | 'quota';

export const IMPORT_ERROR_MESSAGES: Record<ImportErrorCode, string> = {
  'invalid-pdf': 'Bu dosya açılamadı. Geçerli bir PDF olduğundan emin ol.',
  'password-cancelled': 'Şifre girilmediği için kitap eklenmedi.',
  quota: 'Cihazda yer kalmadı. Bazı kitapları silip tekrar dene.',
};

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  constructor(code: ImportErrorCode, options?: { cause?: unknown }) {
    super(IMPORT_ERROR_MESSAGES[code], options);
    this.name = 'ImportError';
    this.code = code;
  }
}

export interface ImportResult {
  status: 'added' | 'exists';
  bookId: string;
  /** Dönüştürme bitince çözülür (hata olursa kitap 'failed' olarak işaretlenir). */
  done: Promise<void>;
}

/** 1. sayfada bundan az karakter varsa (kapak/başlık sayfası) o sayfa kapak görseli olur. */
const COVER_TEXT_LIMIT = 200;

export async function importBook(file: File, deps: ImportDeps): Promise<ImportResult> {
  const { db } = deps;
  const buffer = await file.arrayBuffer();
  const id = await sha256Hex(buffer);
  if (await db.books.get(id)) return { status: 'exists', bookId: id, done: Promise.resolve() };

  const { opened, password } = await openWithPassword(buffer, deps);
  try {
    const { source } = opened;
    const { title, author } = chooseTitle(await source.getMetadata(), file.name);
    const firstChars =
      source.numPages > 0
        ? (await source.getPageText(0)).items.reduce((n, it) => n + it.str.replace(/\s/g, '').length, 0)
        : 0;
    const cover = firstChars < COVER_TEXT_LIMIT ? await opened.renderCover(360).catch(() => undefined) : undefined;
    const record: BookRecord = {
      id,
      title,
      author,
      fileName: file.name,
      fileSize: file.size,
      pdfPageCount: source.numPages,
      lang: 'other',
      password,
      addedAt: Date.now(),
      convert: { state: 'pending', progress: 0, version: CONVERTER_VERSION },
      readingStatus: 'unread',
      totalWords: 0,
    };
    try {
      await db.transaction('rw', [db.books, db.files, db.covers], async () => {
        await db.books.add(record);
        await db.files.add({ bookId: id, blob: new Blob([buffer], { type: 'application/pdf' }) });
        if (cover) await db.covers.add({ bookId: id, dataUrl: cover });
      });
    } catch (e) {
      throw isQuotaError(e) ? new ImportError('quota', { cause: e }) : e;
    }
  } catch (e) {
    await opened.close();
    throw e;
  }

  const done = runConversion(db, id, opened).finally(() => opened.close());
  return { status: 'added', bookId: id, done };
}

async function openWithPassword(buffer: ArrayBuffer, deps: ImportDeps): Promise<{ opened: OpenedPdf; password?: string }> {
  let password: string | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      // pdf.js verinin sahipliğini worker'a devreder; kaydedeceğimiz asıl veriye dokunmasın diye kopya veriyoruz
      const opened = await deps.openPdf(new Uint8Array(buffer.slice(0)), password);
      return { opened, password };
    } catch (e) {
      if (!isPasswordError(e)) throw new ImportError('invalid-pdf', { cause: e });
      const answer = deps.askPassword ? await deps.askPassword(attempt > 0) : null;
      if (answer === null) throw new ImportError('password-cancelled', { cause: e });
      password = answer;
    }
  }
}

const active = new Set<string>();

/** PDF'i dönüştürür ve sonucu kaydeder. Aynı kitap için aynı anda yalnızca bir dönüştürme çalışır. */
export async function runConversion(db: BookDB, id: string, opened: OpenedPdf): Promise<void> {
  if (active.has(id)) return;
  active.add(id);
  let saved = 0;
  let chain = Promise.resolve();
  try {
    await db.books.update(id, { 'convert.state': 'running', 'convert.progress': 0 });
    const content = await convertPdf(opened.source, {
      onProgress: (p) => {
        if (p - saved < 0.05 && p < 1) return;
        saved = p;
        chain = chain.then(async () => {
          await db.books.update(id, { 'convert.progress': p });
        });
      },
    });
    await chain;
    await db.transaction('rw', [db.books, db.contents], async () => {
      await db.contents.put({ bookId: id, ...content });
      await db.books.update(id, {
        convert: { state: 'done', progress: 1, version: content.version },
        lang: content.lang,
        totalWords: content.totalWords,
      });
    });
  } catch (e) {
    await chain.catch(() => undefined);
    await db.books.update(id, { 'convert.state': 'failed', 'convert.error': e instanceof Error ? e.message : String(e) });
  } finally {
    active.delete(id);
  }
}

/** Uygulama kapanınca yarıda kalan dönüştürmeleri yeniden başlatır. */
export async function resumeConversions(deps: ImportDeps): Promise<void> {
  const { db } = deps;
  const pending = await db.books.filter((b) => b.convert.state === 'pending' || b.convert.state === 'running').toArray();
  for (const book of pending) {
    if (active.has(book.id)) continue;
    const file = await db.files.get(book.id);
    if (!file) {
      await db.books.update(book.id, { 'convert.state': 'failed', 'convert.error': 'Dosya bulunamadı' });
      continue;
    }
    let opened: OpenedPdf;
    try {
      opened = await deps.openPdf(new Uint8Array(await file.blob.arrayBuffer()), book.password);
    } catch (e) {
      await db.books.update(book.id, { 'convert.state': 'failed', 'convert.error': String(e) });
      continue;
    }
    await runConversion(db, book.id, opened).finally(() => opened.close());
  }
}

function isPasswordError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'PasswordException';
}

function isQuotaError(e: unknown): boolean {
  const err = e as { name?: string; inner?: { name?: string } } | null;
  return err?.name === 'QuotaExceededError' || err?.inner?.name === 'QuotaExceededError';
}
