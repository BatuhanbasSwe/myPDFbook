/**
 * Dokunduğun cümleden oku (Plan 13): sesli okuma açıkken kitaba dokunuşun cümle mi araması, yoksa eskisi gibi
 * sayfa mı çevirmesi (menü mü açması) gerektiği. DOM'suz, Node'da test edilir.
 *
 * Kural: kitabın dış kenar şeridi (sayfa genişliğinin %12'si; çift sayfada her dış sayfanın %12'si) hep eskisi gibi
 * davranır — okur kenara dokunarak sayfa çevirebilsin. Şerit dışında noktadaki cümle aranır; noktada yazı yoksa
 * (kenar boşluğu, satır arasından uzak) yine eskisi gibi. Uzun basma ve metin seçimi okumaz. Gerekçe: plan belgesi.
 */

/** Dış kenar şeridi: sayfa genişliğinin payı */
export const EDGE_STRIP = 0.12;
/** Bundan uzun basma dokunuş sayılmaz (ms): metin seçimi, kalemle bekleme */
export const LONG_TAP_MS = 500;

/** Kitaba dokunuş (sürüklemesiz): ekrandaki yeri ve basma süresi */
export interface BookTap {
  clientX: number;
  clientY: number;
  /** basma süresi (ms) */
  duration: number;
}

/** x (0 sol kenar … 1 sağ kenar) kitabın dış kenar şeridinde mi */
export function inEdgeStrip(x: number, spread: boolean): boolean {
  const w = EDGE_STRIP / (spread ? 2 : 1);
  return x < w || x > 1 - w;
}

/** Sesli okuma açıkken bu dokunuş noktadaki cümleyi arasın mı */
export function tapSeeksSentence(
  x: number,
  tap: BookTap | undefined,
  spread: boolean,
  selecting: boolean,
): boolean {
  return !!tap && !inEdgeStrip(x, spread) && tap.duration < LONG_TAP_MS && !selecting;
}

/** Sayfada seçili metin var mı (uzun basmayla seçim sürüyor: dokunuş okumaz) */
export function hasSelection(): boolean {
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  return !!sel && !sel.isCollapsed && sel.toString().trim().length > 0;
}
