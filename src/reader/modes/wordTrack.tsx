import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { Block } from '../../convert/types';
import type { PageCharMap } from '../../text/pageGeometry';
import { sentenceText, type SentencePages, type SentencePart } from '../../text/sentencePages';
import type { Sentence } from '../../text/sentences';
import { charRects } from './focusWords';
import { speakableMap, type SpeechProgress } from './readAloud';
import { useTextHighlight } from './textHighlight';
import { speechWords, trimWord, wordAtChar, type WordSpan } from './wordTiming';
import { wordPageRange } from './wordPlace';

/**
 * Okunan kelimenin vurgusu (Plan 14). Kelime saniyede birkaç kez değişir: okuyucu (BookReader) her kelimede yeniden
 * çizilmesin diye kelime React durumunda değil, küçük bir depodadır. Okurken her karede denetleyicinin `progress`i
 * okunur, kelime değişince depo güncellenir; yalnızca depoya abone olan küçük katmanlar yeniden çizilir (metin
 * görünümünde `::highlight(mypdfbook-word)`, sayfa görünümünde cümlenin katmanının yanındaki SVG).
 */

/** Okunan kelime: cümle ve bloktaki [start, end) */
export interface ActiveWord {
  sentence: number;
  block: number;
  start: number;
  end: number;
}

export interface WordStore {
  get(): ActiveWord | null;
  set(word: ActiveWord | null): void;
  subscribe(listener: () => void): () => void;
}

export function createWordStore(): WordStore {
  let word: ActiveWord | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => word,
    set(next) {
      const same =
        next === word ||
        (next &&
          word &&
          next.sentence === word.sentence &&
          next.start === word.start &&
          next.end === word.end);
      if (same) return;
      word = next;
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Metin görünümünde okunan kelimenin vurgusu (book.css) */
export const WORD_HIGHLIGHT = 'mypdfbook-word';
/** API'siz tarayıcıda kelimenin yedek kutuları (book.css) */
const WORD_FALLBACK = 'word-fallback';

/** Okunan yerin okunma aralığı (ms) */
const READ_MS = 50;

/** Cümlenin okunan metni ve kelimeleri (cümle metninde) */
interface SentenceWords {
  map: number[];
  spokenLength: number;
  raw: string;
  words: WordSpan[];
}

/**
 * Okurken okunan kelimeyi izler: `playing` iken her karede (requestAnimationFrame: sekme gizliyken durur), duraklatınca
 * ya da cümle değişince bir kez. Okunan metindeki konum cümle metnine (dipnot imleri, görünmez karakterler) çevrilir;
 * kelimenin baş ve sonundaki noktalama vurgulanmaz.
 */
export function useWordTracker({
  on,
  playing,
  current,
  progress,
  sentences,
  blocks,
  store,
}: {
  /** kelime takibi açık (sesli okuma açık, ayar açık) */
  on: boolean;
  playing: boolean;
  /** etkin cümle (değişince bir kez okunur) */
  current: number;
  progress(): SpeechProgress | null;
  sentences(): Sentence[] | null;
  blocks: Block[];
  store: WordStore;
}): void {
  const latest = useRef({ progress, sentences });
  useEffect(() => {
    latest.current = { progress, sentences };
  });
  /** son cümlenin kelimeleri (her karede yeniden bölünmesin) */
  const cache = useRef<{ s: Sentence; words: SentenceWords } | null>(null);

  useEffect(() => {
    // Kitap ya da dil değişmiş olabilir: kelimeler yeniden bölünür
    cache.current = null;
    if (!on) {
      store.set(null);
      return;
    }
    const read = () => {
      const p = latest.current.progress();
      const list = latest.current.sentences();
      const s = p && list ? list[p.index] : undefined;
      if (!p || !s) return store.set(null);
      let entry = cache.current?.s === s ? cache.current.words : null;
      if (!entry) {
        const raw = sentenceText(blocks, s);
        const { text, map } = speakableMap(raw);
        entry = { map, spokenLength: text.length, raw, words: speechWords(raw) };
        cache.current = { s, words: entry };
      }
      const rawOffset = entry.map[Math.min(Math.max(0, p.offset), entry.spokenLength)] ?? 0;
      const k = wordAtChar(entry.words, rawOffset);
      if (k < 0) return store.set(null);
      const w = trimWord(entry.raw, entry.words[k]);
      store.set({ sentence: s.id, block: s.block, start: s.start + w.start, end: s.start + w.end });
    };
    read();
    if (!playing) return;
    // Kelime saniyede birkaç kez değişir: her karede değil, en çok READ_MS'de bir okunur (120 Hz ekranda pil)
    let last = 0;
    let frame = requestAnimationFrame(function tick(now) {
      if (now - last >= READ_MS) {
        last = now;
        read();
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [on, playing, current, blocks, store]);

  // Kapanınca kelime kalmaz
  useEffect(() => () => store.set(null), [store]);
}

/** Depodaki kelime */
export function useActiveWord(store: WordStore): ActiveWord | null {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/**
 * Metin görünümünde okunan kelimenin vurgusu: yalnızca bu bileşen kelimeyle yeniden çizilir (okuyucunun ağacında
 * boş bir yer kaplar).
 */
export function WordTextLayer({
  store,
  rootRef,
  blocks,
}: {
  store: WordStore;
  rootRef: RefObject<HTMLElement | null>;
  blocks: Block[];
}) {
  const word = useActiveWord(store);
  useTextHighlight(rootRef, blocks, word, false, {
    name: WORD_HIGHLIGHT,
    fallbackClass: WORD_FALLBACK,
    priority: 1,
    root: false,
  });
  return null;
}

/**
 * Sayfa görünümünde okunan kelimenin vurgusu: cümlenin bu sayfadaki parçasının yanında ayrı bir SVG (aynı ölçek).
 * Kelime parçada değilse (sayfa sınırından taşan cümlenin öteki sayfası) çizilmez.
 */
export function WordOverlay({
  store,
  pages,
  sentence,
  text,
  part,
}: {
  store: WordStore;
  pages: SentencePages;
  sentence: Sentence;
  /** cümlenin metni */
  text: string;
  part: SentencePart;
}) {
  const word = useActiveWord(store);
  const [map, setMap] = useState<{ page: number; map: PageCharMap } | null>(null);
  useEffect(() => {
    let alive = true;
    pages.pageMap(part.page).then(
      (m) => {
        if (alive) setMap({ page: part.page, map: m });
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [pages, part.page]);
  if (!word || word.sentence !== sentence.id || map?.page !== part.page) return null;
  const range = wordPageRange(part, text, word.start - sentence.start, word.end - sentence.start);
  if (!range) return null;
  const rects = charRects(map.map, range[0], range[1]);
  return (
    <svg
      className="sentence-overlay word-overlay"
      data-testid="word-overlay"
      data-word={text.slice(word.start - sentence.start, word.end - sentence.start)}
      viewBox={`0 0 ${part.pageWidth} ${part.pageHeight}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <g className="word-marks">
        {rects.map((r, i) => (
          <rect
            key={i}
            className="word-mark"
            x={r.x - 1}
            y={r.y - 0.5}
            width={r.width + 2}
            height={r.height + 1}
            rx={2}
          />
        ))}
      </g>
      {rects.map((r, i) => (
        <rect
          key={`u${i}`}
          className="word-underline"
          x={r.x}
          y={r.y + r.height + 0.2}
          width={r.width}
          height={1.4}
          rx={0.7}
        />
      ))}
    </svg>
  );
}
