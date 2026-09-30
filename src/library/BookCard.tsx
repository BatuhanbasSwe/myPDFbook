import { Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { deleteBook } from '../db/books';
import { db, type BookRecord } from '../db/db';
import { appImportDeps } from '../import/deps';
import { attachPdf, ImportError, retryConversion } from '../import/importBook';
import { BookCover } from './BookCover';

export function BookCard({ book, percent }: { book: BookRecord; percent: number }) {
  // PDF'i gelmemiş kitap ("PDF bekleniyor") açılmaz
  const ready = book.convert.state === 'done' && !book.pdfMissing;
  const [deleteFailed, setDeleteFailed] = useState(false);

  async function onDelete() {
    if (!window.confirm(`“${book.title}” kütüphaneden silinsin mi?`)) return;
    try {
      await deleteBook(db, book.id);
    } catch (e) {
      console.error(e);
      setDeleteFailed(true);
    }
  }

  return (
    <article data-testid="book-card" className="flex flex-col gap-2">
      {ready ? (
        <Link
          to={`/read/${book.id}`}
          data-testid="book-open"
          aria-label={`${book.title} kitabını aç`}
        >
          <BookCover book={book} />
        </Link>
      ) : (
        <BookCover book={book} />
      )}
      <div className="min-w-0">
        <h3 className="line-clamp-2 font-book text-sm leading-snug">{book.title}</h3>
        {book.author && <p className="truncate text-xs text-muted">{book.author}</p>}
      </div>
      <Status book={book} percent={percent} />
      <button
        type="button"
        onClick={() => void onDelete()}
        aria-label={`${book.title} kitabını sil`}
        className="-mx-2 -my-2 flex min-h-11 items-center gap-1 self-start px-2 text-xs text-muted hover:text-ink"
      >
        <Trash2 className="size-3.5" /> Sil
      </button>
      {deleteFailed && (
        <p role="alert" className="text-xs text-danger">
          Silinemedi. Tekrar dene.
        </p>
      )}
    </article>
  );
}

function Status({ book, percent }: { book: BookRecord; percent: number }) {
  if (book.pdfMissing) return <AwaitingPdf book={book} />;
  if (book.convert.state === 'failed') {
    return (
      <div className="flex flex-col gap-0.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-danger">Dönüştürülemedi</span>
          <button
            type="button"
            onClick={() => void retryConversion(appImportDeps, book.id).catch(() => undefined)}
            aria-label={`${book.title} dönüştürmesini tekrar dene`}
            className="-my-3 min-h-11 px-1 text-accent underline"
          >
            Tekrar dene
          </button>
        </div>
        {/* Nedeni görünür (telefonda üzerine gelinemez): sorun bildirirken okunabilsin */}
        {book.convert.error && (
          <p data-testid="convert-error" className="line-clamp-3 break-words text-muted">
            {book.convert.error}
            {book.convert.errorAt && (
              <span className="block text-[10px] opacity-80">{book.convert.errorAt}</span>
            )}
          </p>
        )}
      </div>
    );
  }
  if (book.convert.state === 'pending') return <p className="text-xs text-muted">Sırada…</p>;
  if (book.convert.state !== 'done') {
    return (
      <p className="text-xs text-muted">Hazırlanıyor… %{Math.round(book.convert.progress * 100)}</p>
    );
  }
  const value = Math.round(percent * 100);
  return (
    <div
      className="h-1 overflow-hidden rounded-full bg-line"
      role="progressbar"
      aria-valuenow={value}
      aria-label={`%${value} okundu`}
    >
      <div className="h-full bg-accent" style={{ width: `${value}%` }} />
    </div>
  );
}

/**
 * "PDF bekleniyor": kitap PDF'siz yedekten geldi. "PDF'i ekle" aynı PDF'i (aynı SHA-256) ister; başka bir PDF
 * seçilirse uyarı verilir, hiçbir şey kaydedilmez.
 */
function AwaitingPdf({ book }: { book: BookRecord }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function attach(file: File) {
    setBusy(true);
    setError(null);
    try {
      await attachPdf(file, book.id, appImportDeps);
    } catch (e) {
      if (!(e instanceof ImportError)) console.error(e);
      setError(e instanceof ImportError ? e.message : 'Beklenmeyen bir hata oluştu.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-0.5 text-xs" data-testid="pdf-missing">
      <div className="flex items-center gap-2">
        <span className="text-muted">PDF bekleniyor</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          aria-label={`${book.title} kitabının PDF'ini ekle`}
          data-testid="attach-pdf"
          className="-my-3 min-h-11 px-1 text-accent underline disabled:opacity-40"
        >
          PDF'i ekle
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        data-testid="attach-pdf-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void attach(file);
        }}
      />
      {error && (
        <p role="alert" data-testid="attach-pdf-error" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
