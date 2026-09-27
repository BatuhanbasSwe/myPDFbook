import type { TextRect } from '../text/pageGeometry';

/** Dikdörtgenin harflerden taşan payı (PDF birimi): vurgu harflere yapışmasın */
const PAD_X = 1.5;
const PAD_Y = 0.5;

/**
 * Sayfa görünümünde okunan cümlenin vurgusu: PDF sayfa görüntüsünün üstünde, sayfa boyutuna ölçekli SVG. Görüntü
 * kutuya `object-contain` ile oturur; SVG de aynı oranla (`xMidYMid meet`) ölçeklenir. Renk ve karışım book.css'te
 * (.sentence-overlay): çarpma karışımıyla yazı koyu kalır.
 */
export function SentenceOverlay({
  rects,
  pageWidth,
  pageHeight,
}: {
  rects: TextRect[];
  /** sayfa boyutu (PDF birimi) */
  pageWidth: number;
  pageHeight: number;
}) {
  return (
    <svg
      className="sentence-overlay"
      data-testid="sentence-overlay"
      viewBox={`0 0 ${pageWidth} ${pageHeight}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {rects.map((r, i) => (
        <rect
          key={i}
          x={r.x - PAD_X}
          y={r.y - PAD_Y}
          width={r.width + 2 * PAD_X}
          height={r.height + 2 * PAD_Y}
          rx={2}
        />
      ))}
    </svg>
  );
}
