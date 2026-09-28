import type { Locator } from '../../convert/types';
import type { TextRect } from '../../text/pageGeometry';
import { sentenceAt, type Sentence } from '../../text/sentences';

/**
 * Kalemle odak (useFocusMode.ts) için DOM'suz yardımcılar: ekrandaki noktanın PDF sayfasındaki yeri ve noktanın
 * altındaki (ya da ona en yakın) cümle. Node'da test edilir.
 */

/** Ekrandaki kutu (getBoundingClientRect) */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** PDF sayfasındaki nokta (PDF birimi; sayfanın sol üstünden, y aşağı doğru) ve ekran pikselinin PDF birimi */
export interface PagePoint {
  x: number;
  y: number;
  /** bir ekran pikseli kaç PDF birimi (toleransı ekrandaki boyuta göre vermek için) */
  unit: number;
}

/**
 * Ekrandaki noktanın PDF sayfasındaki yeri. Sayfa görüntüsü kutuya `object-contain` ile, vurgu katmanı
 * `xMidYMid meet` ile oturur: sayfa kutunun ortasında, oranı korunarak en büyük ölçekle durur.
 */
export function clientToPage(
  box: Box,
  pageWidth: number,
  pageHeight: number,
  clientX: number,
  clientY: number,
): PagePoint | null {
  if (!(box.width > 0 && box.height > 0 && pageWidth > 0 && pageHeight > 0)) return null;
  const scale = Math.min(box.width / pageWidth, box.height / pageHeight);
  const left = box.left + (box.width - pageWidth * scale) / 2;
  const top = box.top + (box.height - pageHeight * scale) / 2;
  return { x: (clientX - left) / scale, y: (clientY - top) / scale, unit: 1 / scale };
}

/** Noktanın dikdörtgene uzaklığı (içindeyse 0) */
export function rectDistance(r: TextRect, x: number, y: number): number {
  const dx = Math.max(r.x - x, 0, x - (r.x + r.width));
  const dy = Math.max(r.y - y, 0, y - (r.y + r.height));
  return Math.hypot(dx, dy);
}

/** Sayfadaki bir cümlenin satır dikdörtgenleri */
export interface SentenceRects {
  id: number;
  rects: TextRect[];
}

/**
 * Noktanın altındaki cümle: dikdörtgenlerinden birinin içindeyse o; değilse `tolerance` içindeki en yakını (satır
 * arası, kelime arası boşluk, satırın hemen yanı). Eşit uzaklıkta önce gelen. Hiçbiri yakın değilse null.
 */
export function sentenceAtPoint(
  items: readonly SentenceRects[],
  x: number,
  y: number,
  tolerance: number,
): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const item of items) {
    for (const r of item.rects) {
      const d = rectDistance(r, x, y);
      if (d < bestDist) {
        bestDist = d;
        best = item.id;
        if (d === 0) return best;
      }
    }
  }
  return bestDist <= tolerance ? best : null;
}

/**
 * Bloktaki konumun cümlesi (metin görünümünde imlecin altındaki yer): konumu içeren cümle; iki cümle arasındaki
 * boşlukta ya da bloğun sonundaki boşlukta önceki cümle. Konumun bloğunda cümle yoksa null.
 */
export function sentenceAtOffset(list: readonly Sentence[], at: Locator): Sentence | null {
  const next = sentenceAt(list as Sentence[], at);
  if (next && next.block === at.block && next.start <= at.offset) return next;
  const prev = list[(next?.id ?? list.length) - 1];
  if (prev && prev.block === at.block && prev.start <= at.offset) return prev;
  return next && next.block === at.block ? next : null;
}
