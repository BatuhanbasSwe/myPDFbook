import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { deleteBook } from '../db/books';
import { db, type BookRecord } from '../db/db';
import { BookCover } from './BookCover';

export function BookCard({ book, percent }: { book: BookRecord; percent: number }) {
  const ready = book.convert.state === 'done';
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
        <Link to={`/read/${book.id}`} data-testid="book-open" aria-label={`${book.title} kitabını aç`}>
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
  if (book.convert.state === 'failed') return <p className="text-xs text-danger">Dönüştürülemedi</p>;
  if (book.convert.state === 'pending') return <p className="text-xs text-muted">Sırada…</p>;
  if (book.convert.state !== 'done') {
    return <p className="text-xs text-muted">Hazırlanıyor… %{Math.round(book.convert.progress * 100)}</p>;
  }
  const value = Math.round(percent * 100);
  return (
    <div className="h-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={value} aria-label={`%${value} okundu`}>
      <div className="h-full bg-accent" style={{ width: `${value}%` }} />
    </div>
  );
}
