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
  lang: string,
  t: Typography,
  box: PageBox | null,
): Locator[] | null {
  const [result, setResult] = useState<{ key: string; starts: Locator[] } | null>(null);
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
