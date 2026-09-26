import { useEffect, useMemo, useState } from 'react';
import type { Block, Locator } from '../convert/types';
import { db } from '../db/db';
import { layoutSignature, loadLayout, saveLayout } from '../layout/layoutCache';
import type { PageLayout } from '../layout/pageBox';
import { paginate } from '../layout/paginator';
import { FONT_FAMILIES, typographyStyle, type Typography } from '../layout/typography';

/** Türkçe harfleri de içeren örnek: yazı tipinin gerekli alt kümeleri ölçümden önce yüklensin */
const SAMPLE = 'Aa ğüşıöç ĞÜŞİÖÇ “—”';
/** Kitap başına saklanan en fazla sayfalama (ayarı geri alınca ya da ekran geri dönünce yeniden ölçülmesin) */
const CACHE_MAX = 8;

/** Sayfalamalar kitabın metnine (bloklar) ve sayfalama anahtarına göre bellekte tutulur */
const memoryCache = new WeakMap<Block[], Map<string, Locator[]>>();

function remember(blocks: Block[], key: string, starts: Locator[]) {
  let byKey = memoryCache.get(blocks);
  if (!byKey) memoryCache.set(blocks, (byKey = new Map()));
  byKey.delete(key);
  byKey.set(key, starts);
  // En eski sayfalama atılır (Map ekleme sırasını korur)
  if (byKey.size > CACHE_MAX) byKey.delete(byKey.keys().next().value!);
}

/**
 * IndexedDB'den gelen sayfalama bu kitaba uyuyor mu: ilk sayfa baştan başlar, konumlar artan sırada ve blokların
 * içinde (bozuk ya da yanlış kitaba ait kayıt kullanılmaz, yeniden sayfalanır).
 */
function fits(starts: Locator[], blocks: Block[]): boolean {
  if (starts.length === 0 || starts[0].block !== 0 || starts[0].offset !== 0) return false;
  const last = Math.max(1, blocks.length);
  return starts.every(
    (s, i) =>
      Number.isInteger(s?.block) &&
      Number.isInteger(s.offset) &&
      s.block < last &&
      s.offset >= 0 &&
      (i === 0 ||
        s.block > starts[i - 1].block ||
        (s.block === starts[i - 1].block && s.offset > starts[i - 1].offset)),
  );
}

/** Ölçümden önce yazı tipi (yüklenemezse yedek yazı tipiyle ölçülür; çizimde de o kullanılır) */
async function fontsLoaded(t: Typography): Promise<void> {
  try {
    await document.fonts.load(`${t.size}px ${FONT_FAMILIES[t.font]}`, SAMPLE);
    await document.fonts.ready;
  } catch {
    // yedek yazı tipi
  }
}

/** Sayfa sınırları ve onların hesaplandığı yerleşim ile tipografi: sayfalar hep bu üçlüyle birlikte çizilir */
export interface Pagination {
  starts: Locator[];
  layout: PageLayout;
  typography: Typography;
}

/** Kalıcı önbellek için kitap kimliği ve metnin sürümü (bloklar sürümle değişir) */
export interface PaginationCache {
  bookId: string;
  contentVersion: number;
}

/**
 * Kitabı verilen yerleşime ve tipografiye göre sayfalar; null = ilk sayfalama hesaplanıyor. Ayar ya da ekran
 * değişince yenisi hazır olana dek öncekinin üçlüsü döner (kitap kaybolmaz).
 *
 * Arama sırası: bellek → IndexedDB (`cache` verilmişse) → ölçüm. Ölçüm, yazı tipi yüklendikten sonra ekran
 * dışındaki bir kutuda yapılır (yoksa sayfa sınırları yedek yazı tipine göre çıkar); sonuç IndexedDB'ye yazılır.
 * IndexedDB'den gelen sayfalama yazı tipini beklemez: çizim zaten o yazı tipiyle yapılır.
 */
export function usePagination(
  blocks: Block[],
  lang: string,
  t: Typography,
  layout: PageLayout | null,
  cache?: PaginationCache,
): Pagination | null {
  const box = layout?.box ?? null;
  const bookId = cache?.bookId;
  // Anahtar bellekte ve IndexedDB'de aynı: satır kırılımını etkileyen ayarlar, kutu, motor ve metin sürümü (bkz.
  // layoutSignature; kenar boşluğu ve çift sayfa kutuyu değiştirir, kutu zaten anahtarda)
  const key = box
    ? layoutSignature({ lang, typography: t, box, contentVersion: cache?.contentVersion ?? 0 })
    : '';
  const hit = box ? memoryCache.get(blocks)?.get(key) : undefined;
  const fresh = useMemo(
    () => (hit && layout ? { starts: hit, layout, typography: t } : null),
    [hit, layout, t],
  );
  // Son gösterilen üçlü: yenisi hesaplanırken o gösterilir
  const [shown, setShown] = useState<Pagination | null>(null);
  if (fresh && fresh !== shown) setShown(fresh);
  // Sonuç gelince yeniden çizim (sonuç bellekte, kendi anahtarıyla: eski bir sonuç yeni ayara karışmaz)
  const [, setDone] = useState(0);

  useEffect(() => {
    if (!box || hit) return; // okuma alanı henüz ölçülmedi ya da bu sayfalama zaten var
    let cancelled = false;
    void (async () => {
      // Yazı tipi, IndexedDB okunurken yüklenmeye başlar (kayıt yoksa beklenmesin)
      const fonts = fontsLoaded(t);
      if (bookId !== undefined) {
        const stored = await loadLayout(db, bookId, key);
        if (stored && fits(stored, blocks)) {
          remember(blocks, key, stored);
          if (!cancelled) setDone((n) => n + 1);
          return;
        }
        if (cancelled) return;
      }
      await fonts;
      if (cancelled) return;
      const host = document.createElement('div');
      host.className = 'book-page-content';
      host.setAttribute('aria-hidden', 'true');
      host.lang = lang; // heceleme dile bağlı; sayfa görünümü de aynı dili taşır
      Object.assign(host.style, {
        position: 'absolute',
        left: '-100000px',
        top: '0',
        visibility: 'hidden',
      });
      for (const [k, v] of Object.entries(typographyStyle(t))) host.style.setProperty(k, v);
      document.body.append(host);
      let starts: Locator[];
      try {
        starts = paginate(host, blocks, box);
      } finally {
        host.remove();
      }
      remember(blocks, key, starts);
      if (!cancelled) setDone((n) => n + 1);
      if (bookId !== undefined) void saveLayout(db, bookId, key, starts);
    })();
    return () => {
      cancelled = true;
    };
    // key tipografiyi, kutuyu ve içerik sürümünü kapsar (nesne kimlikleri her çizimde değişebilir)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, key, bookId, !!hit]);

  return fresh ?? shown;
}
