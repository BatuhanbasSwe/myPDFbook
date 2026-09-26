import { ArrowLeft, ChevronLeft, ChevronRight, FileText, List } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  /** "Orijinal sayfa": okunan yerin PDF sayfası */
  onOriginalPage(pdfPage: number): void;
}

type Panel = 'settings' | 'toc' | null;

/**
 * Sayfalı kitap okuyucu. Okuma konumu (anchor) tek kaynaktır: sayfa ondan hesaplanır, böylece yazı tipi, punto ya
 * da ekran değişince aynı yerin bulunduğu sayfa açılır.
 */
export function BookReader({ book, content, saved, pdf, pdfFailed, onOriginalPage }: Props) {
  const { blocks, chapters, version } = content;
  const t = useTypography();
  const prefs = useReaderPrefs();
  const rootRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<FlipBookHandle>(null);
  const [vp, setVp] = useState<Viewport | null>(null);
  const [anchor, setAnchor] = useState<Locator>(() => startLocator(saved, blocks, version));
  const [ui, setUi] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);

  // Okuma alanının boyutu (döndürme, pencere boyutu)
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setVp({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => (vp ? pageLayout(vp, t) : null), [vp, t]);
  const lang = bookLang(content.lang);
  const starts = usePagination(blocks, lang, t, layout?.box ?? null);
  const step = layout?.spread ? 2 : 1;
  const page = starts ? alignPage(pageOf(starts, anchor), step) : 0;
  const fractions = useMemo(() => blockStartFractions(blocks), [blocks]);
  const percent = locatorFraction(blocks, fractions, anchor);

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

  // Klavye: ←/→ her zaman
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (panel || e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') next();
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, panel]);

  const chapterIndex = currentChapter(chapters, anchor);
  const chapterTitle = chapterIndex >= 0 ? chapters[chapterIndex].title : '';

  const renderPage = (i: number) =>
    starts && layout ? (
      <BookPage
        key={i}
        blocks={blocks}
        start={starts[i]}
        end={starts[i + 1]}
        layout={layout}
        typography={t}
        lang={lang}
        pageNumber={i + 1}
        runningHead={
          layout.spread && i % 2 === 0
            ? book.title
            : (chapters[currentChapter(chapters, starts[i])]?.title ?? book.title)
        }
        side={layout.spread ? (i % 2 === 0 ? 'left' : 'right') : 'single'}
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

  return (
    <div className="fixed inset-0 bg-paper text-ink">
      <div ref={rootRef} className="absolute inset-0 grid place-items-center overflow-hidden">
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
            }}
            onTap={onTap}
            renderPage={renderPage}
          />
        ) : (
          <p className="text-sm text-muted">Sayfalar hazırlanıyor…</p>
        )}
      </div>

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

      {ui && (
        <>
          <header className="absolute inset-x-0 top-0 z-10 flex items-center gap-1 border-b border-line bg-paper/95 px-2 pb-1 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur">
            <Link
              to="/"
              aria-label="Kütüphaneye dön"
              className="grid size-11 place-items-center rounded-full hover:bg-surface"
            >
              <ArrowLeft className="size-5" />
            </Link>
            <h1 className="min-w-0 flex-1 truncate font-book">{book.title}</h1>
            <button
              type="button"
              aria-label="İçindekiler"
              data-testid="reader-toc"
              aria-expanded={panel === 'toc'}
              onClick={() => setPanel((p) => (p === 'toc' ? null : 'toc'))}
              className="grid size-11 place-items-center rounded-full hover:bg-surface"
            >
              <List className="size-5" />
            </button>
            <button
              type="button"
              data-testid="original-page"
              onClick={() => onOriginalPage(blocks[anchor.block]?.srcPage ?? 0)}
              className="flex min-h-11 items-center gap-1 rounded-full px-3 text-sm hover:bg-surface"
            >
              <FileText className="size-4" />{' '}
              <span className="hidden sm:inline">Orijinal sayfa</span>
            </button>
            <button
              type="button"
              data-testid="reader-settings"
              aria-label="Görünüm ayarları"
              aria-expanded={panel === 'settings'}
              onClick={() => setPanel((p) => (p === 'settings' ? null : 'settings'))}
              className="min-h-11 rounded-full px-3 font-book text-sm hover:bg-surface"
            >
              Aa
            </button>
          </header>

          {starts && (
            <footer className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-1 border-t border-line bg-paper/95 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
              <input
                type="range"
                aria-label="Sayfa"
                data-testid="page-slider"
                min={0}
                max={starts.length - 1}
                step={1}
                value={page}
                onChange={(e) => goToPage(Number(e.target.value))}
                className="w-full accent-[var(--accent)]"
              />
              <div className="flex justify-between text-xs text-muted">
                <span className="truncate">{chapterTitle}</span>
                <span data-testid="page-status" className="shrink-0 tabular-nums">
                  {page + 1} / {starts.length} · %{Math.round(percent * 100)}
                </span>
              </div>
            </footer>
          )}
        </>
      )}

      {panel && (
        <div className="absolute inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] z-20 mx-auto max-w-md rounded-b-xl border border-line bg-surface shadow-lg">
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
    </div>
  );
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
