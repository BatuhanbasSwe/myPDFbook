import { Dexie, type EntityTable, type Table } from 'dexie';
import type { BookContent, Lang, Locator } from '../convert/types';

export type ConvertState = 'pending' | 'running' | 'done' | 'failed';
export type ReadingStatus = 'unread' | 'reading' | 'finished' | 'abandoned';

/** Kitap günlüğünün okurca düzenlenen alanları */
export const JOURNAL_FIELDS = [
  'readingStatus',
  'startedAt',
  'finishedAt',
  'rating',
  'review',
] as const;
export type JournalField = (typeof JOURNAL_FIELDS)[number];
/** Alan başına son düzenleme anı (ms) */
export type JournalEdits = Partial<Record<JournalField, number>>;

export interface BookRecord {
  /** Dosya içeriğinin SHA-256 özeti: aynı PDF iki kez eklenmez; ileride senkron için sabit kimlik. */
  id: string;
  title: string;
  author: string;
  fileName: string;
  fileSize: number;
  pdfPageCount: number;
  lang: Lang;
  /**
   * Şifreli PDF'ler için. Bu cihazda düz metin olarak saklanır ve hiçbir sunucuya gönderilmez. Kullanıcının aldığı
   * yedek dosyasına (varsayılan olarak) girer (bkz. backup/): başka cihazda PDF'in açılabilmesi için gerekir. Girmezse
   * kitap başka cihazda açılırken şifreyi sorar.
   */
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
  /** Kitap günlüğü (bkz. journal/): okunacak, okunuyor, bitti, yarım bırakıldı */
  readingStatus: ReadingStatus;
  /** başlama tarihi: ilk açılışta yazılır, günlükte değiştirilebilir */
  startedAt?: number;
  /** bitiş tarihi: "Bitti" seçilince bugün; günlükte değiştirilebilir */
  finishedAt?: number;
  /** puan: 0,5–5, yarım adımlı (yoksa puanlanmamış) */
  rating?: number;
  /** inceleme ve notlar (günlük) */
  review?: string;
  /**
   * Günlük alanlarının okurca değiştirildiği anlar (alan başına; bkz. journal/journal.ts). Kendiliğinden yazılan
   * değerin (ilk açılışta başlama tarihi ve "okunuyor") anı yoktur. Alanın anı var ama değeri yoksa okur onu
   * temizlemiştir: yeniden doldurulmaz, yedekle öteki cihaza da temizlik olarak gider. Yedek birleştirilirken her
   * alanda daha yeni düzenleme kazanır.
   */
  journalEdits?: JournalEdits;
  /** Son sayfada "Kitabı bitirdin mi?" bir daha sorulmaz (Evet ya da iki kez "Henüz değil"; cihaza özel) */
  finishAsked?: boolean;
  /** "Henüz değil" yanıtlarının sayısı (cihaza özel, yedeğe girmez) */
  finishDeclined?: number;
  totalWords: number;
  /**
   * PDF'siz yedekten geldi: kaydı, notları ve (varsa) metni cihazda, PDF'i yok. Aynı PDF (aynı SHA-256)
   * eklenince silinir. Bu durumda kitap açılmaz ve dönüştürülmez. İndeksli değil: şema sürümü gerekmez.
   */
  pdfMissing?: boolean;
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

/**
 * Okuma oturumu (bkz. stats/sessionTracker): okuyucunun açık ve okurun etkin olduğu kesintisiz süre. Kimlik rastgele
 * metindir: yedekte cihazlar arasında aynı kalır, aynı oturum iki kez eklenmez. Kitap silinince oturumları kalır
 * (okuma geçmişi; toplamlar değişmez).
 */
export interface SessionRecord {
  id: string;
  bookId: string;
  /** başlangıç ve bitiş anı (ms) */
  start: number;
  end: number;
  /** okunan süre (ms; 2 dk'dan kısa duraklar dahil) */
  activeMs: number;
  /** oturumda yeni açılan PDF sayfaları (açılıştaki sayfa sayılmaz) */
  pages: number;
  /** o sayfaların kelimeleri (yaklaşık; metinsiz sayfada 0) */
  words: number;
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
  sessions: EntityTable<SessionRecord, 'id'>;
};

/**
 * Birincil anahtarı kitap kimliği olan tablolar; kitap silinirken `delete(id)` ile temizlenir. Kitaba bağlı yeni
 * tablonun anahtarı kitap kimliğiyse buraya ekle; değilse (ör. `layouts`, `annotations`, `bookmarks`) deleteBook onu
 * `where('bookId')` ile siler.
 */
export const BOOK_TABLES = ['books', 'files', 'covers', 'contents', 'progress'] as const;

/**
 * Şemanın sürümleri, sırayla. Yayımlanmış sürümlerin tanımı değiştirilmez: yeni tablo ya da dizin yeni bir sürümle
 * eklenir. (Testler eski sürümlü veritabanını ilk sürümlerle kurar.)
 */
export const SCHEMA: readonly Record<string, string>[] = [
  {
    books: 'id, addedAt, lastOpenedAt',
    files: 'bookId',
    covers: 'bookId',
    contents: 'bookId',
    progress: 'bookId',
  },
  { layouts: '[bookId+signature], bookId, usedAt' },
  { annotations: '++id, [bookId+page], bookId, updatedAt' },
  { bookmarks: '++id, [bookId+pdfPage], bookId, createdAt' },
  // 5: okuma oturumları. Günlük alanları kitap kaydında, dizinsiz: kitaplar değişmez.
  { sessions: 'id, bookId, start' },
];

export function createDb(name = 'mypdfbook', versions = SCHEMA.length): BookDB {
  const db = new Dexie(name) as BookDB;
  SCHEMA.slice(0, versions).forEach((stores, i) => db.version(i + 1).stores(stores));
  return db;
}

export const db = createDb();
