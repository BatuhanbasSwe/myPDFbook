import { useId } from 'react';
import type { TextRect } from '../text/pageGeometry';

/** Dikdörtgenin harflerden taşan payı (PDF birimi): vurgu harflere yapışmasın */
const PAD_X = 1.5;
const PAD_Y = 0.5;

/**
 * Sayfa görünümünde okunan cümlenin vurgusu: PDF sayfa görüntüsünün üstünde, sayfa boyutuna ölçekli SVG. Görüntü
 * kutuya `object-contain` ile oturur; SVG de aynı oranla (`xMidYMid meet`) ölçeklenir. Renk ve karışım book.css'te
 * (.sentence-overlay): çarpma karışımıyla yazı koyu kalır. Odakta sayfanın cümle dışındaki yeri bir maskeyle
 * karartılır (.sentence-dim).
 */
export function SentenceOverlay({
  rects,
  pageWidth,
  pageHeight,
  focus = false,
}: {
  rects: TextRect[];
  /** sayfa boyutu (PDF birimi) */
  pageWidth: number;
  pageHeight: number;
  /** odak: cümle dışı karartılır */
  focus?: boolean;
}) {
  const maskId = useId();
  const boxes = rects.map((r) => ({
    x: r.x - PAD_X,
    y: r.y - PAD_Y,
    width: r.width + 2 * PAD_X,
    height: r.height + 2 * PAD_Y,
  }));
  return (
    <svg
      className="sentence-overlay"
      data-testid="sentence-overlay"
      viewBox={`0 0 ${pageWidth} ${pageHeight}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {focus && (
        <>
          <mask id={maskId}>
            <rect width={pageWidth} height={pageHeight} fill="white" />
            {boxes.map((b, i) => (
              <rect key={i} {...b} rx={2} fill="black" />
            ))}
          </mask>
          <rect
            className="sentence-dim"
            data-testid="sentence-dim"
            width={pageWidth}
            height={pageHeight}
            mask={`url(#${CSS.escape(maskId)})`}
          />
        </>
      )}
      {boxes.map((b, i) => (
        <rect key={i} className="sentence-mark" {...b} rx={2} />
      ))}
    </svg>
  );
}

/** Odakta cümlenin olmadığı açık sayfa: tamamı karartılır */
export const DIMMED_PAGE = (
  <div className="sentence-dim-page" data-testid="sentence-dim" aria-hidden="true" />
);
