import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { markOpened } from '../db/books';
import { db, type ContentRecord, type ProgressRecord } from '../db/db';
import { BookReader } from './BookReader';
import { OriginalPageDialog } from './OriginalPageDialog';
import { usePdfDocument } from './usePdfDocument';

/** Kitap değişince okuyucu sıfırdan kurulur: belge, kaldığı yer ve sayfa durumu önceki kitaptan kalmasın. */
export function ReaderRoute() {
  const { bookId = '' } = useParams();
  return <ReaderPage key={bookId} bookId={bookId} />;
}

export function ReaderPage({ bookId }: { bookId: string }) {
  // undefined = yükleniyor, null = yok
  const book = useLiveQuery(() => db.books.get(bookId).then((b) => b ?? null), [bookId]);
  // Okurken kitap arka planda yeniden dönüştürülse de ekrandaki metin değişmez (bloklar ve kaydedilen konum
  // tutarlı kalsın); yeni metin bir sonraki açılışta gelir. Metin gelince sorgu durur: kitabın ikinci kopyası
  // bellekte tutulmasın.
  const [content, setContent] = useState<ContentRecord | null>();
  const pinned = !!content;
  const liveContent = useLiveQuery(
    () => (pinned ? null : db.contents.get(bookId).then((c) => c ?? null)),
    [bookId, pinned],
  );
  if (!content && liveContent !== undefined && liveContent !== content) setContent(liveContent);
  const [originalPage, setOriginalPage] = useState<number | null>(null);
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

  // Kaldığı yer yalnızca açılışta bir kez okunur; okurken yapılan kayıtlar sayfayı etkilemez.
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

  if (book === null)
    return (
      <Centered>
        Kitap bulunamadı. <BackLink />
      </Centered>
    );
  if (book === undefined || content === undefined || saved === undefined)
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
    <>
      <BookReader
        book={book}
        content={content}
        saved={saved}
        pdf={pdf}
        pdfFailed={pdfFailed}
        onOriginalPage={(p) => {
          setPdfWanted(true);
          setOriginalPage(p);
        }}
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
    </>
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
