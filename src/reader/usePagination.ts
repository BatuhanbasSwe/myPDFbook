import { useEffect, useMemo, useState } from 'react';
import type { Block, Locator } from '../convert/types';
import type { PageLayout } from '../layout/pageBox';
import { paginate } from '../layout/paginator';
import { FONT_FAMILIES, typographyStyle, type Typography } from '../layout/typography';

/** Türkçe harfleri de içeren örnek: yazı tipinin gerekli alt kümeleri ölçümden önce yüklensin */
const SAMPLE = 'Aa ğüşıöç ĞÜŞİÖÇ “—”';
/** Kitap başına saklanan en fazla sayfalama (ayarı geri alınca ya da ekran geri dönünce yeniden ölçülmesin) */
const CACHE_MAX = 8;

/** Sayfalamalar kitabın metnine (bloklar) ve sayfalama anahtarına göre bellekte tutulur */
const cache = new WeakMap<Block[], Map<string, Locator[]>>();

function remember(blocks: Block[], key: string, starts: Locator[]) {
  let byKey = cache.get(blocks);
  if (!byKey) cache.set(blocks, (byKey = new Map()));
  byKey.delete(key);
  byKey.set(key, starts);
  // En eski sayfalama atılır (Map ekleme sırasını korur)
  if (byKey.size > CACHE_MAX) byKey.delete(byKey.keys().next().value!);
}

/** Sayfa sınırları ve onların hesaplandığı yerleşim ile tipografi: sayfalar hep bu üçlüyle birlikte çizilir */
export interface Pagination {
  starts: Locator[];
  layout: PageLayout;
  typography: Typography;
}

/**
 * Kitabı verilen yerleşime ve tipografiye göre sayfalar; null = ilk sayfalama hesaplanıyor. Ayar ya da ekran
 * değişince yenisi hazır olana dek öncekinin üçlüsü döner (kitap kaybolmaz). Ölçüm, yazı tipi yüklendikten sonra
 * ekran dışındaki bir kutuda yapılır (yoksa sayfa sınırları yedek yazı tipine göre çıkar).
 */
export function usePagination(
  blocks: Block[],
  lang: string,
  t: Typography,
  layout: PageLayout | null,
): Pagination | null {
  const box = layout?.box ?? null;
  // Yalnızca satır kırılımını etkileyen ayarlar (kenar boşluğu ve çift sayfa kutuyu değiştirir, kutu zaten anahtarda)
  const key = box
    ? [
        lang,
        t.font,
        t.size,
        t.lineHeight,
        t.align,
        t.hyphenate,
        box.width,
        box.height,
        box.sink,
      ].join('|')
    : '';
  const hit = box ? cache.get(blocks)?.get(key) : undefined;
  const fresh = useMemo(
    () => (hit && layout ? { starts: hit, layout, typography: t } : null),
    [hit, layout, t],
  );
  // Son gösterilen üçlü: yenisi hesaplanırken o gösterilir
  const [shown, setShown] = useState<Pagination | null>(null);
  if (fresh && fresh !== shown) setShown(fresh);
  // Hesap bitince yeniden çizim (sonuç önbellekte)
  const [, setDone] = useState(0);

  useEffect(() => {
    if (!box || hit) return; // okuma alanı henüz ölçülmedi ya da bu sayfalama zaten var
    let cancelled = false;
    void (async () => {
      try {
        await document.fonts.load(`${t.size}px ${FONT_FAMILIES[t.font]}`, SAMPLE);
        await document.fonts.ready;
      } catch {
        // yazı tipi yüklenemedi: yedek yazı tipiyle ölçülür (çizimde de o kullanılır)
      }
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
      try {
        remember(blocks, key, paginate(host, blocks, box));
        if (!cancelled) setDone((n) => n + 1);
      } finally {
        host.remove();
      }
    })();
    return () => {
      cancelled = true;
    };
    // key tipografiyi ve kutuyu kapsar (nesne kimlikleri her çizimde değişebilir)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, key, !!hit]);

  return fresh ?? shown;
}
