import { Dexie, type EntityTable, type Table } from 'dexie';
import type { BookContent, Lang, Locator } from '../convert/types';

export type ConvertState = 'pending' | 'running' | 'done' | 'failed';
export type ReadingStatus = 'unread' | 'reading' | 'finished' | 'abandoned';

export interface BookRecord {
  /** Dosya içeriğinin SHA-256 özeti: aynı PDF iki kez eklenmez; ileride senkron için sabit kimlik. */
  id: string;
  title: string;
  author: string;
  fileName: string;
  fileSize: number;
  pdfPageCount: number;
  lang: Lang;
  /** Şifreli PDF'ler için. Yalnızca bu cihazda ve düz metin olarak saklanır; hiçbir yere gönderilmez. */
  password?: string;
  addedAt: number;
  lastOpenedAt?: number;
  /**
   * attempts: yarıda kalabilen dönüştürme denemelerinin sayısı; upgradeTo: bu denemeler bir yeniden dönüştürmeye
   * aitse hedef dönüştürücü sürümü. İkisi de dönüştürme bitince silinir.
   */
  convert: {
    state: ConvertState;
    progress: number;
    version: number;
    error?: string;
    /** hatanın koddaki yeri (ilk yığın satırları; sorun bildirirken okunur) */
    errorAt?: string;
    attempts?: number;
    upgradeTo?: number;
  };
  readingStatus: ReadingStatus;
  startedAt?: number;
  totalWords: number;
}

/** Orijinal PDF. Blob değil ArrayBuffer: Safari/WebKit bazı durumlarda (gizli sekme, bazı iOS sürümleri) IndexedDB'ye Blob yazamıyor. */
export interface FileRecord {
  bookId: string;
  data: ArrayBuffer;
}

/** Kapak ayrı tabloda: dönüştürme ilerlemesi `books` satırını sık günceller, kapaklar her seferinde yeniden okunmasın. */
export interface CoverRecord {
  bookId: string;
  dataUrl: string;
}

export interface ContentRecord extends BookContent {
  bookId: string;
}

export interface ProgressRecord {
  bookId: string;
  locator: Locator;
  percent: number;
  updatedAt: number;
  /** Konumun ait olduğu içerik sürümü; kitap yeniden dönüştürülünce bloklar değişir (yoksa 1). */
  contentVersion?: number;
  /**
   * Açık PDF sayfası (0'dan; sayfa görünümü). Metinsiz sayfada da tam yeri tutar ve kitap yeniden dönüştürülse de
   * geçerlidir. İndeksli değil: şema sürümü gerekmez (eski kayıtlarda yok, konumdan hesaplanır).
   */
  pdfPage?: number;
}

/**
 * Sayfalama önbelleği (bkz. layout/layoutCache): kitabın bir ekran ve tipografi için hesaplanmış sayfa sınırları.
 * Kitap başına birkaç kayıt; en az kullanılan önce silinir.
 */
export interface LayoutRecord {
  bookId: string;
  /** sayfalamanın anahtarı (layoutSignature) */
  signature: string;
  starts: Locator[];
  usedAt: number;
}

/** Sayfadaki işaret: fosforlu kalem, kalem çizgisi ya da not iğnesi */
export type AnnotationKind = 'highlight' | 'ink' | 'note';

/**
 * Sayfa görünümünde PDF sayfasına konan işaret (bkz. annotations/store). Koordinatlar PDF sayfasına göre 0–1
 * aralığındadır: ekran boyutu, tek/çift sayfa ya da çizim çözünürlüğü değişse de işaret yerinde kalır.
 */
export interface AnnotationRecord {
  /** otomatik artan anahtar; aynı sayfada çizim sırası da budur */
  id?: number;
  bookId: string;
  /** PDF sayfası (0'dan) */
  page: number;
  kind: AnnotationKind;
  /** CSS rengi (#rrggbb) */
  color: string;
  /** çizgi kalınlığı, sayfa genişliğine oranla (not: 0) */
  width: number;
  /** x, y çiftleri (0–1); not için tek nokta: iğnenin ucu */
  points: number[];
  /** not metni */
  text?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Yer imi (köşe kıvırma): PDF sayfasına bağlıdır (bkz. bookmarks/store). Metin görünümünde konulan yer imi açık
 * sayfanın başladığı PDF sayfasına bağlanır; o sayfanın metindeki başı da saklanır (oraya geri dönülür).
 */
export interface BookmarkRecord {
  /** otomatik artan anahtar */
  id?: number;
  bookId: string;
  /** PDF sayfası (0'dan) */
  pdfPage: number;
  /** metin görünümünde konulduysa sayfanın metindeki başı */
  locator?: Locator;
  createdAt: number;
}

export type BookDB = Dexie & {
  books: EntityTable<BookRecord, 'id'>;
  files: EntityTable<FileRecord, 'bookId'>;
  covers: EntityTable<CoverRecord, 'bookId'>;
  contents: EntityTable<ContentRecord, 'bookId'>;
  progress: EntityTable<ProgressRecord, 'bookId'>;
  /** birincil anahtar [bookId+signature] */
  layouts: Table<LayoutRecord, [string, string]>;
  annotations: EntityTable<AnnotationRecord, 'id'>;
  bookmarks: EntityTable<BookmarkRecord, 'id'>;
};

/**
 * Birincil anahtarı kitap kimliği olan tablolar; kitap silinirken `delete(id)` ile temizlenir. Kitaba bağlı yeni
 * tablonun anahtarı kitap kimliğiyse buraya ekle; değilse (ör. `layouts`, `annotations`, `bookmarks`) deleteBook onu
 * `where('bookId')` ile siler.
 */
export const BOOK_TABLES = ['books', 'files', 'covers', 'contents', 'progress'] as const;

export function createDb(name = 'mypdfbook'): BookDB {
  const db = new Dexie(name) as BookDB;
  // Yayımlanmış sürümlerin tanımı değiştirilmez: yeni tablo ya da dizin yeni bir sürümle eklenir.
  db.version(1).stores({
    books: 'id, addedAt, lastOpenedAt',
    files: 'bookId',
    covers: 'bookId',
    contents: 'bookId',
    progress: 'bookId',
  });
  db.version(2).stores({
    layouts: '[bookId+signature], bookId, usedAt',
  });
  db.version(3).stores({
    annotations: '++id, [bookId+page], bookId, updatedAt',
  });
  db.version(4).stores({
    bookmarks: '++id, [bookId+pdfPage], bookId, createdAt',
  });
  return db;
}

export const db = createDb();
