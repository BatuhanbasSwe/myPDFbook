import { MoreHorizontal, PencilLine, Trash2 } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Link } from 'react-router';
import { deleteBook } from '../db/books';
import { db, type BookRecord } from '../db/db';
import { appImportDeps } from '../import/deps';
import { attachPdf, ImportError, retryConversion } from '../import/importBook';
import { MenuButton } from '../ui/MenuButton';
import { BookCover } from './BookCover';

/** Dokunarak basılı tutma kitabın menüsünü açar (ms) */
const LONG_PRESS = 500;
/** Basılı tutarken bundan çok kayan parmak kaydırıyordur (px) */
const MOVE_SLOP = 10;

/**
 * Kütüphanedeki kitap: kapak (dokununca açılır), altında başlık, yazar ve durum ("%34", "Yeni", dönüştürme).
 * Yeniden adlandırma ve silme kitabın menüsünde (⋯ düğmesi; kapağa basılı tutma ya da sağ tık da açar).
 */
export function BookCard({ book, percent }: { book: BookRecord; percent: number }) {
  // PDF'i gelmemiş kitap ("PDF bekleniyor") açılmaz
  const ready = book.convert.state === 'done' && !book.pdfMissing;
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const press = useLongPress(() => setMenuOpen(true));

  async function onDelete() {
    if (!window.confirm(`“${book.title}” kütüphaneden silinsin mi?`)) return;
    try {
      await deleteBook(db, book.id);
    } catch (e) {
      console.error(e);
      setDeleteFailed(true);
    }
  }

  const converting = book.convert.state === 'pending' || book.convert.state === 'running';

  return (
    <article data-testid="book-card" className="flex flex-col gap-2">
      <div
        className="relative"
        {...press}
        onContextMenu={(e) => {
          // Sağ tık (ve Android'de basılı tutma) kitabın menüsünü açar
          e.preventDefault();
          setMenuOpen(true);
        }}
      >
        {ready ? (
          <Link
            to={`/read/${book.id}`}
            data-testid="book-open"
            aria-label={`${book.title} kitabını aç`}
            draggable={false}
            className="ui-press ui-focus block rounded-[5px] [-webkit-touch-callout:none]"
          >
            <BookCover book={book} />
          </Link>
        ) : (
          <BookCover book={book} />
        )}
        {/* Dönüştürme kapak üstünde ince bir çubuk */}
        {converting && (
          <div
            role="progressbar"
            aria-label="Hazırlanıyor"
            aria-valuenow={Math.round(book.convert.progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-black/35"
          >
            <div
              className="h-full rounded-full bg-white/90 transition-[width] duration-300"
              style={{ width: `${Math.max(4, book.convert.progress * 100)}%` }}
            />
          </div>
        )}
      </div>
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1 pt-0.5">
          <h3 className="line-clamp-2 text-[15px] leading-snug font-semibold tracking-[-0.01em]">
            {book.title}
          </h3>
          {book.author && <p className="truncate text-[13px] text-secondary">{book.author}</p>}
          <Status book={book} percent={percent} />
        </div>
        <MenuButton
          label={`${book.title} seçenekleri`}
          testId="book-menu"
          menuTestId="book-menu-list"
          Icon={MoreHorizontal}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          buttonRef={menuButton}
          tipSide="above"
          actions={[
            {
              id: 'book-rename',
              menuLabel: 'Yeniden adlandır',
              Icon: PencilLine,
              run: () => setRenaming(true),
            },
            {
              id: 'book-delete',
              menuLabel: 'Sil',
              Icon: Trash2,
              destructive: true,
              divider: true,
              run: () => void onDelete(),
            },
          ]}
        />
      </div>
      {deleteFailed && (
        <p role="alert" className="text-xs text-danger">
          Silinemedi. Tekrar dene.
        </p>
      )}
      {renaming && (
        <RenameDialog
          book={book}
          onClose={() => {
            setRenaming(false);
            requestAnimationFrame(() => menuButton.current?.focus());
          }}
        />
      )}
    </article>
  );
}

/**
 * Dokunarak basılı tutma: kapağa basılı tutunca kitabın menüsü açılır, ardından gelen tıklama kitabı açmaz. Kalem
 * ve fare yok sayılır (fareyle sağ tık).
 */
function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  const cancel = () => {
    clearTimeout(timer.current);
    start.current = null;
  };
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      fired.current = false;
      if (e.pointerType !== 'touch') return;
      start.current = { x: e.clientX, y: e.clientY };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        fired.current = true;
        start.current = null;
        onLongPress();
      }, LONG_PRESS);
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_SLOP) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture: (e: ReactMouseEvent) => {
      if (!fired.current) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}

/** Yeniden adlandırma penceresi (başlık boş bırakılamaz) */
function RenameDialog({ book, onClose }: { book: BookRecord; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(book.title);
  const [failed, setFailed] = useState(false);
  const trimmed = title.trim();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!trimmed) return;
    if (trimmed === book.title) return onClose();
    try {
      await db.books.update(book.id, { title: trimmed });
      onClose();
    } catch (err) {
      console.error(err);
      setFailed(true);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-label="Kitabı yeniden adlandır"
      data-testid="rename-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="ui-pop m-auto w-[min(22rem,calc(100vw-2rem))] rounded-sheet bg-surface p-0 text-ink shadow-float backdrop:bg-black/40"
    >
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 p-5">
        <h2 className="text-[17px] font-semibold">Yeniden adlandır</h2>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-secondary">Başlık</span>
          <input
            autoFocus
            data-testid="rename-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="ui-focus min-h-11 rounded-control bg-fill px-3 text-[16px] text-ink"
          />
        </label>
        {failed && (
          <p role="alert" className="text-xs text-danger">
            Kaydedilemedi. Tekrar dene.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="ui-press min-h-11 rounded-full px-4 text-[15px] text-ink hover:bg-fill"
          >
            Vazgeç
          </button>
          <button
            type="submit"
            data-testid="rename-save"
            disabled={!trimmed}
            className="ui-press min-h-11 rounded-full bg-accent px-4 text-[15px] font-semibold text-paper disabled:opacity-40"
          >
            Kaydet
          </button>
        </div>
      </form>
    </dialog>
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
            className="-my-3 min-h-11 px-1 font-medium text-accent"
          >
            Tekrar dene
          </button>
        </div>
        {/* Nedeni görünür (telefonda üzerine gelinemez): sorun bildirirken okunabilsin */}
        {book.convert.error && (
          <p data-testid="convert-error" className="line-clamp-3 break-words text-secondary">
            {book.convert.error}
            {book.convert.errorAt && (
              <span className="block text-[10px] opacity-80">{book.convert.errorAt}</span>
            )}
          </p>
        )}
      </div>
    );
  }
  if (book.convert.state === 'pending')
    return <p className="mt-0.5 text-xs text-secondary">Sırada…</p>;
  if (book.convert.state !== 'done') {
    return (
      <p className="mt-0.5 text-xs text-secondary tabular-nums">
        Hazırlanıyor… %{Math.round(book.convert.progress * 100)}
      </p>
    );
  }
  const value = Math.round(percent * 100);
  // Hiç açılmamış kitap "Yeni"; sonuna gelinmişse "Bitti"
  const label = !book.lastOpenedAt && value === 0 ? 'Yeni' : value >= 100 ? 'Bitti' : `%${value}`;
  return (
    <p
      data-testid="book-progress"
      aria-label={label === 'Yeni' ? 'Yeni kitap' : `%${value} okundu`}
      className={`mt-0.5 text-xs font-medium tabular-nums ${label === 'Yeni' ? 'text-accent' : 'text-secondary'}`}
    >
      {label}
    </p>
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
        <span className="text-secondary">PDF bekleniyor</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          aria-label={`${book.title} kitabının PDF'ini ekle`}
          data-testid="attach-pdf"
          className="-my-3 min-h-11 px-1 font-medium text-accent disabled:opacity-40"
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
