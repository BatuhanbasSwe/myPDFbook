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

/** Yedek vurgu katmanının sınıfı (book.css): API'siz tarayıcıda sayfanın içinde, yazının arkasında kutular */
export const FALLBACK_CLASS = 'sentence-fallback';

/**
 * CSS Custom Highlight API'si olmayan tarayıcıda (iPadOS 17.2 öncesi) vurgu: aralıkların satır kutuları, her
 * `.book-page`'in ilk çocuğu olan mutlak konumlu, dokunulmaz bir katmana çizilir. Katman sayfanın öteki (konumlu)
 * öğelerinden önce geldiği için yazının arkasında kalır; yerleşimi etkilemez. Katmanları kaldıran işlev döner.
 */
export function paintFallback(ranges: Range[]): () => void {
  const layers = new Map<HTMLElement, HTMLElement>();
  for (const range of ranges) {
    const node = range.startContainer;
    const page = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(
      '.book-page',
    );
    if (!page) continue;
    let layer = layers.get(page);
    if (!layer) {
      layer = document.createElement('div');
      layer.className = FALLBACK_CLASS;
      layer.setAttribute('aria-hidden', 'true');
      layers.set(page, layer);
    }
    const box = page.getBoundingClientRect();
    // Sayfa ölçekli olabilir (kıvrılan sayfa): kutular sayfanın kendi biriminde
    const scale = page.offsetWidth > 0 ? box.width / page.offsetWidth : 1;
    for (const r of range.getClientRects()) {
      if (r.width < 0.5 || r.height < 0.5) continue;
      const mark = document.createElement('div');
      mark.style.left = `${(r.left - box.left) / scale}px`;
      mark.style.top = `${(r.top - box.top) / scale}px`;
      mark.style.width = `${r.width / scale}px`;
      mark.style.height = `${r.height / scale}px`;
      layer.append(mark);
    }
  }
  // Katman kutularıyla birlikte eklenir: tek değişiklik
  for (const [page, layer] of layers) page.prepend(layer);
  return () => {
    for (const layer of layers.values()) layer.remove();
  };
}

/** Değişiklik yalnızca yedek vurgu katmanının eklenip kaldırılması mı (kendi çizimimiz: yeniden çizim gerekmez) */
function ownMutation(records: MutationRecord[]): boolean {
  const ours = (n: Node) => n instanceof Element && n.classList.contains(FALLBACK_CLASS);
  return records.every(
    (r) => ours(r.target) || ([...r.addedNodes].every(ours) && [...r.removedNodes].every(ours)),
  );
}

/**
 * Metin görünümünde cümleyi vurgular (CSS Custom Highlight API: DOM değişmez, sayfalama etkilenmez; API yoksa
 * sayfanın içine çizilen yedek kutular). Sayfalar çevrilince ya da yeniden çizilince (kıvrılan sayfanın kutuları
 * sonradan dolar) vurgu yeniden kurulur.
 */
export function useTextHighlight(
  rootRef: RefObject<HTMLElement | null>,
  blocks: Block[],
  sentence: BlockRange | null,
): void {
  useEffect(() => {
    const registry = highlightRegistry();
    const root = rootRef.current;
    if (!sentence || !root) {
      registry?.delete(ACTIVE_HIGHLIGHT);
      return;
    }
    let frame = 0;
    let clear = () => {};
    const apply = () => {
      frame = 0;
      const ranges = sentenceRanges(root, blocks, sentence);
      if (!registry) {
        clear();
        clear = paintFallback(ranges);
      } else if (ranges.length) registry.set(ACTIVE_HIGHLIGHT, new Highlight(...ranges));
      else registry.delete(ACTIVE_HIGHLIGHT);
    };
    apply();
    const observer = new MutationObserver((records) => {
      if (!ownMutation(records)) frame ||= requestAnimationFrame(apply);
    });
    observer.observe(root, { childList: true, subtree: true });
    // Yedek kutular yerleşime bağlı: boyut değişince yeniden çizilir
    const resize = registry
      ? null
      : new ResizeObserver(() => (frame ||= requestAnimationFrame(apply)));
    resize?.observe(root);
    return () => {
      observer.disconnect();
      resize?.disconnect();
      cancelAnimationFrame(frame);
      clear();
      registry?.delete(ACTIVE_HIGHLIGHT);
    };
  }, [rootRef, blocks, sentence]);
}
