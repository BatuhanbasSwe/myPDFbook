import {
  AlignLeft,
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FileText,
  Highlighter,
  List,
  NotebookPen,
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
import { Link } from 'react-router';
import { AnnotatorContext, useAnnotator } from '../annotations/annotator';
import { NoteEditor } from '../annotations/NoteEditor';
import { NotesPanel } from '../annotations/NotesPanel';
import { PenToolbar } from '../annotations/PenToolbar';
import type { Locator } from '../convert/types';
import { saveProgress } from '../db/books';
import { db, type BookRecord, type ContentRecord, type ProgressRecord } from '../db/db';
import type { Viewport } from '../layout/pageBox';
import { useTypography } from '../layout/typography';
import type { PdfDocument } from '../pdf/pdfjs';
import { FlipBook, type BookSource, type FlipBookHandle } from './FlipBook';
import { ReadAloudBar, ReadAloudButton } from './modes/ReadAloudBar';
import { SpeedReaderBar, SpeedReaderButton } from './modes/SpeedReaderBar';
import { useReadAloud } from './modes/useReadAloud';
import { useSpeedReader } from './modes/useSpeedReader';
import { usePdfBook } from './pdfBook';
import {
  blockStartFractions,
  currentChapter,
  locatorFraction,
  locatorOfPdfPage,
  pdfPageOfLocator,
  startPosition,
  type ReadingPosition,
} from './progress';
import { setReaderPrefs, useReaderPrefs, type ReaderView } from './readerPrefs';
import { SettingsSheet } from './SettingsSheet';
import { useTextBook } from './textBook';
import { TocDrawer } from './TocDrawer';

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

type Panel = 'settings' | 'toc' | 'notes' | null;

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

/**
 * Kitap okuyucu. İki görünüm aynı çubukları, tuşları ve dokunmayı paylaşır; yalnızca sayfaların kaynağı değişir:
 * sayfa görünümünde PDF'in kendi sayfaları (pdfBook.tsx), metin görünümünde yeniden dizilmiş metin (textBook.tsx).
 * Okuma yeri iki görünümde birden tutulur (metindeki konum ve PDF sayfası): görünüm değişince aynı yer açılır.
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
  const notesButton = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const panelId = useId();
  const vp = useViewport(rootRef);
  const pageCount = book.pdfPageCount;
  const [pos, setPos] = useState<ReadingPosition>(() =>
    startPosition(saved, blocks, version, Math.max(1, pageCount)),
  );
  const [ui, setUi] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  // Sayfaya git: açıkken yazılan sayı
  const [jump, setJump] = useState<string | null>(null);

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
  const readAloudButton = useRef<HTMLButtonElement>(null);
  const speedButton = useRef<HTMLButtonElement>(null);
  const modeOptions = {
    blocks,
    lang: content.lang,
    view,
    pdf,
    pos,
    sourceRef,
    turnNext: () => {
      const src = sourceRef.current;
      if (src) autoTurn.current = src.index + (src.spread ? 2 : 1);
      flipRef.current?.next();
    },
    rootRef,
    keys: !paused && !panel && !note,
    penOn,
    hold: !!note || !!panel || penOn,
  };
  const readAloud = useReadAloud({ ...modeOptions, buttonRef: readAloudButton });
  // Hızlı okuma (modes/useSpeedReader.ts): aynı vurgu ve sayfa çevirme; sesli okumayla aynı anda açık olmaz
  const speed = useSpeedReader({ ...modeOptions, buttonRef: speedButton });
  const modeOpen = readAloud.open || speed.open;
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
    overlays: readAloud.overlays ?? speed.overlays,
  });
  const source = view === 'page' ? pdfBook : textBook;
  const step = source?.spread ? 2 : 1;
  useLayoutEffect(() => {
    sourceRef.current = source;
  });

  const fractions = useMemo(() => blockStartFractions(blocks), [blocks]);
  // Kaydedilen oran metindeki konumdan (kitap yeniden dönüştürülünce oradan açılır); gösterilen oran görünüme göre
  const textFraction = locatorFraction(blocks, fractions, pos.locator);
  const shownFraction =
    view === 'page' ? (pageCount > 1 ? pos.pdfPage / (pageCount - 1) : 0) : textFraction;

  useProgressSaver(book.id, pos, textFraction, version);

  const next = useCallback(() => flipRef.current?.next(), []);
  const prev = useCallback(() => flipRef.current?.prev(), []);

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

  // Klavye: ←/→ sayfa çevirir; Esc paneli kapatır ya da menüyü açıp kapatır, Enter ve M menüyü açıp kapatır
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paused || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      // Not yazılırken tuşlar yazıya gider
      if (e.target instanceof HTMLTextAreaElement) return;
      // Boşluk ve Enter yalnızca kitabın üstündeyken bizim (düğmede düğmeye basar)
      const onBook =
        e.target === document.body ||
        (e.target instanceof Node && !!rootRef.current?.contains(e.target));
      // Kitabın içindeki düğme (not iğnesi) de Boşluk ve Enter'la kendisi basılır
      const bookButton = onBook && e.target instanceof HTMLButtonElement;
      if (e.key === 'Escape') {
        if (note) closeNote(true);
        else if (panel) {
          setPanel(null);
          ({ toc: tocButton, notes: notesButton, settings: settingsButton })[
            panel
          ].current?.focus();
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
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, panel, paused, note, closeNote, penOn, setPenMode]);

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
    if (panel) return setPanel(null);
    if (prefs.tap && x < 1 / 3) prev();
    else if (prefs.tap && x > 2 / 3) next();
    else setUi((v) => !v);
  };

  const togglePanel = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));
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

  // Sayfaya git: sayfa görünümünde PDF sayfası, metin görünümünde kitabın sayfası (1'den)
  const jumpValue = jump === null ? NaN : Number(jump.trim());
  const jumpValid =
    source !== null && Number.isInteger(jumpValue) && jumpValue >= 1 && jumpValue <= source.total;
  const submitJump = (e: FormEvent) => {
    e.preventDefault();
    if (!jumpValid) return;
    if (view === 'page') goPdfPage(jumpValue - 1);
    else textBook?.go(jumpValue - 1);
    setJump(null);
  };

  const status = source ? `${source.label} / ${source.total}` : '';

  return (
    <div
      className={`fixed inset-0 text-ink ${view === 'page' ? 'reader-page-view' : 'reader-text-view bg-paper'}`}
    >
      <div
        ref={rootRef}
        className="absolute grid place-items-center overflow-hidden"
        style={
          reserve
            ? { ...SAFE_AREA, bottom: `calc(env(safe-area-inset-bottom, 0px) + ${reserve}px)` }
            : SAFE_AREA
        }
      >
        {source ? (
          <div
            style={{
              boxShadow: pageEdges(source.index, source.count),
              // Parlaklık yalnızca kitaba uygulanır (çubuklar ve paneller değişmez)
              filter: prefs.brightness !== 1 ? `brightness(${prefs.brightness})` : undefined,
            }}
          >
            <AnnotatorContext value={annot.value}>
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
                  setUi(false);
                  setJump(null);
                  setPanel(null); // kıvrılan sayfada panel açıkken kaydırma sayfayı çevirir
                  setNote(null);
                }}
                onTap={onTap}
                onDismiss={panel ? () => setPanel(null) : note ? () => setNote(null) : undefined}
                // Kalem kipinde dokunma ve sürükleme çizer: sayfa düğmeler, tuşlar ve kaydırıcıyla çevrilir
                gesturesDisabled={penOn}
                renderPage={source.renderPage}
              />
            </AnnotatorContext>
          </div>
        ) : (
          <p className="text-sm text-muted">
            {view === 'page' ? 'Kitap açılıyor…' : 'Sayfalar hazırlanıyor…'}
          </p>
        )}
      </div>

      {/* Ekran okuyucu sayfa değişimini duyurur */}
      <p className="sr-only" aria-live="polite">
        {source ? `Sayfa ${status}` : ''}
      </p>

      {/* Alt düğmeler: ortada, sayfa numarasının iki yanında. Kalem kipinde her zaman: dokunma çizer, sayfa
          (klavyesiz iPad'de) bunlarla çevrilir */}
      {pageButtons && source && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[max(0.25rem,env(safe-area-inset-bottom))] flex items-center justify-center gap-1">
          <button
            type="button"
            aria-label="Önceki sayfa"
            onClick={prev}
            className="pointer-events-auto grid size-11 place-items-center rounded-full bg-surface/80 text-ink shadow-sm backdrop-blur hover:bg-surface"
          >
            <ChevronLeft className="size-5" />
          </button>
          <span className="min-w-16 rounded-full bg-surface/80 px-3 py-1 text-center text-xs tabular-nums text-muted backdrop-blur">
            {source.label}
          </span>
          <button
            type="button"
            aria-label="Sonraki sayfa"
            onClick={next}
            className="pointer-events-auto grid size-11 place-items-center rounded-full bg-surface/80 text-ink shadow-sm backdrop-blur hover:bg-surface"
          >
            <ChevronRight className="size-5" />
          </button>
        </div>
      )}

      <header
        ref={headerRef}
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
        {readAloud.available && (
          <ReadAloudButton
            ref={readAloudButton}
            open={readAloud.open}
            onClick={() => {
              if (!readAloud.open) speed.close();
              readAloud.toggleOpen();
            }}
          />
        )}
        {speed.available && (
          <SpeedReaderButton
            ref={speedButton}
            open={speed.open}
            onClick={() => {
              if (!speed.open) readAloud.close();
              speed.toggleOpen();
            }}
          />
        )}
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
        {pageViewPossible && (
          <button
            ref={notesButton}
            type="button"
            aria-label="Notlar"
            data-testid="reader-notes"
            aria-expanded={panel === 'notes'}
            aria-controls={panel === 'notes' ? panelId : undefined}
            onClick={() => {
              togglePanel('notes');
              setNote(null); // not panelde de düzenlenir: iğnedeki düzenleyici kapanır
            }}
            className="grid size-11 place-items-center rounded-full hover:bg-surface"
          >
            <NotebookPen className="size-5" />
          </button>
        )}
        {pageViewPossible && (
          <button
            type="button"
            data-testid="view-toggle"
            aria-label={view === 'page' ? 'Metin görünümüne geç' : 'Sayfa görünümüne geç'}
            onClick={() => setReaderPrefs({ view: view === 'page' ? 'text' : 'page' })}
            className="flex min-h-11 items-center gap-1 rounded-full px-3 text-sm hover:bg-surface"
          >
            {view === 'page' ? (
              <>
                <AlignLeft className="size-4" /> Metin
              </>
            ) : (
              <>
                <BookOpen className="size-4" /> Sayfa
              </>
            )}
          </button>
        )}
        {view === 'page' && (
          <button
            type="button"
            data-testid="pen-mode"
            aria-label="Kalem kipi"
            aria-pressed={penOn}
            onClick={() => {
              setPenMode(!penOn);
              if (!penOn) {
                // Kitap açıkta kalsın: menü ve panel kapanır, araç çubuğu çıkar
                setUi(false);
                setPanel(null);
                setJump(null);
              }
            }}
            className={`flex min-h-11 items-center gap-1 rounded-full px-3 text-sm hover:bg-surface ${penOn ? 'text-accent' : ''}`}
          >
            <Highlighter className="size-4" /> <span className="hidden sm:inline">Kalem</span>
          </button>
        )}
        {view === 'text' && (
          <button
            type="button"
            data-testid="original-page"
            aria-label="Orijinal sayfa"
            onClick={() => onOriginalPage(pdfPageOfLocator(blocks, pos.locator))}
            className="flex min-h-11 items-center gap-1 rounded-full px-3 text-sm hover:bg-surface"
          >
            <FileText className="size-4" /> <span className="hidden sm:inline">Orijinal sayfa</span>
          </button>
        )}
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
            <SettingsSheet textOnly={!pageViewPossible} />
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
            <TocDrawer
              chapters={chapters}
              current={chapterIndex}
              onSelect={(c) => {
                goLocator({ block: c.block, offset: 0 });
                setPanel(null);
                setUi(false);
              }}
            />
          )}
        </div>
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

      {penOn && !panel && (
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
          className={`absolute inset-x-0 bottom-0 z-10 flex flex-col gap-1 border-t border-line bg-paper/95 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur transition-opacity ${hidden}`}
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
            onChange={(e) => source.go(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
          <div className="flex items-center justify-between gap-2 text-xs text-muted">
            <span className="truncate">{chapterTitle}</span>
            {jump === null || !ui ? (
              <button
                type="button"
                data-testid="page-status"
                aria-label={`Sayfa ${status}; sayfaya git`}
                onClick={() => setJump('')}
                className="-my-2 min-h-11 shrink-0 rounded-full px-2 tabular-nums hover:bg-surface"
              >
                {status} · %{Math.round(shownFraction * 100)}
              </button>
            ) : (
              <form onSubmit={submitJump} className="flex shrink-0 items-center gap-1">
                <label className="flex items-center gap-1">
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
                    className="w-16 rounded-md border border-line bg-paper px-2 py-1 text-ink tabular-nums"
                  />
                </label>
                <button
                  type="submit"
                  disabled={!jumpValid}
                  className="min-h-9 rounded-full bg-accent px-3 text-paper disabled:opacity-40"
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
