import { convertPdf } from '../convert/convertPdf';
import { CONVERTER_VERSION } from '../convert/types';
import type { BookDB, BookRecord } from '../db/db';
import type { OpenedPdf } from '../pdf/pdfSource';
import { chooseTitle } from './fileName';
import { sha256Hex } from './hash';

export type { OpenedPdf };

export interface ImportDeps {
  db: BookDB;
  /** PDF'i açar. Reddederse (bozuk dosya, yanlış şifre) açtığı her şeyi (pdf.js worker'ı dahil) kendisi bırakmalıdır. */
  openPdf(bytes: Uint8Array, password?: string): Promise<OpenedPdf>;
  /** Şifre sorar; kullanıcı vazgeçerse null. */
  askPassword?(retry: boolean): Promise<string | null>;
  /** Bu kadar süre ilerleme olmazsa dönüştürme takılmış sayılır (varsayılan STALL_MS; testler kısaltır). */
  stallMs?: number;
}

/** Bozuk PDF ya da ölen worker yüzünden takılan dönüştürme sıradaki kitapları sonsuza dek bekletmesin. */
const STALL_MS = 90_000;

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
  /** Kitabın dönüştürmesi (sırada öndekiler bittikten sonra) bitince çözülür; hata olursa kitap 'failed' olarak işaretlenir. Hiçbir zaman reddetmez. */
  done: Promise<void>;
}

/** 1. sayfada bundan az karakter varsa (kapak/başlık sayfası) o sayfa kapak görseli olur. */
const COVER_TEXT_LIMIT = 200;

/**
 * PDF'i kütüphaneye kaydeder ve dönüştürmeyi sıraya ekler; dönüştürmeyi beklemeden döner.
 * Birden çok dosya seçilince hepsi hemen kaydedilir: sekme kapansa da kaybolmaz, sonraki açılışta dönüştürülür.
 */
export async function importBook(file: File, deps: ImportDeps): Promise<ImportResult> {
  const { db } = deps;
  // Özet için okunan tampon hemen bırakılır; pdf.js'e her denemede taze okuma verilir, saklanacak veri kayıt anında ayrıca okunur.
  const id = await sha256Hex(await file.arrayBuffer());
  const exists: ImportResult = { status: 'exists', bookId: id, done: Promise.resolve() };
  if (await db.books.get(id)) return exists;

  const { opened, password } = await openWithPassword(file, deps);
  // Kayıttan önce kapat: dönüştürme belgeyi IndexedDB'den yeniden açar (bellekte aynı PDF'in fazladan kopyası kalmasın).
  // Kapanış beklenmez: yanıt vermeyen worker içe aktarmayı durdurmasın.
  const { record, cover } = await readBookInfo(opened, file, id, password).finally(() =>
    closeQuietly(opened),
  );
  try {
    await saveNewBook(db, record, await file.arrayBuffer(), cover);
  } catch (e) {
    // Aynı dosya aynı anda iki kez bırakıldı: diğer içe aktarma kazandı.
    if ((e as { name?: string }).name === 'ConstraintError' && (await db.books.get(id)))
      return exists;
    throw isQuotaError(e) ? new ImportError('quota', { cause: e }) : e;
  }
  return { status: 'added', bookId: id, done: enqueueConversion(deps, id) };
}

/** Başlığı, yazarı ve kapağı okur. Metadata ya da ilk sayfa okunamazsa kitabı reddetmez: dosya adıyla devam eder, kapak çizmeyi denemez. */
async function readBookInfo(
  opened: OpenedPdf,
  file: File,
  id: string,
  password: string | undefined,
): Promise<{ record: BookRecord; cover: string | undefined }> {
  const { source } = opened;
  const meta = await source.getMetadata().catch(() => ({}));
  const { title, author } = chooseTitle(meta, file.name);
  const firstChars = await source
    .getPageText(0)
    .then((page) => page.items.reduce((n, it) => n + it.str.replace(/\s/g, '').length, 0))
    .catch(() => COVER_TEXT_LIMIT);
  const cover =
    firstChars < COVER_TEXT_LIMIT
      ? await opened.renderCover(360).catch(() => undefined)
      : undefined;
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
  return { record, cover };
}

/** Kitabı, PDF verisini ve kapağı tek işlemde yazar. Veri yalnızca bu fonksiyonun kapsamında tutulur. */
async function saveNewBook(
  db: BookDB,
  record: BookRecord,
  data: ArrayBuffer,
  cover: string | undefined,
): Promise<void> {
  await db.transaction('rw', [db.books, db.files, db.covers], async () => {
    await db.books.add(record);
    await db.files.add({ bookId: record.id, data });
    if (cover) await db.covers.add({ bookId: record.id, dataUrl: cover });
  });
}

async function openWithPassword(
  file: Blob,
  deps: ImportDeps,
): Promise<{ opened: OpenedPdf; password?: string }> {
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

let queue: Promise<void> = Promise.resolve();

/** Dönüştürmeyi sıraya ekler: kitaplar birer birer dönüştürülür (iPad'de bellek ve işlemci için). Hiçbir zaman reddetmez. */
function enqueueConversion(deps: ImportDeps, id: string): Promise<void> {
  const run = queue.then(() => convertStored(deps, id)).catch((e: unknown) => console.error(e));
  queue = run;
  return run;
}

/** Dönüştürülemeyen kitabı yeniden sıraya ekler (deneme sayısı sıfırlanır). */
export async function retryConversion(deps: ImportDeps, id: string): Promise<void> {
  await deps.db.books.update(id, {
    convert: { state: 'pending', progress: 0, version: CONVERTER_VERSION },
  });
  await enqueueConversion(deps, id);
}

const unfinished = (b: BookRecord) =>
  b.convert.state === 'pending' || b.convert.state === 'running';

/**
 * Yarıda kalan (sekme kapanan ya da çöken) deneme sayısı bu sınıra ulaşınca kitap yeniden denenmez.
 * Yoksa iPad'de belleği aşıp sekmeyi çökerten bir kitap her açılışta yeniden çökertir.
 */
const MAX_ATTEMPTS = 3;

/** Eski kurallarla dönüştürülmüş: arka planda yeniden dönüştürülür, bu sırada eski metin okunabilir kalır. */
const outdated = (b: BookRecord) =>
  b.convert.state === 'done' &&
  b.convert.version < CONVERTER_VERSION &&
  (b.convert.attempts ?? 0) < MAX_ATTEMPTS;

/**
 * Kaydedilmiş kitabı IndexedDB'deki PDF'ten açıp dönüştürür (eski sürümle dönüştürülmüşse yeniden).
 * Silinmiş ya da güncel kitabı atlar: aynı kitap sıraya iki kez girmiş olabilir.
 */
async function convertStored(
  { db, openPdf, stallMs = STALL_MS }: ImportDeps,
  id: string,
): Promise<void> {
  const book = await db.books.get(id);
  if (!book) return;
  const upgrade = outdated(book);
  if (!unfinished(book) && !upgrade) return;
  const attempts = book.convert.attempts ?? 0;
  // Kuyruk sırayla çalıştığı için burada "running" görmek, önceki denemenin yarıda kaldığı anlamına gelir.
  if (book.convert.state === 'running' && attempts >= MAX_ATTEMPTS) {
    await markFailed(db, id, 'Dönüştürme tamamlanamadı: uygulama kapandı ya da bellek yetmedi.');
    return;
  }
  const file = await db.files.get(id);
  if (!file) {
    await (upgrade
      ? keepOldContent(db, id, 'Dosya bulunamadı')
      : markFailed(db, id, 'Dosya bulunamadı'));
    return;
  }
  // Deneme sayısı açılıştan önce yazılır: sekme açılışta ya da dönüştürmede çökerse de sayılır.
  // Yeniden dönüştürmede kitap "hazır" kalır: eski metin bu sırada okunabilir.
  await db.books.update(
    id,
    upgrade
      ? { 'convert.attempts': attempts + 1 }
      : { 'convert.state': 'running', 'convert.progress': 0, 'convert.attempts': attempts + 1 },
  );
  await runConversion(
    db,
    id,
    () => openPdf(new Uint8Array(file.data), book.password),
    stallMs,
    upgrade,
  );
}

/**
 * PDF'i açıp dönüştürür ve sonucu kaydeder. Yalnızca kuyruktan çağrılır, bu yüzden aynı anda tek dönüştürme çalışır.
 * Kitap silinirse ya da `stallMs` boyunca ilerleme olmazsa (açılış dahil) durur. Belgenin kapanışı beklenmez:
 * yanıt vermeyen worker sıradaki kitapları bekletmesin.
 */
async function runConversion(
  db: BookDB,
  id: string,
  open: () => Promise<OpenedPdf>,
  stallMs: number,
  upgrade: boolean,
): Promise<void> {
  let saved = 0;
  let deleted = false;
  let stopped = false; // takıldı ya da hata verdi: arkada süren convertPdf bir sonraki ilerlemede durur
  let chain = Promise.resolve();
  const watchdog = createWatchdog(stallMs);
  let opening: Promise<OpenedPdf> | undefined;
  try {
    opening = open();
    const opened = await Promise.race([opening, watchdog.stalled]);
    watchdog.poke();
    const converting = convertPdf(opened.source, {
      onProgress: (p) => {
        if (deleted) throw new Error('Kitap silindi'); // convertPdf'i durdurur
        if (stopped) throw new Error('Dönüştürme durduruldu');
        watchdog.poke();
        if (p - saved < 0.05 && p < 1) return;
        saved = p;
        // İlerleme yazımı en iyi çaba: başarısız olursa dönüştürmeyi düşürmesin. 0 satır = kitap silinmiş.
        chain = chain.then(() =>
          db.books.update(id, { 'convert.progress': p }).then(
            (n) => {
              if (n === 0) deleted = true;
            },
            () => undefined,
          ),
        );
      },
    });
    converting.catch(() => undefined); // takılma kazanırsa sonradan gelen hata işlenmemiş kalmasın
    const content = await Promise.race([converting, watchdog.stalled]);
    watchdog.stop();
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
    stopped = true;
    watchdog.stop();
    await chain.catch(() => undefined);
    await (upgrade ? keepOldContent(db, id, e) : markFailed(db, id, e));
  } finally {
    // Belge ne zaman açılırsa açılsın (takılmadan sonra bile) kapanır
    void opening?.then(closeQuietly, () => undefined);
  }
}

/**
 * `poke` çağrılmadan `stallMs` geçerse `stalled` reddedilir. Çok geç tetiklenen zamanlayıcı takılma sayılmaz:
 * sayfa askıya alınmıştı (iPad'de uygulama değiştirme, uyku), süre yeniden başlar.
 */
function createWatchdog(stallMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let armedAt = 0;
  let reject!: (e: Error) => void;
  const stalled = new Promise<never>((_, r) => (reject = r));
  stalled.catch(() => undefined); // iki bekleme arasında tetiklenirse işlenmemiş hata sayılmasın
  const poke = () => {
    clearTimeout(timer);
    armedAt = Date.now();
    timer = setTimeout(() => {
      if (Date.now() - armedAt > stallMs + 5_000) return poke();
      reject(new Error('Dönüştürme yanıt vermedi'));
    }, stallMs);
  };
  poke();
  return { stalled, poke, stop: () => clearTimeout(timer) };
}

function markFailed(db: BookDB, id: string, e: unknown): Promise<number> {
  return db.books.update(id, { 'convert.state': 'failed', 'convert.error': errorText(e) });
}

/** Yeniden dönüştürme olmadı: eski metin okunmaya devam eder, kitap bir daha yeniden dönüştürülmeye çalışılmaz. */
function keepOldContent(db: BookDB, id: string, e: unknown): Promise<number> {
  return db.books.update(id, { 'convert.attempts': MAX_ATTEMPTS, 'convert.error': errorText(e) });
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Kapanışı başlatır ama beklemez ve hatasını yutar. */
function closeQuietly(opened: OpenedPdf): void {
  void opened.close().catch(() => undefined);
}

let resuming: Promise<void> | undefined;

/** Uygulama kapanınca yarıda kalan dönüştürmeleri sıraya ekler ve bitmelerini bekler. Aynı anda tek tur çalışır; hiçbir zaman reddetmez. */
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
  // Eklenme sırasıyla (birincil anahtar sırası = özet sırası, kullanıcıya rastgele görünür)
  const books = await deps.db.books.orderBy('addedAt').toArray();
  await Promise.all(books.filter(unfinished).map((b) => enqueueConversion(deps, b.id)));
  // Eski kurallarla dönüştürülmüşler en son ve birer birer: sıra boşalınca bir tane eklenir, yeni eklenen
  // kitaplar en fazla o an süren tek yeniden dönüştürmeyi bekler.
  for (const b of books.filter(outdated)) {
    await queue;
    await enqueueConversion(deps, b.id);
  }
}

function isPasswordError(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && (e as { name?: string }).name === 'PasswordException'
  );
}

function isQuotaError(e: unknown): boolean {
  const err = e as { name?: string; inner?: { name?: string } } | null;
  return err?.name === 'QuotaExceededError' || err?.inner?.name === 'QuotaExceededError';
}
