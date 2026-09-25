import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, FileText } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ThemePicker } from '../app/ThemePicker';
import { markOpened } from '../db/books';
import { db, type ProgressRecord } from '../db/db';
import { OriginalPageDialog } from './OriginalPageDialog';
import { startBlock } from './progress';
import { ScrollReader } from './ScrollReader';
import { usePdfDocument } from './usePdfDocument';

/** Kitap değişince okuyucu sıfırdan kurulur: belge, kaldığı yer ve sayfa durumu önceki kitaptan kalmasın. */
export function ReaderRoute() {
  const { bookId = '' } = useParams();
  return <ReaderPage key={bookId} bookId={bookId} />;
}

export function ReaderPage({ bookId }: { bookId: string }) {
  // undefined = yükleniyor, null = yok
  const book = useLiveQuery(() => db.books.get(bookId).then((b) => b ?? null), [bookId]);
  const liveContent = useLiveQuery(() => db.contents.get(bookId).then((c) => c ?? null), [bookId]);
  // Okurken kitap arka planda yeniden dönüştürülse de ekrandaki metin değişmez (bloklar ve kaydedilen konum
  // tutarlı kalsın); yeni metin bir sonraki açılışta gelir.
  const [content, setContent] = useState(liveContent);
  if (!content && liveContent !== undefined && liveContent !== content) setContent(liveContent);
  const headerRef = useRef<HTMLElement>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [originalPage, setOriginalPage] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [saved, setSaved] = useState<ProgressRecord | null>();
  // PDF yalnızca gerekince açılır (görsel sayfa varsa ya da orijinal sayfa istenince): tüm dosyayı okuyup worker başlatmak pahalı
  const [pdfWanted, setPdfWanted] = useState(false);
  const needsPdf = pdfWanted || (content?.textlessPages.length ?? 0) > 0;
  const { doc: pdf, failed: pdfFailed } = usePdfDocument(
    book && needsPdf ? book.id : null,
    book?.password,
  );
  const ready = book?.convert.state === 'done';

  // Yalnızca okunabilir kitap "açıldı" sayılır (başlama tarihi, okunuyor durumu)
  useEffect(() => {
    if (ready) void markOpened(db, bookId).catch(() => undefined);
  }, [bookId, ready]);

  // Kaldığı yer yalnızca açılışta bir kez okunur; okurken yapılan kayıtlar kaydırmayı etkilemez.
  useEffect(() => {
    let alive = true;
    void db.progress
      .get(bookId)
      .then(
        (p) => p ?? null,
        () => null,
      )
      .then((p) => {
        if (alive) setSaved(p);
      });
    return () => {
      alive = false;
    };
  }, [bookId]);
  const initialBlock = useMemo(
    () =>
      content && saved !== undefined ? startBlock(saved, content.blocks, content.version) : null,
    [content, saved],
  );

  if (book === null)
    return (
      <Centered>
        Kitap bulunamadı. <BackLink />
      </Centered>
    );
  if (book === undefined || content === undefined || initialBlock === null)
    return <Centered>Yükleniyor…</Centered>;
  if (book.convert.state === 'failed')
    return (
      <Centered>
        Bu kitap dönüştürülemedi. <BackLink />
      </Centered>
    );
  if (book.convert.state !== 'done' || content === null) {
    return <Centered>Kitap hazırlanıyor… %{Math.round(book.convert.progress * 100)}</Centered>;
  }

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header
        ref={headerRef}
        className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-paper/90 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur"
      >
        <Link to="/" aria-label="Kütüphaneye dön" className="rounded-full p-2 hover:bg-surface">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-book">{book.title}</h1>
        <button
          type="button"
          data-testid="original-page"
          onClick={() => {
            setPdfWanted(true);
            setOriginalPage(currentPage);
          }}
          className="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm hover:bg-surface"
        >
          <FileText className="size-4" /> Orijinal sayfa
        </button>
        <button
          type="button"
          data-testid="reader-settings"
          aria-label="Görünüm ayarları"
          aria-expanded={showSettings}
          onClick={() => setShowSettings((s) => !s)}
          className="rounded-full px-3 py-1.5 font-book text-sm hover:bg-surface"
        >
          Aa
        </button>
      </header>
      {showSettings && (
        <div className="border-b border-line bg-surface px-4 py-4">
          <ThemePicker />
        </div>
      )}
      <ScrollReader
        bookId={book.id}
        blocks={content.blocks}
        lang={content.lang}
        initialBlock={initialBlock}
        contentVersion={content.version}
        pdf={pdf}
        pdfFailed={pdfFailed}
        headerRef={headerRef}
        onVisiblePage={setCurrentPage}
      />
      {originalPage !== null && (
        <OriginalPageDialog
          pdf={pdf}
          failed={pdfFailed}
          pageIndex={originalPage}
          pageCount={book.pdfPageCount}
          onChange={setOriginalPage}
          onClose={() => setOriginalPage(null)}
        />
      )}
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-paper p-6 text-center text-ink">
      {children}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/" className="text-accent underline">
      Kütüphaneye dön
    </Link>
  );
}
