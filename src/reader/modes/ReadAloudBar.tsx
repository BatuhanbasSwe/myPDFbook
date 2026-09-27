import {
  Moon,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Volume2,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { RATE_CHOICES } from './readAloud';
import type { ReadAloudUi } from './useReadAloud';

/** Uyku zamanlayıcısı seçenekleri (dakika) */
const SLEEP_OPTIONS = [15, 30, 60] as const;

/** Başlıktaki "Sesli oku" düğmesi: okumayı açar ve başlatır (dokunuşun içinde: iOS), açıkken kapatır */
export function ReadAloudButton({ open, onClick }: { open: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      data-testid="read-aloud"
      aria-label="Sesli oku"
      aria-pressed={open}
      onClick={onClick}
      className={`grid size-11 place-items-center rounded-full hover:bg-surface ${open ? 'text-accent' : ''}`}
    >
      <Volume2 className="size-5" />
    </button>
  );
}

/** "1,25×" */
export function formatRate(rate: number): string {
  return `${rate.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}×`;
}

const iconButton =
  'grid size-11 shrink-0 place-items-center rounded-full text-ink hover:bg-paper disabled:opacity-40 max-[400px]:size-10';
const selectClass =
  'min-h-11 min-w-0 rounded-full border border-line bg-paper px-3 text-sm text-ink max-[400px]:min-h-10';

/**
 * Sesli okuma çubuğu: altta ortada yüzer. Menü açıkken alt çubuğun (sayfa kaydırıcısı ve sayfa numarası) üstünde,
 * gizliyken ekranın altında durur (alt düğmeler açıksa onların üstünde). Geniş ekranda tek satırdır; dar ekranda
 * oynatma düğmeleri, hız seçenekleri ve ("Ses ve uyku zamanlayıcısı" düğmesiyle açılan) ses ile uyku zamanlayıcısı
 * alt alta durur.
 */
export function ReadAloudBar({
  ra,
  footerRef,
  ui,
  raised,
}: {
  ra: ReadAloudUi;
  /** menü açıkken çubuk bunun üstünde durur */
  footerRef: RefObject<HTMLElement | null>;
  ui: boolean;
  /** menü gizliyken altta sayfa düğmeleri var */
  raised: boolean;
}) {
  const footer = useHeight(footerRef, ui);
  const [more, setMore] = useState(false);
  const state = ra.state;
  const playing = state?.status === 'playing';
  const rate = state?.rate ?? 1;
  const [sleepLeft, tick] = useMinutesLeft(state?.sleepAt ?? null);

  const bottom = ui
    ? `${footer + 8}px`
    : `calc(${raised ? 56 : 8}px + env(safe-area-inset-bottom, 0px))`;

  return (
    <div
      role="region"
      aria-label="Sesli okuma"
      data-testid="read-aloud-bar"
      className="pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center gap-2 px-2 transition-[bottom] duration-200"
      style={{ bottom }}
    >
      {state?.error && (
        <p
          role="status"
          className="pointer-events-auto rounded-full bg-surface/95 px-3 py-1 text-xs text-muted shadow-sm backdrop-blur"
        >
          {state.error === 'not-allowed'
            ? 'Okumak için oynat düğmesine dokunun.'
            : 'Ses çalınamadı. Başka bir ses seçip yeniden deneyin.'}
        </p>
      )}
      {/* Dar ekranda satırlar: oynatma ve kapatma, hız, (açılınca) ses ve uyku; genişte hepsi tek satır */}
      <div className="pointer-events-auto flex w-full max-w-sm flex-wrap items-center gap-x-0.5 gap-y-1 rounded-3xl border border-line bg-surface/95 p-1 shadow-lg backdrop-blur lg:w-auto lg:max-w-full lg:flex-nowrap lg:rounded-full">
        <div className="order-1 flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Önceki cümle"
            onClick={ra.prev}
            disabled={!state || state.current <= 0}
            className={iconButton}
          >
            <SkipBack className="size-5" />
          </button>
          <button
            type="button"
            data-testid="read-aloud-play"
            aria-label={playing ? 'Duraklat' : 'Oynat'}
            onClick={ra.toggle}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-paper hover:opacity-90 max-[400px]:size-10"
          >
            {playing ? <Pause className="size-5" /> : <Play className="size-5 translate-x-px" />}
          </button>
          <button type="button" aria-label="Sonraki cümle" onClick={ra.next} className={iconButton}>
            <SkipForward className="size-5" />
          </button>
        </div>

        <div
          role="group"
          aria-label="Okuma hızı"
          data-testid="read-aloud-rates"
          className="order-3 flex w-full justify-center gap-1 lg:order-2 lg:w-auto lg:border-l lg:border-line lg:pl-1.5"
        >
          {RATE_CHOICES.map((r) => {
            const on = Math.abs(r - rate) < 1e-6;
            return (
              <button
                key={r}
                type="button"
                data-rate={r}
                aria-pressed={on}
                aria-label={`Hız ${formatRate(r)}`}
                onClick={() => ra.setRate(r)}
                className={`min-h-11 min-w-12 shrink-0 rounded-full border px-2 text-sm tabular-nums max-[400px]:min-h-10 max-[400px]:min-w-11 ${
                  on
                    ? 'border-accent font-semibold text-accent'
                    : 'border-transparent text-ink hover:bg-paper'
                }`}
              >
                {formatRate(r)}
              </button>
            );
          })}
        </div>

        <div
          data-testid="read-aloud-more"
          className={`order-4 w-full items-center justify-center gap-2 lg:order-3 lg:flex lg:w-auto lg:border-l lg:border-line lg:pl-1.5 ${
            more ? 'flex' : 'hidden'
          }`}
        >
          <select
            aria-label="Ses"
            data-testid="read-aloud-voice"
            value={state?.voice ?? ''}
            disabled={ra.voices.length === 0}
            onChange={(e) => ra.setVoice(e.target.value)}
            className={`${selectClass} max-w-44 truncate`}
          >
            {ra.voices.length === 0 && <option value="">Cihazın sesi</option>}
            {ra.voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <label className="flex min-w-0 items-center gap-1 text-muted">
            <Moon className="size-4 shrink-0" aria-hidden="true" />
            <select
              aria-label="Uyku zamanlayıcısı"
              data-testid="read-aloud-sleep"
              value={sleepLeft !== null ? 'left' : 'off'}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'left') return;
                ra.setSleep(v === 'off' ? null : Number(v));
                tick();
              }}
              className={selectClass}
            >
              {sleepLeft !== null && <option value="left">{sleepLeft} dk kaldı</option>}
              <option value="off">{sleepLeft !== null ? 'Kapat' : 'Kapalı'}</option>
              {SLEEP_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m} dk
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="order-2 ml-auto flex items-center gap-0.5 lg:order-4 lg:ml-0">
          <button
            type="button"
            data-testid="read-aloud-options"
            aria-label="Ses ve uyku zamanlayıcısı"
            aria-expanded={more}
            onClick={() => setMore((v) => !v)}
            className={`${iconButton} lg:hidden ${more ? 'text-accent' : ''}`}
          >
            <SlidersHorizontal className="size-5" />
          </button>
          <button
            type="button"
            data-testid="read-aloud-close"
            aria-label="Sesli okumayı kapat"
            onClick={ra.close}
            className={`${iconButton} text-muted`}
          >
            <X className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Uyku zamanlayıcısının kalan dakikası (kapalıysa null). Saat on beş saniyede bir ilerler; zamanlayıcı
 * kurulurken `tick` ile hemen güncellenir.
 */
function useMinutesLeft(sleepAt: number | null): [number | null, () => void] {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (sleepAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [sleepAt]);
  const left = sleepAt === null ? null : Math.max(1, Math.ceil((sleepAt - now) / 60_000));
  return [left, () => setNow(Date.now())];
}

/** Öğenin yüksekliği (`active` iken izlenir) */
function useHeight(ref: RefObject<HTMLElement | null>, active: boolean): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, active]);
  return height;
}
