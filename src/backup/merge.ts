import { CONVERTER_VERSION } from '../convert/types';
import type { AnnotationRecord, BookRecord, ProgressRecord } from '../db/db';
import type { BackupAnnotation, BackupBook, BackupBookmark } from './format';

/**
 * Birleştirme kuralları (yedek → cihaz). Saf fonksiyonlar: veritabanı işlemi importBackup'tadır.
 * - Kitap: kimliği PDF'in SHA-256'sı, her cihazda aynı. Yoksa eklenir; varsa daha yakın zamanda açılmış olanın
 *   başlığı, yazarı ve okuma durumu kalır.
 * - Okuma yeri: `updatedAt` büyük olan kalır.
 * - İşaret: anahtarı cihaza özel bir sayıdır. Aynı işaret, oluşturulma anıyla tanınır (kitap + sayfa + tür +
 *   createdAt; yedekte korunur); daha yeni düzenlenmiş olan kalır. İçeriği birebir aynı olan işaret (parmak izi)
 *   de yeniden eklenmez.
 * - Yer imi: kitap + PDF sayfası başına bir tane.
 * Silmeler taşınmaz: bir cihazda silinen işaret, onu hâlâ tutan cihazın yedeğinden geri gelir.
 */

/** Koordinatlar bu hassasiyetle karşılaştırılır (sayfanın on binde biri): kayan nokta farkları ikileşme yaratmasın */
const PRECISION = 1e4;

const round = (v: number) => Math.round(v * PRECISION);

/** 32 bit FNV-1a: noktaların kısa özeti */
function fnv1a(values: readonly number[]): string {
  let h = 0x811c9dc5;
  for (const v of values) {
    let x = v | 0;
    for (let k = 0; k < 4; k++) {
      h ^= x & 0xff;
      h = Math.imul(h, 0x01000193);
      x >>>= 8;
    }
  }
  return (h >>> 0).toString(16);
}

/** İçerik parmak izi: kitap + sayfa + tür + renk + kalınlık + yuvarlanmış noktaların özeti (+ not metni) */
export function annotationFingerprint(a: BackupAnnotation): string {
  const points = a.points.map(round);
  return [
    a.bookId,
    a.page,
    a.kind,
    a.color.toLowerCase(),
    round(a.width),
    points.length,
    fnv1a(points),
    a.kind === 'note' ? (a.text ?? '') : '',
  ].join('|');
}

/** Aynı işaretin (düzenlense de) kimliği: oluşturulma anı yedekte korunur */
export const annotationIdentity = (a: BackupAnnotation) =>
  `${a.bookId}|${a.page}|${a.kind}|${a.createdAt}`;

export interface AnnotationPlan {
  add: BackupAnnotation[];
  /** cihazdaki işaret, yedekteki daha yeni düzenlemesiyle güncellenir */
  update: {
    id: number;
    changes: Pick<AnnotationRecord, 'color' | 'width' | 'points' | 'text' | 'updatedAt'>;
  }[];
}

/** Yedekteki işaretlerden hangilerinin ekleneceği ve hangilerinin cihazdakini güncelleyeceği */
export function planAnnotations(
  device: readonly AnnotationRecord[],
  incoming: readonly BackupAnnotation[],
): AnnotationPlan {
  const fingerprints = new Set(device.map(annotationFingerprint));
  // Aynı anda oluşturulmuş birden çok işaret varsa (cihazda ya da yedekte) kimlik belirsizdir: yalnızca parmak izi
  // kullanılır. Yoksa yedekteki ikinci işaret, cihazdaki birinciyi "düzenlemesi" sanılıp üzerine yazılırdı.
  const byIdentity = new Map<string, AnnotationRecord | null>();
  for (const a of device) {
    const key = annotationIdentity(a);
    byIdentity.set(key, byIdentity.has(key) ? null : a);
  }
  const seen = new Set<string>();
  for (const a of incoming) {
    const key = annotationIdentity(a);
    if (seen.has(key)) byIdentity.set(key, null);
    seen.add(key);
  }
  const plan: AnnotationPlan = { add: [], update: [] };
  for (const a of incoming) {
    const fingerprint = annotationFingerprint(a);
    const same = byIdentity.get(annotationIdentity(a));
    if (same && same.id !== undefined) {
      if (a.updatedAt > same.updatedAt && fingerprint !== annotationFingerprint(same)) {
        const changes = {
          color: a.color,
          width: a.width,
          points: a.points,
          text: a.text,
          updatedAt: a.updatedAt,
        };
        plan.update.push({ id: same.id, changes });
        byIdentity.set(annotationIdentity(a), { ...same, ...changes });
        fingerprints.add(fingerprint);
      }
      continue;
    }
    if (fingerprints.has(fingerprint)) continue;
    fingerprints.add(fingerprint);
    plan.add.push(a);
    // Yedekte aynı kimlikli iki kayıt varsa ikincisi de kimlikle eşleşmesin (ikisi de eklenir)
    byIdentity.set(annotationIdentity(a), null);
  }
  return plan;
}

/** Yedekteki yer imlerinden cihazda (kitap + PDF sayfası) olmayanlar; yedeğin kendi içindeki ikiler de atlanır */
export function planBookmarks(
  device: readonly { bookId: string; pdfPage: number }[],
  incoming: readonly BackupBookmark[],
): BackupBookmark[] {
  const taken = new Set(device.map((b) => `${b.bookId}|${b.pdfPage}`));
  return incoming.filter((b) => {
    const key = `${b.bookId}|${b.pdfPage}`;
    if (taken.has(key)) return false;
    taken.add(key);
    return true;
  });
}

/** Yedekteki okuma yeri cihazdakinden yeniyse onu döndürür */
export function newerProgress(
  device: ProgressRecord | undefined,
  incoming: ProgressRecord,
): ProgressRecord | null {
  return !device || incoming.updatedAt > device.updatedAt ? incoming : null;
}

/**
 * Cihazda olmayan kitabın kaydı: PDF'i henüz yok ("PDF bekleniyor"; PDF yedekten ya da sonradan eklenince
 * silinir), dönüştürülmemiş (metin yedekten gelirse ya da PDF'ten dönüştürülünce "hazır" olur).
 */
export function newBookRecord(b: BackupBook): BookRecord {
  return {
    ...b,
    convert: { state: 'pending', progress: 0, version: CONVERTER_VERSION },
    pdfMissing: true,
  };
}

/**
 * Cihazdaki kitabın yedekle güncellenen alanları (değişiklik yoksa null). Daha yakın zamanda açılmış kaydın
 * başlığı, yazarı ve okuma durumu kalır; son açılma en yeni, başlama ve eklenme en eskidir. Dönüştürme durumu,
 * dil ve kelime sayısı cihazın kendi metnine aittir, değişmez.
 */
export function mergeBook(device: BookRecord, incoming: BackupBook): Partial<BookRecord> | null {
  const changes: Partial<BookRecord> = {};
  if ((incoming.lastOpenedAt ?? 0) > (device.lastOpenedAt ?? 0)) {
    changes.lastOpenedAt = incoming.lastOpenedAt;
    if (incoming.title !== device.title) changes.title = incoming.title;
    if (incoming.author !== device.author) changes.author = incoming.author;
    if (incoming.readingStatus !== device.readingStatus)
      changes.readingStatus = incoming.readingStatus;
  }
  if (incoming.startedAt !== undefined && incoming.startedAt < (device.startedAt ?? Infinity))
    changes.startedAt = incoming.startedAt;
  if (incoming.addedAt < device.addedAt) changes.addedAt = incoming.addedAt;
  if (device.password === undefined && incoming.password !== undefined)
    changes.password = incoming.password;
  return Object.keys(changes).length ? changes : null;
}
