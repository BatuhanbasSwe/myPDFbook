import {
  AlignLeft,
  ArrowLeft,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  Focus,
  Gauge,
  Headphones,
  Highlighter,
  List,
  Lock,
  LockOpen,
  MoreHorizontal,
  NotebookPen,
  Search,
  Volume2,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type RefObject,
} from 'react';
import { flushSync } from 'react-dom';
import { Link } from 'react-router';
import { AnnotatorContext, useAnnotator } from '../annotations/annotator';
import { NoteEditor } from '../annotations/NoteEditor';
import { NotesPanel } from '../annotations/NotesPanel';
import { PenToolbar } from '../annotations/PenToolbar';
import { BookmarkContext, type BookmarkCorners } from '../bookmarks/BookmarkCorner';
import { BookmarksList, NavTabs, type NavTab } from '../bookmarks/BookmarksPanel';
import {
  deleteBookmark,
  toggleBookmark,
  useBookmarks,
  type BookmarkTarget,
  type SavedBookmark,
} from '../bookmarks/store';
import type { Locator } from '../convert/types';
import { saveProgress } from '../db/books';
import { db, type BookRecord, type ContentRecord, type ProgressRecord } from '../db/db';
import type { Viewport } from '../layout/pageBox';
import { useTypography } from '../layout/typography';
import type { PdfDocument } from '../pdf/pdfjs';
import type { SearchResult } from '../text/search';
import { FlipBook, type BookSource, type FlipBookHandle } from './FlipBook';
import { FocusBar } from './modes/FocusBar';
import { MenuButton, type MenuAction } from '../ui/MenuButton';
import { ReadAloudBar } from './modes/ReadAloudBar';
import { RsvpCard } from './modes/RsvpCard';
import { SpeedReaderBar } from './modes/SpeedReaderBar';
import { useFocusMode } from './modes/useFocusMode';
import { useReadAloud } from './modes/useReadAloud';
import { useSpeedReader } from './modes/useSpeedReader';
import { usePdfBook } from './pdfBook';
import {
  blockStartFractions,
  currentChapter,
  locatorFraction,
  locatorOfPdfPage,
  locatorOnPdfPage,
  pdfPageOfLocator,
  startPosition,
  type ReadingPosition,
} from './progress';
import { setReaderPrefs, useReaderPrefs, type ReaderView } from './readerPrefs';
import { countRender } from './renderCount';
import { blockPageRange } from './search/locateMatch';
import { SearchPanel } from './search/SearchPanel';
import { mergeOverlays, useSearchHit } from './search/useSearchHit';
import { SettingsSheet } from './SettingsSheet';
import { useTextBook } from './textBook';
import { TocDrawer } from './TocDrawer';
import { useSharpZoom, useZoomGestures, useZoomStore } from './zoom/useZoom';
import { ZoomBar } from './zoom/ZoomBar';
import { IconButton, iconButtonClass } from '../ui/IconButton';
import { Sheet } from '../ui/Sheet';
import { useTooltip } from '../ui/Tooltip';
import { useWide, WIDE } from '../ui/useMediaQuery';

interface Props {
  book: BookRecord;
  /** okurken sabit kalan içerik (bkz. ReaderPage) */
  content: ContentRecord;
  saved: ProgressRecord | null;
  pdf: PdfDocument | null;
  pdfFailed: boolean;
}

type Panel = 'settings' | 'toc' | 'notes' | 'search' | null;

const PANEL_LABELS: Record<Exclude<Panel, null>, string> = {
  settings: 'Görünüm ayarları',
  toc: 'İçindekiler',
  notes: 'Notlar',
  search: 'Kitapta ara',
};

/** Üst çubuk eyleminin yeri: çubukta düğme ya da ⋯ ("Diğer") menüsünde öğe */
type Place = 'bar' | 'more';

/**
 * Üst çubuğun eylemi. Yeri ekrana göre değişir: geniş ekranda (iPad, bilgisayar) ve dar ekranda (telefon) çubukta
 * düğme ya da ⋯ menüsünde öğe olur. Yeni eylem listeye bir öge eklemekle gelir.
 */
interface HeaderAction extends MenuAction {
  /** düğmenin erişilebilir adı (araç ipucu) */
  label: string;
  /** açtığı panel (aria-expanded, aria-controls) */
  panel?: Exclude<Panel, null>;
  /** menüdeki öbeği: öbekler arasında ayırıcı çizgi */
  group: 'find' | 'tools' | 'view';
  wide: Place;
  narrow: Place;
}

type Menu = 'more' | 'modes';

/** Okuma alanı çentik ve ev çubuğu gibi güvenli alan boşluklarının içinde kalır (sayfa numarası altında kalmasın) */
const SAFE_AREA: CSSProperties = {
  top: 'env(safe-area-inset-top, 0px)',
  right: 'env(safe-area-inset-right, 0px)',
  bottom: 'env(safe-area-inset-bottom, 0px)',
  left: 'env(safe-area-inset-left, 0px)',
};

/** Sesli okuma çubuğunun alttan uzaklığı (px): sayfa düğmeleri varken onların üstünde; kitapla arasındaki boşluk */
const BAR_BOTTOM = 8;
const BAR_RAISED = 56;
const BAR_GAP = 4;

/** Sayfa görünümünde kitabın üstünde ve altında bırakılan boşluk (px): kâğıdın kenarı görünsün */
const PAGE_GAP = 12;

/** Kilitliyken çevirme denenince "Sayfa kilitli" işaretinin görünme süresi (ms) */
const LOCK_NOTICE_MS = 1400;

/**
 * Kitap okuyucu. İki görünüm aynı çubukları, tuşları ve dokunmayı paylaşır; yalnızca sayfaların kaynağı değişir:
 * sayfa görünümünde PDF'in kendi sayfaları (pdfBook.tsx), metin görünümünde yeniden dizilmiş metin (textBook.tsx).
 * Okuma yeri iki görünümde birden tutulur (metindeki konum ve PDF sayfası): görünüm değişince aynı yer açılır.
 */
export function BookReader({ book, content, saved, pdf, pdfFailed }: Props) {
  // Testte: okuyucunun çizim sayısı (RSVP'de her kelimede çizilmesin; bkz. renderCount.ts, üretimde yok)
  if (import.meta.env.DEV) countRender('BookReader');
  const { blocks, chapters, version } = content;
  const t = useTypography();
  const prefs = useReaderPrefs();
  const rootRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<FlipBookHandle>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tocButton = useRef<HTMLButtonElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const panelId = useId();
  const backTip = useTooltip({ label: 'Kütüphaneye dön' });
  const vp = useViewport(rootRef);
  const pageCount = book.pdfPageCount;
  const [pos, setPos] = useState<ReadingPosition>(() =>
    startPosition(saved, blocks, version, Math.max(1, pageCount)),
  );
  const [ui, setUi] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  // Üst çubuğun açılır menüsü: ⋯ ("Diğer") ya da "Okuma modları"
  const [menu, setMenu] = useState<Menu | null>(null);
  const menuOpen = menu !== null;
  const moreButton = useRef<HTMLButtonElement>(null);
  const modesButton = useRef<HTMLButtonElement>(null);
  const wide = useWide();
  // Menü (üst çubuk) gizlenince açılır menü de kapanır: yeniden görününce kendiliğinden açık gelmez
  const [uiBefore, setUiBefore] = useState(ui);
  if (ui !== uiBefore) {
    setUiBefore(ui);
    if (!ui) setMenu(null);
  }
  // Sayfaya git: açıkken yazılan sayı
  const [jump, setJump] = useState<string | null>(null);
  // İçindekiler panelinin açık sekmesi (bölümler ya da yer imleri)
  const [navTab, setNavTab] = useState<NavTab>('toc');

  // Sayfa kilidi (oturumluk, saklanmaz): kilitliyken sayfa çevrilmez, sayfa yakınlaştırılır (zoom/). Çevirme
  // denenince kısa bir "Sayfa kilitli" işareti görünür; kilitlenip açılması ekran okuyucuya duyurulur.
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(locked);
  const [lockNotice, setLockNotice] = useState(false);
  const [lockMessage, setLockMessage] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showLocked = useCallback(() => {
    setLockNotice(true);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setLockNotice(false), LOCK_NOTICE_MS);
  }, []);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  const zoomStore = useZoomStore();
  // Durulmuş yakınlaştırma: açık PDF sayfaları o kadar keskin yeniden çizilir
  const sharpZoom = useSharpZoom(zoomStore);
  const zoomTarget = useRef<HTMLDivElement>(null);
  /** Kilitler ya da açar. Açılınca yakınlaştırma 1×'e döner (useZoomGestures). */
  const setLock = useCallback(
    (on: boolean) => {
      if (on === locked) return;
      setLocked(on);
      setLockMessage(on ? 'Sayfa kilitlendi' : 'Kilit açıldı');
      if (!on) setLockNotice(false);
    },
    [locked],
  );
  // Tuşlar, sayfa düğmeleri ve okuma modları kilidi hemen görsün
  useLayoutEffect(() => {
    lockedRef.current = locked;
  });

  // PDF açılamazsa sayfa görünümü olamaz: metin gösterilir
  const pageViewPossible = !pdfFailed && pageCount > 0;
  const view: ReaderView = prefs.view === 'page' && pageViewPossible ? 'page' : 'text';

  // Kitabın iki yanında sayfa kalınlığına yer ayrılır (sayfa boyutu okudukça değişmez)
  const area = useMemo<Viewport | null>(
    () =>
      vp
        ? {
            width: vp.width - 2 * EDGE_MAX,
            height: vp.height - (view === 'page' ? 2 * PAGE_GAP : 0),
          }
        : null,
    [vp, view],
  );

  const goLocator = useCallback(
    (locator: Locator) => setPos({ locator, pdfPage: pdfPageOfLocator(blocks, locator) }),
    [blocks],
  );
  const goPdfPage = useCallback(
    (pdfPage: number) => setPos({ pdfPage, locator: locatorOfPdfPage(blocks, pdfPage) }),
    [blocks],
  );

  // İşaretler (boyama, kalem, not) yalnızca sayfa görünümünde: PDF sayfasına göre saklanır
  const annot = useAnnotator(book.id, view === 'page');
  const { penOn, setPenMode, note, setNote } = annot;

  // Sesli okuma: okunan cümle vurgulanır, sayfa dışına çıkınca sayfa çevrilir (modes/useReadAloud.ts)
  const sourceRef = useRef<BookSource | null>(null);
  // Okumanın efektle çevirdiği sayfa: bu çevirme okurun değil, menü, panel ve not düzenleyicisi olduğu gibi kalır
  const autoTurn = useRef<number | null>(null);
  const modeOptions = {
    blocks,
    lang: content.lang,
    view,
    pdf,
    pos,
    sourceRef,
    turnNext: () => {
      // Kilitli sayfa okumayla da çevrilmez (okuma izlemeyi bırakır, bkz. hold)
      if (lockedRef.current) return;
      const src = sourceRef.current;
      if (src) autoTurn.current = src.index + (src.spread ? 2 : 1);
      flipRef.current?.next();
    },
    rootRef,
    // Açılır menü açıkken Esc menüyü kapatır, Boşluk öğeye basar
    keys: !panel && !note && !menuOpen,
    penOn,
    hold: !!note || !!panel || penOn || locked,
  };
  // Okuma modları "Okuma modları" menüsünde: çubuk kapanınca odak menünün düğmesine döner
  const readAloud = useReadAloud({ ...modeOptions, buttonRef: modesButton });
  // Hızlı okuma (modes/useSpeedReader.ts): aynı vurgu ve sayfa çevirme; sesli okumayla aynı anda açık olmaz
  const speed = useSpeedReader({ ...modeOptions, buttonRef: modesButton });
  // Kalemle odak (modes/useFocusMode.ts): kalemin üstünde durduğu cümle açık; okuma modlarıyla aynı anda açık olmaz
  const focusMode = useFocusMode({
    ...modeOptions,
    // okurun işi sürerken (not, panel) ve sayfa kilitliyken sayfa çevrilmez; kalem kipinde kalem çizer, odak havadaki
    // kalemle sürer
    hold: !!note || !!panel || locked,
    cancelGesture: () => flipRef.current?.cancelGesture(),
    buttonRef: modesButton,
  });
  const modeOpen = readAloud.open || speed.open || focusMode.open;
  // Arama sonucuna gidilince eşleşmenin vurgusu (search/useSearchHit.tsx)
  const searchHit = useSearchHit({ view, blocks, pdf, rootRef });
  const modeOverlays = readAloud.overlays ?? speed.overlays ?? focusMode.overlays;
  const overlays = useMemo(
    () => mergeOverlays(modeOverlays, searchHit.overlays),
    [modeOverlays, searchHit.overlays],
  );
  // Okuma açıkken çubuğun yüksekliği kitabın altında boş kalır: okunan son satırlar çubuğun altında kalmasın
  const [barHeight, setBarHeight] = useState(0);

  const textBook = useTextBook({
    active: view === 'text',
    book,
    content,
    area,
    typography: t,
    anchor: pos.locator,
    onGo: goLocator,
    pdf,
    pdfFailed,
  });
  const pdfBook = usePdfBook({
    active: view === 'page',
    pdf,
    pdfFailed,
    pageCount,
    area,
    spread: t.spread,
    pdfPage: pos.pdfPage,
    onGo: goPdfPage,
    overlays,
    zoom: sharpZoom,
  });
  const source = view === 'page' ? pdfBook : textBook;
  const step = source?.spread ? 2 : 1;
  useLayoutEffect(() => {
    // Kilitliyken okuma modları (sesli ve hızlı okuma, odak) sayfayı doğrudan da değiştiremez
    sourceRef.current = source && locked ? { ...source, go: () => undefined } : source;
  });

  // Kilitli sayfada yakınlaştırma ve kaydırma (zoom/useZoom.ts). Tek dokunma menüyü açıp kapar (sayfa çevirmez);
  // üstte panel, menü ya da not açıksa yalnızca onu kapatır. Kalem kipinde dokunma menüyü açmaz.
  const { step: zoomStep, reset: zoomReset } = useZoomGestures({
    store: zoomStore,
    rootRef,
    targetRef: zoomTarget,
    active: locked && !!source,
    book: { width: source ? source.pageWidth * step : 0, height: source?.pageHeight ?? 0 },
    resetKey: view,
    penOn,
    onTap: () => {
      searchHit.clear();
      const dismiss = dismissRef.current;
      if (dismiss) dismiss();
      else if (!penOn) setUi((v) => !v);
    },
    cancelGesture: () => flipRef.current?.cancelGesture(),
  });

  const fractions = useMemo(() => blockStartFractions(blocks), [blocks]);
  // Kaydedilen oran metindeki konumdan (kitap yeniden dönüştürülünce oradan açılır); gösterilen oran görünüme göre
  const textFraction = locatorFraction(blocks, fractions, pos.locator);
  const shownFraction =
    view === 'page' ? (pageCount > 1 ? pos.pdfPage / (pageCount - 1) : 0) : textFraction;

  useProgressSaver(book.id, pos, textFraction, version);

  // Kilitliyken sayfa düğmeleri ve tuşlar çevirmez: "Sayfa kilitli" işareti görünür
  const next = useCallback(
    () => (lockedRef.current ? showLocked() : flipRef.current?.next()),
    [showLocked],
  );
  const prev = useCallback(
    () => (lockedRef.current ? showLocked() : flipRef.current?.prev()),
    [showLocked],
  );

  // Kitaba dokunma üstteki paneli, menüyü ya da notu kapatır (sayfa çevirmez)
  const onDismiss = menuOpen
    ? () => setMenu(null)
    : panel
      ? () => setPanel(null)
      : note
        ? () => setNote(null)
        : undefined;
  const dismissRef = useRef(onDismiss);
  useLayoutEffect(() => {
    dismissRef.current = onDismiss;
  });

  // Yer imleri (köşe kıvırma): PDF sayfasına bağlı. Metin görünümünde açık sayfanın başladığı PDF sayfasına bağlanır,
  // sayfanın metindeki başı da saklanır.
  const bookmarks = useBookmarks(book.id);
  const bookmarkCorners = useMemo<BookmarkCorners>(
    () => ({
      marked: new Set((bookmarks ?? []).map((b) => b.pdfPage)),
      // Menü açıkken yer imi olmayan köşe de hafifçe görünür
      hint: ui,
      passive: penOn,
      toggle: (pdfPage, locator) => {
        // Üstte panel, menü ya da not açıkken köşeye dokunma da (kitaba dokunma gibi) yalnızca onu kapatır
        const dismiss = dismissRef.current;
        if (dismiss) return dismiss();
        toggleBookmark(db, book.id, [{ pdfPage, locator }]).catch(() => undefined);
      },
    }),
    [bookmarks, ui, penOn, book.id],
  );
  // Açık sayfalar (çift sayfada ikisi, soldan): B tuşu ve yer imleri listesindeki açık sayfa
  const shownTargets: BookmarkTarget[] = [];
  for (let k = 0; source && k < step; k++) {
    const i = source.index + k;
    if (view === 'page') {
      const p = i - (source.spread ? 1 : 0);
      if (p >= 0 && p < pageCount) shownTargets.push({ pdfPage: p });
    } else {
      const start = source.pageStart?.(i);
      if (start) shownTargets.push({ pdfPage: pdfPageOfLocator(blocks, start), locator: start });
    }
  }
  // Açık sayfalardan birinde yer imi var (başlıktaki "Yer imi" düğmesi basılı)
  const shownMarked = shownTargets.some((t) => bookmarkCorners.marked.has(t.pdfPage));
  // B tuşu açık sayfanın yer imini açıp kapar (tuş dinleyicisi en güncel açık sayfayı görsün)
  const toggleShown = useRef(() => {});
  useLayoutEffect(() => {
    toggleShown.current = () => {
      toggleBookmark(db, book.id, shownTargets).catch(() => undefined);
    };
  });
  // Saklanan konum kitap yeniden dönüştürüldüyse (bloklar yeniden numaralandı) eskimiş olabilir: sayfanınki alınır
  const bookmarkLocator = (b: SavedBookmark) => locatorOnPdfPage(blocks, b.pdfPage, b.locator);
  const goBookmark = (b: SavedBookmark) => {
    setLock(false); // gidilen yer açılsın: kilit önce açılır
    if (view === 'page') goPdfPage(b.pdfPage);
    else goLocator(bookmarkLocator(b));
    setPanel(null);
    setUi(false);
  };

  // Not düzenleyicisi kapanınca odak kaybolmasın: notun iğnesine döner; not silindiyse ya da yeni notsa kalem araç
  // çubuğunun seçili aracına (Not)
  const closeNote = useCallback(
    (toPin: boolean) => {
      const id = note?.record?.id;
      setNote(null);
      requestAnimationFrame(() => {
        const pin =
          toPin && id !== undefined
            ? rootRef.current?.querySelector<HTMLElement>(`[data-note-id="${id}"]`)
            : null;
        (
          pin ??
          document.querySelector<HTMLElement>('[data-testid="pen-toolbar"] [aria-pressed="true"]')
        )?.focus({ preventScroll: true });
      });
    },
    [note, setNote],
  );

  // Klavye: ←/→ sayfa çevirir; Esc paneli kapatır ya da menüyü açıp kapatır, Enter ve M menüyü açıp kapatır, B açık
  // sayfanın yer imini açıp kapar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      // Not yazılırken tuşlar yazıya gider
      if (e.target instanceof HTMLTextAreaElement) return;
      // Boşluk ve Enter yalnızca kitabın üstündeyken bizim (düğmede düğmeye basar)
      const onBook =
        e.target === document.body ||
        (e.target instanceof Node && !!rootRef.current?.contains(e.target));
      // Kitabın içindeki düğme (not iğnesi) de Boşluk ve Enter'la kendisi basılır
      const bookButton = onBook && e.target instanceof HTMLButtonElement;
      if (e.key === 'Escape') {
        if (menu) {
          const button = (menu === 'modes' ? modesButton : moreButton).current;
          setMenu(null);
          button?.focus();
        } else if (note) closeNote(true);
        else if (panel) {
          setPanel(null);
          // Panelin düğmesi ⋯ menüsündeyse (notlar; telefonda arama) odak ⋯ düğmesine döner
          const button = {
            toc: tocButton,
            notes: moreButton,
            settings: settingsButton,
            search: searchButton,
          }[panel].current;
          (button && button.getClientRects().length > 0 ? button : moreButton.current)?.focus();
        } else if (penOn) setPenMode(false);
        else setUi((v) => !v);
      } else if (
        panel ||
        e.target instanceof HTMLInputElement ||
        (bookButton && (e.key === ' ' || e.key === 'Enter'))
      )
        return;
      else if (
        e.key === 'ArrowRight' ||
        e.key === 'PageDown' ||
        (e.key === ' ' && onBook && !e.shiftKey)
      )
        next();
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && onBook)) prev();
      else if ((e.key === 'Enter' && onBook) || e.key === 'm' || e.key === 'M') setUi((v) => !v);
      else if (e.key === 'b' || e.key === 'B') toggleShown.current();
      // L sayfayı kilitler ya da açar; kilitliyken + / − yakınlaştırır, 0 sıfırlar
      else if (e.key === 'l' || e.key === 'L') setLock(!lockedRef.current);
      else if (lockedRef.current && (e.key === '+' || e.key === '=')) zoomStep(1);
      else if (lockedRef.current && e.key === '-') zoomStep(-1);
      else if (lockedRef.current && e.key === '0') zoomReset();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, panel, note, closeNote, penOn, setPenMode, menu, setLock, zoomStep, zoomReset]);

  // Açılır menü ekran genişliği değişince (telefonu yan çevirme: eylemlerin yeri değişir) kapanır. Dışarıya dokunma
  // MenuButton'da kapatır; kitaba dokunma kitabın kendi yoluyla kapatır (onDismiss): sayfa çevirmez, menüyü gizlemez.
  useEffect(() => {
    if (!menuOpen) return;
    const mq = window.matchMedia(WIDE);
    const onChange = () => setMenu(null);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [menuOpen]);
  const keepMenuOpen = useCallback(
    (target: Element) => !penOn && !!target.closest('[data-testid="flipbook"]'),
    [penOn],
  );
  const openMenu = useCallback((which: Menu, open: boolean) => {
    if (!open) return setMenu(null);
    setPanel(null); // panel menünün üstünde kalırdı
    setMenu(which);
  }, []);

  // Açılan panelin ilk denetimine (içindekilerde okunan bölüme) odaklan
  useEffect(() => {
    const el = panelRef.current;
    if (!panel || !el) return;
    const first =
      el.querySelector<HTMLElement>('[aria-current="true"]') ??
      el.querySelector<HTMLElement>('button, input, a[href]');
    first?.focus();
  }, [panel]);

  // Menü gizlenince odak görünmez bir düğmede kalmasın (Boşluk/Enter ona basardı): odak kitaba döner
  useEffect(() => {
    if (ui) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      (headerRef.current?.contains(active) || footerRef.current?.contains(active))
    )
      active.blur();
  }, [ui]);

  const chapterIndex = currentChapter(chapters, pos.locator);
  const chapterTitle = chapterIndex >= 0 ? chapters[chapterIndex].title : '';

  const onTap = (x: number) => {
    // Arama sonucunun vurgusu bir sonraki dokunuşta kalkar
    searchHit.clear();
    if (panel) return setPanel(null);
    if (prefs.tap && x < 1 / 3) prev();
    else if (prefs.tap && x > 2 / 3) next();
    else setUi((v) => !v);
  };

  const togglePanel = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));

  // Arama sonucuna gidilir, eşleşme vurgulanır. Sayfa görünümünde hemen bloğun başladığı sayfa açılır; eşleşme PDF
  // sayfalarında aranır (uzun paragraf sonraki sayfalara taşar), başka sayfada bulunursa oraya geçilir.
  const goSearchResult = (r: SearchResult) => {
    setLock(false); // gidilen yer açılsın: kilit önce açılır
    setPanel(null);
    setUi(false);
    setJump(null);
    setNote(null);
    if (view === 'text') {
      searchHit.show(r).catch(() => undefined);
      goLocator(r.locator);
      return;
    }
    const [first] = blockPageRange(blocks, r.block, pageCount);
    goPdfPage(first);
    searchHit.show(r).then(
      (found) => {
        if (found?.page != null && found.page !== first) goPdfPage(found.page);
      },
      () => undefined,
    );
  };
  // Sonuç listesindeki sayfa: metin görünümünde kitabın sayfası; sayfa görünümünde eşleşmenin olabileceği PDF
  // sayfaları (paragraf sonraki sayfaya taşıyorsa "4–5": sonuca gidilince bunlardan biri açılır)
  const searchPageLabel = (r: SearchResult) => {
    if (view === 'text' && source?.pageOf) return String(source.pageOf(r.locator) + 1);
    const [first, last] = blockPageRange(blocks, r.block, pageCount);
    return first === last ? String(first + 1) : `${first + 1}–${last + 1}`;
  };

  // Üst çubuğun eylemleri. Sağda sıra: İçindekiler, Ara, Okuma modları, Kalem, Kilit, Aa, ⋯. Sık kullanılanlar
  // (ara, kalem, kilit) geniş ekranda tek dokunuşla çubukta; yer imi (sayfanın köşesiyle de konur), notlar ve görünüm
  // ⋯ menüsünde. Telefonda başlık okunsun diye çubukta yalnızca İçindekiler, Okuma modları ve Aa kalır.
  const actions: HeaderAction[] = [
    {
      id: 'reader-search',
      label: 'Kitapta ara',
      menuLabel: 'Kitapta ara',
      Icon: Search,
      panel: 'search',
      group: 'find',
      wide: 'bar',
      narrow: 'more',
      run: () => {
        // Panel dokunuşun içinde çizilir, kutu kendini odaklar (autoFocus): iPad'de klavye de açılır
        flushSync(() => togglePanel('search'));
      },
    },
    {
      // Menü açıkken başlık sayfanın üst köşesini örter: yer imi buradan da konur, kaldırılır (köşe gösterge kalır)
      id: 'reader-bookmark',
      label: 'Yer imi',
      menuLabel: 'Yer imi',
      Icon: shownMarked ? BookmarkCheck : Bookmark,
      pressed: shownMarked,
      shortcut: 'B',
      group: 'find',
      wide: 'more',
      narrow: 'more',
      run: () => {
        toggleBookmark(db, book.id, shownTargets).catch(() => undefined);
      },
    },
  ];
  if (pageViewPossible)
    actions.push({
      id: 'reader-notes',
      label: 'Notlar',
      menuLabel: 'Notlar',
      Icon: NotebookPen,
      panel: 'notes',
      group: 'find',
      wide: 'more',
      narrow: 'more',
      run: () => {
        togglePanel('notes');
        setNote(null); // not panelde de düzenlenir: iğnedeki düzenleyici kapanır
      },
    });
  if (view === 'page')
    actions.push({
      id: 'pen-mode',
      label: 'Kalem kipi',
      menuLabel: 'Kalem kipi',
      Icon: Highlighter,
      pressed: penOn,
      group: 'tools',
      wide: 'bar',
      narrow: 'more',
      run: () => {
        setPenMode(!penOn);
        if (!penOn) {
          // Kitap açıkta kalsın: menü ve panel kapanır, araç çubuğu çıkar
          setUi(false);
          setPanel(null);
          setJump(null);
        }
      },
    });
  actions.push({
    id: 'page-lock',
    label: 'Sayfayı kilitle',
    menuLabel: 'Sayfayı kilitle',
    Icon: locked ? Lock : LockOpen,
    pressed: locked,
    shortcut: 'L',
    group: 'tools',
    wide: 'bar',
    narrow: 'more',
    run: () => {
      setLock(!locked);
      if (!locked) {
        // Kitap açıkta kalsın (yakınlaştırılacak): menü ve panel kapanır
        setUi(false);
        setPanel(null);
        setJump(null);
      }
    },
  });
  if (pageViewPossible)
    actions.push({
      id: 'view-toggle',
      label: view === 'page' ? 'Metin görünümüne geç' : 'Sayfa görünümüne geç',
      menuLabel: view === 'page' ? 'Metin görünümü' : 'Sayfa görünümü',
      Icon: view === 'page' ? AlignLeft : BookOpen,
      group: 'view',
      wide: 'more',
      narrow: 'more',
      run: () => setReaderPrefs({ view: view === 'page' ? 'text' : 'page' }),
    });
  // ⋯ menüsündekiler (ekrana göre); öbekler arasında ayırıcı
  const moreActions = actions
    .filter((a) => (wide ? a.wide : a.narrow) === 'more')
    .map((a, i, list) => ({ ...a, divider: i > 0 && list[i - 1].group !== a.group }));
  /** Çubuktaki düğme: yalnızca bir ekranda çubuktaysa ötekinde gizlenir */
  const barButton = (id: string) => {
    const a = actions.find((x) => x.id === id);
    if (!a || (a.wide !== 'bar' && a.narrow !== 'bar')) return null;
    return (
      <IconButton
        key={a.id}
        // Esc paneli kapatınca odak düğmesine döner
        ref={a.panel === 'search' ? searchButton : undefined}
        testId={a.id}
        label={a.label}
        Icon={a.Icon}
        shortcut={a.shortcut}
        aria-pressed={a.pressed}
        aria-expanded={a.panel ? panel === a.panel : undefined}
        aria-controls={a.panel && panel === a.panel ? panelId : undefined}
        onClick={a.run}
        className={`${a.narrow !== 'bar' ? 'max-sm:hidden' : ''} ${a.wide !== 'bar' ? 'sm:hidden' : ''}`}
      />
    );
  };

  // "Okuma modları" menüsü: sesli okuma, hızlı okuma ve odak (biri açılınca öteki kapanır)
  const modeActions: MenuAction[] = [];
  if (readAloud.available)
    modeActions.push({
      id: 'read-aloud',
      menuLabel: 'Sesli oku',
      Icon: Volume2,
      pressed: readAloud.open,
      run: () => {
        if (!readAloud.open) {
          speed.close();
          focusMode.close();
        }
        // Okuma dokunuşun içinde başlar (iOS)
        readAloud.toggleOpen();
      },
    });
  if (speed.available)
    modeActions.push({
      id: 'speed-read',
      menuLabel: 'Hızlı oku',
      Icon: Gauge,
      pressed: speed.open,
      run: () => {
        if (!speed.open) {
          readAloud.close();
          focusMode.close();
        }
        speed.toggleOpen();
      },
    });
  if (focusMode.available)
    modeActions.push({
      id: 'focus-mode',
      menuLabel: 'Odak',
      Icon: Focus,
      pressed: focusMode.open,
      run: () => {
        if (!focusMode.open) {
          readAloud.close();
          speed.close();
        }
        focusMode.toggleOpen();
      },
    });
  const openMode = modeActions.find((a) => a.pressed)?.id;

  // Açık panelin düğmesi (geniş ekranda panel onun altında açılır); düğme ⋯ menüsündeyse ⋯ düğmesi
  const panelAnchor = useMemo<RefObject<HTMLElement | null>>(
    () => ({
      get current() {
        const button =
          panel === 'toc'
            ? tocButton.current
            : panel === 'settings'
              ? settingsButton.current
              : panel === 'search'
                ? searchButton.current
                : null;
        return button && button.getClientRects().length > 0 ? button : moreButton.current;
      },
    }),
    [panel],
  );

  // Gizli menü ekranda görünmez ama klavyeyle ulaşılabilir: odak gelince görünür
  const hidden = ui ? '' : 'pointer-events-none opacity-0';
  // Menü gizliyken alttaki sayfa düğmeleri (ayar; kalem kipinde her zaman)
  const pageButtons = (prefs.buttons || penOn) && !ui;
  // Sesli okuma çubuğunun kitabın altında ayrılan yeri (menü gizliyken çubuğun durduğu yer; menü açılıp kapanınca
  // sayfa yeniden dizilmesin diye menüye bağlı değil)
  const reserve =
    modeOpen && barHeight > 0
      ? barHeight + (prefs.buttons || penOn ? BAR_RAISED : BAR_BOTTOM) + BAR_GAP
      : 0;
  const bookArea: CSSProperties = reserve
    ? { ...SAFE_AREA, bottom: `calc(env(safe-area-inset-bottom, 0px) + ${reserve}px)` }
    : SAFE_AREA;

  // Sayfaya git: sayfa görünümünde PDF sayfası, metin görünümünde kitabın sayfası (1'den)
  const jumpValue = jump === null ? NaN : Number(jump.trim());
  const jumpValid =
    source !== null && Number.isInteger(jumpValue) && jumpValue >= 1 && jumpValue <= source.total;
  const submitJump = (e: FormEvent) => {
    e.preventDefault();
    if (!jumpValid) return;
    setLock(false); // yazılan sayfa açılsın: kilit önce açılır
    if (view === 'page') goPdfPage(jumpValue - 1);
    else textBook?.go(jumpValue - 1);
    setJump(null);
  };

  const status = source ? `${source.label} / ${source.total}` : '';
  const left = pagesLeftInChapter();

  /**
   * Okunan bölümde açık sayfadan sonra kalan sayfa (sonraki bölümün başladığı sayfaya dek; son bölümde kitabın
   * sonuna dek). Bölümde değilse ya da metin henüz sayfalanmadıysa null.
   */
  function pagesLeftInChapter(): number | null {
    // İlk bölümden önce (kapak, önsöz) bölüm sayılmaz: oran gösterilir
    if (!source || chapterIndex < 0) return null;
    const from = chapters[chapterIndex].block;
    const nextChapter = chapters.find((c) => c.block > from);
    const start = nextChapter ? { block: nextChapter.block, offset: 0 } : null;
    if (view === 'page') {
      if (shownTargets.length === 0) return null;
      const last = Math.max(...shownTargets.map((t) => t.pdfPage));
      const end = start ? pdfPageOfLocator(blocks, start) : pageCount;
      return Math.max(0, end - last - 1);
    }
    if (!source.pageOf) return null;
    const last = Math.min(source.index + step - 1, source.total - 1);
    const end = start ? source.pageOf(start) : source.total;
    return Math.max(0, end - last - 1);
  }

  return (
    <div
      data-testid="reader"
      data-view={view}
      className={`fixed inset-0 text-ink ${view === 'page' ? 'reader-page-view' : 'reader-text-view bg-paper'}`}
    >
      <div
        ref={rootRef}
        // Kilitliyken tarayıcı dokunmayla kaydırmaz, yakınlaştırmaz: parmaklar kitabı yakınlaştırır ve kaydırır
        className={`absolute grid place-items-center overflow-hidden ${locked ? 'touch-none' : ''}`}
        data-locked={locked || undefined}
        style={bookArea}
      >
        {source ? (
          <div
            // Yakınlaştırma bu kutuya yazılır (sayfalar, işaretler, vurgular ve yer imi köşeleri birlikte büyür)
            ref={zoomTarget}
            data-testid="zoom-surface"
            style={{
              boxShadow: pageEdges(source.index, source.count),
              // Parlaklık yalnızca kitaba uygulanır (çubuklar ve paneller değişmez)
              filter: prefs.brightness !== 1 ? `brightness(${prefs.brightness})` : undefined,
            }}
          >
            <AnnotatorContext value={annot.value}>
              <BookmarkContext value={bookmarkCorners}>
                <FlipBook
                  ref={flipRef}
                  count={source.count}
                  index={source.index}
                  spread={source.spread}
                  effect={prefs.effect}
                  swipe={prefs.swipe}
                  width={source.pageWidth * step}
                  height={source.pageHeight}
                  onIndexChange={(i) => {
                    const auto = autoTurn.current === i;
                    autoTurn.current = null;
                    source.go(i);
                    if (auto) return; // okumanın çevirdiği sayfa: yazılan not, açık panel ve menü kalır
                    searchHit.clear();
                    setUi(false);
                    setJump(null);
                    setPanel(null); // kıvrılan sayfada panel açıkken kaydırma sayfayı çevirir
                    setNote(null);
                  }}
                  onTap={onTap}
                  onDismiss={onDismiss}
                  // Kalem kipinde dokunma ve sürükleme çizer: sayfa düğmeler, tuşlar ve kaydırıcıyla çevrilir. Kilitli
                  // sayfada dokunma ve sürükleme yakınlaştırır ve kaydırır (useZoomGestures)
                  gesturesDisabled={penOn || locked}
                  renderPage={source.renderPage}
                />
              </BookmarkContext>
            </AnnotatorContext>
          </div>
        ) : (
          <p className="text-sm text-muted">
            {view === 'page' ? 'Kitap açılıyor…' : 'Sayfalar hazırlanıyor…'}
          </p>
        )}
      </div>

      {/* RSVP kartı kitabın ortasında, kitap arkada kararmış (kitabın kökünün dışında: vurgu gözlemcisi her kelimede
          çalışmasın) */}
      {speed.open && speed.state?.mode === 'rsvp' && <RsvpCard sr={speed} style={bookArea} />}

      {/* Ekran okuyucu sayfa değişimini duyurur */}
      <p className="sr-only" aria-live="polite">
        {source ? `Sayfa ${status}` : ''}
      </p>
      <p className="sr-only" aria-live="polite" data-testid="lock-status">
        {lockMessage}
      </p>

      {/* Alt düğmeler: ortada, sayfa numarasının iki yanında. Kalem kipinde her zaman: dokunma çizer, sayfa
          (klavyesiz iPad'de) bunlarla çevrilir */}
      {pageButtons && source && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[max(0.25rem,env(safe-area-inset-bottom))] flex items-center justify-center gap-1.5">
          <IconButton
            label="Önceki sayfa"
            shortcut="←"
            tipSide="above"
            Icon={ChevronLeft}
            onClick={prev}
            className="material pointer-events-auto"
          />
          <span className="material min-w-16 rounded-full px-3 py-1.5 text-center text-xs font-medium tabular-nums text-secondary">
            {source.label}
          </span>
          <IconButton
            label="Sonraki sayfa"
            shortcut="→"
            tipSide="above"
            Icon={ChevronRight}
            onClick={next}
            className="material pointer-events-auto"
          />
        </div>
      )}

      <header
        ref={headerRef}
        data-testid="reader-header"
        data-shown={ui}
        onFocus={() => setUi(true)}
        className={`material-bar absolute inset-x-0 top-0 z-(--ui-z-bar) flex items-center gap-0.5 px-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] pb-1.5 shadow-[0_0.5px_0_var(--ui-hairline)] transition-opacity duration-200 ${hidden}`}
      >
        <Link
          to="/"
          aria-label="Kütüphaneye dön"
          {...backTip.handlers}
          className={iconButtonClass()}
        >
          <ArrowLeft className="size-[22px]" strokeWidth={1.75} />
        </Link>
        {backTip.tip}
        <h1 className="min-w-0 flex-1 truncate px-1 text-[17px] font-semibold tracking-[-0.01em]">
          {book.title}
        </h1>
        <IconButton
          ref={tocButton}
          label="İçindekiler"
          Icon={List}
          testId="reader-toc"
          aria-expanded={panel === 'toc'}
          aria-controls={panel === 'toc' ? panelId : undefined}
          onClick={() => togglePanel('toc')}
        />
        {barButton('reader-search')}
        {modeActions.length > 0 && (
          <MenuButton
            label="Okuma modları"
            testId="reading-modes"
            menuTestId="reading-modes-menu"
            Icon={Headphones}
            actions={modeActions}
            open={menu === 'modes'}
            onOpenChange={(open) => openMenu('modes', open)}
            active={!!openMode}
            dataActive={openMode}
            keepOpen={keepMenuOpen}
            buttonRef={modesButton}
          />
        )}
        {barButton('pen-mode')}
        {barButton('page-lock')}
        <IconButton
          ref={settingsButton}
          testId="reader-settings"
          label="Görünüm ayarları"
          aria-expanded={panel === 'settings'}
          aria-controls={panel === 'settings' ? panelId : undefined}
          active={panel === 'settings'}
          onClick={() => togglePanel('settings')}
          className="text-[17px] font-medium tracking-[-0.01em]"
        >
          Aa
        </IconButton>
        {moreActions.length > 0 && (
          <MenuButton
            label="Diğer"
            testId="reader-more"
            menuTestId="reader-more-menu"
            Icon={MoreHorizontal}
            actions={moreActions}
            open={menu === 'more'}
            onOpenChange={(open) => openMenu('more', open)}
            keepOpen={keepMenuOpen}
            buttonRef={moreButton}
          />
        )}
      </header>

      {/* Panel, başlıktaki düğmesinin hemen ardından gelir (klavyede sıra) */}
      {panel && (
        <Sheet
          ref={panelRef}
          id={panelId}
          testId="reader-panel"
          label={PANEL_LABELS[panel]}
          anchorRef={panelAnchor}
          // Telefonda arama üstten açılır: klavye arama kutusunu örtmesin
          phone={panel === 'search' ? 'top' : 'bottom'}
        >
          {panel === 'settings' ? (
            <SettingsSheet textOnly={!pageViewPossible} />
          ) : panel === 'search' ? (
            <SearchPanel
              blocks={blocks}
              chapters={chapters}
              lang={content.lang}
              bookTitle={book.title}
              pageLabel={searchPageLabel}
              onGo={goSearchResult}
            />
          ) : panel === 'notes' ? (
            <NotesPanel
              bookId={book.id}
              textView={view === 'text'}
              // Açık PDF sayfaları: çift sayfada yuva i'de PDF sayfası i - 1 durur (bkz. pdfBook)
              currentPages={
                view === 'page' && source
                  ? Array.from({ length: step }, (_, k) => source.index - (step - 1) + k)
                  : [pos.pdfPage]
              }
              onGo={(page) => {
                setLock(false);
                // İşaretler PDF sayfasındadır: metin görünümünden sayfa görünümüne geçilir
                if (view === 'text') setReaderPrefs({ view: 'page' });
                goPdfPage(page);
                setPanel(null);
                setUi(false);
              }}
              onSaveNote={(record, text) => annot.editNote(record, text).catch(() => undefined)}
              onDelete={(records) => annot.remove(records).catch(() => undefined)}
            />
          ) : (
            <NavTabs
              tab={navTab}
              onTab={setNavTab}
              bookmarkCount={bookmarks?.length ?? 0}
              toc={
                <TocDrawer
                  chapters={chapters}
                  current={chapterIndex}
                  onSelect={(c) => {
                    setLock(false);
                    goLocator({ block: c.block, offset: 0 });
                    setPanel(null);
                    setUi(false);
                  }}
                />
              }
              bookmarks={
                <BookmarksList
                  bookmarks={bookmarks}
                  textView={view === 'text'}
                  isCurrent={(b) => shownTargets.some((t) => t.pdfPage === b.pdfPage)}
                  // Açık görünümdeki sayfa: sayfa görünümünde PDF sayfası, metin görünümünde kitabın sayfası
                  pageLabel={(b) =>
                    String(
                      (view === 'text' && source?.pageOf
                        ? source.pageOf(bookmarkLocator(b))
                        : b.pdfPage) + 1,
                    )
                  }
                  chapterOf={(b) => {
                    const c = currentChapter(chapters, bookmarkLocator(b));
                    return c >= 0 ? chapters[c].title : '';
                  }}
                  onGo={goBookmark}
                  onDelete={(b) => {
                    deleteBookmark(db, b.id).catch(() => undefined);
                  }}
                />
              }
            />
          )}
        </Sheet>
      )}

      {/* Sesli okuma çubuğu başlıktan (ve panelden) sonra: klavyede sıra "Sesli oku" düğmesinden sonra gelir */}
      {readAloud.open && (
        <ReadAloudBar
          ra={readAloud}
          footerRef={footerRef}
          ui={ui && !!source}
          raised={pageButtons && !!source}
          onHeight={setBarHeight}
        />
      )}
      {speed.open && (
        <SpeedReaderBar
          sr={speed}
          footerRef={footerRef}
          ui={ui && !!source}
          raised={pageButtons && !!source}
          onHeight={setBarHeight}
        />
      )}

      {focusMode.open && (
        <FocusBar
          fm={focusMode}
          textView={view === 'text'}
          footerRef={footerRef}
          ui={ui && !!source}
          raised={pageButtons && !!source}
          onHeight={setBarHeight}
        />
      )}
      {focusMode.textLayer}

      {/* Kilitli sayfanın yakınlaştırma çubuğu: okuma modu çubuğu açıksa onun üstünde */}
      {locked && source && (
        <ZoomBar
          store={zoomStore}
          footerRef={footerRef}
          ui={ui}
          raised={pageButtons}
          lift={modeOpen && barHeight > 0 ? barHeight + BAR_GAP + 4 : 0}
          notice={lockNotice}
          onStep={zoomStep}
          onReset={zoomReset}
          onUnlock={() => setLock(false)}
        />
      )}

      {/* Panel ya da ⋯ menüsü açıkken araç çubuğu çekilir (üstlerini örterdi) */}
      {penOn && !panel && !menuOpen && (
        <PenToolbar
          belowHeader={ui}
          canUndo={annot.canUndo}
          onUndo={annot.undo}
          onDone={() => setPenMode(false)}
        />
      )}

      {note && view === 'page' && (
        <NoteEditor
          target={note}
          onSave={(text) => {
            annot.saveNote(note, text).catch(() => undefined);
            closeNote(true);
          }}
          onDelete={() => {
            if (note.record) annot.remove(note.record).catch(() => undefined);
            closeNote(false);
          }}
          onClose={() => closeNote(true)}
        />
      )}

      {source && (
        <footer
          ref={footerRef}
          onFocus={() => setUi(true)}
          className={`material-bar absolute inset-x-0 bottom-0 z-(--ui-z-bar) flex flex-col gap-0.5 px-4 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] shadow-[0_-0.5px_0_var(--ui-hairline)] transition-opacity duration-200 ${hidden}`}
        >
          <input
            type="range"
            aria-label="Sayfa"
            aria-valuetext={`Sayfa ${status}`}
            data-testid="page-slider"
            min={0}
            max={source.count - 1}
            step={step}
            value={source.index}
            // Kilitliyken kaydırıcı sayfayı çevirmez (yerinde kalır)
            onChange={(e) => (locked ? showLocked() : source.go(Number(e.target.value)))}
            className="ui-range w-full"
            style={
              {
                '--fill': `${source.count > 1 ? (source.index / (source.count - 1)) * 100 : 0}%`,
              } as CSSProperties
            }
          />
          <div className="flex items-center justify-between gap-3 text-xs text-secondary">
            <span className="min-w-0 truncate">{chapterTitle}</span>
            {jump === null || !ui ? (
              <button
                type="button"
                data-testid="page-status"
                aria-label={`Sayfa ${status}; sayfaya git`}
                onClick={() => setJump('')}
                className="ui-press -my-2.5 min-h-11 shrink-0 rounded-full px-2 tabular-nums hover:bg-fill"
              >
                <span className="font-medium text-ink">Sayfa {status}</span>
                {' · '}
                {left === null
                  ? `%${Math.round(shownFraction * 100)}`
                  : left > 0
                    ? `Bölümde ${left} sayfa kaldı`
                    : 'Bölümün son sayfası'}
              </button>
            ) : (
              <form onSubmit={submitJump} className="flex shrink-0 items-center gap-1">
                <label className="flex items-center gap-1.5">
                  Sayfaya git
                  <input
                    autoFocus // düğmeye basınca yazmaya başlanır
                    inputMode="numeric"
                    data-testid="page-jump"
                    value={jump}
                    onChange={(e) => setJump(e.target.value.replace(/\D/g, '').slice(0, 5))}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault(); // menü kapanmasın
                        setJump(null);
                      }
                    }}
                    aria-invalid={jump !== '' && !jumpValid}
                    placeholder={`1–${source.total}`}
                    className="ui-focus min-h-9 w-16 rounded-inner bg-fill px-2 text-ink tabular-nums"
                  />
                </label>
                <button
                  type="submit"
                  disabled={!jumpValid}
                  className="ui-press min-h-9 rounded-full bg-accent px-3.5 font-semibold text-paper disabled:opacity-40"
                >
                  Git
                </button>
                {jump !== '' && !jumpValid && (
                  <span role="status" className="text-[11px]">
                    1–{source.total} arası
                  </span>
                )}
              </form>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}

/** Sayfa kalınlığı: kitabın bir yanındaki en çok kenar çizgisi (px) */
const EDGE_MAX = 6;

/**
 * Kitabın dış kenarlarındaki sayfa kalınlığı (kutu gölgeleri; yerleşimi etkilemez). Sol yan okunan, sağ yan kalan
 * sayfalarla orantılı kalınlaşır. Her katman 1 px dışarıda ve üstten, alttan 1 px kısadır; kâğıt kenarı ve çizgi
 * sırayla gelir.
 */
function pageEdges(page: number, count: number): string {
  const read = count > 1 ? page / (count - 1) : 0;
  const layers = (n: number, dir: 1 | -1) =>
    Array.from({ length: n }, (_, k) => {
      const j = k + 1;
      const color = j % 2 ? 'var(--page-edge)' : 'var(--page-edge-line)';
      return `${dir * 2 * j}px 0 0 -${j}px ${color}`;
    });
  const all = [
    ...layers(Math.round(EDGE_MAX * read), -1),
    ...layers(Math.round(EDGE_MAX * (1 - read)), 1),
  ];
  return all.length ? all.join(', ') : 'none';
}

/** Ölçümden sonraki boyut değişikliği bu kadar beklenir (döndürme, pencere sürükleme): her ara boyutta sayfalanmasın */
const RESIZE_DEBOUNCE = 150;

/** Öğenin iç boyutu: ilk ölçüm hemen, sonrakiler durulunca; boyut aynı kaldıysa yeni değer üretilmez. */
function useViewport(ref: RefObject<HTMLElement | null>): Viewport | null {
  const [vp, setVp] = useState<Viewport | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const size = () => ({ width: el.clientWidth, height: el.clientHeight });
    const apply = () => {
      const s = size();
      last = `${s.width}x${s.height}`;
      setVp(s);
    };
    apply();
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      const s = size();
      if (`${s.width}x${s.height}` !== last) timer = setTimeout(apply, RESIZE_DEBOUNCE);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(timer);
    };
  }, [ref]);
  return vp;
}

/**
 * Okuma yeri değişince ilerlemeyi yazar (400 ms sonra; uygulama değiştirilince ve kapanınca hemen): metindeki konum,
 * oranı ve PDF sayfası. Açılıştaki yer yazılmaz: kaldığı yer yalnızca okur ilerleyince değişir.
 */
function useProgressSaver(
  bookId: string,
  pos: ReadingPosition,
  percent: number,
  contentVersion: number,
) {
  const initial = useRef(pos);
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (pos === initial.current) return;
    pending.current = () => {
      pending.current = null;
      saveProgress(db, bookId, {
        locator: pos.locator,
        percent,
        contentVersion,
        pdfPage: pos.pdfPage,
      }).catch(() => undefined);
    };
    const timer = setTimeout(() => pending.current?.(), 400);
    return () => clearTimeout(timer);
  }, [bookId, pos, percent, contentVersion]);

  useEffect(() => {
    const flush = () => pending.current?.();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);
}
