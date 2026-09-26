import { useEffect, useState } from 'react';
import type { Block, Locator } from '../convert/types';
import { paginate, type PageBox } from '../layout/paginator';
import { FONT_FAMILIES, typographyStyle, type Typography } from '../layout/typography';

/** Türkçe harfleri de içeren örnek: yazı tipinin gerekli alt kümeleri ölçümden önce yüklensin */
const SAMPLE = 'Aa ğüşıöç ĞÜŞİÖÇ “—”';

/**
 * Kitabı verilen sayfa kutusuna ve tipografiye göre sayfalar; null = hesaplanıyor. Ölçüm, yazı tipi yüklendikten
 * sonra ekran dışındaki bir kutuda yapılır (yoksa sayfa sınırları yedek yazı tipine göre çıkar).
 */
export function usePagination(
  blocks: Block[],
  t: Typography,
  box: PageBox | null,
): Locator[] | null {
  const [result, setResult] = useState<{ key: string; starts: Locator[] } | null>(null);
  const key = box ? `${JSON.stringify(t)}|${box.width}x${box.height}` : '';

  useEffect(() => {
    if (!box) return; // okuma alanı henüz ölçülmedi
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
      Object.assign(host.style, {
        position: 'absolute',
        left: '-100000px',
        top: '0',
        width: `${box.width}px`,
        visibility: 'hidden',
      });
      for (const [k, v] of Object.entries(typographyStyle(t))) host.style.setProperty(k, v);
      document.body.append(host);
      try {
        const starts = paginate(host, blocks, box);
        if (!cancelled) setResult({ key, starts });
      } finally {
        host.remove();
      }
    })();
    return () => {
      cancelled = true;
    };
    // key tipografiyi ve kutuyu kapsar (nesne kimlikleri her çizimde değişebilir)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, key]);

  return box && result && result.key === key ? result.starts : null;
}
