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
import type { Block, Lang } from '../../convert/types';
import type { PdfDocument } from '../../pdf/pdfjs';
import type { PageSentence, SentencePages } from '../../text/sentencePages';
import type { Sentence } from '../../text/sentences';
import type { BookSource } from '../FlipBook';
import type { ReadingPosition } from '../progress';
import type { ReaderView } from '../readerPrefs';
import { DIMMED_PAGE, SentenceOverlay } from '../SentenceOverlay';
import { clientToPage, sentenceAtOffset, sentenceAtPoint, type SentenceRects } from './focusHit';
import { getFocusPrefs, setFocusPrefs, useFocusPrefs, type FocusPrefs } from './focusPrefs';
import type { PageOverlays } from './pageHighlight';
import { locatorAtPoint, useTextHighlight } from './textHighlight';
import { pagesFor, returnFocus, useSentencePlayer } from './useSentencePlayer';

/**
 * Kalemle odak: Apple Pencil'ın (ya da farenin) üstünde durduğu cümle açık, gerisi karanlık kalır.
 *
 * - **Kalem havada** (iPadOS 16.1+, havadan algılayan kalem) ya da **fare**: `pointermove` noktanın altındaki cümleyi
 *   seçer. Sayfa görünümünde nokta PDF sayfasına çevrilip sayfanın cümle dikdörtgenleriyle karşılaştırılır (en yakın,
 *   küçük toleransla); metin görünümünde imleç yeri (`caretPositionFromPoint`) → blok konumu → cümle.
 * - **Kalem değince:** "Kalemle her zaman çiz" açıksa (sayfa görünümünde) çizer; değilse yalnızca odağı taşır, sayfa
 *   çevirmez, menü açmaz (olaylar yakalama aşamasında kitaba ulaşmadan durdurulur).
 * - **Parmak:** dokunma ve kaydırma sayfa çevirir; basılı tutup (~350 ms) sürüklemek odağı taşır.
 * - ↑/↓ bir cümle geri/ileri (cümle sayfadan çıkınca sayfa çevrilir), Esc kapatır.
 *
 * Nokta her karede en çok bir kez denetlenir; odak küçük bir depoda durur: okuyucu her harekette (her cümlede de)
 * yeniden çizilmez, yalnızca vurgu katmanları çizilir.
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
  /** bir cümle ileri, geri (↓/↑) */
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

/** Odağın anlık durumu */
interface FocusState {
  /** odaktaki cümle (-1: yok) */
  id: number;
  /** karartma sönüyor (kalem kalktı, ayar kapalı) */
  fading: boolean;
  /** sayfa görünümünde açık PDF sayfaları: cümle bunlardan birindeyse öteki açık sayfa tamamen kararır */
  shown: readonly number[];
}

interface FocusStore {
  get(): FocusState;
  set(patch: Partial<FocusState>): void;
  subscribe(listener: () => void): () => void;
}

function createFocusStore(): FocusStore {
  let value: FocusState = { id: -1, fading: false, shown: [] };
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(patch) {
      const next = { ...value, ...patch };
      if (
        next.id === value.id &&
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

/** Parmağın basılı tutma süresi (ms): bundan sonra sürükleme odağı taşır */
export const LONG_PRESS_MS = 350;
/** Basılı tutarken bundan çok kayan parmak kaydırmadır (px; sayfa çevirmenin dokunma eşiği) */
const PRESS_SLOP = 8;
/** Noktanın cümleye en çok bu kadar uzak olabileceği (ekran pikseli): satır arası, kenar */
const HIT_TOLERANCE = 18;
/** Kalem kalkınca karartmanın sönme süresi (ms; book.css ile aynı) */
const FADE_MS = 400;

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
  const latest = useRef({ view, penOn, blocks, list, pages, cancelGesture });
  useLayoutEffect(() => {
    latest.current = { view, penOn, blocks, list, pages, cancelGesture };
  });

  const fadeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Odağı cümleye taşır (sönmekte olan karartma geri gelir) */
  const setFocus = useCallback(
    (id: number) => {
      clearTimeout(fadeTimer.current);
      store.set({ id, fading: false });
    },
    [store],
  );
  /** Karartma söner, sonra odak kalkar */
  const fadeOut = useCallback(() => {
    if (store.get().id < 0 || store.get().fading) return;
    store.set({ fading: true });
    clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => store.set({ id: -1, fading: false }), FADE_MS);
  }, [store]);

  /** Açık sayfanın ilk cümlesine (kaldığı cümle açıksa ona) */
  const focusShown = useCallback(
    (last: number) => {
      const before = store.get().id;
      start(last, (from) => {
        // Bu arada kalem başka cümleye geçtiyse onunki geçerli
        if (store.get().id === before) setFocus(from);
      });
    },
    [start, store, setFocus],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
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
    [sentenceIndex, follow, start, store, setFocus, show],
  );

  const close = useCallback(() => {
    cancelStart();
    clearTimeout(fadeTimer.current);
    store.set({ id: -1, fading: false });
    returnFocus('focus-bar', buttonRef);
    setOpen(false);
  }, [cancelStart, store, buttonRef]);

  const toggleOpen = useCallback(() => {
    if (open) return close();
    setList(sentenceIndex());
    setOpen(true);
    focusShown(-1);
  }, [open, close, sentenceIndex, focusShown]);

  // Sayfa değişti (okur çevirdi, görünüm değişti; okuma yeri sayfayla değişir): açık sayfalar güncellenir; odaktaki
  // cümle görünmüyorsa odak açık sayfanın ilk cümlesine geçer (karartma sönmüşse sönük kalır)
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
    if (s.id >= 0 && !s.fading) focusShown(s.id);
  }, [open, view, pos, sourceRef, store, focusShown]);

  // Görünen sayfaların cümleleri önceden toplanır: kalem ilk değdiğinde beklemesin
  useEffect(() => {
    if (!open || !pages) return;
    for (const p of store.get().shown) void pages.onPage(p).catch(() => undefined);
  }, [open, pages, pos, store]);

  // Kökteki işaretler: karartma düzeyi, sönme, odaktaki cümle (sınamalar için)
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
      root.classList.toggle('focus-fading', s.fading);
    };
    sync();
    const unsubscribe = store.subscribe(sync);
    return () => {
      unsubscribe();
      delete root.dataset.focusSentence;
      root.classList.remove('focus-fading');
    };
  }, [open, rootRef, store]);

  // Kalem, fare ve parmak
  useEffect(() => {
    const root = rootRef.current;
    if (!open || !root) return;

    /** Sayfaların cümle dikdörtgenleri (sayfa görünümü), sayfa yeri önbelleğine göre */
    const pageItems = new Map<number, { width: number; height: number; items: SentenceRects[] }>();
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

    /** Noktadaki cümle; bilinmiyorsa (sayfanın cümleleri toplanıyor) undefined */
    const hit = (x: number, y: number): number | null | undefined => {
      const { view: v, blocks: b, list: all, pages: sp } = latest.current;
      if (!all) return null;
      if (v === 'text') {
        const at = locatorAtPoint(root, b, x, y, HIT_TOLERANCE);
        return at ? (sentenceAtOffset(all, at)?.id ?? null) : null;
      }
      if (!sp) return null;
      if (sp !== itemsOf) {
        itemsOf = sp;
        pageItems.clear();
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
      const known = pageItems.get(page);
      if (!known) {
        if (!loading.has(page)) {
          loading.add(page);
          sp.onPage(page).then(
            (found: PageSentence[]) => {
              if (itemsOf !== sp) return;
              const first = found[0]?.part;
              pageItems.set(page, {
                width: first?.pageWidth ?? 0,
                height: first?.pageHeight ?? 0,
                items: found.map((f) => ({ id: f.sentence.id, rects: f.part.rects })),
              });
              // Beklenen nokta hâlâ geçerliyse şimdi denetlenir
              if (point === null && last) schedule(last.x, last.y);
            },
            () => loading.delete(page),
          );
        }
        return undefined;
      }
      if (known.items.length === 0) return null;
      const p = clientToPage(el.getBoundingClientRect(), known.width, known.height, x, y);
      return p ? sentenceAtPoint(known.items, p.x, p.y, HIT_TOLERANCE * p.unit) : null;
    };

    const run = () => {
      frame = 0;
      const p = point;
      point = null;
      if (!p) return;
      last = p;
      const id = hit(p.x, p.y);
      if (id === undefined || id === null) return;
      setFocus(id);
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
  }, [open, rootRef, setFocus, fadeOut]);

  // Tuşlar: ↑/↓ cümle cümle, Esc kapatır (menüden ve sayfa çevirmeden önce: yakalama aşaması). Kalem kipinde Esc
  // kalem kipinden çıkar.
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
            get: (page) => <FocusPageOverlay key="focus" page={page} pages={pages} store={store} />,
          }
        : undefined,
    [open, pages, list, store],
  );

  const textLayer = useMemo(
    () =>
      open && view === 'text' && list ? (
        <FocusTextHighlight rootRef={rootRef} blocks={blocks} list={list} store={store} />
      ) : null,
    [open, view, list, rootRef, blocks, store],
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
 * Sayfa görünümünde bir PDF sayfasının odak katmanı: odaktaki cümle bu sayfadaysa cümle dışı kararır (cümle açık,
 * sarı vurgu yok); cümle açık öteki sayfadaysa bu (açık) sayfa tamamen kararır. Cümlenin yeri, noktanın cümlesi
 * gibi sayfanın cümle listesinden (SentencePages.onPage) okunur. Odağı kendisi izler: okuyucu ve sayfa yeniden
 * çizilmez.
 */
function FocusPageOverlay({
  page,
  pages,
  store,
}: {
  page: number;
  pages: SentencePages;
  store: FocusStore;
}) {
  const state = useSyncExternalStore(store.subscribe, store.get);
  const lists = usePageLists(pages, [page, ...state.shown]);
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

/** Metin görünümünde odak: bütün yazı soluk (ya da bulanık), odaktaki cümle ::highlight ile açık */
function FocusTextHighlight({
  rootRef,
  blocks,
  list,
  store,
}: {
  rootRef: RefObject<HTMLElement | null>;
  blocks: Block[];
  list: Sentence[];
  store: FocusStore;
}) {
  const state = useSyncExternalStore(store.subscribe, store.get);
  const sentence = state.id >= 0 ? (list[state.id] ?? null) : null;
  useTextHighlight(rootRef, blocks, sentence, !state.fading);
  return null;
}
