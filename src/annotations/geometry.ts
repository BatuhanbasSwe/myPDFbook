/*
 * İşaretlerin geometrisi. Noktalar düz dizide x, y çiftleridir ve PDF sayfasına göre 0–1 aralığındadır (x sayfa
 * genişliğine, y yüksekliğine oranla). Uzaklıklar sayfa genişliği biriminde ölçülür: y farkı `yScale` (sayfa
 * yüksekliği / genişliği) ile çarpılır; dik sayfada da daire daire kalır. Çizgi kalınlığı da sayfa genişliğine oranladır.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** İşaretin geometriyle ilgili alanları */
export interface Shape {
  kind: 'highlight' | 'ink' | 'note';
  points: number[];
  /** çizgi kalınlığı (sayfa genişliğine oranla) */
  width: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Ekrandaki nokta (clientX/Y) → sayfaya göre 0–1; sayfanın dışı kenara çekilir */
export function toRelative(point: Point, rect: Rect): Point {
  return {
    x: clamp01((point.x - rect.left) / Math.max(1e-9, rect.width)),
    y: clamp01((point.y - rect.top) / Math.max(1e-9, rect.height)),
  };
}

/** Kaydedilen koordinat hassasiyeti: 1/100000 sayfa (büyük ekranda da pikselin çok altında) */
export function roundPoints(points: number[]): number[] {
  return points.map((v) => Math.round(v * 1e5) / 1e5);
}

const num = (v: number) => String(Math.round(v * 1e5) / 1e5);

/**
 * Noktalardan geçen yumuşak SVG yolu (Catmull-Rom → kübik Bezier). Çizim alanı `viewBox="0 0 1 yScale"`: x olduğu
 * gibi, y `yScale` ile çarpılır. Tek nokta kısa bir çizgi olur (yuvarlak uçla nokta görünür).
 */
export function smoothPath(points: number[], yScale = 1): string {
  const n = Math.floor(points.length / 2);
  if (n === 0) return '';
  const x = (i: number) => points[2 * i];
  const y = (i: number) => points[2 * i + 1] * yScale;
  let d = `M${num(x(0))} ${num(y(0))}`;
  if (n === 1) return `${d}l0.0001 0`;
  if (n === 2) return `${d}L${num(x(1))} ${num(y(1))}`;
  for (let i = 0; i < n - 1; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 2);
    const c1x = x(i) + (x(i + 1) - x(a)) / 6;
    const c1y = y(i) + (y(i + 1) - y(a)) / 6;
    const c2x = x(i + 1) - (x(b) - x(i)) / 6;
    const c2y = y(i + 1) - (y(b) - y(i)) / 6;
    d += `C${num(c1x)} ${num(c1y)} ${num(c2x)} ${num(c2y)} ${num(x(i + 1))} ${num(y(i + 1))}`;
  }
  return d;
}

/** (px, py) noktasının [a, b] parçasına uzaklığı */
export function segmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Ramer–Douglas–Peucker: çizginin biçimini `epsilon` (sayfa genişliği biriminde) içinde koruyarak ara noktaları
 * atar; kayıt küçülür. İlk ve son nokta hep kalır.
 */
export function simplify(points: number[], epsilon: number, yScale = 1): number[] {
  const n = Math.floor(points.length / 2);
  if (n <= 2) return points.slice(0, n * 2);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let worst = -1;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance(
        points[2 * i],
        points[2 * i + 1] * yScale,
        points[2 * first],
        points[2 * first + 1] * yScale,
        points[2 * last],
        points[2 * last + 1] * yScale,
      );
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (index >= 0 && worst > epsilon) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[2 * i], points[2 * i + 1]);
  return out;
}

/** İki parça arasındaki en kısa uzaklık (kesişiyorlarsa 0) */
function segmentsDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  const cross = (ox: number, oy: number, px: number, py: number, qx: number, qy: number) =>
    (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  const d1 = cross(ax, ay, bx, by, cx, cy);
  const d2 = cross(ax, ay, bx, by, dx, dy);
  const d3 = cross(cx, cy, dx, dy, ax, ay);
  const d4 = cross(cx, cy, dx, dy, bx, by);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
    return 0;
  return Math.min(
    segmentDistance(ax, ay, cx, cy, dx, dy),
    segmentDistance(bx, by, cx, cy, dx, dy),
    segmentDistance(cx, cy, ax, ay, bx, by),
    segmentDistance(dx, dy, ax, ay, bx, by),
  );
}

/**
 * Silgi: [from, to] yolunda giden silgi işarete değiyor mu. Çizgiye uzaklık `tolerance` ile çizginin yarı
 * kalınlığının toplamından azsa değer; not iğnesine uzaklık `tolerance`tan azsa. Uzaklıklar sayfa genişliği biriminde.
 */
export function hitTestSegment(
  shape: Shape,
  from: Point,
  to: Point,
  tolerance: number,
  yScale = 1,
): boolean {
  const { points } = shape;
  const n = Math.floor(points.length / 2);
  if (n === 0) return false;
  const reach = tolerance + (shape.kind === 'note' ? 0 : shape.width / 2);
  const ax = from.x;
  const ay = from.y * yScale;
  const bx = to.x;
  const by = to.y * yScale;
  if (n === 1) return segmentDistance(points[0], points[1] * yScale, ax, ay, bx, by) <= reach;
  for (let i = 0; i < n - 1; i++) {
    const d = segmentsDistance(
      ax,
      ay,
      bx,
      by,
      points[2 * i],
      points[2 * i + 1] * yScale,
      points[2 * i + 2],
      points[2 * i + 3] * yScale,
    );
    if (d <= reach) return true;
  }
  return false;
}

/** Silgi tek noktada: (x, y) işarete değiyor mu (bkz. hitTestSegment) */
export function hitTest(
  shape: Shape,
  x: number,
  y: number,
  tolerance: number,
  yScale = 1,
): boolean {
  return hitTestSegment(shape, { x, y }, { x, y }, tolerance, yScale);
}
