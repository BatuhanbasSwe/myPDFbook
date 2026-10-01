import type {
  AnnotationKind,
  AnnotationRecord,
  BookmarkRecord,
  BookRecord,
  ContentRecord,
  CoverRecord,
  ProgressRecord,
  ReadingStatus,
} from '../db/db';
import type { Block, Chapter, Lang, Locator } from '../convert/types';

/**
 * Yedek dosyası (`.mypdfbook`): sıradan bir ZIP.
 * - `manifest.json`: biçim ve uygulama sürümü, tarih, cihaz, içindekilerin sayısı (ilk girdi)
 * - `data.json`: kitap kayıtları, kapaklar, okuma yerleri, işaretler, yer imleri ve ayarlar (ikinci girdi)
 * - `contents/<kitap>.json`: dönüştürülmüş metin (isteğe bağlı; geri yüklemede yeniden dönüştürmeyi önler)
 * - `pdf/<kitap>.pdf`: PDF'in kendisi, sıkıştırılmadan (isteğe bağlı)
 * Sayfalama önbelleği (`layouts`) yedeğe girmez, yeniden hesaplanır. Yapay zekâ sesleri (Cache Storage) de girmez.
 */

/** Vite derlemede package.json'daki sürümle değiştirir (vite.config.ts); testlerde tanımsızdır. */
declare const __APP_VERSION__: string | undefined;

export const BACKUP_FORMAT = 'mypdfbook-backup';
/** Biçim değişince artırılır. Daha yeni sürümlü yedek, eski uygulamada açılmaz (anlaşılır hatayla). */
export const BACKUP_FORMAT_VERSION = 1;
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev';
export const BACKUP_EXTENSION = '.mypdfbook';
export const BACKUP_MIME = 'application/zip';

export const MANIFEST_PATH = 'manifest.json';
export const DATA_PATH = 'data.json';
export const contentPath = (bookId: string) => `contents/${bookId}.json`;
export const pdfPath = (bookId: string) => `pdf/${bookId}.pdf`;

/**
 * Yedeğe giren ayarlar (localStorage). Cihaza özel olanlar girmez: kurulum kartı, yedek hatırlatıcısı.
 * Geri yüklemede yalnızca kullanıcı "Ayarları da uygula"yı seçerse yazılır.
 */
export const SETTINGS_KEYS = [
  'mypdfbook:theme',
  'mypdfbook:typography',
  'mypdfbook:reader',
  'mypdfbook:pen',
  'mypdfbook:read-aloud',
  'mypdfbook:speed-reading',
  'mypdfbook:focus',
  'mypdfbook:search',
] as const;

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  appVersion: string;
  /** yedeğin alındığı an (ms) */
  createdAt: number;
  /** yedeğin alındığı cihaz (ör. "iPad"); yalnızca gösterilir */
  device: string;
  counts: {
    books: number;
    pdfs: number;
    contents: number;
    annotations: number;
    bookmarks: number;
  };
}

/** Yedekteki kitap: dönüştürme durumu ve "PDF bekleniyor" cihaza özeldir, yedeğe girmez */
export type BackupBook = Omit<BookRecord, 'convert' | 'pdfMissing'>;
/** Yedekteki işaret ve yer imi: anahtarları cihaza özel sayılardır, yedeğe girmez */
export type BackupAnnotation = Omit<AnnotationRecord, 'id'>;
export type BackupBookmark = Omit<BookmarkRecord, 'id'>;

export interface BackupData {
  books: BackupBook[];
  covers: CoverRecord[];
  progress: ProgressRecord[];
  annotations: BackupAnnotation[];
  bookmarks: BackupBookmark[];
  /** SETTINGS_KEYS'teki anahtarların ham localStorage değerleri */
  settings: Record<string, string>;
}

export type BackupErrorCode =
  | 'not-backup'
  | 'corrupt'
  | 'too-new'
  | 'too-large'
  | 'quota'
  | 'partial'
  | 'unreadable'
  | 'partial-unreadable';

export const BACKUP_ERROR_MESSAGES: Record<BackupErrorCode, string> = {
  'not-backup': 'Bu dosya bir mypdfbook yedeği değil. “.mypdfbook” uzantılı yedek dosyasını seç.',
  corrupt: 'Yedek dosyası bozuk ya da eksik, açılamadı. Yedeği yeniden alıp tekrar dene.',
  'too-new':
    'Bu yedek uygulamanın daha yeni bir sürümüyle alınmış. Önce uygulamayı güncelle (kütüphanede “Yenile”), sonra tekrar dene.',
  'too-large': "Yedek 4 GB'ı aşıyor, bu boyutta dosya üretilemiyor. PDF'leri eklemeden yedek al.",
  quota: 'Cihazda yer kalmadı. Bazı kitapları silip tekrar dene.',
  partial: 'Cihazda yer kalmadı. Yedeğin bir kısmı yüklendi; yer açıp aynı yedeği tekrar yükle.',
  'partial-unreadable':
    'Yedek dosyası okunamadı; yedeğin bir kısmı yüklendi. Aynı yedeği tekrar yükle.',
  unreadable:
    "Dosya okunamadı. iCloud'daysa önce Dosyalar'da indirildiğinden emin ol, sonra tekrar dene.",
};

export class BackupError extends Error {
  readonly code: BackupErrorCode;
  constructor(code: BackupErrorCode, options?: { cause?: unknown }) {
    super(BACKUP_ERROR_MESSAGES[code], options);
    this.name = 'BackupError';
    this.code = code;
  }
}

/** `mypdfbook-yedek-YYYY-AA-GG.mypdfbook` (yerel tarih) */
export function backupFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `mypdfbook-yedek-${day}${BACKUP_EXTENSION}`;
}

/** Yedeğin alındığı cihazın kısa adı (yalnızca özette gösterilir) */
export function deviceName(userAgent: string, maxTouchPoints = 0): string {
  if (/iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'iPad';
  if (/iPhone|iPod/.test(userAgent)) return 'iPhone';
  if (/Android/.test(userAgent)) return 'Android';
  if (/Macintosh/.test(userAgent)) return 'Mac';
  if (/Windows/.test(userAgent)) return 'Windows';
  if (/Linux/.test(userAgent)) return 'Linux';
  return 'Tarayıcı';
}

// ---- Doğrulama: yedek dosyası dışarıdan gelir; veritabanına yalnızca beklenen biçimdeki alanlar yazılır ----

type Obj = Record<string, unknown>;

const corrupt = (): never => {
  throw new BackupError('corrupt');
};
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const obj = (v: unknown): Obj => (isObj(v) ? v : corrupt());
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : corrupt());
const str = (v: unknown): string => (typeof v === 'string' ? v : corrupt());
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : corrupt());
const int = (v: unknown): number =>
  Number.isInteger(v) && (v as number) >= 0 ? (v as number) : corrupt();
const optional = <T>(v: unknown, read: (v: unknown) => T): T | undefined =>
  v === undefined || v === null ? undefined : read(v);
const oneOf =
  <T extends string>(values: readonly T[]) =>
  (v: unknown): T =>
    (values as readonly unknown[]).includes(v) ? (v as T) : corrupt();

/** Kitap kimliği: PDF'in SHA-256 özeti (dosya yollarında da kullanılır) */
const BOOK_ID = /^[0-9a-f]{64}$/;
const bookId = (v: unknown): string => (BOOK_ID.test(str(v)) ? (v as string) : corrupt());

const LANGS: readonly Lang[] = ['tr', 'en', 'other'];
const STATUSES: readonly ReadingStatus[] = ['unread', 'reading', 'finished', 'abandoned'];
const KINDS: readonly AnnotationKind[] = ['highlight', 'ink', 'note'];
const lang = oneOf(LANGS);

/** Tanımsız alanları atar: Dexie'ye `undefined` değerli alan yazılmasın */
function compact<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[])
    if (value[key] === undefined) delete value[key];
  return value;
}

function locator(v: unknown): Locator {
  const o = obj(v);
  return { block: int(o.block), offset: int(o.offset) };
}

/** manifest.json'u doğrular: yedek değilse, bozuksa ya da daha yeni biçimdeyse anlaşılır hata verir */
export function parseManifest(raw: unknown): BackupManifest {
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) throw new BackupError('not-backup');
  const formatVersion = int(raw.formatVersion);
  if (formatVersion > BACKUP_FORMAT_VERSION) throw new BackupError('too-new');
  if (formatVersion < 1) corrupt();
  const counts = obj(raw.counts);
  return {
    format: BACKUP_FORMAT,
    formatVersion,
    appVersion: str(raw.appVersion),
    createdAt: num(raw.createdAt),
    device: typeof raw.device === 'string' ? raw.device : '',
    counts: {
      books: int(counts.books),
      pdfs: int(counts.pdfs),
      contents: int(counts.contents),
      annotations: int(counts.annotations),
      bookmarks: int(counts.bookmarks),
    },
  };
}

function parseBook(v: unknown): BackupBook {
  const o = obj(v);
  return compact({
    id: bookId(o.id),
    title: str(o.title),
    author: str(o.author),
    fileName: str(o.fileName),
    fileSize: int(o.fileSize),
    pdfPageCount: int(o.pdfPageCount),
    lang: lang(o.lang),
    password: optional(o.password, str),
    addedAt: num(o.addedAt),
    lastOpenedAt: optional(o.lastOpenedAt, num),
    readingStatus: oneOf(STATUSES)(o.readingStatus),
    startedAt: optional(o.startedAt, num),
    totalWords: int(o.totalWords),
  });
}

function parseProgress(v: unknown): ProgressRecord {
  const o = obj(v);
  return compact({
    bookId: bookId(o.bookId),
    locator: locator(o.locator),
    // Oran 0–1 arasıdır (ilerleme çubuğu, yüzde)
    percent: Math.min(1, Math.max(0, num(o.percent))),
    updatedAt: num(o.updatedAt),
    contentVersion: optional(o.contentVersion, int),
    pdfPage: optional(o.pdfPage, int),
  });
}

function parseAnnotation(v: unknown): BackupAnnotation {
  const o = obj(v);
  const points = arr(o.points).map(num);
  if (points.length % 2 !== 0) corrupt();
  return compact({
    bookId: bookId(o.bookId),
    page: int(o.page),
    kind: oneOf(KINDS)(o.kind),
    color: str(o.color),
    width: num(o.width),
    points,
    text: optional(o.text, str),
    createdAt: num(o.createdAt),
    updatedAt: num(o.updatedAt),
  });
}

function parseBookmark(v: unknown): BackupBookmark {
  const o = obj(v);
  return compact({
    bookId: bookId(o.bookId),
    pdfPage: int(o.pdfPage),
    locator: optional(o.locator, locator),
    createdAt: num(o.createdAt),
  });
}

function parseCover(v: unknown): CoverRecord {
  const o = obj(v);
  const dataUrl = str(o.dataUrl);
  // Kapak <img src> olarak çizilir: yalnızca gömülü görsel
  if (!dataUrl.startsWith('data:image/')) corrupt();
  return { bookId: bookId(o.bookId), dataUrl };
}

/**
 * data.json'u doğrular ve yalnızca bilinen alanları alır. Beklenmeyen biçim bozuk yedek sayılır. Yedekte olmayan
 * kitaba ait kayıtlar (okuma yeri, işaret, yer imi, kapak) atlanır.
 */
export function parseData(raw: unknown): BackupData {
  const o = obj(raw);
  const books = arr(o.books).map(parseBook);
  const ids = new Set(books.map((b) => b.id));
  if (ids.size !== books.length) corrupt();
  const known = <T extends { bookId: string }>(records: T[]) =>
    records.filter((r) => ids.has(r.bookId));
  const settings: Record<string, string> = {};
  const rawSettings = optional(o.settings, obj) ?? {};
  for (const key of SETTINGS_KEYS) {
    const value = rawSettings[key];
    if (typeof value === 'string') settings[key] = value;
  }
  return {
    books,
    covers: known(arr(o.covers).map(parseCover)),
    progress: known(arr(o.progress).map(parseProgress)),
    annotations: known(arr(o.annotations).map(parseAnnotation)),
    bookmarks: known(arr(o.bookmarks).map(parseBookmark)),
    settings,
  };
}

const BLOCK_KINDS = ['heading', 'para', 'note', 'break', 'pageImage'] as const;

/** Bloğu yalnızca bilinen alanlarından yeniden kurar; kaynak sayfası kitabın sayfalarından biri olmalı */
function parseBlock(v: unknown, pageCount: number): Block {
  const o = obj(v);
  const kind = oneOf(BLOCK_KINDS)(o.kind);
  const srcPage = page(o.srcPage, pageCount);
  switch (kind) {
    case 'heading': {
      const level = o.level === 1 || o.level === 2 ? o.level : corrupt();
      return { kind, level, text: str(o.text), srcPage };
    }
    case 'para':
    case 'note':
      return { kind, text: str(o.text), srcPage };
    case 'break':
    case 'pageImage':
      return { kind, srcPage };
  }
}

/** PDF sayfa numarası (0'dan): kitabın sayfa sayısından küçük olmalı */
const page = (v: unknown, pageCount: number): number => {
  const n = int(v);
  return n < pageCount ? n : corrupt();
};

/**
 * contents/<kitap>.json: dönüştürülmüş metin. Bloklar sayfalayıcıya gider: yalnızca bilinen alanlarıyla yeniden
 * kurulur, bölümler var olan bloklara, sayfalar kitabın sayfalarına (`pageCount`, yedekteki kitap kaydından)
 * işaret etmelidir.
 */
export function parseContent(raw: unknown, id: string, pageCount: number): ContentRecord {
  const o = obj(raw);
  const blocks = arr(o.blocks).map((b) => parseBlock(b, pageCount));
  const chapters = arr(o.chapters).map((c): Chapter => {
    const chapter = obj(c);
    const block = int(chapter.block);
    if (block >= blocks.length) corrupt();
    return { title: str(chapter.title), block, level: int(chapter.level) };
  });
  return {
    bookId: id,
    version: int(o.version),
    lang: lang(o.lang),
    blocks,
    chapters,
    textlessPages: arr(o.textlessPages).map((p) => page(p, pageCount)),
    totalWords: int(o.totalWords),
  };
}
