import type { TextRect } from '../text/pageGeometry';

/** Dikdörtgenin harflerden taşan payı (PDF birimi): vurgu harflere yapışmasın */
const PAD_X = 1.5;
const PAD_Y = 0.5;
/** Köşe yuvarlaklığı (PDF birimi) */
const RADIUS = 2;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Yuvarlak köşeli dikdörtgen (`<rect rx>` gibi), yol parçası olarak */
function roundedRect({ x, y, width: w, height: h }: Box): string {
  const rx = Math.max(0, Math.min(RADIUS, w / 2));
  const ry = Math.max(0, Math.min(RADIUS, h / 2));
  const arc = (dx: number, dy: number) => `A${rx} ${ry} 0 0 1 ${dx} ${dy}`;
  return (
    `M${x + rx} ${y}H${x + w - rx}${arc(x + w, y + ry)}V${y + h - ry}${arc(x + w - rx, y + h)}` +
    `H${x + rx}${arc(x, y + h - ry)}V${y + ry}${arc(x + rx, y)}Z`
  );
}

/**
 * Odak karartmasının yolu: sayfanın tamamı, cümlenin dikdörtgenleri delik (çift-tek kuralı). Üst üste binen iki
 * deliğin ortak yeri (sıkı satır aralığı) bir kez daha eklenir: çift-tek kuralında yine delik kalır.
 */
export function dimPath(pageWidth: number, pageHeight: number, boxes: Box[]): string {
  let d = `M0 0H${pageWidth}V${pageHeight}H0Z`;
  for (const b of boxes) d += roundedRect(b);
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const x0 = Math.max(a.x, b.x);
      const y0 = Math.max(a.y, b.y);
      const x1 = Math.min(a.x + a.width, b.x + b.width);
      const y1 = Math.min(a.y + a.height, b.y + b.height);
      if (x1 > x0 && y1 > y0) d += `M${x0} ${y0}H${x1}V${y1}H${x0}Z`;
    }
  return d;
}

/**
 * Sayfa görünümünde okunan cümlenin vurgusu: PDF sayfa görüntüsünün üstünde, sayfa boyutuna ölçekli SVG. Görüntü
 * kutuya `object-contain` ile oturur; SVG de aynı oranla (`xMidYMid meet`) ölçeklenir. Renk ve karışım book.css'te
 * (.sentence-overlay): vurgu çarpma karışımıyla çizilir, yazı koyu kalır. Odakta sayfanın cümle dışındaki yeri tek
 * bir yolla karartılır (.sentence-dim: sayfanın tamamı, cümlenin dikdörtgenleri delik). Karartma çarpma karışımlı
 * grubun dışındadır ve maske kullanılmaz: iPad'de her cümlede sayfa boyutunda maske ve karışım katmanı çizilmez
 * (siyahın çarpması ve üstüne çizilmesi aynı sonucu verir).
 */
export function SentenceOverlay({
  rects,
  pageWidth,
  pageHeight,
  focus = false,
  mark = true,
}: {
  rects: TextRect[];
  /** sayfa boyutu (PDF birimi) */
  pageWidth: number;
  pageHeight: number;
  /** odak: cümle dışı karartılır */
  focus?: boolean;
  /** cümle sarıyla vurgulanır (kalemle odakta yalnızca açık kalır) */
  mark?: boolean;
}) {
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
        <path
          className="sentence-dim"
          data-testid="sentence-dim"
          // delikler (x y genişlik yükseklik; testler ve hata ayıklama için okunur)
          data-holes={boxes.map((b) => `${b.x} ${b.y} ${b.width} ${b.height}`).join(';')}
          fillRule="evenodd"
          d={dimPath(pageWidth, pageHeight, boxes)}
        />
      )}
      {mark && (
        <g className="sentence-marks">
          {boxes.map((b, i) => (
            <rect key={i} className="sentence-mark" {...b} rx={RADIUS} />
          ))}
        </g>
      )}
    </svg>
  );
}

/** Odakta cümlenin olmadığı açık sayfa: tamamı karartılır */
export const DIMMED_PAGE = (
  <div className="sentence-dim-page" data-testid="sentence-dim" aria-hidden="true" />
);
