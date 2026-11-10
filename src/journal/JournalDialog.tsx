import { useLiveQuery } from 'dexie-react-hooks';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { db, type BookRecord, type ReadingStatus } from '../db/db';
import { BookCover } from '../library/BookCover';
import { formatDuration, pace } from '../stats/aggregate';
import { IconButton } from '../ui/IconButton';
import { ListGroup, ListRow } from '../ui/List';
import { ModalShell } from '../ui/ModalShell';
import { SegmentedControl } from '../ui/SegmentedControl';
import {
  dateInputValue,
  datesInOrder,
  parseDateInput,
  STATUS_LABELS,
  updateJournal,
  type JournalPatch,
} from './journal';
import { ratingLabel, StarRating } from './StarRating';

/** İnceleme yazılırken bu kadar durulunca kaydedilir (ms) */
const REVIEW_SAVE_MS = 700;
/** Günlükte gösterilen son oturum sayısı */
const RECENT_SESSIONS = 5;

const STATUSES: ReadingStatus[] = ['unread', 'reading', 'finished', 'abandoned'];
/** Bölümlü seçicide kısa adlar (dar ekrana sığsın); erişilebilir ad tam adıdır */
const SHORT: Record<ReadingStatus, string> = {
  unread: 'Okunacak',
  reading: 'Okunuyor',
  finished: 'Bitti',
  abandoned: 'Yarım',
};

/**
 * Kitap günlüğü penceresi (kütüphanede kitabın ⋯ menüsünden, okuyucuda ⋯ menüsünden): durum, başlama ve bitiş
 * tarihi, yarım yıldızlı puan, inceleme (kendiliğinden kaydedilir), kitabın okuma süresi ve oturumları, not ve yer
 * imi sayısı. Her değişiklik hemen yazılır.
 */
export function JournalDialog({
  bookId,
  onClose,
  onOpenNotes,
}: {
  bookId: string;
  onClose(): void;
  /** okuyucuda: notlar panelini açar (kütüphanede yok) */
  onOpenNotes?(): void;
}) {
  const titleId = useId();
  const dateErrorId = useId();
  const book = useLiveQuery(() => db.books.get(bookId), [bookId]);
  const sessions = useLiveQuery(
    () => db.sessions.where('bookId').equals(bookId).sortBy('start'),
    [bookId],
  );
  const marks = useLiveQuery(
    async () => ({
      annotations: await db.annotations.where('bookId').equals(bookId).count(),
      bookmarks: await db.bookmarks.where('bookId').equals(bookId).count(),
    }),
    [bookId],
  );
  const [failed, setFailed] = useState(false);
  // Başlama bitişten sonra seçildi (ya da tersi): yazılmaz, satırların altında uyarı
  const [dateError, setDateError] = useState<string | null>(null);

  const save = (patch: JournalPatch) => {
    updateJournal(db, bookId, patch).then(
      () => setFailed(false),
      (e: unknown) => {
        console.error(e);
        setFailed(true);
      },
    );
  };

  // Kipli pencere: arkadaki ekran odak ve dokunuş almaz, Esc kapatır (<dialog> yoksa sabit katman)
  return (
    <ModalShell
      labelledBy={titleId}
      testId="journal-dialog"
      onClose={onClose}
      className="ui-pop max-h-[calc(100dvh-2rem)] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-sheet bg-grouped p-0 text-ink shadow-float"
    >
      <div className="material-bar sticky top-0 z-10 flex items-center gap-1 py-1 pr-1 pl-5 shadow-[0_0.5px_0_var(--ui-hairline)]">
        <h2
          id={titleId}
          tabIndex={-1}
          data-autofocus
          className="flex-1 text-[17px] font-semibold outline-none"
        >
          Kitap günlüğü
        </h2>
        <IconButton
          label="Pencereyi kapat"
          shortcut="Esc"
          Icon={X}
          variant="muted"
          testId="journal-close"
          onClick={onClose}
        />
      </div>
      {book && (
        <div className="flex flex-col gap-6 p-4 text-[15px] sm:p-5">
          <div className="flex items-center gap-4">
            <div className="w-14 shrink-0">
              <BookCover book={book} compact />
            </div>
            <div className="min-w-0">
              <p className="line-clamp-2 text-[17px] leading-snug font-semibold tracking-[-0.01em]">
                {book.title}
              </p>
              {book.author && <p className="truncate text-secondary">{book.author}</p>}
            </div>
          </div>

          <SegmentedControl
            label="Durum"
            value={book.readingStatus}
            onChange={(readingStatus) => save({ readingStatus })}
            segments={STATUSES.map((s) => ({
              value: s,
              label: SHORT[s],
              name: STATUS_LABELS[s],
              testId: `journal-status-${s}`,
            }))}
          />

          <ListGroup
            title="Tarihler"
            footer={
              dateError && (
                <span id={dateErrorId} role="alert" className="text-danger">
                  {dateError}
                </span>
              )
            }
          >
            <DateRow
              label="Başladı"
              testId="journal-started"
              value={book.startedAt}
              describedBy={dateError ? dateErrorId : undefined}
              onChange={(startedAt) => {
                const finish = book.readingStatus === 'finished' ? book.finishedAt : undefined;
                if (!datesInOrder(startedAt, finish))
                  return setDateError('Başlama tarihi bitiş tarihinden sonra olamaz.');
                setDateError(null);
                save({ startedAt });
              }}
            />
            {book.readingStatus === 'finished' && (
              <DateRow
                label="Bitti"
                testId="journal-finished"
                value={book.finishedAt}
                describedBy={dateError ? dateErrorId : undefined}
                onChange={(finishedAt) => {
                  if (!datesInOrder(book.startedAt, finishedAt))
                    return setDateError('Bitiş tarihi başlama tarihinden önce olamaz.');
                  setDateError(null);
                  save({ finishedAt });
                }}
              />
            )}
          </ListGroup>

          <ListGroup title="Puan">
            <ListRow className="flex-wrap py-2">
              <StarRating
                value={book.rating}
                onChange={(rating) => save({ rating })}
                testId="journal-rating"
              />
              <span className="flex-1" />
              {book.rating !== undefined && (
                <button
                  type="button"
                  onClick={() => save({ rating: undefined })}
                  aria-label={`Puanı kaldır (${ratingLabel(book.rating)})`}
                  className="ui-press -my-1 min-h-11 rounded-full px-3 text-[15px] text-accent hover:bg-fill"
                >
                  Kaldır
                </button>
              )}
            </ListRow>
          </ListGroup>

          <ReviewField key={book.id} book={book} onSave={(review) => save({ review })} />

          <ReadingSummary sessions={sessions} />

          {marks && (marks.annotations > 0 || marks.bookmarks > 0 || onOpenNotes) && (
            <ListGroup title="Notlar ve yer imleri">
              <ListRow label={`${marks.annotations} işaret · ${marks.bookmarks} yer imi`}>
                {onOpenNotes && (
                  <button
                    type="button"
                    data-testid="journal-open-notes"
                    onClick={onOpenNotes}
                    className="ui-press -my-1 min-h-11 rounded-full px-3 text-[15px] font-medium text-accent hover:bg-fill"
                  >
                    Notları aç
                  </button>
                )}
              </ListRow>
            </ListGroup>
          )}

          {failed && (
            <p role="alert" className="text-[13px] text-danger">
              Kaydedilemedi. Tekrar dene.
            </p>
          )}
        </div>
      )}
    </ModalShell>
  );
}

/** Tarih satırı: yerel tarih kutusu (boşaltılabilir) */
function DateRow({
  label,
  value,
  onChange,
  testId,
  describedBy,
}: {
  label: string;
  value: number | undefined;
  onChange(value: number | undefined): void;
  testId: string;
  /** uyarının kimliği (tarih sırası) */
  describedBy?: string;
}) {
  // Gelecek tarih seçilmesin (pencere açıkken bir kez hesaplanır)
  const [today] = useState(() => dateInputValue(Date.now()));
  return (
    <label className="flex min-h-11 items-center gap-3 px-4 py-1.5 text-[15px]">
      <span className="min-w-0 flex-1">{label}</span>
      <input
        type="date"
        data-testid={testId}
        value={dateInputValue(value)}
        max={today}
        aria-describedby={describedBy}
        aria-invalid={describedBy ? true : undefined}
        onChange={(e) => {
          const v = e.target.value;
          // Yarım yazılmış tarih (bazı tarayıcılarda) yazılmaz; boşaltmak tarihi siler
          if (v === '') onChange(undefined);
          else {
            const t = parseDateInput(v);
            if (t !== undefined) onChange(t);
          }
        }}
        className="ui-focus min-h-9 rounded-inner bg-fill px-2 text-[15px] text-ink tabular-nums"
      />
    </label>
  );
}

/**
 * İnceleme: yazdıkça (durulunca), odaktan çıkınca, pencere kapanınca, uygulamadan çıkılınca (sekme gizlenince) ve
 * sayfa kapanırken kaydedilir. Boşaltılan inceleme silinir (silme de düzenlemedir: öteki cihaza geçer).
 */
function ReviewField({
  book,
  onSave,
}: {
  book: BookRecord;
  onSave(review: string | undefined): void;
}) {
  const [text, setText] = useState(book.review ?? '');
  const [state, setState] = useState<'idle' | 'pending' | 'saved'>('idle');
  const pending = useRef<string | null>(null);
  const saveRef = useRef(onSave);
  useEffect(() => {
    saveRef.current = onSave;
  });
  const flush = () => {
    const value = pending.current;
    if (value === null) return;
    pending.current = null;
    saveRef.current(value.trim() ? value : undefined);
    setState('saved');
  };
  useEffect(() => {
    if (pending.current === null) return;
    const timer = setTimeout(flush, REVIEW_SAVE_MS);
    return () => clearTimeout(timer);
  });
  // Uygulamadan çıkılınca ya da sayfa kapanırken (iPad sekmeyi habersiz kapatabilir) beklemeden kaydedilir
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushRef.current();
    };
    const onHide = () => flushRef.current();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);
  // Pencere kapanırken yazılmamış kalan kaydedilir
  useEffect(
    () => () => {
      const value = pending.current;
      if (value !== null) saveRef.current(value.trim() ? value : undefined);
    },
    [],
  );
  const id = useId();
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-baseline px-4">
        <label htmlFor={id} className="flex-1 text-[13px] font-medium text-secondary">
          İnceleme ve notlar
        </label>
        <span role="status" className="text-xs text-secondary" data-testid="journal-review-state">
          {state === 'pending' ? 'Yazılıyor…' : state === 'saved' ? 'Kaydedildi' : ''}
        </span>
      </div>
      <textarea
        id={id}
        data-testid="journal-review"
        value={text}
        rows={4}
        placeholder="Kitap hakkında düşüncelerin, sevdiğin bölümler…"
        onChange={(e) => {
          setText(e.target.value);
          pending.current = e.target.value;
          setState('pending');
        }}
        onBlur={flush}
        // 16 px: iPad ve iPhone odaklanınca sayfayı yakınlaştırmasın
        className="ui-focus min-h-28 resize-y rounded-control bg-group px-4 py-3 text-[16px] leading-relaxed text-ink"
      />
    </section>
  );
}

/** Kitabın okuma süresi, hızı ve son oturumları */
function ReadingSummary({
  sessions,
}: {
  sessions: { start: number; activeMs: number; pages: number; words: number }[] | undefined;
}) {
  if (!sessions) return null;
  const p = pace(sessions);
  const recent = sessions.slice(-RECENT_SESSIONS).reverse();
  const day = (t: number) =>
    new Date(t).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  const time = (t: number) =>
    new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return (
    <ListGroup
      title="Okuma"
      testId="journal-reading"
      footer={
        sessions.length === 0
          ? 'Okudukça süren burada birikir. Kısa göz atmalar (30 sn’den az) sayılmaz.'
          : undefined
      }
    >
      <ListRow label="Toplam süre">
        <span className="text-secondary tabular-nums" data-testid="journal-total">
          {formatDuration(p.activeMs)}
        </span>
      </ListRow>
      <ListRow label="Oturum">
        <span className="text-secondary tabular-nums">{sessions.length}</span>
      </ListRow>
      {p.pagesPerMin !== null && (
        <ListRow label="Hız">
          <span className="text-secondary tabular-nums">
            {formatRate(p.pagesPerMin)} sayfa/dk
            {p.wordsPerMin !== null && ` · ${Math.round(p.wordsPerMin)} kelime/dk`}
          </span>
        </ListRow>
      )}
      {recent.map((s) => (
        <ListRow key={s.start} className="text-[13px]">
          <span className="min-w-0 flex-1 text-secondary">
            {day(s.start)}, {time(s.start)}
          </span>
          <span className="text-secondary tabular-nums">
            {formatDuration(s.activeMs)}
            {s.pages > 0 && ` · ${s.pages} sayfa`}
          </span>
        </ListRow>
      ))}
    </ListGroup>
  );
}

/** "1,5" (bir ondalık) */
export const formatRate = (v: number) =>
  v.toLocaleString('tr-TR', { maximumFractionDigits: v < 10 ? 1 : 0, minimumFractionDigits: 0 });
