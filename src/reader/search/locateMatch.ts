import type { Block } from '../../convert/types';
import type { PdfDocument } from '../../pdf/pdfjs';
import {
  findInContext,
  findTextRects,
  pageCharMap,
  type PageCharMap,
  type TextMatch,
} from '../../text/pageGeometry';
import { pdfPageMaps } from '../../text/pdfPageMaps';

/** Aranan yerin blok metnindeki aralığı */
export interface BlockSpan {
  block: number;
  start: number;
  end: number;
}

/** Eşleşmenin PDF sayfasındaki yeri */
export interface LocatedMatch {
  /** PDF sayfası (0'dan) */
  page: number;
  match: TextMatch;
}

/** Eşleşme bloğun başladığı sayfadan en çok bu kadar sayfa ötede aranır (çok uzun paragraf) */
const MAX_SPAN = 30;
/** Bağlam için eşleşmenin önünden ve ardından alınan karakter (harf olmayanlar da sayılır) */
const CONTEXT_CHARS = 48;

/**
 * Bloğun bulunabileceği PDF sayfaları [ilk, son] (0'dan): başladığı sayfadan sonraki bloğun başladığı sayfaya dek
 * (paragraf sonraki sayfaya taşabilir). Arama sonucunun sayfası bu aralıktadır (sonuç listesindeki sayfa da).
 */
export function blockPageRange(
  blocks: Block[],
  block: number,
  pageCount: number,
): [number, number] {
  const b = blocks[block];
  if (!b || pageCount <= 0) return [0, 0];
  const first = Math.min(pageCount - 1, Math.max(0, b.srcPage));
  const next = blocks[block + 1]?.srcPage ?? first;
  return [first, Math.min(pageCount - 1, Math.max(first, next), first + MAX_SPAN)];
}

/**
 * Arama sonucunun PDF sayfasındaki yeri: bloğun başladığı sayfadan sonraki bloğun sayfasına dek, önce bağlamıyla
 * (aynı kelimenin öteki geçişleri karışmasın), bulunamazsa bağlamsız aranır. Bulunamazsa null. Sayfa haritaları
 * belgenin ortak önbelleğindendir (okuma modlarıyla paylaşılır).
 */
export async function locateMatch(
  pdf: PdfDocument,
  blocks: Block[],
  span: BlockSpan,
): Promise<LocatedMatch | null> {
  const b = blocks[span.block];
  const pageCount = pdf.numPages;
  if (!b || !('text' in b) || pageCount === 0) return null;
  const [first, last] = blockPageRange(blocks, span.block, pageCount);
  const text = b.text.slice(span.start, span.end);
  const before = b.text.slice(Math.max(0, span.start - CONTEXT_CHARS), span.start);
  const after = b.text.slice(span.end, span.end + CONTEXT_CHARS);
  const pageMap = pdfPageMaps(pdf);

  const pages: PageCharMap[] = [];
  for (let p = first; p <= last; p++) {
    const map = await pageMap(p).catch(() => null);
    pages.push(map ?? pageCharMap({ width: 1, height: 1, items: [] }));
    const m = map && findInContext(map, before, text, after, false);
    if (m) return { page: p, match: m };
  }
  // Bağlamla bulunamadı: bağlamsız (tamamı, yoksa sayfa sınırında bölünen parçası)
  let partial: LocatedMatch | null = null;
  for (let k = 0; k < pages.length; k++) {
    const m = findTextRects(pages[k], text);
    if (m?.part === 'whole') return { page: first + k, match: m };
    if (m && !partial) partial = { page: first + k, match: m };
  }
  return partial;
}
