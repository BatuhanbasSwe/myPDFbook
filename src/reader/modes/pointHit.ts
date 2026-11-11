import type { Block } from '../../convert/types';
import type { PageCharMap } from '../../text/pageGeometry';
import type { PageSentence, SentencePages } from '../../text/sentencePages';
import type { Sentence } from '../../text/sentences';
import { clientToPage, sentenceAtOffset, sentenceAtPoint, type SentenceRects } from './focusHit';
import { locatorAtPoint } from './textHighlight';

/**
 * Ekrandaki noktanın altındaki cümle, DOM'la: kalemle odak (useFocusMode.tsx) ve dokunduğun cümleden oku
 * (useSentencePlayer.ts, Plan 13) aynı yolu kullanır. Hesabın DOM'suz kısmı focusHit.ts'te.
 *
 * - Metin görünümünde imleç yeri (`caretPositionFromPoint`/`caretRangeFromPoint`) → blok konumu → cümle.
 * - Sayfa görünümünde noktanın altındaki PDF sayfası (`.pdf-page[data-pdf-page]`), sayfanın harf haritası ve
 *   cümleleri (sayfa metninden, eşzamansız: önbelleğe alınır), nokta PDF birimine çevrilir → en yakın cümle.
 */

/** Noktanın cümleye (harfe) en çok bu kadar uzak olabileceği (ekran pikseli): satır arası, kenar */
export const HIT_TOLERANCE = 18;

/** Sayfanın harf haritası ve cümleleri (sayfa görünümünde noktanın altındaki yer bunlardan bulunur) */
export interface PageInfo {
  map: PageCharMap;
  items: SentenceRects[];
  /** cümlelerin sayfa metnindeki [start, end) aralığı */
  spans: { id: number; start: number; end: number }[];
}

export const spansOf = (found: PageSentence[]): PageInfo['spans'] =>
  found.map((f) => ({ id: f.sentence.id, start: f.part.start, end: f.part.end }));

/** Metin görünümünde noktadaki cümle (yazıdan `HIT_TOLERANCE`'tan uzaksa null) */
export function textSentenceAt(
  root: ParentNode & Node,
  blocks: Block[],
  list: readonly Sentence[],
  x: number,
  y: number,
): { sentence: Sentence | null; at: { block: number; offset: number } } | null {
  const at = locatorAtPoint(root, blocks, x, y, HIT_TOLERANCE);
  return at && { sentence: sentenceAtOffset(list, at), at };
}

/** Sayfa görünümünde noktanın altındaki PDF sayfası (0'dan) ve öğesi; kitabın dışındaysa null */
export function pdfPageAt(
  root: Node,
  x: number,
  y: number,
): { el: HTMLElement; page: number } | null {
  const el = document
    .elementsFromPoint(x, y)
    .find(
      (e): e is HTMLElement =>
        e instanceof HTMLElement && e.matches('.pdf-page[data-pdf-page]') && root.contains(e),
    );
  return el ? { el, page: Number(el.dataset.pdfPage) - 1 } : null;
}

/** Noktanın sayfadaki (PDF birimi) yeri; sayfanın kutusu boşsa null */
export function pointOnPage(el: HTMLElement, info: PageInfo, x: number, y: number) {
  return clientToPage(el.getBoundingClientRect(), info.map.width, info.map.height, x, y);
}

/** Sayfa görünümünde noktadaki cümlenin kimliği (yazıdan uzaksa null) */
export function pageSentenceAt(
  el: HTMLElement,
  info: PageInfo,
  x: number,
  y: number,
): number | null {
  const p = pointOnPage(el, info, x, y);
  if (!p || info.items.length === 0) return null;
  return sentenceAtPoint(info.items, p.x, p.y, HIT_TOLERANCE * p.unit);
}

/**
 * Sayfaların harf haritası ve cümleleri, sayfa yeri önbelleğine (`SentencePages`) göre: önbellek değişince (kitap,
 * dil) unutulur. Yüklenemeyen sayfa sonraki istekte yeniden denenir.
 */
export interface PageInfoCache {
  /** sayfanın bilgisi; yoksa undefined (yüklenmesi `load` ile) */
  get(sp: SentencePages, page: number): PageInfo | undefined;
  /** sayfanın bilgisini yükler (yükleniyorsa aynı söz) */
  load(sp: SentencePages, page: number): Promise<PageInfo>;
  /** her şey unutulur; süren yüklemeler önbelleğe yazılmaz */
  clear(): void;
}

export function createPageInfoCache(): PageInfoCache {
  let of: SentencePages | null = null;
  const info = new Map<number, PageInfo>();
  const loading = new Map<number, Promise<PageInfo>>();
  const bind = (sp: SentencePages) => {
    if (sp === of) return;
    of = sp;
    info.clear();
    loading.clear();
  };
  return {
    get(sp, page) {
      bind(sp);
      return info.get(page);
    },
    load(sp, page) {
      bind(sp);
      const known = info.get(page);
      if (known) return Promise.resolve(known);
      let p = loading.get(page);
      if (!p) {
        p = Promise.all([sp.pageMap(page), sp.onPage(page)]).then(
          ([map, found]) => {
            const value: PageInfo = {
              map,
              items: found.map((f) => ({ id: f.sentence.id, rects: f.part.rects })),
              spans: spansOf(found),
            };
            if (of === sp) info.set(page, value);
            return value;
          },
          (err: unknown) => {
            if (of === sp) loading.delete(page);
            throw err;
          },
        );
        loading.set(page, p);
      }
      return p;
    },
    clear() {
      of = null;
      info.clear();
      loading.clear();
    },
  };
}
