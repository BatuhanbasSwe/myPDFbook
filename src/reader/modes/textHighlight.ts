import { useEffect, type RefObject } from 'react';
import type { Block } from '../../convert/types';

/** Okunan cümlenin vurgusu: `::highlight(mypdfbook-active)` (book.css) */
export const ACTIVE_HIGHLIGHT = 'mypdfbook-active';

/** yumuşak tire (U+00AD) */
const SHY = String.fromCharCode(0xad);

/** Blok içindeki aralık (cümle): [start, end) */
export interface BlockRange {
  block: number;
  start: number;
  end: number;
}

/** CSS Custom Highlight API (Safari 17.2+, Chrome 105+); yoksa null */
function highlightRegistry(): HighlightRegistry | null {
  if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight !== 'function')
    return null;
  return CSS.highlights;
}

interface Point {
  node: Text;
  offset: number;
}

/**
 * Blok metnindeki konumun öğedeki yeri. Öğe blok metninin `from`dan başlayan kısmını gösterir; yumuşak tireler
 * (yalnızca birinde olan) atlanır. Konum öğenin metninden sonraysa null.
 */
function pointIn(el: HTMLElement, text: string, from: number, offset: number): Point | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let bi = from;
  let last: Text | null = null;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    last = node;
    const data = node.data;
    for (let k = 0; k < data.length; k++) {
      if (bi >= offset) return { node, offset: k };
      const ch = data[k];
      if (ch === SHY && text[bi] !== SHY) continue;
      while (text[bi] === SHY && ch !== SHY) bi++;
      bi++;
    }
  }
  return last && bi >= offset ? { node: last, offset: last.data.length } : null;
}

/**
 * Cümlenin çizilmiş sayfalardaki DOM aralıkları: bloğun her sayfadaki öğesinde (`data-block`, bloğun sayfadaki
 * başlangıcı `data-from`) cümlenin o öğeye düşen kısmı. Cümle iki sayfaya bölünmüşse iki aralık.
 */
export function sentenceRanges(root: ParentNode, blocks: Block[], s: BlockRange): Range[] {
  const b = blocks[s.block];
  if (!b || !('text' in b)) return [];
  const out: Range[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(
    `.book-page-content [data-block="${s.block}"]`,
  )) {
    const from = Number(el.dataset.from ?? 0);
    if (s.end <= from) continue;
    const start = pointIn(el, b.text, from, Math.max(s.start, from));
    if (!start) continue;
    const end = pointIn(el, b.text, from, s.end);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    if (end) range.setEnd(end.node, end.offset);
    else range.setEndAfter(el.lastChild ?? el);
    if (!range.collapsed) out.push(range);
  }
  return out;
}

/**
 * Metin görünümünde cümleyi vurgular (CSS Custom Highlight API: DOM değişmez, sayfalama etkilenmez). Sayfalar
 * çevrilince ya da yeniden çizilince (kıvrılan sayfanın kutuları sonradan dolar) vurgu yeniden kurulur.
 * Tarayıcı desteklemiyorsa bir şey yapmaz.
 */
export function useTextHighlight(
  rootRef: RefObject<HTMLElement | null>,
  blocks: Block[],
  sentence: BlockRange | null,
): void {
  useEffect(() => {
    const registry = highlightRegistry();
    const root = rootRef.current;
    if (!registry) return;
    if (!sentence || !root) {
      registry.delete(ACTIVE_HIGHLIGHT);
      return;
    }
    let frame = 0;
    const apply = () => {
      frame = 0;
      const ranges = sentenceRanges(root, blocks, sentence);
      if (ranges.length) registry.set(ACTIVE_HIGHLIGHT, new Highlight(...ranges));
      else registry.delete(ACTIVE_HIGHLIGHT);
    };
    apply();
    const observer = new MutationObserver(() => {
      frame ||= requestAnimationFrame(apply);
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      registry.delete(ACTIVE_HIGHLIGHT);
    };
  }, [rootRef, blocks, sentence]);
}
