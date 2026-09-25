import { Dexie, type EntityTable } from 'dexie';
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
  /** attempts: yarıda kalabilen dönüştürme denemelerinin sayısı (bitince silinir). */
  convert: {
    state: ConvertState;
    progress: number;
    version: number;
    error?: string;
    attempts?: number;
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
}

export type BookDB = Dexie & {
  books: EntityTable<BookRecord, 'id'>;
  files: EntityTable<FileRecord, 'bookId'>;
  covers: EntityTable<CoverRecord, 'bookId'>;
  contents: EntityTable<ContentRecord, 'bookId'>;
  progress: EntityTable<ProgressRecord, 'bookId'>;
};

/** Kitaba bağlı tüm tablolar; kitap silinirken hepsi temizlenir. Yeni tablo eklenince buraya da ekle. */
export const BOOK_TABLES = ['books', 'files', 'covers', 'contents', 'progress'] as const;

export function createDb(name = 'mypdfbook'): BookDB {
  const db = new Dexie(name) as BookDB;
  db.version(1).stores({
    books: 'id, addedAt, lastOpenedAt',
    files: 'bookId',
    covers: 'bookId',
    contents: 'bookId',
    progress: 'bookId',
  });
  return db;
}

export const db = createDb();
