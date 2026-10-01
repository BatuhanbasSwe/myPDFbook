import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Minus, Plus } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { db, type BookRecord } from '../db/db';
import { formatRate, JournalDialog } from '../journal/JournalDialog';
import { STATUS_LABELS } from '../journal/journal';
import { RatingBadge } from '../journal/StarRating';
import { BookCover } from '../library/BookCover';
import { IconButton } from '../ui/IconButton';
import { ListGroup, ListRow } from '../ui/List';
import { useTooltip } from '../ui/Tooltip';
import {
  bookTotals,
  dailyTotals,
  dayKey,
  finishedInYear,
  formatDuration,
  heatmap,
  pace,
  streaks,
  weekDays,
} from './aggregate';
import { GoalRing, Heatmap, StatTile, WeekChart } from './charts';
import { DAILY_GOAL_OPTIONS, setGoals, useGoals, YEARLY_GOAL_RANGE } from './goals';

const MINUTE = 60_000;

/**
 * İstatistikler (kütüphanenin ⋯ menüsünden): bugünün hedef halkası ve seri, bu haftanın grafiği, son bir yılın ısı
 * haritası, bu yıl biten kitaplar ve yıllık hedef, toplam süre ve hız, kitap başına liste (günlüğü açar), hedef
 * ayarları. Veriler okurken izlenen oturumlardan (stats/sessionTracker) hesaplanır.
 */
export function StatsPage() {
  const sessions = useLiveQuery(() => db.sessions.orderBy('start').toArray(), []);
  const books = useLiveQuery(() => db.books.toArray(), []);
  const goals = useGoals();
  // Ekran açıkken gün değişirse sonraki yenilemede düzelir; "şimdi" açılışta bir kez alınır
  const [now] = useState(() => Date.now());
  const [journal, setJournal] = useState<string | null>(null);
  const backTip = useTooltip({ label: 'Kütüphaneye dön' });

  const goalMs = goals.dailyMinutes * MINUTE;
  const stats = useMemo(() => {
    if (!sessions) return null;
    const daily = dailyTotals(sessions);
    return {
      daily,
      today: daily.get(dayKey(now)) ?? 0,
      streak: streaks(daily, now),
      week: weekDays(daily, now),
      // Telefonda da bütün yıl: SVG genişliğe uyar, hücreler küçülür
      heat: heatmap(daily, now, goalMs),
      pace: pace(sessions),
      perBook: bookTotals(sessions),
    };
  }, [sessions, now, goalMs]);

  const finished = books ? finishedInYear(books, now) : [];
  const byId = new Map((books ?? []).map((b) => [b.id, b]));
  const bookRows = stats
    ? [...stats.perBook.entries()]
        .filter(([id]) => byId.has(id))
        .sort((a, b) => b[1].lastRead - a[1].lastRead)
    : [];
  const empty = sessions !== undefined && sessions.length === 0;

  return (
    <div className="min-h-dvh bg-paper text-ink" data-testid="stats-page">
      <header className="material-bar sticky top-0 z-(--ui-z-bar) pt-[env(safe-area-inset-top)] shadow-[0_0.5px_0_var(--ui-hairline)]">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-1 px-2 sm:px-4">
          <Link to="/" aria-label="Kütüphaneye dön" {...backTip.handlers} className={backClass}>
            <ArrowLeft className="size-[22px]" strokeWidth={1.75} />
          </Link>
          {backTip.tip}
          <p className="text-[17px] font-semibold">İstatistikler</p>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-4 pt-4 pb-16 sm:px-6">
        {empty && <EmptyStats />}

        {stats && !empty && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Card title="Bugün" testId="stats-today">
                <div className="flex items-center gap-5">
                  <GoalRing ms={stats.today} goalMs={goalMs} />
                  <div className="flex flex-col gap-3">
                    <Figure
                      label="Okuma serisi"
                      value={`${stats.streak.current} gün`}
                      testId="stats-streak"
                    />
                    <Figure label="En uzun seri" value={`${stats.streak.best} gün`} />
                  </div>
                </div>
                <p className="mt-3 text-[13px] text-secondary">
                  {stats.today >= goalMs
                    ? 'Bugünkü hedefe ulaştın.'
                    : `Hedefe ${formatDuration(goalMs - stats.today)} kaldı.`}
                </p>
              </Card>
              <YearGoal
                finished={finished}
                goal={goals.yearlyBooks}
                now={now}
                onOpen={setJournal}
              />
            </div>

            <Card title="Bu hafta" testId="stats-week">
              <WeekChart days={stats.week} goalMs={goalMs} today={dayKey(now)} />
            </Card>

            <Card title="Son bir yıl" testId="stats-year">
              <Heatmap weeks={stats.heat} />
            </Card>

            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Toplamlar">
              <StatTile
                label="Toplam okuma"
                value={formatDuration(stats.pace.activeMs)}
                testId="stats-total"
              />
              <StatTile label="Okunan sayfa" value={stats.pace.pages.toLocaleString('tr-TR')} />
              <StatTile
                label="Ortalama hız"
                value={
                  stats.pace.pagesPerMin !== null ? (
                    <>
                      {formatRate(stats.pace.pagesPerMin)}{' '}
                      <span className="text-[15px] font-medium text-secondary">sayfa/dk</span>
                    </>
                  ) : (
                    '—'
                  )
                }
                note={stats.pace.pagesPerMin === null ? 'Biraz daha okuyunca' : undefined}
              />
              <StatTile
                label="Kelime hızı"
                value={
                  stats.pace.wordsPerMin !== null ? (
                    <>
                      {Math.round(stats.pace.wordsPerMin)}{' '}
                      <span className="text-[15px] font-medium text-secondary">kelime/dk</span>
                    </>
                  ) : (
                    '—'
                  )
                }
              />
            </section>

            {bookRows.length > 0 && (
              <ListGroup title="Kitaplar" testId="stats-books">
                {bookRows.map(([id, t]) => {
                  const book = byId.get(id)!;
                  const p = pace([t]);
                  return (
                    <button
                      key={id}
                      type="button"
                      data-testid="stats-book"
                      onClick={() => setJournal(id)}
                      aria-label={`${book.title}: ${formatDuration(t.activeMs)}; kitap günlüğünü aç`}
                      className="ui-press flex min-h-16 w-full items-center gap-3 px-4 py-2 text-left hover:bg-fill"
                    >
                      <div className="w-9 shrink-0">
                        <BookCover book={book} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-medium">{book.title}</p>
                        <p className="truncate text-[13px] text-secondary">
                          {t.sessions} oturum
                          {p.pagesPerMin !== null && ` · ${formatRate(p.pagesPerMin)} sayfa/dk`}
                          {' · '}
                          {STATUS_LABELS[book.readingStatus]}
                          {book.rating !== undefined && (
                            <>
                              {' · '}
                              <RatingBadge value={book.rating} />
                            </>
                          )}
                        </p>
                      </div>
                      <span className="shrink-0 text-[15px] text-secondary tabular-nums">
                        {formatDuration(t.activeMs)}
                      </span>
                    </button>
                  );
                })}
              </ListGroup>
            )}
          </>
        )}

        {sessions !== undefined && empty && (
          <YearGoal finished={finished} goal={goals.yearlyBooks} now={now} onOpen={setJournal} />
        )}

        <ListGroup
          title="Hedefler"
          footer="Okuma süresi kitap açıkken ve sen okurken işler; 2 dakika dokunulmazsa durur. Sesli ve hızlı okuma da sayılır."
          testId="stats-goals"
        >
          <ListRow label="Günlük okuma">
            <Stepper
              value={`${goals.dailyMinutes} dk`}
              testId="goal-daily"
              label="Günlük okuma hedefi"
              onStep={(dir) => setGoals({ dailyMinutes: stepOption(goals.dailyMinutes, dir) })}
              canDown={goals.dailyMinutes > DAILY_GOAL_OPTIONS[0]}
              canUp={goals.dailyMinutes < DAILY_GOAL_OPTIONS[DAILY_GOAL_OPTIONS.length - 1]}
            />
          </ListRow>
          <ListRow label="Yıllık kitap">
            <Stepper
              value={`${goals.yearlyBooks} kitap`}
              testId="goal-yearly"
              label="Yıllık kitap hedefi"
              onStep={(dir) =>
                setGoals({
                  yearlyBooks: Math.min(
                    YEARLY_GOAL_RANGE.max,
                    Math.max(YEARLY_GOAL_RANGE.min, goals.yearlyBooks + dir),
                  ),
                })
              }
              canDown={goals.yearlyBooks > YEARLY_GOAL_RANGE.min}
              canUp={goals.yearlyBooks < YEARLY_GOAL_RANGE.max}
            />
          </ListRow>
        </ListGroup>
      </main>

      {journal && <JournalDialog bookId={journal} onClose={() => setJournal(null)} />}
    </div>
  );
}

const backClass =
  'ui-press grid size-11 shrink-0 place-items-center rounded-full text-ink hover:bg-fill active:bg-fill-strong';

/** Sonraki ya da önceki seçenek (seçeneklerde olmayan değerden en yakına) */
function stepOption(value: number, dir: 1 | -1): number {
  const options = DAILY_GOAL_OPTIONS as readonly number[];
  if (dir > 0) return options.find((o) => o > value) ?? options[options.length - 1];
  return [...options].reverse().find((o) => o < value) ?? options[0];
}

function Card({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="flex flex-col gap-3 rounded-sheet bg-group p-4 shadow-control sm:p-5"
      aria-label={title}
      data-testid={testId}
    >
      <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
      {children}
    </section>
  );
}

function Figure({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex flex-col" data-testid={testId}>
      <span className="text-[13px] text-secondary">{label}</span>
      <span className="text-[22px] leading-tight font-semibold tracking-[-0.01em]">{value}</span>
    </div>
  );
}

/** Bu yıl biten kitaplar ve yıllık hedef: ilerleme çubuğu ve kapaklar */
function YearGoal({
  finished,
  goal,
  now,
  onOpen,
}: {
  finished: BookRecord[];
  goal: number;
  now: number;
  onOpen(id: string): void;
}) {
  const year = new Date(now).getFullYear();
  const ratio = Math.min(1, finished.length / goal);
  return (
    <Card title={`${year} hedefi`} testId="stats-year-goal">
      <p className="flex items-baseline gap-1.5">
        <span
          className="text-[32px] leading-none font-semibold tracking-[-0.02em]"
          data-testid="year-finished"
        >
          {finished.length}
        </span>
        <span className="text-[15px] text-secondary">/ {goal} kitap bitti</span>
      </p>
      <div
        role="progressbar"
        aria-label={`Yıllık hedef: ${finished.length} / ${goal} kitap`}
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-valuenow={Math.min(goal, finished.length)}
        className="h-2 overflow-hidden rounded-full bg-fill-strong"
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${ratio * 100}%` }} />
      </div>
      {finished.length > 0 ? (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {finished.map((b) => (
            <li key={b.id} className="w-11 shrink-0">
              <button
                type="button"
                onClick={() => onOpen(b.id)}
                aria-label={`${b.title}: kitap günlüğünü aç`}
                className="ui-press ui-focus block w-full rounded-[5px]"
              >
                <BookCover book={b} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-secondary">
          Bir kitabı bitirince kitap günlüğünde “Bitti” olarak işaretle; burada sayılır.
        </p>
      )}
    </Card>
  );
}

/** Henüz okuma kaydı yok */
function EmptyStats() {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center" data-testid="stats-empty">
      <svg
        aria-hidden="true"
        viewBox="0 0 120 96"
        className="w-28 text-secondary"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <circle cx="60" cy="48" r="34" stroke="var(--ui-fill-strong)" strokeWidth="10" />
        <path d="M60 14a34 34 0 0 1 29.4 17" stroke="var(--accent)" strokeWidth="10" />
      </svg>
      <h2 className="text-[20px] font-semibold tracking-[-0.01em]">Henüz okuma kaydı yok.</h2>
      <p className="max-w-sm text-[15px] text-secondary">
        Bir kitap açıp okudukça günlük süren, serin ve hızın burada görünür.
      </p>
    </div>
  );
}

/** − değer + : iOS adımlayıcısı gibi */
function Stepper({
  value,
  label,
  onStep,
  canDown,
  canUp,
  testId,
}: {
  value: string;
  label: string;
  onStep(dir: 1 | -1): void;
  canDown: boolean;
  canUp: boolean;
  testId: string;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <IconButton
        label="Azalt"
        Icon={Minus}
        testId={`${testId}-down`}
        disabled={!canDown}
        onClick={() => onStep(-1)}
      />
      <span
        className="min-w-16 text-center text-[15px] font-medium tabular-nums"
        aria-live="polite"
        data-testid={testId}
      >
        {value}
      </span>
      <IconButton
        label="Artır"
        Icon={Plus}
        testId={`${testId}-up`}
        disabled={!canUp}
        onClick={() => onStep(1)}
      />
    </div>
  );
}
