import type { Locator } from '../convert/types';
import type { BookDB } from '../db/db';
import { PAGINATOR_VERSION, type PageBox } from './paginator';
import type { Typography } from './typography';

/**
 * Sayfalama önbelleği: hesaplanan sayfa sınırları IndexedDB'de saklanır, kitap yeniden açılınca ölçülmeden
 * kullanılır. Önbellek isteğe bağlıdır: IndexedDB hatası (ör. yer kalmaması, gizli sekme) sessizce yutulur, o
 * zaman kitap yeniden sayfalanır.
 */

/** Kitap başına saklanan en fazla sayfalama (ör. iki yön × birkaç punto) */
export const LAYOUTS_PER_BOOK = 8;

export type Engine = 'webkit' | 'blink' | 'gecko';

/**
 * Tarayıcı motoru: satır kırılımı ve heceleme motora göre değişir. iOS'taki bütün tarayıcılar (Chrome, Firefox da)
 * WebKit kullanır; iPad masaüstü kipinde kendini Mac Safari olarak tanıtır (yine WebKit).
 */
export function engineToken(
  ua = typeof navigator === 'undefined' ? '' : (navigator.userAgent ?? ''),
): Engine {
  if (/\b(iPhone|iPad|iPod)\b|CriOS|FxiOS|EdgiOS/.test(ua)) return 'webkit';
  if (/Firefox\//.test(ua)) return 'gecko';
  if (/Chrome\/|Chromium\//.test(ua)) return 'blink';
  if (/AppleWebKit\//.test(ua)) return 'webkit';
  return 'blink';
}

export interface SignatureInput {
  lang: string;
  typography: Typography;
  box: PageBox;
  contentVersion: number;
  /** yoksa bu tarayıcının motoru */
  engine?: Engine;
}

/**
 * Sayfalamanın anahtarı: sayfa sınırlarını değiştirebilen her şey. Kenar boşluğu ve tek/çift sayfa ayarı kutuyu
 * değiştirdiği için ayrıca girmez.
 */
export function layoutSignature({
  lang,
  typography: t,
  box,
  contentVersion,
  engine = engineToken(),
}: SignatureInput): string {
  return [
    `p${PAGINATOR_VERSION}`,
    engine,
    lang,
    t.font,
    t.size,
    t.lineHeight,
    t.align,
    t.hyphenate ? 'h' : '-',
    box.width,
    box.height,
    box.sink,
    `c${contentVersion}`,
  ].join('|');
}

/** Kayıtlı sayfalama (yoksa ya da okunamazsa undefined); son kullanım zamanı güncellenir. */
export async function loadLayout(
  db: BookDB,
  bookId: string,
  signature: string,
  now = Date.now(),
): Promise<Locator[] | undefined> {
  try {
    const record = await db.layouts.get([bookId, signature]);
    if (!record || !Array.isArray(record.starts)) return undefined;
    await db.layouts.update([bookId, signature], { usedAt: now }).catch(() => undefined);
    return record.starts;
  } catch {
    return undefined;
  }
}

/** Sayfalamayı yazar; kitabın kayıtları LAYOUTS_PER_BOOK'u aşarsa en uzun süredir kullanılmayanlar silinir. */
export async function saveLayout(
  db: BookDB,
  bookId: string,
  signature: string,
  starts: Locator[],
  now = Date.now(),
): Promise<void> {
  try {
    await db.transaction('rw', db.layouts, async () => {
      await db.layouts.put({ bookId, signature, starts, usedAt: now });
      const records = await db.layouts.where('bookId').equals(bookId).sortBy('usedAt');
      // Az önce yazılan hiç silinmez (aynı zamanlı kayıtlar olabilir)
      const others = records.filter((r) => r.signature !== signature);
      const excess = records.length - LAYOUTS_PER_BOOK;
      if (excess > 0)
        await db.layouts.bulkDelete(
          others.slice(0, excess).map((r): [string, string] => [r.bookId, r.signature]),
        );
    });
  } catch {
    // önbellek isteğe bağlı: yazılamazsa bir dahaki açılışta yeniden sayfalanır
  }
}
