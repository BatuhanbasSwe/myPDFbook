import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { ThemePicker } from '../app/ThemePicker';
import { db, type BookRecord } from '../db/db';
import { appImportDeps } from '../import/deps';
import { ImportError, importBook, resumeConversions } from '../import/importBook';
import { BookCard } from './BookCard';
import { BookCover } from './BookCover';

export function LibraryPage() {
  const books = useLiveQuery(() => db.books.orderBy('addedAt').reverse().toArray(), []);
  const progress = useLiveQuery(async () => new Map((await db.progress.toArray()).map((p) => [p.bookId, p.percent])), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    void resumeConversions(appImportDeps);
  }, []);

  async function handleFiles(files: FileList | File[]) {
    setMessage(null);
    const pdfs = [...files].filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length === 0) {
      setMessage('Lütfen PDF dosyası seç.');
      return;
    }
    for (const file of pdfs) {
      try {
        const res = await importBook(file, appImportDeps);
        if (res.status === 'exists') setMessage(`“${file.name}” zaten kütüphanende.`);
        else void navigator.storage?.persist?.(); // tarayıcıdan verileri silmemesini iste
        await res.done;
      } catch (e) {
        setMessage(e instanceof ImportError ? e.message : 'Beklenmeyen bir hata oluştu.');
      }
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void handleFiles(e.dataTransfer.files);
  }

  const lastRead = books
    ?.filter((b) => b.lastOpenedAt && b.convert.state === 'done')
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0];

  return (
    <div
      className="min-h-dvh bg-paper text-ink"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <header className="sticky top-0 z-10 border-b border-line bg-paper/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <h1 className="flex items-center gap-2 font-book text-xl">
            <BookOpen className="size-6 text-accent" /> Kitaplığım
          </h1>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-paper"
          >
            <Plus className="size-4" /> PDF ekle
          </button>
          <input
            ref={inputRef}
            data-testid="file-input"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-6">
        {message && (
          <p role="status" className="mb-4 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
            {message}
          </p>
        )}
        {lastRead && <ContinueCard book={lastRead} percent={progress?.get(lastRead.id) ?? 0} />}
        {books && books.length === 0 ? (
          <div className="grid place-items-center gap-3 py-24 text-center">
            <p className="font-book text-lg">Henüz kitap yok.</p>
            <p className="text-sm text-muted">Bir PDF sürükleyip bırak ya da “PDF ekle”ye dokun.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {books?.map((book) => (
              <li key={book.id}>
                <BookCard book={book} percent={progress?.get(book.id) ?? 0} />
              </li>
            ))}
          </ul>
        )}
        <section className="mt-12 border-t border-line pt-6">
          <h2 className="mb-3 text-sm text-muted">Tema</h2>
          <ThemePicker />
        </section>
      </main>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 grid place-items-center bg-paper/80 font-book text-xl">
          PDF'i bırak
        </div>
      )}
    </div>
  );
}

function ContinueCard({ book, percent }: { book: BookRecord; percent: number }) {
  return (
    <Link to={`/read/${book.id}`} className="mb-8 flex items-center gap-4 rounded-xl border border-line bg-surface p-4">
      <div className="w-16 shrink-0">
        <BookCover book={book} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-wide text-muted">Okumaya devam et</p>
        <p className="truncate font-book text-lg">{book.title}</p>
        <p className="text-xs text-muted">%{Math.round(percent * 100)} okundu</p>
      </div>
    </Link>
  );
}
