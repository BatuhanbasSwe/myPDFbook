import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, FileText } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ThemePicker } from '../app/ThemePicker';
import { markOpened } from '../db/books';
import { db } from '../db/db';
import { OriginalPageDialog } from './OriginalPageDialog';
import { ScrollReader } from './ScrollReader';
import { usePdfDocument } from './usePdfDocument';

export function ReaderPage() {
  const { bookId = '' } = useParams();
  // undefined = yükleniyor, null = yok
  const book = useLiveQuery(() => db.books.get(bookId).then((b) => b ?? null), [bookId]);
  const content = useLiveQuery(() => db.contents.get(bookId).then((c) => c ?? null), [bookId]);
  const pdf = usePdfDocument(book ? book.id : null, book?.password);
  const [currentPage, setCurrentPage] = useState(0);
  const [originalPage, setOriginalPage] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [initialBlock, setInitialBlock] = useState<number | null>(null);

  useEffect(() => {
    if (bookId) void markOpened(db, bookId);
  }, [bookId]);

  // Kaldığı yer yalnızca açılışta bir kez okunur; okurken yapılan kayıtlar kaydırmayı etkilemez.
  useEffect(() => {
    let alive = true;
    void db.progress.get(bookId).then((p) => {
      if (alive) setInitialBlock(p?.locator.block ?? 0);
    });
    return () => {
      alive = false;
    };
  }, [bookId]);

  if (book === null) return <Centered>Kitap bulunamadı. <BackLink /></Centered>;
  if (book === undefined || content === undefined || initialBlock === null) return <Centered>Yükleniyor…</Centered>;
  if (book.convert.state === 'failed') return <Centered>Bu kitap dönüştürülemedi. <BackLink /></Centered>;
  if (book.convert.state !== 'done' || content === null) {
    return <Centered>Kitap hazırlanıyor… %{Math.round(book.convert.progress * 100)}</Centered>;
  }

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-paper/90 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur">
        <Link to="/" aria-label="Kütüphaneye dön" className="rounded-full p-2 hover:bg-surface">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-book">{book.title}</h1>
        <button
          type="button"
          data-testid="original-page"
          disabled={!pdf}
          onClick={() => setOriginalPage(currentPage)}
          className="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm hover:bg-surface disabled:opacity-40"
        >
          <FileText className="size-4" /> Orijinal sayfa
        </button>
        <button
          type="button"
          data-testid="reader-settings"
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
        pdf={pdf}
        onVisiblePage={setCurrentPage}
      />
      {originalPage !== null && pdf && (
        <OriginalPageDialog
          pdf={pdf}
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
  return <div className="grid min-h-dvh place-items-center bg-paper p-6 text-center text-ink">{children}</div>;
}

function BackLink() {
  return (
    <Link to="/" className="text-accent underline">
      Kütüphaneye dön
    </Link>
  );
}
