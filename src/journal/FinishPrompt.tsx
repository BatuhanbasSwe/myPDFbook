import { BookCheck, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { db, type BookRecord } from '../db/db';
import { IconButton } from '../ui/IconButton';
import { markFinishAsked, updateJournal } from './journal';
import { StarRating } from './StarRating';

/**
 * Son sayfada bir kez sorulan küçük kart: "Kitabı bitirdin mi?" Evet: kitap biter (bitiş tarihi bugün) ve puan
 * sorulur; Henüz değil: kart kapanır, bir daha sorulmaz. Kitabın üstünde yüzer; sayfanın kendisi değişmez.
 */
export function FinishPrompt({
  book,
  stage,
  onStage,
  onOpenJournal,
  style,
}: {
  book: BookRecord;
  /** ask: soru; rate: "Evet"ten sonra puan */
  stage: 'ask' | 'rate';
  onStage(stage: 'rate' | null): void;
  onOpenJournal(): void;
  style?: CSSProperties;
}) {
  const answer = (finished: boolean) => {
    const done = finished
      ? updateJournal(db, book.id, { readingStatus: 'finished' }).then(() =>
          markFinishAsked(db, book.id),
        )
      : markFinishAsked(db, book.id);
    done.catch(() => undefined);
    onStage(finished ? 'rate' : null);
  };

  return (
    <section
      data-testid="finish-prompt"
      data-stage={stage}
      aria-label={stage === 'ask' ? 'Kitabı bitirdin mi?' : 'Kitaba puan ver'}
      style={style}
      className="material ui-pop absolute left-1/2 z-(--ui-z-panel) flex w-[min(24rem,calc(100vw-1.5rem))] -translate-x-1/2 items-center gap-3 rounded-panel py-2 pr-1.5 pl-3"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-tint text-accent">
        <BookCheck className="size-[18px]" strokeWidth={1.75} aria-hidden />
      </span>
      {stage === 'ask' ? (
        <>
          <p className="min-w-0 flex-1 text-[15px] font-semibold">Kitabı bitirdin mi?</p>
          <button
            type="button"
            data-testid="finish-not-yet"
            onClick={() => answer(false)}
            className="ui-press min-h-11 shrink-0 rounded-full px-3 text-[15px] text-ink hover:bg-fill"
          >
            Henüz değil
          </button>
          <button
            type="button"
            data-testid="finish-yes"
            onClick={() => answer(true)}
            className="ui-press min-h-11 shrink-0 rounded-full bg-accent px-4 text-[15px] font-semibold text-paper hover:opacity-90"
          >
            Evet
          </button>
        </>
      ) : (
        <>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
            <p className="text-[15px] font-semibold" role="status">
              Tebrikler! Puanın?
            </p>
            <StarRating
              size="small"
              value={book.rating}
              testId="finish-rating"
              onChange={(rating) => {
                updateJournal(db, book.id, { rating }).catch(() => undefined);
              }}
            />
            <button
              type="button"
              data-testid="finish-open-journal"
              onClick={onOpenJournal}
              className="ui-press -ml-1 w-fit min-h-9 rounded-full px-1 text-left text-[13px] font-medium text-accent"
            >
              Günlüğe inceleme yaz
            </button>
          </div>
          <IconButton
            label="Kapat"
            testId="finish-close"
            Icon={X}
            variant="muted"
            onClick={() => onStage(null)}
            className="self-start"
          />
        </>
      )}
    </section>
  );
}
