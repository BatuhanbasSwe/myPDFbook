import { spreadAllowed, type Viewport } from './pageBox';
import type { Spread } from './typography';

/** Sayfa görünümünde (PDF sayfaları) kitabın yerleşimi, CSS pikseli */
export interface PdfPageLayout {
  /** yan yana iki sayfa */
  spread: boolean;
  pageWidth: number;
  pageHeight: number;
}

/**
 * Çift sayfada sayfa, tek sayfadakinin en az bu kadarı büyüklükte olmalı. Dik sayfa (kitap) yatay ekranda iki
 * sayfa yan yana da aynı boyutta sığar; yatık sayfa (sunum) yan yana çok küçülür, tek sayfa kalır.
 */
const SPREAD_MIN_SCALE = 0.8;

/**
 * PDF sayfasının en-boy oranı (genişlik / yükseklik) korunarak alana sığan sayfa boyutu. Ekran yatay, genişlik
 * ≥ 900 ve ayar `auto` ise, iki sayfa yan yana belirgin küçülmeden sığıyorsa çift sayfa açılır. Boyutlar tam
 * piksele yuvarlanır (çift sayfada iki sayfa aynı genişlikte).
 */
export function pdfPageLayout(vp: Viewport, aspect: number, spread: Spread): PdfPageLayout {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : DEFAULT_ASPECT;
  const width = Math.max(1, vp.width);
  const height = Math.max(1, vp.height);
  // Sütun sayısına göre sayfanın sığdığı en büyük ölçek (yükseklik ya da genişlik sınırlar)
  const fit = (columns: number) => Math.min(height, width / columns / ratio);
  const single = fit(1);
  const two = spreadAllowed(vp, spread) && fit(2) >= single * SPREAD_MIN_SCALE;
  const pageHeight = two ? fit(2) : single;
  return {
    spread: two,
    pageWidth: Math.max(1, Math.floor(pageHeight * ratio)),
    pageHeight: Math.max(1, Math.floor(pageHeight)),
  };
}

/** Oran bilinmiyorsa (sayfa okunamadı) A serisi dik sayfa */
export const DEFAULT_ASPECT = 1 / Math.SQRT2;
