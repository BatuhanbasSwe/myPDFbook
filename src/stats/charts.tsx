import { useState, type ReactNode } from 'react';
import { formatDuration, type DayValue, type HeatCell } from './aggregate';

const MINUTE = 60_000;

const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

/** "Çarşamba, 30 Eylül" */
export const longDay = (t: number) =>
  new Date(t).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });

/**
 * Günlük hedef halkası (Apple Fitness gibi): iz ve vurgu renginde yay; ortada okunan dakika ve hedef. Hedef
 * aşılınca halka dolu kalır, ortadaki sayı gerçek süreyi söyler.
 */
export function GoalRing({
  ms,
  goalMs,
  size = 132,
}: {
  ms: number;
  goalMs: number;
  size?: number;
}) {
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = goalMs > 0 ? Math.min(1, ms / goalMs) : 0;
  const minutes = Math.floor(ms / MINUTE);
  const goal = Math.round(goalMs / MINUTE);
  return (
    <div
      role="img"
      aria-label={`Bugün ${minutes} dakika okundu, günlük hedef ${goal} dakika`}
      data-testid="goal-ring"
      data-minutes={minutes}
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="size-full -rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          style={{ stroke: 'var(--ui-fill-strong)' }}
        />
        {ratio > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * ratio} ${c}`}
            style={{ stroke: 'var(--accent)' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center" aria-hidden="true">
        <span className="text-[32px] leading-none font-semibold tracking-[-0.02em]">{minutes}</span>
        <span className="mt-1 text-[13px] text-secondary">/ {goal} dk</span>
      </div>
    </div>
  );
}

/**
 * Bu haftanın sütun grafiği: günlük okuma süresi, hedef çizgisi. Sütuna dokununca (fareyle üzerine gelince,
 * klavyeyle odaklanınca) üstteki satır o günü yazar; yoksa haftanın toplamını.
 */
export function WeekChart({
  days,
  goalMs,
  today,
}: {
  days: DayValue[];
  goalMs: number;
  /** bugünün anahtarı (vurgulu etiket; sonraki günler boş) */
  today: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const max = Math.max(goalMs * 1.25, ...days.map((d) => d.ms), MINUTE);
  const total = days.reduce((n, d) => n + d.ms, 0);
  const past = days.filter((d) => d.key <= today).length;
  const sel = days.find((d) => d.key === selected);
  const goalPct = (goalMs / max) * 100;
  return (
    <div className="flex flex-col gap-3">
      <p className="min-h-5 text-[13px] text-secondary tabular-nums" aria-live="polite">
        {sel ? (
          <>
            <span className="font-semibold text-ink">{formatDuration(sel.ms)}</span> ·{' '}
            {longDay(sel.date)}
          </>
        ) : (
          <>
            Toplam <span className="font-semibold text-ink">{formatDuration(total)}</span> · günde
            ortalama {formatDuration(past ? total / past : 0)}
          </>
        )}
      </p>
      <div className="relative h-36" data-testid="week-chart">
        {/* Taban ve hedef çizgisi: ince, geride */}
        <div className="absolute inset-x-0 bottom-6 h-px bg-hairline" aria-hidden="true" />
        <div
          className="pointer-events-none absolute inset-x-0 flex items-center gap-2"
          style={{ bottom: `calc(1.5rem + (100% - 1.5rem) * ${goalPct / 100})` }}
          aria-hidden="true"
        >
          <span className="h-px flex-1 bg-hairline" />
          <span className="translate-y-[-55%] text-[11px] text-secondary">
            Hedef {Math.round(goalMs / MINUTE)} dk
          </span>
        </div>
        <div className="absolute inset-0 flex">
          {days.map((d, i) => {
            const future = d.key > today;
            const pct = (d.ms / max) * 100;
            return (
              <button
                key={d.key}
                type="button"
                disabled={future}
                data-testid={`week-day-${i}`}
                data-ms={Math.round(d.ms)}
                aria-label={`${longDay(d.date)}: ${formatDuration(d.ms)}`}
                aria-pressed={selected === d.key}
                onPointerEnter={(e) => e.pointerType === 'mouse' && setSelected(d.key)}
                onPointerLeave={(e) => e.pointerType === 'mouse' && setSelected(null)}
                onFocus={() => setSelected(d.key)}
                onBlur={() => setSelected(null)}
                onClick={() => setSelected(d.key)}
                className="ui-focus group flex min-w-0 flex-1 flex-col items-center justify-end rounded-inner outline-offset-0"
              >
                <span className="flex w-full flex-1 items-end justify-center pb-px">
                  {d.ms > 0 && (
                    <span
                      className={`w-[min(24px,60%)] rounded-t-[4px] bg-accent transition-opacity ${
                        selected && selected !== d.key ? 'opacity-45' : ''
                      }`}
                      style={{ height: `max(3px, ${pct}%)` }}
                    />
                  )}
                </span>
                <span
                  className={`flex h-6 items-end text-[11px] ${
                    d.key === today ? 'font-semibold text-ink' : 'text-secondary'
                  }`}
                >
                  {WEEKDAYS[i]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Isı haritası en az bu ölçekte çizilir (hücre ~9 px): daha darsa yana kayar */
const MIN_SCALE = 0.9;

/** Kayan kabı en sağa (en yeni haftaya) kaydırır */
const scrollToEnd = (el: HTMLDivElement | null) => {
  if (el) el.scrollLeft = el.scrollWidth;
};

/** Isı haritasının dilimleri: vurgu renginin opaklığı (açık ve koyu temada sıralı, ayrışır; doğrulandı) */
const LEVEL_OPACITY = [0, 0.5, 0.67, 0.84, 1];

/**
 * Yıllık ısı haritası (GitHub gibi): sütun başına bir hafta, satırda pazartesiden pazara. Hücre rengi günlük
 * hedefe göre koyulaşır. SVG genişliğe uyar: telefonda hücreler küçülür. Hücreye dokununca (üzerine gelince) o
 * günün süresi yazılır. Ekran okuyucu için aylık özet tablosu.
 */
export function Heatmap({ weeks }: { weeks: HeatCell[][] }) {
  const [selected, setSelected] = useState<HeatCell | null>(null);
  const cell = 10;
  const gap = 2;
  const left = 22;
  const top = 14;
  const width = left + weeks.length * (cell + gap);
  const height = top + 7 * (cell + gap);
  // Ay adları: ayın ilk gününü içeren haftanın üstünde
  const months: { x: number; label: string }[] = [];
  weeks.forEach((week, w) => {
    const first = week.find((d) => new Date(d.date).getDate() === 1);
    if (first && w < weeks.length - 1) {
      months.push({ x: left + w * (cell + gap), label: MONTHS[new Date(first.date).getMonth()] });
    }
  });
  const pick = (target: EventTarget | null) => {
    const key = target instanceof Element ? target.getAttribute('data-key') : null;
    if (!key) return null;
    for (const week of weeks) for (const d of week) if (d.key === key) return d;
    return null;
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="min-h-5 text-[13px] text-secondary tabular-nums" aria-hidden="true">
        {selected ? (
          <>
            <span className="font-semibold text-ink">{formatDuration(selected.ms)}</span> ·{' '}
            {longDay(selected.date)}
          </>
        ) : (
          'Bir güne dokun'
        )}
      </p>
      {/* Dar ekranda (telefon) hücreler okunur boyda kalır, harita yana kayar; açılınca en yeni hafta görünür */}
      <div ref={scrollToEnd} className="-mx-1 overflow-x-auto overscroll-x-contain px-1">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full select-none"
          style={{ minWidth: width * MIN_SCALE }}
          aria-hidden="true"
          data-testid="heatmap"
          onPointerMove={(e) => {
            if (e.pointerType === 'mouse') setSelected(pick(e.target));
          }}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setSelected(null)}
          onPointerDown={(e) => setSelected(pick(e.target))}
        >
          {months.map((m) => (
            <text key={m.x} x={m.x} y={9} className="fill-secondary text-[9px]">
              {m.label}
            </text>
          ))}
          {[0, 2, 4].map((d) => (
            <text
              key={d}
              x={0}
              y={top + d * (cell + gap) + cell - 2}
              className="fill-secondary text-[8px]"
            >
              {WEEKDAYS[d]}
            </text>
          ))}
          {weeks.map((week, w) =>
            week.map((d, i) =>
              d.future ? null : (
                <rect
                  key={d.key}
                  data-key={d.key}
                  data-level={d.level}
                  x={left + w * (cell + gap)}
                  y={top + i * (cell + gap)}
                  width={cell}
                  height={cell}
                  rx={2}
                  style={
                    d.level === 0
                      ? { fill: 'var(--ui-fill-strong)' }
                      : { fill: 'var(--accent)', fillOpacity: LEVEL_OPACITY[d.level] }
                  }
                  stroke={selected?.key === d.key ? 'var(--ink)' : undefined}
                  strokeWidth={selected?.key === d.key ? 1 : undefined}
                />
              ),
            ),
          )}
        </svg>
      </div>
      <div
        className="flex items-center justify-end gap-1.5 text-[11px] text-secondary"
        aria-hidden="true"
      >
        Az
        {LEVEL_OPACITY.map((o, level) => (
          <span
            key={level}
            className="size-2.5 rounded-[2px]"
            style={
              level === 0
                ? { background: 'var(--ui-fill-strong)' }
                : { background: 'var(--accent)', opacity: o }
            }
          />
        ))}
        Çok
      </div>
      <MonthTable weeks={weeks} />
    </div>
  );
}

/** Ekran okuyucu için: ay başına okunan gün ve süre */
function MonthTable({ weeks }: { weeks: HeatCell[][] }) {
  const months = new Map<string, { label: string; days: number; ms: number }>();
  for (const week of weeks)
    for (const d of week) {
      if (d.future) continue;
      const date = new Date(d.date);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      const m = months.get(key) ?? {
        label: date.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }),
        days: 0,
        ms: 0,
      };
      if (d.level > 0) m.days++;
      m.ms += d.ms;
      months.set(key, m);
    }
  return (
    <table className="sr-only">
      <caption>Son bir yılda aylara göre okuma</caption>
      <thead>
        <tr>
          <th scope="col">Ay</th>
          <th scope="col">Okunan gün</th>
          <th scope="col">Süre</th>
        </tr>
      </thead>
      <tbody>
        {[...months.values()].map((m) => (
          <tr key={m.label}>
            <th scope="row">{m.label}</th>
            <td>{m.days}</td>
            <td>{formatDuration(m.ms)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Rakam kutusu: etiket ve büyük değer (ve küçük açıklama) */
export function StatTile({
  label,
  value,
  note,
  testId,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="flex flex-col gap-0.5 rounded-panel bg-group px-4 py-3 shadow-control"
      data-testid={testId}
    >
      <span className="text-[13px] text-secondary">{label}</span>
      <span className="text-[22px] leading-tight font-semibold tracking-[-0.01em]">{value}</span>
      {note && <span className="text-xs text-secondary">{note}</span>}
    </div>
  );
}
