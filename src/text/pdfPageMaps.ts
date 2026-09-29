import type { PdfDocument } from '../pdf/pdfjs';
import { createPdfSource } from '../pdf/pdfSource';
import { pageCharMap, type PageCharMap } from './pageGeometry';

/** Belge başına bellekte tutulan sayfa haritası sayısı (en eskisi atılır) */
const MAP_CACHE = 24;

/** Belgenin sayfa haritalarını veren işlev (sayfa, 0'dan) */
export type PageMaps = (page: number) => Promise<PageCharMap>;

const byDoc = new WeakMap<PdfDocument, PageMaps>();

/**
 * PDF sayfalarının harf haritaları (pageCharMap), belge başına tek önbellek: okuma modları (cümle yeri, kalemle
 * odak) ve arama sonucunun yeri aynı sayfanın metnini ve fontlarını ayrı ayrı okumasın. Okunamayan sayfa sonraki
 * denemede yeniden okunur.
 */
export function pdfPageMaps(pdf: PdfDocument): PageMaps {
  let maps = byDoc.get(pdf);
  if (maps) return maps;
  const source = createPdfSource(pdf, { glyphAdvances: true });
  const cache = new Map<number, Promise<PageCharMap>>();
  maps = (page) => {
    const cached = cache.get(page);
    if (cached) return cached;
    const p = source.getPageText(page).then(pageCharMap);
    p.catch(() => {
      if (cache.get(page) === p) cache.delete(page);
    });
    cache.set(page, p);
    if (cache.size > MAP_CACHE) cache.delete(cache.keys().next().value as number);
    return p;
  };
  byDoc.set(pdf, maps);
  return maps;
}
