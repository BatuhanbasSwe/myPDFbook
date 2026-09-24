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
  /** PDF'i açar. Reddederse (bozuk dosya, yanlış şifre) açtığı her şeyi (pdf.js worker'ı dahil) kendisi bırakmalıdır. */
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
  // Özet için okunan tampon hemen bırakılır; pdf.js'e her denemede taze okuma verilir, saklanacak veri kayıt anında ayrıca okunur.
  const id = await sha256Hex(await file.arrayBuffer());
  const exists: ImportResult = { status: 'exists', bookId: id, done: Promise.resolve() };
  if (await db.books.get(id)) return exists;

  const { opened, password } = await openWithPassword(file, deps);
  try {
    const { source } = opened;
    // Metadata ya da ilk sayfa okunamazsa kitabı reddetme: dosya adıyla devam et, kapak çizmeyi deneme.
    const meta = await source.getMetadata().catch(() => ({}));
    const { title, author } = chooseTitle(meta, file.name);
    const firstChars = await source
      .getPageText(0)
      .then((page) => page.items.reduce((n, it) => n + it.str.replace(/\s/g, '').length, 0))
      .catch(() => COVER_TEXT_LIMIT);
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
      await saveNewBook(db, record, await file.arrayBuffer(), cover);
    } catch (e) {
      // Aynı dosya aynı anda iki kez bırakıldı: diğer içe aktarma kazandı.
      if ((e as { name?: string }).name === 'ConstraintError' && (await db.books.get(id))) {
        await opened.close();
        return exists;
      }
      throw isQuotaError(e) ? new ImportError('quota', { cause: e }) : e;
    }
  } catch (e) {
    await opened.close();
    throw e;
  }

  const done = runConversion(db, id, opened).finally(() => opened.close());
  return { status: 'added', bookId: id, done };
}

/** Kitabı, PDF verisini ve kapağı tek işlemde yazar. Veri yalnızca bu fonksiyonun kapsamında tutulur (dönüştürme boyunca bellekte kalmasın). */
async function saveNewBook(db: BookDB, record: BookRecord, data: ArrayBuffer, cover: string | undefined): Promise<void> {
  await db.transaction('rw', [db.books, db.files, db.covers], async () => {
    await db.books.add(record);
    await db.files.add({ bookId: record.id, data });
    if (cover) await db.covers.add({ bookId: record.id, dataUrl: cover });
  });
}

async function openWithPassword(file: Blob, deps: ImportDeps): Promise<{ opened: OpenedPdf; password?: string }> {
  let password: string | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      // pdf.js verinin sahipliğini worker'a devreder: her denemede dosyadan taze okuma (kopya yok)
      const opened = await deps.openPdf(new Uint8Array(await file.arrayBuffer()), password);
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
        // İlerleme yazımı en iyi çaba: başarısız olursa dönüştürmeyi düşürmesin
        chain = chain.then(
          () => db.books.update(id, { 'convert.progress': p }).then(() => undefined, () => undefined),
        );
      },
    });
    await chain;
    await db.transaction('rw', [db.books, db.contents], async () => {
      if (!(await db.books.get(id))) return; // dönüştürme sürerken kitap silindi: sahipsiz içerik yazma
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

const unfinished = (b: BookRecord) => b.convert.state === 'pending' || b.convert.state === 'running';
let resuming: Promise<void> | undefined;

/** Uygulama kapanınca yarıda kalan dönüştürmeleri yeniden başlatır. Aynı anda tek tur çalışır; hiçbir zaman reddetmez. */
export function resumeConversions(deps: ImportDeps): Promise<void> {
  // StrictMode ve kütüphaneye her dönüş yeniden çağırır: aynı anda tek tur
  resuming ??= resumeAll(deps)
    .catch(() => undefined)
    .finally(() => {
      resuming = undefined;
    });
  return resuming;
}

async function resumeAll(deps: ImportDeps): Promise<void> {
  const ids = await deps.db.books.filter(unfinished).primaryKeys();
  for (const id of ids) {
    try {
      await resumeOne(deps, id);
    } catch {
      // bu kitap bir sonraki açılışta yeniden denenir; diğerlerini durdurma
    }
  }
}

async function resumeOne({ db, openPdf }: ImportDeps, id: string): Promise<void> {
  const book = await db.books.get(id); // liste eskimiş olabilir: silinmiş/bitmiş kitabı atla
  if (!book || !unfinished(book) || active.has(id)) return;
  const file = await db.files.get(id);
  if (!file) {
    await db.books.update(id, { 'convert.state': 'failed', 'convert.error': 'Dosya bulunamadı' });
    return;
  }
  let opened: OpenedPdf;
  try {
    opened = await openPdf(new Uint8Array(file.data), book.password);
  } catch (e) {
    await db.books.update(id, { 'convert.state': 'failed', 'convert.error': String(e) });
    return;
  }
  await runConversion(db, id, opened).finally(() => opened.close());
}

function isPasswordError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'PasswordException';
}

function isQuotaError(e: unknown): boolean {
  const err = e as { name?: string; inner?: { name?: string } } | null;
  return err?.name === 'QuotaExceededError' || err?.inner?.name === 'QuotaExceededError';
}
