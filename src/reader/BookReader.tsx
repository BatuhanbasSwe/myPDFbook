import { ArrowLeft, ChevronLeft, ChevronRight, FileText, List } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { Link } from 'react-router';
import type { Chapter, Locator } from '../convert/types';
import { saveProgress } from '../db/books';
import { db, type BookRecord, type ContentRecord, type ProgressRecord } from '../db/db';
import { pageLayout, type Viewport } from '../layout/pageBox';
import { pageOf } from '../layout/paginator';
import { useTypography } from '../layout/typography';
import type { PdfDocument } from '../pdf/pdfjs';
import { BookPage } from './BookPage';
import { FlipBook, type FlipBookHandle } from './FlipBook';
import { blockStartFractions, locatorFraction, startLocator } from './progress';
import { useReaderPrefs } from './readerPrefs';
import { SettingsSheet } from './SettingsSheet';
import { TocDrawer } from './TocDrawer';
import { usePagination } from './usePagination';

interface Props {
  book: BookRecord;
  /** okurken sabit kalan içerik (bkz. ReaderPage) */
  content: ContentRecord;
  saved: ProgressRecord | null;
  pdf: PdfDocument | null;
  pdfFailed: boolean;
  /** okuyucunun üstünde pencere açık (orijinal sayfa): klavye kitaba gitmez */
  paused: boolean;
  /** "Orijinal sayfa": okunan yerin PDF sayfası */
  onOriginalPage(pdfPage: number): void;
}

type Panel = 'settings' | 'toc' | null;

/** Okuma alanı çentik ve ev çubuğu gibi güvenli alan boşluklarının içinde kalır (sayfa numarası altında kalmasın) */
const SAFE_AREA: CSSProperties = {
  top: 'env(safe-area-inset-top, 0px)',
  right: 'env(safe-area-inset-right, 0px)',
  bottom: 'env(safe-area-inset-bottom, 0px)',
  left: 'env(safe-area-inset-left, 0px)',
};

/**
 * Sayfalı kitap okuyucu. Okuma konumu (anchor) tek kaynaktır: sayfa ondan hesaplanır, böylece yazı tipi, punto ya
 * da ekran değişince aynı yerin bulunduğu sayfa açılır.
 */
export function BookReader({
  book,
  content,
  saved,
  pdf,
  pdfFailed,
  paused,
  onOriginalPage,
}: Props) {
  const { blocks, chapters, version } = content;
  const t = useTypography();
  const prefs = useReaderPrefs();
  const rootRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<FlipBookHandle>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tocButton = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const vp = useViewport(rootRef);
  const [anchor, setAnchor] = useState<Locator>(() => startLocator(saved, blocks, version));
  const [ui, setUi] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);

  const wanted = useMemo(() => (vp ? pageLayout(vp, t) : null), [vp, t]);
  const lang = bookLang(content.lang);
  // Ayar ya da ekran değişince yeni sayfalama hazır olana dek önceki (kendi yerleşimi ve tipografisiyle) çizilir.
  // Sayfalama kitabın kimliği ve metnin sürümüyle IndexedDB'de saklanır: yeniden açılışta ölçülmez.
  const paged = usePagination(blocks, lang, t, wanted, {
    bookId: book.id,
    contentVersion: version,
  });
  const starts = paged?.starts ?? null;
  const layout = paged?.layout ?? null;
  const step = layout?.spread ? 2 : 1;
  const page = starts ? alignPage(pageOf(starts, anchor), step) : 0;
  const fractions = useMemo(() => blockStartFractions(blocks), [blocks]);
  const percent = locatorFraction(blocks, fractions, anchor);
  // Çift sayfada iki sayfa numarası ("12–13")
  const pageLabel =
    starts && step === 2 && page + 1 < starts.length ? `${page + 1}–${page + 2}` : `${page + 1}`;

  useProgressSaver(book.id, anchor, percent, version);

  const goToPage = useCallback(
    (p: number) => {
      if (!starts) return;
      const clamped = Math.max(0, Math.min(starts.length - 1, p));
      setAnchor(starts[clamped]);
    },
    [starts],
  );
  const next = useCallback(() => flipRef.current?.next(), []);
  const prev = useCallback(() => flipRef.current?.prev(), []);

  // Klavye: ←/→ sayfa çevirir; Esc paneli kapatır ya da menüyü açıp kapatır, Enter ve M menüyü açıp kapatır
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paused || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      // Boşluk ve Enter yalnızca kitabın üstündeyken bizim (düğmede düğmeye basar)
      const onBook =
        e.target === document.body ||
        (e.target instanceof Node && !!rootRef.current?.contains(e.target));
      if (e.key === 'Escape') {
        if (panel) {
          setPanel(null);
          (panel === 'toc' ? tocButton : settingsButton).current?.focus();
        } else setUi((v) => !v);
      } else if (panel || e.target instanceof HTMLInputElement) return;
      else if (
        e.key === 'ArrowRight' ||
        e.key === 'PageDown' ||
        (e.key === ' ' && onBook && !e.shiftKey)
      )
        next();
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && onBook)) prev();
      else if ((e.key === 'Enter' && onBook) || e.key === 'm' || e.key === 'M') setUi((v) => !v);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, panel, paused]);

  // Açılan panelin ilk denetimine (içindekilerde okunan bölüme) odaklan
  useEffect(() => {
    const el = panelRef.current;
    if (!panel || !el) return;
    const first =
      el.querySelector<HTMLElement>('[aria-current="true"]') ??
      el.querySelector<HTMLElement>('button, input, a[href]');
    first?.focus();
  }, [panel]);

  const chapterIndex = currentChapter(chapters, anchor);
  const chapterTitle = chapterIndex >= 0 ? chapters[chapterIndex].title : '';

  const renderPage = (i: number) =>
    paged && starts && layout ? (
      <BookPage
        key={i}
        blocks={blocks}
        start={starts[i]}
        end={starts[i + 1]}
        layout={layout}
        typography={paged.typography}
        lang={lang}
        pageNumber={i + 1}
        runningHead={
          layout.spread && i % 2 === 0
            ? book.title
            : (chapters[currentChapter(chapters, starts[i])]?.title ?? book.title)
        }
        side={layout.spread ? (i % 2 === 0 ? 'left' : 'right') : 'single'}
        // Görünen ve komşu sayfalar: taranmış sayfanın görseli çevirmeden önce hazır olsun
        eager={i >= page - step && i < page + 2 * step}
        pdf={pdf}
        pdfFailed={pdfFailed}
      />
    ) : null;

  const onTap = (x: number) => {
    if (panel) return setPanel(null);
    if (prefs.tap && x < 1 / 3) prev();
    else if (prefs.tap && x > 2 / 3) next();
    else setUi((v) => !v);
  };

  const togglePanel = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));
  // Gizli menü ekranda görünmez ama klavyeyle ulaşılabilir: odak gelince görünür
  const hidden = ui ? '' : 'pointer-events-none opacity-0';

  return (
    <div className="fixed inset-0 bg-paper text-ink">
      <div
        ref={rootRef}
        className="absolute grid place-items-center overflow-hidden"
        style={SAFE_AREA}
      >
        {starts && layout ? (
          <FlipBook
            ref={flipRef}
            count={starts.length}
            index={page}
            spread={layout.spread}
            effect={prefs.effect}
            swipe={prefs.swipe}
            width={layout.pageWidth * step}
            height={layout.pageHeight}
            onIndexChange={(i) => {
              goToPage(i);
              setUi(false);
              setPanel(null); // kıvrılan sayfada panel açıkken kaydırma sayfayı çevirir
            }}
            onTap={onTap}
            onDismiss={panel ? () => setPanel(null) : undefined}
            renderPage={renderPage}
          />
        ) : (
          <p className="text-sm text-muted">Sayfalar hazırlanıyor…</p>
        )}
      </div>

      {/* Ekran okuyucu sayfa değişimini duyurur */}
      <p className="sr-only" aria-live="polite">
        {starts ? `Sayfa ${pageLabel} / ${starts.length}` : ''}
      </p>

      {prefs.buttons && starts && !ui && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[max(0.25rem,env(safe-area-inset-bottom))] flex justify-between px-2">
          <button
            type="button"
            aria-label="Önceki sayfa"
            onClick={prev}
            className="pointer-events-auto grid size-11 place-items-center rounded-full text-muted hover:bg-surface"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Sonraki sayfa"
            onClick={next}
            className="pointer-events-auto grid size-11 place-items-center rounded-full text-muted hover:bg-surface"
          >
            <ChevronRight className="size-5" />
          </button>
        </div>
      )}

      <header
        data-testid="reader-header"
        data-shown={ui}
        onFocus={() => setUi(true)}
        className={`absolute inset-x-0 top-0 z-10 flex items-center gap-1 border-b border-line bg-paper/95 px-2 pb-1 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur transition-opacity ${hidden}`}
      >
        <Link
          to="/"
          aria-label="Kütüphaneye dön"
          className="grid size-11 place-items-center rounded-full hover:bg-surface"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-book">{book.title}</h1>
        <button
          ref={tocButton}
          type="button"
          aria-label="İçindekiler"
          data-testid="reader-toc"
          aria-expanded={panel === 'toc'}
          aria-controls={panel === 'toc' ? panelId : undefined}
          onClick={() => togglePanel('toc')}
          className="grid size-11 place-items-center rounded-full hover:bg-surface"
        >
          <List className="size-5" />
        </button>
        <button
          type="button"
          data-testid="original-page"
          aria-label="Orijinal sayfa"
          onClick={() => onOriginalPage(blocks[anchor.block]?.srcPage ?? 0)}
          className="flex min-h-11 items-center gap-1 rounded-full px-3 text-sm hover:bg-surface"
        >
          <FileText className="size-4" /> <span className="hidden sm:inline">Orijinal sayfa</span>
        </button>
        <button
          ref={settingsButton}
          type="button"
          data-testid="reader-settings"
          aria-label="Görünüm ayarları"
          aria-expanded={panel === 'settings'}
          aria-controls={panel === 'settings' ? panelId : undefined}
          onClick={() => togglePanel('settings')}
          className="min-h-11 rounded-full px-3 font-book text-sm hover:bg-surface"
        >
          Aa
        </button>
      </header>

      {/* Panel, başlıktaki düğmesinin hemen ardından gelir (klavyede sıra) */}
      {panel && (
        <div
          ref={panelRef}
          id={panelId}
          data-testid="reader-panel"
          className="absolute inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] z-20 mx-auto max-w-md rounded-b-xl border border-line bg-surface shadow-lg"
        >
          {panel === 'settings' ? (
            <SettingsSheet />
          ) : (
            <TocDrawer
              chapters={chapters}
              current={chapterIndex}
              onSelect={(c) => {
                setAnchor({ block: c.block, offset: 0 });
                setPanel(null);
                setUi(false);
              }}
            />
          )}
        </div>
      )}

      {starts && (
        <footer
          onFocus={() => setUi(true)}
          className={`absolute inset-x-0 bottom-0 z-10 flex flex-col gap-1 border-t border-line bg-paper/95 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur transition-opacity ${hidden}`}
        >
          <input
            type="range"
            aria-label="Sayfa"
            aria-valuetext={`Sayfa ${pageLabel} / ${starts.length}`}
            data-testid="page-slider"
            min={0}
            max={starts.length - 1}
            step={step}
            value={page}
            onChange={(e) => goToPage(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
          <div className="flex justify-between text-xs text-muted">
            <span className="truncate">{chapterTitle}</span>
            <span data-testid="page-status" className="shrink-0 tabular-nums">
              {pageLabel} / {starts.length} · %{Math.round(percent * 100)}
            </span>
          </div>
        </footer>
      )}
    </div>
  );
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

/** Heceleme ve ekran okuyucu için dil ("": bilinmiyor) */
function bookLang(lang: ContentRecord['lang']): string {
  return lang === 'other' ? '' : lang;
}

function alignPage(page: number, step: number): number {
  return step === 2 ? page - (page % 2) : page;
}

/** Konumun bulunduğu bölüm: başlangıç bloğu konumdan sonra olmayan son bölüm (-1: ilk bölümden önce). */
function currentChapter(chapters: Chapter[], loc: Locator): number {
  let found = -1;
  chapters.forEach((c, i) => {
    if (c.block <= loc.block && (found < 0 || c.block >= chapters[found].block)) found = i;
  });
  return found;
}

/**
 * Konum değişince ilerlemeyi yazar (400 ms sonra; uygulama değiştirilince ve kapanınca hemen). Açılıştaki konum
 * yazılmaz: kaldığı yer yalnızca okur ilerleyince değişir.
 */
function useProgressSaver(
  bookId: string,
  anchor: Locator,
  percent: number,
  contentVersion: number,
) {
  const initial = useRef(anchor);
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (anchor === initial.current) return;
    pending.current = () => {
      pending.current = null;
      saveProgress(db, bookId, { locator: anchor, percent, contentVersion }).catch(() => undefined);
    };
    const timer = setTimeout(() => pending.current?.(), 400);
    return () => clearTimeout(timer);
  }, [bookId, anchor, percent, contentVersion]);

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
