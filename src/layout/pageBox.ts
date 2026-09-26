import { chapterSink, type PageBox } from './paginator';
import { MARGIN_EM, type Typography } from './typography';

export interface Viewport {
  width: number;
  height: number;
}

/** Okuma alanındaki sayfa(lar)ın yerleşimi, CSS pikseli */
export interface PageLayout {
  /** yan yana iki sayfa */
  spread: boolean;
  pageWidth: number;
  pageHeight: number;
  /** metin kutusu: sayfalayıcı bu boyuta göre böler */
  box: PageBox;
  /** metin kutusunun sayfa içindeki konumu */
  padLeft: number;
  padTop: number;
}

/** Satır uzunluğu en fazla bu kadar punto (≈ 70 karakter) */
const MAX_LINE_EM = 34;
/** Sayfanın yan kenar boşluğu en az bu kadar punto (geniş ekranda sayfa daraltılırken) */
const SIDE_MIN_EM = 2.5;
/** Çift sayfa için en küçük okuma alanı genişliği */
const SPREAD_MIN_WIDTH = 900;

/** Çift sayfaya yer var mı: ayar `auto`, ekran yatay ve yeterince geniş (metin ve sayfa görünümü aynı kuralla) */
export function spreadAllowed(vp: Viewport, spread: Typography['spread']): boolean {
  return spread === 'auto' && vp.width > vp.height && vp.width >= SPREAD_MIN_WIDTH;
}

/**
 * Ekran ve tipografiden sayfa yerleşimi. Üstte sayfa başlığına (kitap/bölüm adı), altta sayfa numarasına yer
 * ayrılır. Metin kutusu tam piksele yuvarlanır: aynı ayarlar her zaman aynı sayfa sınırlarını verir (önbellek anahtarı).
 */
export function pageLayout(vp: Viewport, t: Typography): PageLayout {
  const spread = spreadAllowed(vp, t.spread);
  const available = Math.floor(spread ? vp.width / 2 : vp.width);
  const pageHeight = Math.floor(vp.height);
  const margin = MARGIN_EM[t.margin] * t.size;
  const headRoom = Math.max(margin, 2.4 * t.size); // sayfa başlığı
  const footRoom = Math.max(margin, 2.6 * t.size); // sayfa numarası
  const width = Math.max(120, Math.floor(Math.min(available - 2 * margin, MAX_LINE_EM * t.size)));
  // Geniş ekranda sayfa, satırın gerektirdiğinden geniş olmaz: iki sayfa ortada bir kitap gibi birleşik durur
  // (metin kutusu değişmez; sayfa sınırları aynı kalır)
  const pageWidth = Math.min(available, width + 2 * Math.max(margin, SIDE_MIN_EM * t.size));
  const height = Math.max(120, Math.floor(pageHeight - headRoom - footRoom));
  return {
    spread,
    pageWidth,
    pageHeight,
    box: { width, height, sink: chapterSink(t.size * t.lineHeight, height) },
    padLeft: Math.floor((pageWidth - width) / 2),
    padTop: Math.floor(headRoom),
  };
}
