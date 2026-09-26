import { memo, useLayoutEffect, useRef } from 'react';
import type { Block, Locator } from '../convert/types';
import type { PageLayout } from '../layout/pageBox';
import { buildPageElements } from '../layout/paginator';
import { typographyStyle, type Typography } from '../layout/typography';
import type { PdfDocument } from '../pdf/pdfjs';
import { PageImage } from './PageImage';

interface Props {
  blocks: Block[];
  start: Locator;
  /** sonraki sayfanın başı (yoksa kitabın sonu) */
  end: Locator | undefined;
  layout: PageLayout;
  typography: Typography;
  /** kitabın dili: heceleme sayfalayıcıdakiyle aynı olsun */
  lang: string;
  /** 1'den başlar */
  pageNumber: number;
  /** sayfa başlığı: sol sayfada kitap, sağ sayfada bölüm adı */
  runningHead: string;
  side: 'left' | 'right' | 'single';
  /** görünen ya da komşu sayfa: taranmış sayfa görseli ekrana gelmeden çizilir */
  eager: boolean;
  pdf: PdfDocument | null;
  pdfFailed: boolean;
}

/**
 * Tek kitap sayfası. Metin, sayfalayıcının ölçtüğü işaretlemeyle aynı DOM yapıcısından gelir (buildPageElements):
 * React yalnızca kutuyu çizer, içerik kutuya doğrudan yerleştirilir. Görsel sayfa React bileşeniyle çizilir.
 */
export const BookPage = memo(function BookPage({
  blocks,
  start,
  end,
  layout,
  typography,
  lang,
  pageNumber,
  runningHead,
  side,
  eager,
  pdf,
  pdfFailed,
}: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const first = blocks[start.block];
  const image = first?.kind === 'pageImage' ? first : undefined;
  const { box } = layout;

  useLayoutEffect(() => {
    if (image || !contentRef.current) return;
    contentRef.current.replaceChildren(...buildPageElements(blocks, start, end, box));
  }, [blocks, start, end, box, image]);

  const edge = side === 'left' ? 'book-page-left' : side === 'right' ? 'book-page-right' : '';
  return (
    <div
      className={`book-page relative overflow-hidden bg-paper text-ink ${edge}`}
      style={{ width: layout.pageWidth, height: layout.pageHeight }}
      data-page={pageNumber}
    >
      <div
        className="absolute truncate text-center text-xs tracking-wide text-muted"
        style={{ left: layout.padLeft, width: box.width, top: layout.padTop * 0.35 }}
      >
        {runningHead}
      </div>
      <div
        className="absolute"
        style={{ left: layout.padLeft, top: layout.padTop, width: box.width, height: box.height }}
      >
        {image ? (
          <PageImage
            pdf={pdf}
            failed={pdfFailed}
            pageIndex={image.srcPage}
            fill
            eager={eager}
            width={box.width}
          />
        ) : (
          <div
            ref={contentRef}
            lang={lang}
            className="book-page-content h-full overflow-hidden"
            style={typographyStyle(typography)}
          />
        )}
      </div>
      <div
        className="absolute text-center text-xs text-muted"
        style={{ left: layout.padLeft, width: box.width, bottom: layout.padTop * 0.35 }}
      >
        {pageNumber}
      </div>
    </div>
  );
});
