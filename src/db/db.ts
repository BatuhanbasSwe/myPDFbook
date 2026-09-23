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
  /** Kapak görseli (data URL); yoksa arayüz renkli kapak çizer. */
  cover?: string;
  /** Şifreli PDF'ler için; yalnızca bu cihazda saklanır. */
  password?: string;
  addedAt: number;
  lastOpenedAt?: number;
  convert: { state: ConvertState; progress: number; version: number; error?: string };
  readingStatus: ReadingStatus;
  startedAt?: number;
  totalWords: number;
}

export interface FileRecord {
  bookId: string;
  blob: Blob;
}

export interface ContentRecord extends BookContent {
  bookId: string;
}

export interface ProgressRecord {
  bookId: string;
  locator: Locator;
  percent: number;
  updatedAt: number;
}

export type BookDB = Dexie & {
  books: EntityTable<BookRecord, 'id'>;
  files: EntityTable<FileRecord, 'bookId'>;
  contents: EntityTable<ContentRecord, 'bookId'>;
  progress: EntityTable<ProgressRecord, 'bookId'>;
};

export function createDb(name = 'mypdfbook'): BookDB {
  const db = new Dexie(name) as BookDB;
  db.version(1).stores({
    books: 'id, addedAt, lastOpenedAt',
    files: 'bookId',
    contents: 'bookId',
    progress: 'bookId',
  });
  return db;
}

export const db = createDb();
