import { CONVERTER_VERSION } from '../convert/types';
import { completeBookFile } from '../db/books';
import type { BookDB, BookRecord } from '../db/db';
import { sha256Hex } from '../import/hash';
import { isQuotaError } from '../import/importBook';
import type { BackupProgress } from './exportBackup';
import {
  BackupError,
  contentPath,
  DATA_PATH,
  MANIFEST_PATH,
  parseContent,
  parseData,
  parseManifest,
  pdfPath,
  SETTINGS_KEYS,
  type BackupData,
  type BackupManifest,
} from './format';
import { mergeBook, newBookRecord, newerProgress, planAnnotations, planBookmarks } from './merge';
import { readEntry, readJsonEntry, readZipIndex, type ZipEntry } from './zip';

/** Yüklemeden önce gösterilen özet: yedekte ne var, bu cihaza ne eklenecek */
export interface BackupSummary {
  manifest: BackupManifest;
  books: { total: number; new: number };
  /** yedekteki PDF sayısı ve bunlardan cihazda olmayanlar (yüklenecekler) */
  pdfs: { total: number; needed: number };
  /** PDF'i ne yedekte ne cihazda olan kitaplar: "PDF bekleniyor" olarak eklenir */
  awaitingPdf: number;
  annotations: { total: number; new: number };
  bookmarks: { total: number; new: number };
  contents: number;
  /** yedekte ayar var mı ("Ayarları da uygula" seçilebilir mi) */
  hasSettings: boolean;
  fileSize: number;
}

export interface ApplyOptions {
  /** yedekteki ayarlar da yazılsın mı (varsayılan: hayır, cihazın ayarları korunur) */
  applySettings?: boolean;
  onProgress?(progress: BackupProgress): void;
  /** ayarların yazılacağı yer (varsayılan localStorage; testler verir) */
  storage?: Pick<Storage, 'setItem'>;
}

export interface ApplyResult {
  booksAdded: number;
  booksUpdated: number;
  pdfsAdded: number;
  /** okunamayan ya da özeti kitabın kimliğiyle uyuşmayan (bozuk) PDF'ler: yazılmadı, kitap "PDF bekleniyor" kalır */
  pdfsRejected: number;
  contentsAdded: number;
  /** okunamayan ya da biçimi bozuk metinler: yazılmadı, kitap PDF'inden yeniden dönüştürülür */
  contentsRejected: number;
  /** uygulamanın daha yeni sürümüyle dönüştürülmüş metinler: yazılmadı, kitap PDF'inden yeniden dönüştürülür */
  contentsSkipped: number;
  annotationsAdded: number;
  annotationsUpdated: number;
  bookmarksAdded: number;
  progressUpdated: number;
  /** yüklemeden sonra "PDF bekleniyor" durumunda kalan kitaplar (yedektekilerden) */
  awaitingPdf: number;
  /** yazılan ayar anahtarları */
  settingsApplied: string[];
  /** yedekteki bütün kitaplar: metni olmayanlar dönüştürme sırasına eklenebilir (queueConversions) */
  bookIds: string[];
}

interface OpenedBackup {
  entries: Map<string, ZipEntry>;
  manifest: BackupManifest;
  data: BackupData;
}

/** Yedeği açar: dizin, manifest ve kayıtlar. PDF'ler ve metinler okunmaz. */
async function openBackup(file: Blob): Promise<OpenedBackup> {
  const entries = await readZipIndex(file);
  const manifestEntry = entries.get(MANIFEST_PATH);
  if (!manifestEntry) throw new BackupError('not-backup');
  const manifest = parseManifest(await readJsonEntry(file, manifestEntry));
  const dataEntry = entries.get(DATA_PATH);
  if (!dataEntry) throw new BackupError('corrupt');
  const data = parseData(await readJsonEntry(file, dataEntry));
  return { entries, manifest, data };
}

/** Yedekteki ve cihazdaki durum: özet ve yükleme aynı hesabı kullanır */
async function compare(db: BookDB, { entries, data }: OpenedBackup) {
  const ids = data.books.map((b) => b.id);
  const [deviceBooks, fileIds, annotations, bookmarks] = await Promise.all([
    db.books.bulkGet(ids),
    db.files.toCollection().primaryKeys(),
    db.annotations.where('bookId').anyOf(ids).toArray(),
    db.bookmarks.where('bookId').anyOf(ids).toArray(),
  ]);
  const onDevice = new Map<string, BookRecord>();
  deviceBooks.forEach((b) => b && onDevice.set(b.id, b));
  const hasFile = new Set(fileIds);
  const inBackup = (id: string) => entries.has(pdfPath(id));
  return {
    onDevice,
    hasFile,
    pdfsNeeded: ids.filter((id) => inBackup(id) && !hasFile.has(id)),
    awaitingPdf: ids.filter((id) => !inBackup(id) && !hasFile.has(id)).length,
    annotationPlan: planAnnotations(annotations, data.annotations),
    newBookmarks: planBookmarks(bookmarks, data.bookmarks),
  };
}

/** Yedeği doğrular ve özetini çıkarır (bozuk, yedek olmayan ya da yeni sürümlü dosyada BackupError) */
export async function inspectBackup(db: BookDB, file: Blob): Promise<BackupSummary> {
  const opened = await openBackup(file);
  const { manifest, data, entries } = opened;
  const c = await compare(db, opened);
  const contents = data.books.filter((b) => entries.has(contentPath(b.id))).length;
  return {
    manifest,
    books: {
      total: data.books.length,
      new: data.books.filter((b) => !c.onDevice.has(b.id)).length,
    },
    pdfs: {
      total: data.books.filter((b) => entries.has(pdfPath(b.id))).length,
      needed: c.pdfsNeeded.length,
    },
    awaitingPdf: c.awaitingPdf,
    annotations: {
      total: data.annotations.length,
      new: c.annotationPlan.add.length + c.annotationPlan.update.length,
    },
    bookmarks: { total: data.bookmarks.length, new: c.newBookmarks.length },
    contents,
    hasSettings: Object.keys(data.settings).length > 0,
    fileSize: file.size,
  };
}

/**
 * Yedeği bu cihazdakilerle birleştirir (kurallar: merge.ts). Kayıtlar (kitaplar, kapaklar, okuma yerleri,
 * işaretler, yer imleri) tek Dexie işleminde yazılır. PDF'ler ve metinler dosyadan okunmayı gerektirdiği için işlem
 * dışında, birer birer yazılır: bellekte en çok bir PDF durur. PDF'i henüz yazılmamış kitap "PDF bekleniyor",
 * metni yazılmamış kitap "sırada" durumundadır; yükleme yarıda kalsa da tutarlı kalır ve aynı yedek yeniden
 * yüklenebilir.
 *
 * Tek bir bozuk PDF ya da metin yüklemeyi durdurmaz: atlanır ve sayılır (`pdfsRejected`, `contentsRejected`).
 * Yalnızca yer kalmayınca durur: kayıtlar yazılmadan önceyse `quota`, sonraysa `partial` hatası verir.
 */
export async function applyBackup(
  db: BookDB,
  file: Blob,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  try {
    return await applyOpened(db, file, await openBackup(file), options);
  } catch (e) {
    throw isQuotaError(e) ? new BackupError('quota', { cause: e }) : e;
  }
}

async function applyOpened(
  db: BookDB,
  file: Blob,
  opened: OpenedBackup,
  { applySettings = false, onProgress, storage }: ApplyOptions,
): Promise<ApplyResult> {
  const { entries, data } = opened;
  const result: ApplyResult = {
    booksAdded: 0,
    booksUpdated: 0,
    pdfsAdded: 0,
    pdfsRejected: 0,
    contentsAdded: 0,
    contentsRejected: 0,
    contentsSkipped: 0,
    annotationsAdded: 0,
    annotationsUpdated: 0,
    bookmarksAdded: 0,
    progressUpdated: 0,
    awaitingPdf: 0,
    settingsApplied: [],
    bookIds: data.books.map((b) => b.id),
  };

  const contentEntries = data.books
    .map((b) => entries.get(contentPath(b.id)))
    .filter((e): e is ZipEntry => !!e);
  const total =
    1 +
    contentEntries.reduce((n, e) => n + e.compressedSize, 0) +
    data.books.reduce((n, b) => n + (entries.get(pdfPath(b.id))?.compressedSize ?? 0), 0);
  let done = 0;
  const report = () => onProgress?.({ done: Math.min(done, total), total });
  report();

  // 1) Kayıtlar: tek işlemde (yarıda kalırsa hiçbiri yazılmaz)
  await db.transaction(
    'rw',
    [db.books, db.files, db.covers, db.progress, db.annotations, db.bookmarks],
    async () => {
      const c = await compare(db, opened);
      for (const b of data.books) {
        const device = c.onDevice.get(b.id);
        if (!device) {
          const record = newBookRecord(b);
          if (c.hasFile.has(b.id)) delete record.pdfMissing; // PDF'i (sahipsiz kalmış) cihazda
          await db.books.add(record);
          result.booksAdded++;
          continue;
        }
        const changes = mergeBook(device, b);
        if (changes) {
          await db.books.update(b.id, changes);
          result.booksUpdated++;
        }
      }
      const covers = await db.covers.bulkGet(data.covers.map((cv) => cv.bookId));
      const newCovers = data.covers.filter((_, i) => !covers[i]);
      if (newCovers.length) await db.covers.bulkAdd(newCovers);

      const progress = await db.progress.bulkGet(data.progress.map((p) => p.bookId));
      const newer = data.progress.filter((p, i) => newerProgress(progress[i], p));
      if (newer.length) await db.progress.bulkPut(newer);
      result.progressUpdated = newer.length;

      const plan = c.annotationPlan;
      if (plan.add.length) await db.annotations.bulkAdd(plan.add);
      for (const { id, changes } of plan.update) await db.annotations.update(id, changes);
      result.annotationsAdded = plan.add.length;
      result.annotationsUpdated = plan.update.length;

      if (c.newBookmarks.length) await db.bookmarks.bulkAdd(c.newBookmarks);
      result.bookmarksAdded = c.newBookmarks.length;
    },
  );

  // Yer kalmadıysa ya da yedek dosyası okunamaz olduysa (iCloud'dan kaldırıldı, silindi) sonraki girdiler de
  // yazılamaz: yükleme durur (kalanlar bozuk sayılmasın). Öteki hatalar yalnızca o girdiyi atlatır.
  const stopIfFatal = (e: unknown) => {
    if (isQuotaError(e)) throw new BackupError('partial', { cause: e });
    if (e instanceof BackupError && e.code === 'unreadable')
      throw new BackupError('partial-unreadable', { cause: e });
  };

  // 2) PDF'ler (metinlerden önce: metni atlanan kitap PDF'inden dönüştürülebilsin). Yalnızca cihazda olmayanlar
  // okunur; özeti kitabın kimliği olmalı.
  const fileIds = new Set(await db.files.toCollection().primaryKeys());
  for (const b of data.books) {
    const entry = entries.get(pdfPath(b.id));
    if (!entry) continue;
    if (!fileIds.has(b.id)) {
      try {
        const bytes = await readEntry(file, entry, { checkCrc: false });
        // readEntry STORE girdide tam boyda yeni bir tampon döndürür: kopyalanmadan saklanır
        const buffer = bytes.buffer as ArrayBuffer;
        if ((await sha256Hex(buffer)) === b.id) {
          if (await completeBookFile(db, b.id, buffer)) result.pdfsAdded++;
        } else {
          result.pdfsRejected++;
        }
      } catch (e) {
        stopIfFatal(e);
        console.warn('Yedekteki PDF atlandı', b.id, e);
        result.pdfsRejected++;
      }
    }
    done += entry.compressedSize;
    report();
  }

  // 3) Dönüştürülmüş metin: cihazda metni olmayan kitaplara (yeniden dönüştürme gerekmesin). Bozuk ya da daha
  // yeni sürümlü metin atlanır: kitap "sırada" kalır, PDF'i varsa (ya da gelince) PDF'inden dönüştürülür.
  const contentIds = new Set(await db.contents.toCollection().primaryKeys());
  const pageCounts = new Map(data.books.map((b) => [b.id, b.pdfPageCount]));
  for (const entry of contentEntries) {
    const id = entry.name.slice('contents/'.length, -'.json'.length);
    if (!contentIds.has(id)) {
      try {
        const raw = await readJsonEntry(file, entry);
        // Sürüm, sıkı doğrulamadan önce: daha yeni dönüştürücünün metni (biçimi bu sürümce bilinmeyebilir) bozuk
        // sayılmaz, atlanır
        const version = (raw as { version?: unknown } | null)?.version;
        if (typeof version === 'number' && version > CONVERTER_VERSION) {
          result.contentsSkipped++;
        } else {
          const content = parseContent(raw, id, pageCounts.get(id)!);
          const written = await db.transaction('rw', [db.books, db.contents], async () => {
            const book = await db.books.get(id);
            if (!book || (await db.contents.get(id))) return false;
            await db.contents.add(content);
            await db.books.update(id, {
              convert: { state: 'done', progress: 1, version: content.version },
              lang: content.lang,
              totalWords: content.totalWords,
            });
            return true;
          });
          if (written) result.contentsAdded++;
        }
      } catch (e) {
        stopIfFatal(e);
        console.warn('Yedekteki metin atlandı', id, e);
        result.contentsRejected++;
      }
    }
    done += entry.compressedSize;
    report();
  }

  const stillMissing = await db.books.bulkGet(result.bookIds);
  result.awaitingPdf = stillMissing.filter((b) => b?.pdfMissing).length;

  // 4) Ayarlar: yalnızca istenirse
  if (applySettings) result.settingsApplied = writeSettings(data.settings, storage);
  done = total;
  report();
  return result;
}

function writeSettings(
  settings: Record<string, string>,
  storage: Pick<Storage, 'setItem'> | undefined = defaultStorage(),
): string[] {
  const written: string[] = [];
  if (!storage) return written;
  for (const key of SETTINGS_KEYS) {
    const value = settings[key];
    if (value === undefined) continue;
    try {
      storage.setItem(key, value);
      written.push(key);
    } catch {
      // gizli sekme vb.
    }
  }
  return written;
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
