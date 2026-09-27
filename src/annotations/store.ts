import { Dexie } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { db as appDb, type AnnotationRecord, type BookDB } from '../db/db';

/** Yeni işaret: anahtarı ve zamanları veritabanı verir */
export type NewAnnotation = Omit<AnnotationRecord, 'id' | 'createdAt' | 'updatedAt'>;

/** Kaydedilmiş işaret (anahtarı belli) */
export type SavedAnnotation = AnnotationRecord & { id: number };

/** İşareti ekler; anahtarıyla birlikte kaydı döndürür (geri alınabilsin) */
export async function addAnnotation(
  db: BookDB,
  input: NewAnnotation,
  now = Date.now(),
): Promise<SavedAnnotation> {
  const record: AnnotationRecord = { ...input, createdAt: now, updatedAt: now };
  // Anahtar otomatik artar (++id): eklenen kaydın anahtarı hep sayıdır
  const id = (await db.annotations.add(record)) as number;
  return { ...record, id };
}

/** Not metnini, rengi ya da noktaları değiştirir; değişen kayıt sayısını döndürür (0: işaret artık yok) */
export async function updateAnnotation(
  db: BookDB,
  id: number,
  patch: Partial<Pick<AnnotationRecord, 'text' | 'color' | 'points' | 'width'>>,
  now = Date.now(),
): Promise<number> {
  return db.annotations.update(id, { ...patch, updatedAt: now });
}

type DeletedListener = (ids: readonly number[]) => void;
const deletedListeners = new Set<DeletedListener>();

/**
 * Silinen işaretlerin anahtarlarını dinler. Sayfa katmanı, kaydı henüz okunmamış çizginin bekleyen kopyasını
 * bırakır: hemen geri alınan çizgi sayfada hayalet olarak kalmaz.
 */
export function onAnnotationsDeleted(listener: DeletedListener): () => void {
  deletedListeners.add(listener);
  return () => {
    deletedListeners.delete(listener);
  };
}

export async function deleteAnnotation(db: BookDB, id: number): Promise<void> {
  await deleteAnnotations(db, [id]);
}

/** İşaretleri birlikte siler (Notlar panelindeki kalem çizgisi öbeği) */
export async function deleteAnnotations(db: BookDB, ids: readonly number[]): Promise<void> {
  await db.annotations.bulkDelete([...ids]);
  deletedListeners.forEach((listener) => listener(ids));
}

/** Silinen işareti aynı anahtarla geri koyar (geri al): çizim sırası korunur */
export async function restoreAnnotation(db: BookDB, record: SavedAnnotation): Promise<void> {
  await db.annotations.put(record);
}

/** Silinen işaretleri birlikte geri koyar */
export async function restoreAnnotations(
  db: BookDB,
  records: readonly SavedAnnotation[],
): Promise<void> {
  await db.annotations.bulkPut([...records]);
}

/** Sayfanın işaretleri, eklenme sırasıyla (sonra eklenen üstte çizilir) */
export function pageAnnotations(db: BookDB, bookId: string, page: number) {
  return db.annotations.where('[bookId+page]').equals([bookId, page]).toArray() as Promise<
    SavedAnnotation[]
  >;
}

/** Kitabın bütün işaretleri: sayfa sırasıyla, sayfa içinde eklenme sırasıyla */
export function bookAnnotations(db: BookDB, bookId: string) {
  return db.annotations
    .where('[bookId+page]')
    .between([bookId, Dexie.minKey], [bookId, Dexie.maxKey])
    .toArray() as Promise<SavedAnnotation[]>;
}

/** Sayfanın işaretleri; değişince yeniden çizilir. undefined: okunuyor */
export function usePageAnnotations(bookId: string, page: number): SavedAnnotation[] | undefined {
  return useLiveQuery(() => pageAnnotations(appDb, bookId, page), [bookId, page]);
}

/** Kitabın bütün işaretleri (Notlar paneli). undefined: okunuyor */
export function useBookAnnotations(bookId: string): SavedAnnotation[] | undefined {
  return useLiveQuery(() => bookAnnotations(appDb, bookId), [bookId]);
}
