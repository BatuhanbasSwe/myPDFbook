/*
 * Sayfa yakınlaştırmasının DOM'suz hesabı (Node'da test edilir). Yakınlaştırma yalnızca sayfa kilitliyken açıktır;
 * kilit açılınca 1×'e döner. Kitabın kutusu `translate(x, y) scale(s)` ile büyütülür, dönüşümün merkezi kitabın
 * ortasıdır. Kitap okuma alanının ortasında durduğu için ekrandaki noktalar okuma alanının ortasına göre ölçülür:
 * ekrandaki nokta = (x, y) + s × (kitabın ortasına göre büyütülmemiş nokta).
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** Çift dokunmanın yakınlaştırması */
export const DOUBLE_TAP_ZOOM = 2;
/** + / − düğmelerinin adımı */
export const ZOOM_STEP = 0.5;
/** Bundan büyükse sayfa görüntüsü yakınlaştırmaya göre yeniden (keskin) çizilir */
export const SHARP_FROM = 1.2;

export interface Zoom {
  scale: number;
  /** kaydırma (px, ekranda) */
  x: number;
  y: number;
}

export interface Pt {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const NO_ZOOM: Zoom = { scale: 1, x: 0, y: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Yakınlaştırma 1× ile 4× arasında (geçersiz sayı 1×) */
export function clampScale(scale: number): number {
  return Number.isFinite(scale) ? clamp(scale, MIN_ZOOM, MAX_ZOOM) : MIN_ZOOM;
}

/** 1×'ten büyük mü (yuvarlama payıyla) */
export function isZoomed(z: Zoom): boolean {
  return z.scale > MIN_ZOOM + 1e-3;
}

/**
 * Kaydırma sınırı: büyüyen kitap okuma alanını aşıyorsa kenarı alanın kenarından içeri giremez (boşluk görünmez);
 * aşmıyorsa o yönde ortada durur.
 */
export function clampPan(z: Zoom, book: Size, view: Size): Zoom {
  const scale = clampScale(z.scale);
  const mx = Math.max(0, (book.width * scale - view.width) / 2);
  const my = Math.max(0, (book.height * scale - view.height) / 2);
  // -0 yerine 0 (testte ve stil yazısında "-0px" olmasın)
  return { scale, x: clamp(z.x, -mx, mx) || 0, y: clamp(z.y, -my, my) || 0 };
}

/** Ekrandaki nokta (okuma alanının ortasına göre) → kitaptaki büyütülmemiş nokta (kitabın ortasına göre) */
export function toContent(p: Pt, z: Zoom): Pt {
  return { x: (p.x - z.x) / z.scale, y: (p.y - z.y) / z.scale };
}

/** Kitaptaki büyütülmemiş nokta → ekrandaki nokta */
export function toScreen(u: Pt, z: Zoom): Pt {
  return { x: z.x + z.scale * u.x, y: z.y + z.scale * u.y };
}

/** Kitaptaki büyütülmemiş kutunun (kitabın ortasına göre) ekrandaki yeri: işaret katmanı ekranda bunu ölçer */
export function transformRect(r: Rect, z: Zoom): Rect {
  const p = toScreen({ x: r.left, y: r.top }, z);
  return { left: p.x, top: p.y, width: r.width * z.scale, height: r.height * z.scale };
}

/**
 * Ekrandaki nokta → kitaptaki kutuya (sayfa, işaret katmanı) göre 0–1. Kutu büyütülmemiş hâliyle verilir; nokta
 * dönüşümün tersinden geçirilir.
 */
export function toBoxFraction(p: Pt, box: Rect, z: Zoom): Pt {
  const u = toContent(p, z);
  return { x: (u.x - box.left) / box.width, y: (u.y - box.top) / box.height };
}

/** `scale`e yakınlaştırır: odak noktasının (ekranda) altındaki yer yerinde kalır */
export function zoomAt(z: Zoom, scale: number, focal: Pt, book: Size, view: Size): Zoom {
  const s = clampScale(scale);
  const u = toContent(focal, z);
  return clampPan({ scale: s, x: focal.x - s * u.x, y: focal.y - s * u.y }, book, view);
}

export interface PinchStart {
  zoom: Zoom;
  /** iki parmağın başlangıç yeri (ekranda, okuma alanının ortasına göre) */
  a: Pt;
  b: Pt;
}

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * İki parmakla yakınlaştırma: ölçek parmakların uzaklığıyla oranlı değişir, parmakların ortasının başta altında
 * duran yer parmakların şimdiki ortasına gelir (iki parmakla kaydırma da olur).
 */
export function pinchZoom(start: PinchStart, a: Pt, b: Pt, book: Size, view: Size): Zoom {
  const d0 = Math.hypot(start.a.x - start.b.x, start.a.y - start.b.y);
  const d1 = Math.hypot(a.x - b.x, a.y - b.y);
  const s = clampScale(start.zoom.scale * (d0 > 0 ? d1 / d0 : 1));
  const u = toContent(mid(start.a, start.b), start.zoom);
  const c = mid(a, b);
  return clampPan({ scale: s, x: c.x - s * u.x, y: c.y - s * u.y }, book, view);
}

/** Çift dokunma: 1×'teyse dokunulan yer 2×'e büyür, yakınsa 1×'e döner */
export function doubleTapZoom(z: Zoom, focal: Pt, book: Size, view: Size): Zoom {
  return isZoomed(z) ? NO_ZOOM : zoomAt(z, DOUBLE_TAP_ZOOM, focal, book, view);
}

/** Tek parmakla (fareyle) kaydırma */
export function panBy(z: Zoom, dx: number, dy: number, book: Size, view: Size): Zoom {
  return clampPan({ scale: z.scale, x: z.x + dx, y: z.y + dy }, book, view);
}

/**
 * + / − düğmesi: bir sonraki yarım adıma (1,5×, 2× …); arada kalan ölçek (parmakla) en yakın adıma değil, o yöndeki
 * adıma gider. Okuma alanının ortası yerinde kalır.
 */
export function stepZoom(z: Zoom, dir: 1 | -1, book: Size, view: Size): Zoom {
  const k = z.scale / ZOOM_STEP;
  const next =
    dir > 0 ? (Math.floor(k + 1e-6) + 1) * ZOOM_STEP : (Math.ceil(k - 1e-6) - 1) * ZOOM_STEP;
  return zoomAt(z, next, { x: 0, y: 0 }, book, view);
}

/** Ctrl/⌘ + tekerlek ya da dokunmatik yüzeyde kıstırma: imlecin altındaki yer yerinde kalır */
export function wheelZoom(z: Zoom, deltaY: number, focal: Pt, book: Size, view: Size): Zoom {
  return zoomAt(z, z.scale * Math.exp(-deltaY / 200), focal, book, view);
}

/**
 * Keskin çizimin yakınlaştırması: 1,2×'e dek 1 (yeniden çizilmez); üstünde yarım adıma yukarı yuvarlanır (her küçük
 * değişiklikte yeniden çizilmesin).
 */
export function sharpZoomLevel(scale: number): number {
  if (!(scale > SHARP_FROM)) return 1;
  return Math.min(MAX_ZOOM, Math.ceil(scale / ZOOM_STEP - 1e-6) * ZOOM_STEP);
}

/**
 * Yakınlaştırılmış sayfanın çizim genişliği (piksel): genişlik × yakınlaştırma × piksel oranı (en çok 2), uzun kenarı
 * `longSideCap`i geçmeyecek biçimde (bellek; iPad'de 4096, telefonda daha az).
 */
export function sharpPixelWidth(
  cssWidth: number,
  cssHeight: number,
  zoom: number,
  dpr: number,
  longSideCap: number,
): number {
  const ratio = Math.min(Math.max(dpr || 1, 1), 2);
  const wanted = Math.round(cssWidth * ratio * zoom);
  const long = Math.max(cssWidth, cssHeight) / Math.max(1, cssWidth);
  return Math.max(1, Math.min(wanted, Math.floor(longSideCap / long)));
}
