import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type { Block } from '../../convert/types';
import type { PdfDocument } from '../../pdf/pdfjs';
import type { TextMatch } from '../../text/pageGeometry';
import type { PageOverlays } from '../modes/pageHighlight';
import { ownMutation, paintFallback, sentenceRanges } from '../modes/textHighlight';
import type { ReaderView } from '../readerPrefs';
import { locateMatch, type BlockSpan, type LocatedMatch } from './locateMatch';

/** Arama sonucunun vurgusu: `::highlight(mypdfbook-search)` (book.css) */
export const SEARCH_HIGHLIGHT = 'mypdfbook-search';
/** Vurgu bu kadar sonra kalkar (ms; sayfa görünümünde sonuna doğru solar: book.css → .search-overlay) */
export const SEARCH_HIT_MS = 5000;
/** Sayfa görünümünde eşleşmenin yeri en çok bu kadar beklenir; bulunamazsa bloğun sayfasına gidilir (ms) */
const LOCATE_TIMEOUT = 2500;
/** Metin görünümünde vurgu açıkken kökün sınıfı (book.css): vurgu seçilemeyen yazıda da çizilsin */
const SEARCH_LIT = 'search-lit';

/** Dikdörtgenin harflerden taşan payı ve köşe yuvarlaklığı (PDF birimi) */
const PAD_X = 1.5;
const PAD_Y = 0.5;
const RADIUS = 2;

interface Hit {
  id: number;
  view: ReaderView;
  span: BlockSpan;
  /** sayfa görünümünde eşleşmenin sayfadaki yeri (bulunamadıysa null) */
  located: LocatedMatch | null;
}

/** CSS Custom Highlight API (Safari 17.2+, Chrome 105+); yoksa null */
function highlightRegistry(): HighlightRegistry | null {
  if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight !== 'function')
    return null;
  return CSS.highlights;
}

const noSelect = (e: Event) => e.preventDefault();

/** Sayfa görünümünde eşleşmenin vurgusu: PDF sayfa görüntüsünün üstünde, sayfa boyutuna ölçekli SVG */
function SearchOverlay({ match }: { match: TextMatch }) {
  return (
    <svg
      className="search-overlay"
      data-testid="search-overlay"
      viewBox={`0 0 ${match.pageWidth} ${match.pageHeight}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <g className="search-marks">
        {match.rects.map((r, i) => (
          <rect
            key={i}
            className="search-mark"
            x={r.x - PAD_X}
            y={r.y - PAD_Y}
            width={r.width + 2 * PAD_X}
            height={r.height + 2 * PAD_Y}
            rx={RADIUS}
          />
        ))}
      </g>
    </svg>
  );
}

/**
 * İki katman kümesini birleştirir (okuma modunun vurgusu ve arama sonucu): biri yoksa öteki olduğu gibi döner.
 * Sayfanın katmanı bir kez kurulur (sayfa bileşeni her çizimde yeniden çizilmesin).
 */
export function mergeOverlays(a?: PageOverlays, b?: PageOverlays): PageOverlays | undefined {
  if (!a) return b;
  if (!b) return a;
  const cache = new Map<number, ReactNode>();
  return {
    get(page) {
      if (!cache.has(page)) {
        const x = a.get(page);
        const y = b.get(page);
        cache.set(
          page,
          x == null ? (
            y
          ) : y == null ? (
            x
          ) : (
            <>
              {x}
              {y}
            </>
          ),
        );
      }
      return cache.get(page);
    },
  };
}

/**
 * Arama sonucuna gidilince eşleşmenin vurgusu. Sayfa görünümünde eşleşme PDF sayfasının metninde bulunur (bağlamıyla)
 * ve sayfanın üstüne dikdörtgenlerle çizilir; metin görünümünde CSS Custom Highlight (API yoksa sayfanın içine yedek
 * kutular). Vurgu birkaç saniye sonra ya da `clear` ile (okur dokununca, sayfayı çevirince) kalkar; görünüm
 * değişince de kalkar.
 */
export function useSearchHit({
  view,
  blocks,
  pdf,
  rootRef,
}: {
  view: ReaderView;
  blocks: Block[];
  pdf: PdfDocument | null;
  /** metin görünümünde vurgunun arandığı kök */
  rootRef: RefObject<HTMLElement | null>;
}) {
  const [hit, setHit] = useState<Hit | null>(null);
  const seq = useRef(0);
  const active = hit && hit.view === view ? hit : null;

  const clear = useCallback(() => {
    seq.current++;
    setHit(null);
  }, []);

  /**
   * Sonucu vurgular. Sayfa görünümünde eşleşmenin PDF sayfası döner (bulunamazsa `page` null); bu arada başka bir
   * sonuca gidildiyse ya da vurgu kaldırıldıysa null (okuyucu sayfayı değiştirmesin).
   */
  const show = useCallback(
    async (span: BlockSpan): Promise<{ page: number | null } | null> => {
      const id = ++seq.current;
      if (view === 'text' || !pdf) {
        setHit({ id, view, span, located: null });
        return { page: null };
      }
      setHit(null);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const located = await Promise.race([
        locateMatch(pdf, blocks, span).catch(() => null),
        new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), LOCATE_TIMEOUT))),
      ]);
      clearTimeout(timer);
      if (seq.current !== id) return null;
      setHit({ id, view, span, located });
      return { page: located?.page ?? null };
    },
    [view, pdf, blocks],
  );

  // Vurgu birkaç saniye sonra kalkar
  useEffect(() => {
    if (!hit) return;
    const timer = setTimeout(() => setHit((h) => (h === hit ? null : h)), SEARCH_HIT_MS);
    return () => clearTimeout(timer);
  }, [hit]);

  const located = active?.located ?? null;
  const overlays = useMemo<PageOverlays | undefined>(() => {
    if (!located) return undefined;
    const layer = <SearchOverlay key="search" match={located.match} />;
    return { get: (page) => (page === located.page ? layer : undefined) };
  }, [located]);

  // Metin görünümü: eşleşmenin DOM aralıkları vurgulanır; sayfalar çevrilince ya da yeniden çizilince yeniden kurulur
  const textSpan = view === 'text' ? (active?.span ?? null) : null;
  useEffect(() => {
    const root = rootRef.current;
    if (!textSpan || !root) return;
    const registry = highlightRegistry();
    let frame = 0;
    let clearBoxes = () => {};
    const apply = () => {
      frame = 0;
      const ranges = sentenceRanges(root, blocks, textSpan);
      if (!registry) {
        clearBoxes();
        clearBoxes = paintFallback(ranges, 'search-fallback');
      } else if (ranges.length) registry.set(SEARCH_HIGHLIGHT, new Highlight(...ranges));
      else registry.delete(SEARCH_HIGHLIGHT);
    };
    apply();
    const observer = new MutationObserver((records) => {
      if (!ownMutation(records)) frame ||= requestAnimationFrame(apply);
    });
    observer.observe(root, { childList: true, subtree: true });
    const resize = registry
      ? null
      : new ResizeObserver(() => (frame ||= requestAnimationFrame(apply)));
    resize?.observe(root);
    if (registry) {
      root.classList.add(SEARCH_LIT);
      root.addEventListener('selectstart', noSelect);
    }
    return () => {
      root.classList.remove(SEARCH_LIT);
      root.removeEventListener('selectstart', noSelect);
      observer.disconnect();
      resize?.disconnect();
      cancelAnimationFrame(frame);
      clearBoxes();
      registry?.delete(SEARCH_HIGHLIGHT);
    };
  }, [rootRef, blocks, textSpan]);

  return { show, clear, overlays, active: active !== null };
}
