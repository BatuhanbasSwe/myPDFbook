import { useMemo } from 'react';
import type { Locator } from '../convert/types';
import type { BookRecord, ContentRecord } from '../db/db';
import { pageLayout, type Viewport } from '../layout/pageBox';
import { pageOf } from '../layout/paginator';
import type { Typography } from '../layout/typography';
import type { PdfDocument } from '../pdf/pdfjs';
import { BookPage } from './BookPage';
import { alignPage, type BookSource } from './FlipBook';
import { currentChapter } from './progress';
import { usePagination } from './usePagination';

interface Options {
  /** metin görünümü açık mı; kapalıyken sayfalanmaz */
  active: boolean;
  book: BookRecord;
  content: ContentRecord;
  /** kitabın sığacağı alan (null: henüz ölçülmedi) */
  area: Viewport | null;
  typography: Typography;
  /** okunan yer */
  anchor: Locator;
  onGo(anchor: Locator): void;
  pdf: PdfDocument | null;
  pdfFailed: boolean;
}

/**
 * Metin görünümü: kitap ekrana ve tipografiye göre sayfalanır. Okuma konumu (anchor) tek kaynaktır: sayfa ondan
 * hesaplanır, böylece yazı tipi, punto ya da ekran değişince aynı yerin bulunduğu sayfa açılır. null: sayfalar
 * hazırlanıyor (ya da görünüm kapalı).
 */
export function useTextBook({
  active,
  book,
  content,
  area,
  typography: t,
  anchor,
  onGo,
  pdf,
  pdfFailed,
}: Options): BookSource | null {
  const { blocks, chapters, version } = content;
  const wanted = useMemo(() => (active && area ? pageLayout(area, t) : null), [active, area, t]);
  const lang = bookLang(content.lang);
  // Ayar ya da ekran değişince yeni sayfalama hazır olana dek önceki (kendi yerleşimi ve tipografisiyle) çizilir.
  // Sayfalama kitabın kimliği ve metnin sürümüyle IndexedDB'de saklanır: yeniden açılışta ölçülmez.
  const paged = usePagination(blocks, lang, t, wanted, {
    bookId: book.id,
    contentVersion: version,
  });
  if (!active || !paged) return null;

  const { starts, layout } = paged;
  const step = layout.spread ? 2 : 1;
  const page = alignPage(pageOf(starts, anchor), step);
  return {
    count: starts.length,
    index: page,
    spread: layout.spread,
    pageWidth: layout.pageWidth,
    pageHeight: layout.pageHeight,
    // Çift sayfada iki sayfa numarası ("12–13")
    label: step === 2 && page + 1 < starts.length ? `${page + 1}–${page + 2}` : `${page + 1}`,
    total: starts.length,
    go: (p) => onGo(starts[Math.max(0, Math.min(starts.length - 1, p))]),
    slotOf: ({ locator }) => alignPage(pageOf(starts, locator), step),
    renderPage: (i) =>
      i < starts.length ? (
        <BookPage
          key={i}
          blocks={blocks}
          start={starts[i]}
          end={starts[i + 1]}
          layout={layout}
          typography={paged.typography}
          lang={lang}
          pageNumber={i + 1}
          runningHead={
            layout.spread && i % 2 === 0
              ? book.title
              : (chapters[currentChapter(chapters, starts[i])]?.title ?? book.title)
          }
          side={layout.spread ? (i % 2 === 0 ? 'left' : 'right') : 'single'}
          // Görünen ve komşu sayfalar: taranmış sayfanın görseli çevirmeden önce hazır olsun
          eager={i >= page - step && i < page + 2 * step}
          pdf={pdf}
          pdfFailed={pdfFailed}
        />
      ) : null,
  };
}

/** Heceleme ve ekran okuyucu için dil ("": bilinmiyor) */
function bookLang(lang: ContentRecord['lang']): string {
  return lang === 'other' ? '' : lang;
}
