import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';
import { getPenPrefs } from '../../annotations/penPrefs';
import type { Block, Lang, Locator } from '../../convert/types';
import type { PdfDocument } from '../../pdf/pdfjs';
import type { PageCharMap } from '../../text/pageGeometry';
import type { PageSentence, SentencePages } from '../../text/sentencePages';
import type { Sentence } from '../../text/sentences';
import type { BookSource } from '../FlipBook';
import type { ReadingPosition } from '../progress';
import type { ReaderView } from '../readerPrefs';
import { DIMMED_PAGE, SentenceOverlay, type OverlayPad } from '../SentenceOverlay';
import { clientToPage, sentenceAtOffset, sentenceAtPoint, type SentenceRects } from './focusHit';
import {
  getFocusPrefs,
  setFocusPrefs,
  useFocusPrefs,
  type FocusPrefs,
  type FocusUnit,
} from './focusPrefs';
import {
  charAfterWords,
  charAtPoint,
  locatorAfterWords,
  movePageCenter,
  moveTextCenter,
  pageEdge,
  pageWindow,
  textWindow,
  type PageWindow,
  type TextWindow,
} from './focusWords';
import type { PageOverlays } from './pageHighlight';
import { locatorAtPoint, useTextHighlight } from './textHighlight';
import { pagesFor, returnFocus, useSentencePlayer } from './useSentencePlayer';

/**
 * Kalemle odak: Apple Pencil'ın (ya da farenin) üstünde durduğu yer açık, gerisi karanlık kalır. Açık kalan yer
 * kalemin altındaki kelime ve iki yanındaki N kelime (varsayılan; kalem ilerledikçe pencere de anında kayar) ya da
 * kalemin altındaki cümlenin tamamıdır.
 *
 * - **Kalem havada** (iPadOS 16.1+, havadan algılayan kalem) ya da **fare**: `pointermove` noktanın altındaki yeri
 *   seçer. Sayfa görünümünde nokta PDF sayfasına çevrilir: kelime penceresi sayfanın harf haritasından (en yakın
 *   harf, küçük toleransla), cümle sayfanın cümle dikdörtgenlerinden bulunur. Metin görünümünde imleç yeri
 *   (`caretPositionFromPoint`) → blok konumu → kelime ya da cümle.
 * - **Kalem değince:** "Kalemle her zaman çiz" açıksa (sayfa görünümünde) çizer; değilse yalnızca odağı taşır, sayfa
 *   çevirmez, menü açmaz (olaylar yakalama aşamasında kitaba ulaşmadan durdurulur).
 * - **Parmak:** dokunma ve kaydırma sayfa çevirir; basılı tutup (~350 ms) sürüklemek odağı taşır.
 * - ↑/↓ bir cümle (kelime penceresinde N kelime) geri/ileri (sayfadan çıkınca sayfa çevrilir), Esc kapatır.
 *
 * Nokta her karede en çok bir kez denetlenir; odak küçük bir depoda durur: okuyucu her harekette yeniden çizilmez,
 * yalnızca vurgu katmanları çizilir.
 */

interface Options {
  blocks: Block[];
  lang: Lang;
  view: ReaderView;
  pdf: PdfDocument | null;
  pos: ReadingPosition;
  sourceRef: RefObject<BookSource | null>;
  turnNext(): void;
  /** kitabın kökü: olaylar burada dinlenir, odak sınıfları buna konur */
  rootRef: RefObject<HTMLElement | null>;
  /** ↑/↓ ve Esc bizim mi (üstte panel ya da pencere açıkken değil) */
  keys: boolean;
  /** kalem kipi: kalem ve fare dokunuşu çizer, parmak sayfa çevirmez; Esc kalem kipinden çıkar */
  penOn: boolean;
  hold: boolean;
  /** süren dokunma hareketini bırakır (FlipBookHandle.cancelGesture): parmağın sürüklemesi odağa geçti */
  cancelGesture(): void;
  /** başlıktaki "Odak" düğmesi: çubuk kapanınca odak ona döner */
  buttonRef: RefObject<HTMLButtonElement | null>;
}

export interface FocusModeUi {
  available: boolean;
  open: boolean;
  toggleOpen(): void;
  close(): void;
  /** bir cümle (kelime penceresinde N kelime) ileri, geri (↓/↑) */
  next(): void;
  prev(): void;
  prefs: FocusPrefs;
  setPrefs(patch: Partial<FocusPrefs>): void;
  /** metin görünümünde bulanık seçeneği (CSS Custom Highlight API gerekir) */
  canBlur: boolean;
  /** sayfa görünümünde odak katmanı (usePdfBook → overlays) */
  overlays: PageOverlays | undefined;
  /** metin görünümünde odak vurgusu: okuyucu çizer, yalnızca kendisi yeniden çizilir */
  textLayer: ReactNode;
}

/** Kelime penceresi: sayfa görünümünde bir PDF sayfasında, metin görünümünde blok aralıklarında */
type WordFocus =
  | { view: 'page'; page: number; win: PageWindow; pageWidth: number; pageHeight: number }
  | { view: 'text'; win: TextWindow };

/** Odağın anlık durumu */
interface FocusState {
  /** odaktaki cümle (kelime penceresinde pencerenin ortasındaki kelimenin cümlesi; -1: yok) */
  id: number;
  /** kelime penceresi (cümle odağında null) */
  words: WordFocus | null;
  /** karartma sönüyor (kalem kalktı, ayar kapalı) */
  fading: boolean;
  /** sayfa görünümünde açık PDF sayfaları: odak bunlardan birindeyse öteki açık sayfa tamamen kararır */
  shown: readonly number[];
}

interface FocusStore {
  get(): FocusState;
  set(patch: Partial<FocusState>): void;
  subscribe(listener: () => void): () => void;
}

function createFocusStore(): FocusStore {
  let value: FocusState = { id: -1, words: null, fading: false, shown: [] };
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(patch) {
      const next = { ...value, ...patch };
      if (
        next.id === value.id &&
        next.words === value.words &&
        next.fading === value.fading &&
        next.shown.length === value.shown.length &&
        next.shown.every((p, i) => p === value.shown[i])
      )
        return;
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** Odakta bir şey açık mı (cümle ya da kelime penceresi) */
const active = (s: FocusState) => s.id >= 0 || s.words !== null;

/** Aynı pencere mi (kalem aynı kelimenin üstünde kıpırdadı: yeniden çizilmez) */
function sameWords(a: WordFocus | null, b: WordFocus | null): boolean {
  if (!a || !b) return a === b;
  if (a.view === 'page' && b.view === 'page')
    return a.page === b.page && a.win.start === b.win.start && a.win.end === b.win.end;
  if (a.view === 'text' && b.view === 'text')
    return (
      a.win.center.block === b.win.center.block &&
      a.win.center.offset === b.win.center.offset &&
      a.win.ranges.length === b.win.ranges.length &&
      a.win.ranges.every(
        (r, i) =>
          r.block === b.win.ranges[i].block &&
          r.start === b.win.ranges[i].start &&
          r.end === b.win.ranges[i].end,
      )
    );
  return false;
}

/** Parmağın basılı tutma süresi (ms): bundan sonra sürükleme odağı taşır */
export const LONG_PRESS_MS = 350;
/** Basılı tutarken bundan çok kayan parmak kaydırmadır (px; sayfa çevirmenin dokunma eşiği) */
const PRESS_SLOP = 8;
/** Noktanın cümleye (harfe) en çok bu kadar uzak olabileceği (ekran pikseli): satır arası, kenar */
const HIT_TOLERANCE = 18;
/** Kalem kalkınca karartmanın sönme süresi (ms; book.css ile aynı) */
const FADE_MS = 400;
/** Kelime penceresinin delikleri: harflerden biraz taşar, köşeleri hafif yuvarlak (PDF birimi) */
const WORD_PAD: OverlayPad = { x: 2, y: 1, radius: 3 };

/** Parmağın basılı tutması */
interface Press {
  pointerId: number;
  x: number;
  y: number;
  /** son nokta */
  lastX: number;
  lastY: number;
  timer: ReturnType<typeof setTimeout>;
  /** basılı tutma doldu: sürükleme odağı taşır */
  active: boolean;
  /** parmak kalktı (ardından gelen dokunma olayı da yutulur) */
  ended: boolean;
}

/** Sayfanın harf haritası ve cümleleri (sayfa görünümünde noktanın altındaki yer bunlardan bulunur) */
interface PageInfo {
  map: PageCharMap;
  items: SentenceRects[];
  /** cümlelerin sayfa metnindeki [start, end) aralığı */
  spans: { id: number; start: number; end: number }[];
}

/** Sayfa metnindeki harfin cümlesi: harfi içeren, yoksa harften önce başlayan son cümle */
function sentenceAtChar(spans: PageInfo['spans'], c: number): number | null {
  let found: number | null = null;
  for (const s of spans) {
    if (s.start > c) break;
    found = s.id;
    if (c < s.end) break;
  }
  return found;
}

const spansOf = (found: PageSentence[]) =>
  found.map((f) => ({ id: f.sentence.id, start: f.part.start, end: f.part.end }));

const stylus = (e: TouchEvent) =>
  Array.from(e.changedTouches).some(
    (t) => (t as Touch & { touchType?: string }).touchType === 'stylus',
  );

export function useFocusMode({
  blocks,
  lang,
  view,
  pdf,
  pos,
  sourceRef,
  turnNext,
  rootRef,
  keys,
  penOn,
  hold,
  cancelGesture,
  buttonRef,
}: Options): FocusModeUi {
  const hasText = useMemo(() => blocks.some((b) => 'text' in b && b.text.trim() !== ''), [blocks]);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Sentence[] | null>(null);
  const [store] = useState(createFocusStore);
  const prefs = useFocusPrefs();
  const { unit, words: size } = prefs;

  const player = useSentencePlayer({
    blocks,
    lang,
    view,
    pdf,
    pos,
    sourceRef,
    turnNext,
    rootRef,
    hold,
    open,
    current: () => store.get().id,
    playing: () => false,
    paint: false,
  });
  const { index: sentenceIndex, start, show, follow, cancelStart } = player;

  const pages = useMemo(
    () => (view === 'page' && pdf && list ? pagesFor(pdf, blocks, list) : null),
    [view, pdf, blocks, list],
  );

  // Olay dinleyicileri bir kez kurulur; en güncel değerleri buradan okur
  const latest = useRef({
    view,
    penOn,
    blocks,
    list,
    pages,
    cancelGesture,
    unit,
    size,
    pdf,
    pos,
    turnNext,
  });
  useLayoutEffect(() => {
    latest.current = {
      view,
      penOn,
      blocks,
      list,
      pages,
      cancelGesture,
      unit,
      size,
      pdf,
      pos,
      turnNext,
    };
  });

  const fadeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Odağı cümleye taşır (sönmekte olan karartma geri gelir) */
  const setFocus = useCallback(
    (id: number) => {
      clearTimeout(fadeTimer.current);
      store.set({ id, words: null, fading: false });
    },
    [store],
  );
  /** Kelime penceresini taşır (aynı pencereyse yeniden çizilmez; sönmekte olan karartma geri gelir) */
  const setWords = useCallback(
    (words: WordFocus, id: number | null) => {
      clearTimeout(fadeTimer.current);
      const cur = store.get();
      store.set({
        words: sameWords(cur.words, words) ? cur.words : words,
        id: id ?? cur.id,
        fading: false,
      });
    },
    [store],
  );
  /** Karartma söner, sonra odak kalkar */
  const fadeOut = useCallback(() => {
    if (!active(store.get()) || store.get().fading) return;
    store.set({ fading: true });
    clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(
      () => store.set({ id: -1, words: null, fading: false }),
      FADE_MS,
    );
  }, [store]);

  /** Sayfa görünümünde `c` harfinin çevresindeki pencere (sayfanın cümleleriyle: ortadaki kelimenin cümlesi) */
  const pageWords = useCallback(
    async (sp: SentencePages, page: number, c: (map: PageCharMap) => number | null) => {
      const [map, found] = await Promise.all([
        sp.pageMap(page),
        sp.onPage(page).catch(() => [] as PageSentence[]),
      ]);
      const center = c(map);
      const win = center === null ? null : pageWindow(map, center, latest.current.size);
      if (!win) return null;
      const words: WordFocus = {
        view: 'page',
        page,
        win,
        pageWidth: map.width,
        pageHeight: map.height,
      };
      return { words, id: sentenceAtChar(spansOf(found), win.center) };
    },
    [],
  );

  /** Cümlenin başından başlayan kelime penceresi (açılınca, sayfa çevrilince, cümleden kelimeye geçince) */
  const wordsFromSentence = useCallback(
    async (id: number): Promise<WordFocus | null> => {
      const { view: v, blocks: b, list: all, pages: sp, size: n } = latest.current;
      const s = all?.[id];
      if (!s) return null;
      if (v === 'text') {
        const at = locatorAfterWords(b, { block: s.block, offset: s.start }, n);
        const win = textWindow(b, at, n);
        return win && { view: 'text', win };
      }
      if (!sp) return null;
      const parts = await sp.locate(s).catch(() => []);
      const shown = store.get().shown;
      const part = parts.find((p) => shown.includes(p.page)) ?? parts[0];
      if (!part) return null;
      const r = await pageWords(sp, part.page, (map) => charAfterWords(map, part.start, n)).catch(
        () => null,
      );
      return r?.words ?? null;
    },
    [store, pageWords],
  );

  /** Odağı cümleye (kelime penceresinde cümlenin başına) taşır */
  const focusTo = useCallback(
    (id: number) => {
      if (latest.current.unit === 'sentence') return setFocus(id);
      clearTimeout(fadeTimer.current);
      store.set({ id, fading: false });
      void wordsFromSentence(id).then((words) => {
        // Bu arada kalem başka yere geçtiyse onunki geçerli
        if (words && store.get().id === id && latest.current.unit === 'word') setWords(words, id);
      });
    },
    [store, setFocus, setWords, wordsFromSentence],
  );

  /** Açık sayfanın ilk cümlesine (kaldığı cümle açıksa ona) */
  const focusShown = useCallback(
    (last: number) => {
      const before = store.get();
      start(last, (from) => {
        // Bu arada kalem başka yere geçtiyse onunki geçerli
        const now = store.get();
        if (now.id === before.id && now.words === before.words) focusTo(from);
      });
    },
    [start, store, focusTo],
  );

  /** Kelime penceresi açık sayfada mı */
  const wordsShown = useCallback(
    (w: WordFocus): boolean => {
      if (w.view !== latest.current.view) return false;
      if (w.view === 'page') return store.get().shown.includes(w.page);
      const src = sourceRef.current;
      return !!src?.slotOf && src.slotOf({ locator: w.win.center, pdfPage: null }) === src.index;
    },
    [store, sourceRef],
  );

  /** Kelime penceresi açık değilse sayfayı ona çevirir (sonraki sayfaysa efektle) */
  const reveal = useCallback(
    (locator: Locator, pdfPage: number | null) => {
      const src = sourceRef.current;
      const slot = src?.slotOf?.({ locator, pdfPage }) ?? null;
      if (!src || slot === null || slot === src.index) return;
      if (slot === src.index + (src.spread ? 2 : 1)) latest.current.turnNext();
      else src.go(slot);
    },
    [sourceRef],
  );

  /** ↑/↓ kelime penceresinde: pencere N kelime kayar; sayfanın sonunda sonraki (başında önceki) sayfaya geçer */
  const stepWords = useCallback(
    (dir: 1 | -1) => {
      const s = store.get();
      const w = s.words;
      const { blocks: b, list: all, pages: sp, size: n, pdf: doc } = latest.current;
      if (!w || w.view !== latest.current.view) return focusShown(s.id);
      if (w.view === 'text') {
        const to = moveTextCenter(b, w.win.center, dir * n);
        const win = to && textWindow(b, to, n);
        if (!to || !win) return;
        setWords({ view: 'text', win }, all ? (sentenceAtOffset(all, to)?.id ?? null) : null);
        reveal(to, null);
        return;
      }
      if (!sp || !doc) return;
      void (async () => {
        const map = await sp.pageMap(w.page);
        const to = movePageCenter(map, w.win.center, dir * n);
        let r = to === null ? null : await pageWords(sp, w.page, () => to).catch(() => null);
        if (to === null) {
          // Sayfa bitti: sonraki sayfanın başı (önceki sayfanın sonu)
          const page = w.page + dir;
          if (page < 0 || page >= doc.numPages) return;
          r = await pageWords(sp, page, (m) => {
            const edge = pageEdge(m, dir < 0);
            if (edge === null) return null;
            return dir > 0 ? charAfterWords(m, edge, n) : (movePageCenter(m, edge, -n) ?? edge);
          }).catch(() => null);
        }
        // Bu arada kalem başka yere geçtiyse onunki geçerli
        if (!r || store.get().words !== w) return;
        setWords(r.words, r.id);
        if (r.words.view === 'page' && !store.get().shown.includes(r.words.page))
          reveal(latest.current.pos.locator, r.words.page);
      })();
    },
    [store, focusShown, setWords, reveal, pageWords],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      if (latest.current.unit === 'word') return stepWords(dir);
      const all = sentenceIndex();
      if (all.length === 0) return;
      follow();
      const cur = store.get().id;
      start(cur, (from) => {
        const to = from === cur ? Math.max(0, Math.min(all.length - 1, cur + dir)) : from;
        setFocus(to);
        // Cümle sayfadan çıktıysa sayfa çevrilir (okuma modlarının sayfa izlemesi)
        show(all, to);
      });
    },
    [stepWords, sentenceIndex, follow, start, store, setFocus, show],
  );

  const close = useCallback(() => {
    cancelStart();
    clearTimeout(fadeTimer.current);
    store.set({ id: -1, words: null, fading: false });
    returnFocus('focus-bar', buttonRef);
    setOpen(false);
  }, [cancelStart, store, buttonRef]);

  const toggleOpen = useCallback(() => {
    if (open) return close();
    setList(sentenceIndex());
    setOpen(true);
    focusShown(-1);
  }, [open, close, sentenceIndex, focusShown]);

  // Sayfa değişti (okur çevirdi, görünüm değişti; okuma yeri sayfayla değişir): açık sayfalar güncellenir; odak
  // görünmüyorsa açık sayfanın ilk cümlesine geçer (karartma sönmüşse sönük kalır)
  useEffect(() => {
    if (!open) return;
    const src = sourceRef.current;
    const shown: number[] = [];
    if (view === 'page' && src?.slotOf) {
      for (let p = Math.max(0, pos.pdfPage - 1); p <= pos.pdfPage + 1; p++)
        if (src.slotOf({ locator: pos.locator, pdfPage: p }) === src.index) shown.push(p);
    }
    store.set({ shown });
    const s = store.get();
    if (!active(s) || s.fading) return;
    if (latest.current.unit === 'word' && s.words && wordsShown(s.words)) return;
    focusShown(s.id);
  }, [open, view, pos, sourceRef, store, focusShown, wordsShown]);

  // Birim ya da pencere boyu değişti: odak yerinde kalır (kelime penceresi aynı kelimenin çevresinde yeniden kurulur)
  const shape = useRef({ unit, size });
  useEffect(() => {
    const prev = shape.current;
    shape.current = { unit, size };
    if (!open || (prev.unit === unit && prev.size === size)) return;
    const s = store.get();
    if (!active(s)) return;
    if (unit === 'sentence') {
      if (s.id >= 0) setFocus(s.id);
      else focusShown(-1);
      return;
    }
    const w = s.words;
    if (w?.view === 'text') {
      const win = textWindow(blocks, w.win.center, size);
      if (win) setWords({ view: 'text', win }, s.id);
    } else if (w?.view === 'page' && pages) {
      void pageWords(pages, w.page, () => w.win.center).then(
        (r) => r && store.get().words === w && setWords(r.words, r.id),
        () => undefined,
      );
    } else if (s.id >= 0) focusTo(s.id);
  }, [open, unit, size, store, blocks, pages, setFocus, setWords, focusShown, focusTo, pageWords]);

  // Görünen sayfaların cümleleri ve harf haritaları önceden toplanır: kalem ilk değdiğinde beklemesin
  useEffect(() => {
    if (!open || !pages) return;
    for (const p of store.get().shown) {
      void pages.onPage(p).catch(() => undefined);
      void pages.pageMap(p).catch(() => undefined);
    }
  }, [open, pages, pos, store]);

  // Kökteki işaretler: karartma düzeyi, sönme, odaktaki cümle ve penceredeki kelime sayısı (sınamalar için)
  const dim = prefs.dim === 'blur' && view !== 'text' ? 'medium' : prefs.dim;
  useEffect(() => {
    const root = rootRef.current;
    if (!open || !root) return;
    root.dataset.focusDim = dim;
    return () => {
      delete root.dataset.focusDim;
    };
  }, [open, rootRef, dim]);
  useEffect(() => {
    const root = rootRef.current;
    if (!open || !root) return;
    const sync = () => {
      const s = store.get();
      root.dataset.focusSentence = String(s.id);
      root.dataset.focusWords = String(s.words?.win.count ?? 0);
      root.classList.toggle('focus-fading', s.fading);
    };
    sync();
    const unsubscribe = store.subscribe(sync);
    return () => {
      unsubscribe();
      delete root.dataset.focusSentence;
      delete root.dataset.focusWords;
      root.classList.remove('focus-fading');
    };
  }, [open, rootRef, store]);

  // Kalem, fare ve parmak
  useEffect(() => {
    const root = rootRef.current;
    if (!open || !root) return;

    /** Sayfaların harf haritası ve cümleleri (sayfa görünümü), sayfa yeri önbelleğine göre */
    const pageInfo = new Map<number, PageInfo>();
    let itemsOf: SentencePages | null = null;
    const loading = new Set<number>();

    let frame = 0;
    /** denetlenecek nokta (sonraki karede) */
    let point: { x: number; y: number } | null = null;
    /** son denetlenen nokta (sayfanın cümleleri gelince yeniden denetlenir) */
    let last: { x: number; y: number } | null = null;
    let press: Press | null = null;
    /** değen kalemin işaretçisi: onun olayları kitaba gitmez */
    let penDown: number | null = null;

    /**
     * Noktadaki cümle ve (kelime penceresinde) pencere; noktada yazı yoksa null, bilinmiyorsa (sayfanın harfleri
     * toplanıyor) undefined
     */
    const hit = (
      x: number,
      y: number,
    ): { id: number | null; words?: WordFocus } | null | undefined => {
      const { view: v, blocks: b, list: all, pages: sp, unit: u, size: n } = latest.current;
      if (!all) return null;
      if (v === 'text') {
        const at = locatorAtPoint(root, b, x, y, HIT_TOLERANCE);
        if (!at) return null;
        const id = sentenceAtOffset(all, at)?.id ?? null;
        if (u === 'sentence') return id === null ? null : { id };
        const win = textWindow(b, at, n);
        return win && { id, words: { view: 'text', win } };
      }
      if (!sp) return null;
      if (sp !== itemsOf) {
        itemsOf = sp;
        pageInfo.clear();
        loading.clear();
      }
      const el = document
        .elementsFromPoint(x, y)
        .find(
          (e): e is HTMLElement =>
            e instanceof HTMLElement && e.matches('.pdf-page[data-pdf-page]') && root.contains(e),
        );
      if (!el) return null;
      const page = Number(el.dataset.pdfPage) - 1;
      const known = pageInfo.get(page);
      if (!known) {
        if (!loading.has(page)) {
          loading.add(page);
          Promise.all([sp.pageMap(page), sp.onPage(page)]).then(
            ([map, found]) => {
              if (itemsOf !== sp) return;
              pageInfo.set(page, {
                map,
                items: found.map((f) => ({ id: f.sentence.id, rects: f.part.rects })),
                spans: spansOf(found),
              });
              // Beklenen nokta hâlâ geçerliyse şimdi denetlenir
              if (point === null && last) schedule(last.x, last.y);
            },
            () => loading.delete(page),
          );
        }
        return undefined;
      }
      const { map } = known;
      const p = clientToPage(el.getBoundingClientRect(), map.width, map.height, x, y);
      if (!p) return null;
      if (u === 'sentence') {
        if (known.items.length === 0) return null;
        const id = sentenceAtPoint(known.items, p.x, p.y, HIT_TOLERANCE * p.unit);
        return id === null ? null : { id };
      }
      const c = charAtPoint(map, p.x, p.y, HIT_TOLERANCE * p.unit);
      const win = c === null ? null : pageWindow(map, c, n);
      if (!win) return null;
      return {
        id: sentenceAtChar(known.spans, win.center),
        words: { view: 'page', page, win, pageWidth: map.width, pageHeight: map.height },
      };
    };

    const run = () => {
      frame = 0;
      const p = point;
      point = null;
      if (!p) return;
      last = p;
      const r = hit(p.x, p.y);
      if (!r) return;
      if (r.words) setWords(r.words, r.id);
      else if (r.id !== null) setFocus(r.id);
    };
    const schedule = (x: number, y: number) => {
      point = { x, y };
      frame ||= requestAnimationFrame(run);
    };

    /** Kalemin dokunuşu çizime mi gider (sayfa görünümünde kalem kipi ya da "Kalemle her zaman çiz") */
    const penDraws = () =>
      latest.current.view === 'page' && (latest.current.penOn || getPenPrefs().penAlways);

    const endPress = () => {
      if (press) clearTimeout(press.timer);
      press = null;
      delete root.dataset.focusPress;
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'pen') {
        if (penDraws()) return;
        // Kalem yalnızca odağı taşır: sayfa çevirmez, menü açmaz, çizmez
        e.stopPropagation();
        e.preventDefault();
        penDown = e.pointerId;
        schedule(e.clientX, e.clientY);
        return;
      }
      if (e.pointerType !== 'touch') return;
      // İkinci parmak: basılı tutma bırakılır (iki parmak hareketi odağa değil)
      if (press && !press.ended) return endPress();
      endPress();
      // Kalem kipinde parmak çizer (ya da avuç reddiyle yok sayılır)
      if (latest.current.view === 'page' && latest.current.penOn) return;
      const pointerId = e.pointerId;
      press = {
        pointerId,
        x: e.clientX,
        y: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        active: false,
        ended: false,
        timer: setTimeout(() => {
          if (!press || press.pointerId !== pointerId || press.ended) return;
          press.active = true;
          // Parmak odağı sürüklüyor (testler basılı tutmanın dolduğunu bununla bilir)
          root.dataset.focusPress = '';
          // Kitabın başlattığı dokunma (kaydırma, dokunma) bırakılır: bırakınca sayfa çevrilmez, menü açılmaz
          latest.current.cancelGesture();
          schedule(press.lastX, press.lastY);
        }, LONG_PRESS_MS),
      };
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'pen') {
        if (penDown === e.pointerId) {
          e.stopPropagation();
          schedule(e.clientX, e.clientY);
        } else if (e.buttons === 0) schedule(e.clientX, e.clientY); // havada
        return;
      }
      if (e.pointerType === 'mouse') {
        if (e.buttons === 0) schedule(e.clientX, e.clientY);
        return;
      }
      if (!press || press.pointerId !== e.pointerId || press.ended) return;
      press.lastX = e.clientX;
      press.lastY = e.clientY;
      if (!press.active) {
        // Basılı tutma dolmadan kayan parmak kaydırmadır (sayfa çevirir)
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > PRESS_SLOP) endPress();
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      schedule(e.clientX, e.clientY);
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'pen' && penDown === e.pointerId) {
        e.stopPropagation();
        penDown = null;
        // Kalem kalktı: ayar kapalıyken söner (havadan algılayan kalem yeniden yaklaşınca yine açılır)
        if (!getFocusPrefs().keep) {
          point = null;
          fadeOut();
        }
        return;
      }
      if (!press || press.pointerId !== e.pointerId) return;
      if (!press.active) return endPress();
      // Sürükleme bitti: kitap bırakılışı görmez (dokunma sayılıp menü açılmasın, sayfa çevrilmesin)
      e.stopPropagation();
      e.preventDefault();
      clearTimeout(press.timer);
      press.ended = true;
      delete root.dataset.focusPress;
      if (!getFocusPrefs().keep) fadeOut();
    };

    // Kalem ya da fare kitaptan çıktı: ayar kapalıyken karartma söner
    const onLeave = (e: PointerEvent) => {
      if ((e.pointerType === 'pen' || e.pointerType === 'mouse') && !getFocusPrefs().keep) {
        point = null;
        fadeOut();
      }
    };

    // Kıvrılan sayfa kütüphanesi dokunma olaylarını dinler: odağın kalemi ve sürüklemesi ona gitmez
    const onTouchStart = (e: TouchEvent) => {
      if (!stylus(e) || penDraws()) return;
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!((stylus(e) && !penDraws()) || press?.active)) return;
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
    };
    const onTouchEnd = (e: TouchEvent) => {
      const swallow = (stylus(e) && !penDraws()) || press?.active;
      if (press?.ended) press = null;
      if (!swallow) return;
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
    };

    const opts = { capture: true, passive: false } as const;
    root.addEventListener('pointerdown', onDown, true);
    root.addEventListener('pointermove', onMove, true);
    root.addEventListener('pointerup', onUp, true);
    root.addEventListener('pointercancel', onUp, true);
    root.addEventListener('pointerleave', onLeave);
    root.addEventListener('touchstart', onTouchStart, opts);
    root.addEventListener('touchmove', onTouchMove, opts);
    root.addEventListener('touchend', onTouchEnd, opts);
    root.addEventListener('touchcancel', onTouchEnd, opts);
    return () => {
      cancelAnimationFrame(frame);
      endPress();
      itemsOf = null;
      root.removeEventListener('pointerdown', onDown, true);
      root.removeEventListener('pointermove', onMove, true);
      root.removeEventListener('pointerup', onUp, true);
      root.removeEventListener('pointercancel', onUp, true);
      root.removeEventListener('pointerleave', onLeave);
      root.removeEventListener('touchstart', onTouchStart, opts);
      root.removeEventListener('touchmove', onTouchMove, opts);
      root.removeEventListener('touchend', onTouchEnd, opts);
      root.removeEventListener('touchcancel', onTouchEnd, opts);
    };
  }, [open, rootRef, setFocus, setWords, fadeOut]);

  // Tuşlar: ↑/↓ cümle cümle (kelime penceresinde N kelime), Esc kapatır (menüden ve sayfa çevirmeden önce: yakalama
  // aşaması). Kalem kipinde Esc kalem kipinden çıkar.
  useEffect(() => {
    if (!open || !keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && t.closest('input, select, textarea, [contenteditable]'))
        return;
      if (e.key === 'ArrowDown') step(1);
      else if (e.key === 'ArrowUp') step(-1);
      else if (e.key === 'Escape' && !penOn) close();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, keys, penOn, step, close]);

  useEffect(() => () => clearTimeout(fadeTimer.current), []);

  const overlays = useMemo<PageOverlays | undefined>(
    () =>
      open && pages && list
        ? {
            get: (page) => (
              <FocusPageOverlay key="focus" page={page} pages={pages} store={store} unit={unit} />
            ),
          }
        : undefined,
    [open, pages, list, store, unit],
  );

  const textLayer = useMemo(
    () =>
      open && view === 'text' && list ? (
        <FocusTextHighlight
          rootRef={rootRef}
          blocks={blocks}
          list={list}
          store={store}
          unit={unit}
        />
      ) : null,
    [open, view, list, rootRef, blocks, store, unit],
  );

  return {
    available: hasText,
    open,
    toggleOpen,
    close,
    next: () => step(1),
    prev: () => step(-1),
    prefs,
    setPrefs: setFocusPrefs,
    canBlur: typeof CSS !== 'undefined' && 'highlights' in CSS,
    overlays,
    textLayer,
  };
}

/**
 * Sayfa görünümünde bir PDF sayfasının odak katmanı: odak (kelime penceresi ya da cümle) bu sayfadaysa gerisi
 * kararır (açık yer sarı vurgusuz, koyu temalarda hafifçe kısılmış); odak açık öteki sayfadaysa bu (açık) sayfa
 * tamamen kararır. Cümlenin yeri, noktanın cümlesi gibi sayfanın cümle listesinden (SentencePages.onPage) okunur.
 * Odağı kendisi izler: okuyucu ve sayfa yeniden çizilmez.
 */
function FocusPageOverlay({
  page,
  pages,
  store,
  unit,
}: {
  page: number;
  pages: SentencePages;
  store: FocusStore;
  unit: FocusUnit;
}) {
  const state = useSyncExternalStore(store.subscribe, store.get);
  const lists = usePageLists(pages, unit === 'word' ? [] : [page, ...state.shown]);
  if (unit === 'word') {
    const w = state.words?.view === 'page' ? state.words : null;
    if (!w) return null;
    if (w.page === page)
      return (
        <SentenceOverlay
          rects={w.win.rects}
          pageWidth={w.pageWidth}
          pageHeight={w.pageHeight}
          focus
          mark={false}
          pad={WORD_PAD}
          tint
        />
      );
    return state.shown.includes(page) && state.shown.includes(w.page) ? DIMMED_PAGE : null;
  }
  if (state.id < 0) return null;
  const here = lists.get(page)?.find((x) => x.sentence.id === state.id)?.part;
  if (here)
    return (
      <SentenceOverlay
        rects={here.rects}
        pageWidth={here.pageWidth}
        pageHeight={here.pageHeight}
        focus
        mark={false}
        tint
      />
    );
  const elsewhere =
    state.shown.includes(page) &&
    state.shown.some((p) => lists.get(p)?.some((x) => x.sentence.id === state.id));
  return elsewhere ? DIMMED_PAGE : null;
}

/** Sayfaların cümle listeleri (önbellekten; gelene dek boş) */
function usePageLists(pages: SentencePages, wanted: number[]): Map<number, PageSentence[]> {
  const [lists, setLists] = useState<{ key: string; map: Map<number, PageSentence[]> }>({
    key: '',
    map: new Map(),
  });
  const key = [...new Set(wanted)].sort((a, b) => a - b).join(',');
  useEffect(() => {
    let alive = true;
    const want = key ? key.split(',').map(Number) : [];
    Promise.all(
      want.map((p) =>
        pages.onPage(p).then(
          (l) => [p, l] as const,
          () => [p, [] as PageSentence[]] as const,
        ),
      ),
    ).then((entries) => {
      if (alive) setLists({ key, map: new Map(entries) });
    });
    return () => {
      alive = false;
    };
  }, [pages, key]);
  return lists.map;
}

/**
 * Metin görünümünde odak: bütün yazı soluk (ya da bulanık), odaktaki cümle ya da kelime penceresi ::highlight ile
 * açık (temanın yazı rengiyle, arka plansız)
 */
function FocusTextHighlight({
  rootRef,
  blocks,
  list,
  store,
  unit,
}: {
  rootRef: RefObject<HTMLElement | null>;
  blocks: Block[];
  list: Sentence[];
  store: FocusStore;
  unit: FocusUnit;
}) {
  const state = useSyncExternalStore(store.subscribe, store.get);
  const target =
    unit === 'word'
      ? state.words?.view === 'text'
        ? state.words.win.ranges
        : null
      : state.id >= 0
        ? (list[state.id] ?? null)
        : null;
  useTextHighlight(rootRef, blocks, target, !state.fading);
  return null;
}
