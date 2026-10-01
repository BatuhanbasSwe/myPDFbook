import { useLiveQuery } from 'dexie-react-hooks';
import { DatabaseBackup, Info, MoreHorizontal, Palette, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { ThemePicker } from '../app/ThemePicker';
import { BackupDialog } from '../backup/BackupDialog';
import { BackupNotice } from '../backup/BackupNotice';
import { useBackupNotice } from '../backup/reminder';
import { db, type BookRecord } from '../db/db';
import { appImportDeps } from '../import/deps';
import { ImportError, importBook } from '../import/importBook';
import { IconButton } from '../ui/IconButton';
import { ListGroup } from '../ui/List';
import { MenuButton } from '../ui/MenuButton';
import { Sheet } from '../ui/Sheet';
import { BookCard } from './BookCard';
import { BookCover } from './BookCover';
import { InstallCard } from './InstallCard';

/**
 * Kütüphane (iOS Kitaplar gibi): büyük "Kitaplık" başlığı (kaydırınca üst çubukta küçük başlık), sağ üstte "+" (PDF
 * ekle) ve ⋯ (Yedekle / Geri yükle, Tema, Hakkında). Altında bilgi şeritleri, "Okumaya devam et" kartı ve kitaplar.
 */
export function LibraryPage() {
  const books = useLiveQuery(() => db.books.orderBy('addedAt').reverse().toArray(), []);
  const progress = useLiveQuery(
    async () => new Map((await db.progress.toArray()).map((p) => [p.bookId, p.percent])),
    [],
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Yedek penceresi açık mı; kütüphaneye yedek dosyası sürüklendiyse o dosya
  const [backup, setBackup] = useState<{ file?: File } | null>(null);
  const notice = useBackupNotice(books?.length);
  // ⋯ menüsü ve ondan açılan küçük pencere (tema, hakkında)
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheet, setSheet] = useState<'theme' | 'about' | null>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const [scrolledPast, observeTitle] = useScrolledPast();

  // Dosyalar sırayla kaydedilir; dönüştürmeler arka planda sırayla yürür (beklenmez). Her dosyanın sonucu adıyla bildirilir.
  // Sürüklenen yedek dosyası (.mypdfbook) yedek penceresinde açılır.
  async function handleFiles(files: File[]) {
    const backupFile = files.find(isBackupFile);
    const rest = files.filter((f) => !isBackupFile(f));
    if (backupFile) setBackup({ file: backupFile });
    const pdfs = rest.filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
    );
    if (pdfs.length === 0) {
      setMessage(backupFile && rest.length === 0 ? null : 'Lütfen PDF dosyası seç.');
      return;
    }
    const notes: string[] = [];
    if (pdfs.length < rest.length)
      notes.push(`${rest.length - pdfs.length} dosya PDF olmadığı için atlandı.`);
    setMessage(notes.length ? notes.join('\n') : null);
    for (const file of pdfs) {
      try {
        const res = await importBook(file, appImportDeps);
        if (res.status === 'exists') notes.push(`“${file.name}” zaten kütüphanende.`);
        else if (res.status === 'completed')
          notes.push(`“${file.name}”: PDF'i bekleyen kitap tamamlandı.`);
        else askPersist();
      } catch (e) {
        notes.push(`“${file.name}”: ${await describeImportError(e)}`);
      }
      setMessage(notes.length ? notes.join('\n') : null);
    }
  }

  function onDrop(e: DragEvent) {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setDragging(false);
    void handleFiles([...e.dataTransfer.files]);
  }

  const addPdf = () => inputRef.current?.click();

  const lastRead = books
    ?.filter((b) => b.lastOpenedAt && b.convert.state === 'done' && !b.pdfMissing)
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0];

  return (
    <div
      className="min-h-dvh bg-paper text-ink"
      onDragOver={(e) => {
        // Yalnızca dışarıdan dosya sürüklenince (sayfa içindeki kapak/görsel sürüklemesinde değil)
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <header
        className={`sticky top-0 z-(--ui-z-bar) pt-[env(safe-area-inset-top)] transition-[background-color,box-shadow] duration-200 ${
          scrolledPast ? 'material-bar shadow-[0_0.5px_0_var(--ui-hairline)]' : 'bg-paper'
        }`}
      >
        <div className="mx-auto grid h-14 max-w-6xl grid-cols-[1fr_auto_1fr] items-center px-2 sm:px-4">
          <span />
          {/* Büyük başlık kaydırılıp çubuğun altına girince küçük başlık görünür */}
          <p
            aria-hidden="true"
            className={`text-[17px] font-semibold transition-opacity duration-200 ${scrolledPast ? 'opacity-100' : 'opacity-0'}`}
          >
            Kitaplık
          </p>
          <div className="flex items-center justify-end gap-0.5">
            <IconButton label="PDF ekle" testId="add-pdf" Icon={Plus} onClick={addPdf} />
            <MenuButton
              label="Diğer"
              testId="library-more"
              menuTestId="library-more-menu"
              Icon={MoreHorizontal}
              open={menuOpen}
              onOpenChange={(open) => {
                setMenuOpen(open);
                if (open) setSheet(null);
              }}
              buttonRef={moreButton}
              actions={[
                {
                  id: 'backup-open',
                  menuLabel: 'Yedekle / Geri yükle',
                  Icon: DatabaseBackup,
                  run: () => setBackup({}),
                },
                {
                  id: 'library-theme',
                  menuLabel: 'Tema',
                  Icon: Palette,
                  divider: true,
                  run: () => setSheet('theme'),
                },
                {
                  id: 'library-about',
                  menuLabel: 'Hakkında',
                  Icon: Info,
                  run: () => setSheet('about'),
                },
              ]}
            />
          </div>
          <input
            ref={inputRef}
            data-testid="file-input"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(e) => {
              // Kopyala: value = '' bazı tarayıcılarda FileList'i yerinde boşaltır
              if (e.target.files) void handleFiles([...e.target.files]);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <h1
          ref={observeTitle}
          className="pt-1 pb-5 text-[34px] leading-tight font-bold tracking-[-0.02em]"
          style={{ fontFamily: 'var(--ui-font-display)' }}
        >
          Kitaplık
        </h1>
        {/* Canlı bölge hep yerinde: içeriği sonradan değişince ekran okuyucular duyurur */}
        <div role="status">
          {message && (
            <p className="mb-4 rounded-panel bg-group px-4 py-3 text-[15px] whitespace-pre-line shadow-control">
              {message}
            </p>
          )}
        </div>
        <div className="mb-6 flex flex-col gap-3 empty:hidden">
          {notice && <BackupNotice kind={notice} onBackup={() => setBackup({})} />}
          <InstallCard />
        </div>
        {lastRead && <ContinueCard book={lastRead} percent={progress?.get(lastRead.id) ?? 0} />}
        {books && books.length === 0 ? (
          <EmptyState onAdd={addPdf} />
        ) : (
          books && (
            <>
              <h2 className="mb-4 text-[20px] font-semibold tracking-[-0.01em]">Tüm kitaplar</h2>
              <ul className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {books.map((book) => (
                  <li key={book.id}>
                    <BookCard book={book} percent={progress?.get(book.id) ?? 0} />
                  </li>
                ))}
              </ul>
            </>
          )
        )}
      </main>

      {sheet && (
        <Sheet
          label={sheet === 'theme' ? 'Tema' : 'Hakkında'}
          testId={`library-${sheet}`}
          anchorRef={moreButton}
          onDismiss={() => setSheet(null)}
        >
          <div className="max-h-[70dvh] overflow-y-auto bg-grouped p-3">
            {sheet === 'theme' ? (
              <ListGroup title="Tema" footer="Okurken Aa panelinden de değişir.">
                <div className="px-4 py-3">
                  <ThemePicker />
                </div>
              </ListGroup>
            ) : (
              <About />
            )}
          </div>
        </Sheet>
      )}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-(--ui-z-dialog) grid place-items-center bg-paper/85">
          <p className="rounded-sheet border-2 border-dashed border-accent px-10 py-8 text-[20px] font-semibold text-accent">
            PDF'i bırak
          </p>
        </div>
      )}

      {backup && (
        <BackupDialog
          initialFile={backup.file}
          onClose={() => setBackup(null)}
          onRestored={askPersist}
        />
      )}
    </div>
  );
}

/**
 * Büyük başlık üst çubuğun altına kaydı mı (iOS büyük başlık: çubukta küçük başlık ve kenar çizgisi belirir).
 * IntersectionObserver ile: kaydırma olayı dinlenmez.
 */
function useScrolledPast(): [boolean, (el: HTMLElement | null) => void] {
  const [past, setPast] = useState(false);
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setPast(!e.isIntersecting), {
      // Üst çubuğun (56 px ve çentik) altında kalan kısım
      rootMargin: '-64px 0px 0px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [el]);
  return [past, setEl];
}

/** Boş kütüphane: sade bir çizim ve tek bir "PDF ekle" çağrısı */
function EmptyState({ onAdd }: { onAdd(): void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center" data-testid="library-empty">
      <svg
        aria-hidden="true"
        viewBox="0 0 120 96"
        className="w-32 text-secondary"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="88" cy="26" r="14" fill="var(--ui-tint)" stroke="none" />
        <path d="M60 30c-9-7-24-9-40-7v52c16-2 31 0 40 7 9-7 24-9 40-7V23c-16-2-31 0-40 7z" />
        <path d="M60 30v52" />
        <path d="M30 38c7-.6 14 .4 20 3M30 48c7-.6 14 .4 20 3M70 41c6-2.6 13-3.6 20-3M70 51c6-2.6 13-3.6 20-3" />
      </svg>
      <div className="flex flex-col gap-1">
        <h2 className="text-[20px] font-semibold tracking-[-0.01em]">Henüz kitap yok.</h2>
        <p className="max-w-sm text-[15px] text-secondary">
          Bir PDF ekle ya da buraya sürükleyip bırak; kitap gibi okunur hâle getirilir.
        </p>
      </div>
      <button
        type="button"
        onClick={onAdd}
        data-testid="empty-add"
        className="ui-press flex min-h-11 items-center gap-2 rounded-full bg-accent px-5 text-[15px] font-semibold text-paper hover:opacity-90"
      >
        <Plus className="size-[18px]" strokeWidth={2} aria-hidden /> PDF ekle
      </button>
      <p className="max-w-sm text-[13px] text-secondary">
        Başka cihazdaki kitaplığını taşımak için: ⋯ → Yedekle / Geri yükle → Yedek dosyası seç.
      </p>
    </div>
  );
}

/** Hakkında: uygulamanın ne yaptığı ve verilerin nerede durduğu */
function About() {
  return (
    <ListGroup title="Hakkında">
      <div className="flex flex-col gap-2 px-4 py-3 text-[15px]">
        <p className="font-semibold">myPDFbook</p>
        <p className="text-secondary">
          PDF'leri kitap gibi okur: sayfa çevirme, metin görünümü, sesli ve hızlı okuma, kalem ve
          notlar.
        </p>
        <p className="text-secondary">
          Kitapların, notların ve okuma yerlerin yalnızca bu cihazda saklanır; internet gerekmez.
          Başka cihaza taşımak için yedek al.
        </p>
      </div>
    </ListGroup>
  );
}

/** Yedek dosyası (.mypdfbook; paylaşılırken .zip'e dönmüş olabilir) */
const isBackupFile = (f: File) => /\.(mypdfbook|zip)$/i.test(f.name);

/** Tarayıcıdan verileri silmemesini ister; izin zaten verildiyse tekrar sormaz. */
function askPersist() {
  void navigator.storage
    ?.persisted?.()
    .then((granted) => granted || navigator.storage.persist())
    .catch(() => undefined);
}

async function describeImportError(e: unknown): Promise<string> {
  if (!(e instanceof ImportError)) {
    console.error(e);
    return 'Beklenmeyen bir hata oluştu.';
  }
  if (e.code !== 'quota') return e.message;
  // Kullanıcı ne kadar yer açması gerektiğini görsün
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  if (estimate?.usage === undefined || !estimate.quota) return e.message;
  return `${e.message} (Kullanılan: ${megabytes(estimate.usage)} / ${megabytes(estimate.quota)})`;
}

const megabytes = (bytes: number) => `${Math.round(bytes / 1e6).toLocaleString('tr-TR')} MB`;

/** Son okunan kitap: büyük kapak, ilerleme ve "Kaldığın yerden devam et" */
function ContinueCard({ book, percent }: { book: BookRecord; percent: number }) {
  const value = Math.round(percent * 100);
  return (
    <Link
      to={`/read/${book.id}`}
      data-testid="continue-card"
      aria-label={`Okumaya devam et: ${book.title}, %${value} okundu`}
      className="ui-press ui-focus mb-10 flex items-center gap-5 rounded-sheet bg-group p-4 shadow-control sm:gap-7 sm:p-6"
    >
      <div className="w-20 shrink-0 sm:w-28">
        <BookCover book={book} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-[13px] font-medium text-secondary">Okumaya devam et</p>
        <p className="line-clamp-2 text-[20px] leading-tight font-semibold tracking-[-0.01em] sm:text-[24px]">
          {book.title}
        </p>
        {book.author && <p className="truncate text-[15px] text-secondary">{book.author}</p>}
        <div className="mt-2 flex items-center gap-3">
          <div className="h-1 max-w-56 flex-1 overflow-hidden rounded-full bg-fill-strong">
            <div className="h-full rounded-full bg-accent" style={{ width: `${value}%` }} />
          </div>
          <span className="text-[13px] font-medium text-secondary tabular-nums">%{value}</span>
        </div>
        <span className="mt-3 inline-flex min-h-11 w-fit items-center rounded-full bg-accent px-4 text-[15px] font-semibold text-paper">
          Kaldığın yerden devam et
        </span>
      </div>
    </Link>
  );
}
