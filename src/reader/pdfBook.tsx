import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnnotationLayer } from '../annotations/AnnotationLayer';
import type { Viewport } from '../layout/pageBox';
import { DEFAULT_ASPECT, pdfPageLayout } from '../layout/pdfPageBox';
import type { Spread } from '../layout/typography';
import type { PdfDocument } from '../pdf/pdfjs';
import { alignPage, type BookSource } from './FlipBook';
import { PageImage } from './PageImage';

interface Options {
  /** sayfa görünümü açık mı */
  active: boolean;
  pdf: PdfDocument | null;
  pdfFailed: boolean;
  /** PDF'in sayfa sayısı */
  pageCount: number;
  /** kitabın sığacağı alan (null: henüz ölçülmedi) */
  area: Viewport | null;
  spread: Spread;
  /** açık PDF sayfası (0'dan; çift sayfada soldaki ya da tek başına duran kapak) */
  pdfPage: number;
  onGo(pdfPage: number): void;
  /** sayfanın üstüne çizilen katman, PDF sayfasına göre (okunan cümlenin vurgusu) */
  overlays?: ReadonlyMap<number, ReactNode>;
}

/**
 * Sayfa görünümü: PDF'in kendi sayfaları görüntü olarak çevrilir. Çift sayfada kitaptaki gibi tek sayfalar sağda
 * durur: kapak tek başına sağdadır, önündeki yuva boştur (basılı kitapta karşılıklı sayfalar da böylece yan yana
 * gelir). null: belge açılıyor (ya da görünüm kapalı).
 */
export function usePdfBook({
  active,
  pdf,
  pdfFailed,
  pageCount,
  area,
  spread,
  pdfPage,
  onGo,
  overlays,
}: Options): BookSource | null {
  const aspect = usePageAspect(pdf);
  const layout = useMemo(
    () => (active && area && aspect ? pdfPageLayout(area, aspect, spread) : null),
    [active, area, aspect, spread],
  );
  if (!layout || pageCount === 0) return null;

  const step = layout.spread ? 2 : 1;
  // Çift sayfada baştaki boş yuva: yuva i'de PDF sayfası i - offset durur
  const offset = layout.spread ? 1 : 0;
  const index = alignPage(pdfPage + offset, step);
  const shown = [index - offset, index - offset + 1]
    .slice(0, step)
    .filter((p) => p >= 0 && p < pageCount);
  const { pageWidth, pageHeight } = layout;
  return {
    count: pageCount + offset,
    index,
    spread: layout.spread,
    pageWidth,
    pageHeight,
    label: shown.map((p) => p + 1).join('–'),
    total: pageCount,
    go: (i) => onGo(Math.max(0, Math.min(pageCount - 1, i - offset))),
    slotOf: ({ pdfPage: p }) => (p === null ? null : alignPage(p + offset, step)),
    renderPage: (i) => {
      const p = i - offset;
      if (p < 0 || p >= pageCount)
        return (
          <div
            key={i}
            className="pdf-page pdf-page-blank"
            style={{ width: pageWidth, height: pageHeight }}
          />
        );
      return (
        <PdfPage
          key={i}
          pdf={pdf}
          failed={pdfFailed}
          pageIndex={p}
          width={pageWidth}
          height={pageHeight}
          side={layout.spread ? (i % 2 === 0 ? 'left' : 'right') : 'single'}
          // Açık sayfa ve iki yanındaki ikişer sayfa önceden çizilir (çift sayfada önceki ve sonraki açılış);
          // uzaktakiler boş kalır (bellek)
          eager={i >= index - 2 && i < index + step + 2}
          overlay={overlays?.get(p)}
        />
      );
    },
  };
}

/**
 * PDF sayfası: görüntü, üstünde işaretler (boyama, kalem, not) ve cilt gölgesi (book.css → .pdf-page). Yalnızca
 * kitabın çizdiği sayfalar (açık sayfa ve komşuları) kurulur: işaret katmanı da yalnızca onlarda vardır.
 */
const PdfPage = memo(function PdfPage({
  pdf,
  failed,
  pageIndex,
  width,
  height,
  side,
  eager,
  overlay,
}: {
  pdf: PdfDocument | null;
  failed: boolean;
  pageIndex: number;
  width: number;
  height: number;
  side: 'left' | 'right' | 'single';
  eager: boolean;
  overlay?: ReactNode;
}) {
  return (
    <div
      className={`pdf-page book-page-${side}`}
      style={{ width, height }}
      data-pdf-page={pageIndex + 1}
    >
      {/* Çizim genişliği sayfa kutusunun genişliği (PageImage cihaz piksel oranıyla, en çok 2 kat çizer) */}
      <PageImage pdf={pdf} failed={failed} pageIndex={pageIndex} fill eager={eager} width={width} />
      {overlay}
      <AnnotationLayer page={pageIndex} width={width} height={height} />
    </div>
  );
});

/**
 * Kitabın sayfa oranı (genişlik / yükseklik): ilk sayfanın, döndürmesiyle birlikte (görüntü de öyle çizilir).
 * Okunamazsa A serisi oranı. null: belge henüz açılmadı.
 */
function usePageAspect(pdf: PdfDocument | null): number | null {
  const [state, setState] = useState<{ pdf: PdfDocument; aspect: number } | null>(null);
  useEffect(() => {
    if (!pdf) return;
    let alive = true;
    pdf.getPage(1).then(
      (page) => {
        const { width, height } = page.getViewport({ scale: 1 });
        page.cleanup();
        if (alive) setState({ pdf, aspect: width / height });
      },
      () => {
        if (alive) setState({ pdf, aspect: DEFAULT_ASPECT });
      },
    );
    return () => {
      alive = false;
    };
  }, [pdf]);
  return state && state.pdf === pdf ? state.aspect : null;
}
