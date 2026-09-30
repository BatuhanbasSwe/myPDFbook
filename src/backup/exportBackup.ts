import { strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import type { BookContent } from '../convert/types';
import type { BookDB, BookRecord } from '../db/db';
import {
  APP_VERSION,
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_MIME,
  BackupError,
  backupFileName,
  contentPath,
  DATA_PATH,
  deviceName,
  MANIFEST_PATH,
  pdfPath,
  SETTINGS_KEYS,
  type BackupBook,
  type BackupData,
  type BackupManifest,
} from './format';

export interface BackupProgress {
  /** yazılan bayt (PDF'ler ve metin; tahmini toplamla oranlanır) */
  done: number;
  total: number;
}

export interface ExportOptions {
  includePdfs: boolean;
  includeContents: boolean;
  onProgress?(progress: BackupProgress): void;
  /** ayarların okunacağı yer (varsayılan localStorage; testler verir) */
  storage?: Pick<Storage, 'getItem'>;
  now?: number;
  device?: string;
}

export interface ExportResult {
  blob: Blob;
  fileName: string;
  manifest: BackupManifest;
  /** PDF'lerin ZIP'e kaç parçada aktarıldığı ve en büyük parça (bellek denetimi, testler) */
  stats: { pdfChunks: number; largestChunk: number };
}

export interface BackupEstimate {
  books: number;
  /** cihazda PDF'i olan kitap sayısı ve PDF'lerin toplam boyu */
  pdfs: number;
  pdfBytes: number;
  /** dönüştürülmüş metin, kapaklar ve kayıtlar (yaklaşık) */
  otherBytes: number;
}

/** PDF'ler ZIP'e bu boyda parçalarla aktarılır (ilerleme ve olay döngüsüne nefes için) */
export const PDF_CHUNK_BYTES = 1 << 20;
/** Bu kadar veri yazıldıkça olay döngüsüne dönülür: ilerleme çubuğu çizilsin, sayfa donmasın */
const YIELD_BYTES = 4 << 20;
/** ZIP64'süz ZIP'in sınırı (girdi yerleri ve boyları 32 bit); başlıklara pay bırakılır */
const MAX_ZIP_BYTES = 0xffffffff - (16 << 20);
/** Sıkıştırılmış metnin kelime başına yaklaşık boyu (tahmin için) */
const CONTENT_BYTES_PER_WORD = 3;

const yieldToLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Yedeğin yaklaşık boyu: pencerede seçeneklerin yanında gösterilir. PDF'ler okunmaz (yalnızca kayıtlı boyları). */
export async function estimateBackup(db: BookDB): Promise<BackupEstimate> {
  let coverBytes = 0;
  const [books, fileIds] = await Promise.all([
    db.books.toArray(),
    db.files.toCollection().primaryKeys(),
    db.covers.each((c) => {
      coverBytes += c.dataUrl.length;
    }),
  ]);
  const withFile = new Set(fileIds);
  let pdfs = 0;
  let pdfBytes = 0;
  let words = 0;
  for (const b of books) {
    if (withFile.has(b.id)) {
      pdfs++;
      pdfBytes += b.fileSize;
    }
    words += b.totalWords;
  }
  return {
    books: books.length,
    pdfs,
    pdfBytes,
    otherBytes: coverBytes + words * CONTENT_BYTES_PER_WORD + books.length * 2048,
  };
}

/**
 * Yedek dosyasını üretir. Kayıtlar küçüktür, birlikte okunur; metinler ve PDF'ler IndexedDB'den birer birer okunup
 * ZIP'e akıtılır. Her girdinin çıktısı hemen bir Blob parçasına aktarılır: bellekte PDF'lerin tamamı değil, en çok
 * okunan tek PDF ve biriken Blob parçaları durur (tarayıcı büyük Blob'ları diske taşıyabilir).
 */
export async function exportBackup(db: BookDB, options: ExportOptions): Promise<ExportResult> {
  const { includePdfs, includeContents, onProgress } = options;
  const now = options.now ?? Date.now();

  // Kayıtlar tek okuma işleminde: tutarlı bir anlık görüntü
  const snapshot = await db.transaction(
    'r',
    [db.books, db.covers, db.progress, db.annotations, db.bookmarks, db.files, db.contents],
    async () => ({
      books: await db.books.orderBy('addedAt').toArray(),
      covers: await db.covers.toArray(),
      progress: await db.progress.toArray(),
      annotations: await db.annotations.toArray(),
      bookmarks: await db.bookmarks.toArray(),
      fileIds: new Set(await db.files.toCollection().primaryKeys()),
      contentIds: new Set(await db.contents.toCollection().primaryKeys()),
    }),
  );

  const pdfBooks = includePdfs ? snapshot.books.filter((b) => snapshot.fileIds.has(b.id)) : [];
  const contentBooks = includeContents
    ? snapshot.books.filter((b) => snapshot.contentIds.has(b.id))
    : [];
  const pdfBytes = pdfBooks.reduce((n, b) => n + b.fileSize, 0);
  if (pdfBytes > MAX_ZIP_BYTES) throw new BackupError('too-large');

  const data: BackupData = {
    books: snapshot.books.map(toBackupBook),
    covers: snapshot.covers,
    progress: snapshot.progress,
    annotations: snapshot.annotations.map(withoutId),
    bookmarks: snapshot.bookmarks.map(withoutId),
    settings: readSettings(options.storage ?? defaultStorage()),
  };
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    createdAt: now,
    device: options.device ?? currentDevice(),
    counts: {
      books: data.books.length,
      pdfs: pdfBooks.length,
      contents: contentBooks.length,
      annotations: data.annotations.length,
      bookmarks: data.bookmarks.length,
    },
  };

  const writer = new ZipWriter();
  const total =
    pdfBytes + contentBooks.reduce((n, b) => n + b.totalWords * CONTENT_BYTES_PER_WORD, 0) + 1;
  let done = 0;
  const report = () => onProgress?.({ done: Math.min(done, total), total });
  report();

  writer.addDeflated(MANIFEST_PATH, strToU8(JSON.stringify(manifest)));
  writer.addDeflated(DATA_PATH, strToU8(JSON.stringify(data)));

  for (const book of contentBooks) {
    const record = await db.contents.get(book.id);
    if (!record) continue; // bu arada silindi
    const { version, lang, blocks, chapters, textlessPages, totalWords } = record;
    const content: BookContent = { version, lang, blocks, chapters, textlessPages, totalWords };
    writer.addDeflated(contentPath(book.id), strToU8(JSON.stringify(content)));
    done += book.totalWords * CONTENT_BYTES_PER_WORD;
    report();
    await yieldToLoop();
  }

  for (const book of pdfBooks) {
    // Tek PDF okunur; ZIP'e aktarılınca bırakılır
    const file = await db.files.get(book.id);
    if (!file) continue;
    await writer.addStored(pdfPath(book.id), new Uint8Array(file.data), (n) => {
      done += n;
      report();
    });
  }

  const blob = writer.finish();
  done = total;
  report();
  return { blob, fileName: backupFileName(new Date(now)), manifest, stats: writer.stats };
}

/** Kitap kaydı yedekte: dönüştürme durumu ve "PDF bekleniyor" cihaza özeldir, girmez */
function toBackupBook(b: BookRecord): BackupBook {
  const book: BackupBook = {
    id: b.id,
    title: b.title,
    author: b.author,
    fileName: b.fileName,
    fileSize: b.fileSize,
    pdfPageCount: b.pdfPageCount,
    lang: b.lang,
    addedAt: b.addedAt,
    readingStatus: b.readingStatus,
    totalWords: b.totalWords,
  };
  if (b.password !== undefined) book.password = b.password;
  if (b.lastOpenedAt !== undefined) book.lastOpenedAt = b.lastOpenedAt;
  if (b.startedAt !== undefined) book.startedAt = b.startedAt;
  return book;
}

/** İşaret ve yer iminin anahtarı cihaza özeldir, yedeğe girmez */
function withoutId<T extends { id?: number }>(record: T): Omit<T, 'id'> {
  const copy = { ...record };
  delete copy.id;
  return copy;
}

function readSettings(storage: Pick<Storage, 'getItem'> | undefined): Record<string, string> {
  const settings: Record<string, string> = {};
  if (!storage) return settings;
  for (const key of SETTINGS_KEYS) {
    try {
      const value = storage.getItem(key);
      if (value !== null) settings[key] = value;
    } catch {
      // gizli sekme vb.
    }
  }
  return settings;
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function currentDevice(): string {
  if (typeof navigator === 'undefined') return '';
  return deviceName(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}

/**
 * fflate'in akışlı ZIP'i üzerinde küçük bir yazıcı. Her girdinin çıktısı girdi bitince (PDF'lerde birkaç MB'ta
 * bir) Blob parçasına dönüştürülür; parçalar sonunda tek Blob'da birleşir (kopyalanmadan).
 */
class ZipWriter {
  private readonly parts: Blob[] = [];
  private pending: Uint8Array[] = [];
  private written = 0;
  private error: unknown;
  private readonly zip: Zip;
  readonly stats = { pdfChunks: 0, largestChunk: 0 };

  constructor() {
    this.zip = new Zip((err, chunk) => {
      if (err) {
        this.error = err;
        return;
      }
      this.pending.push(chunk);
      this.written += chunk.length;
    });
  }

  addDeflated(name: string, bytes: Uint8Array): void {
    const file = new ZipDeflate(name, { level: 6 });
    this.zip.add(file);
    file.push(bytes, true);
    this.flush();
  }

  /** Sıkıştırmasız girdi (PDF): parça parça aktarılır, arada olay döngüsüne dönülür */
  async addStored(name: string, bytes: Uint8Array, onBytes: (n: number) => void): Promise<void> {
    const file = new ZipPassThrough(name);
    this.zip.add(file);
    if (bytes.length === 0) file.push(bytes, true);
    let sinceYield = 0;
    for (let start = 0; start < bytes.length; start += PDF_CHUNK_BYTES) {
      const end = Math.min(start + PDF_CHUNK_BYTES, bytes.length);
      const chunk = bytes.subarray(start, end);
      file.push(chunk, end === bytes.length);
      this.stats.pdfChunks++;
      this.stats.largestChunk = Math.max(this.stats.largestChunk, chunk.length);
      onBytes(chunk.length);
      sinceYield += chunk.length;
      if (sinceYield >= YIELD_BYTES) {
        sinceYield = 0;
        this.flush();
        await yieldToLoop();
      }
    }
    this.flush();
  }

  finish(): Blob {
    this.zip.end();
    this.flush();
    return new Blob(this.parts, { type: BACKUP_MIME });
  }

  /** Biriken ZIP çıktısını Blob parçasına aktarır: kaynak tamponlar (IndexedDB'den okunan PDF) bırakılabilsin */
  private flush(): void {
    if (this.error) throw this.error;
    if (this.written > MAX_ZIP_BYTES) throw new BackupError('too-large');
    if (this.pending.length === 0) return;
    this.parts.push(new Blob(this.pending as BlobPart[]));
    this.pending = [];
  }
}
