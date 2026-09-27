import { Focus, Gauge, Pause, Play, SkipBack, SkipForward, TrendingUp, X } from 'lucide-react';
import { useLayoutEffect, useRef, type Ref, type RefObject } from 'react';
import { chipClass, iconButton, PlayerBar } from './PlayerBar';
import { RSVP_WPM_CHOICES } from './rsvp';
import { SECONDS_CHOICES, WPM_CHOICES, type SpeedMode, type SpeedState } from './speedReader';
import type { SpeedReaderUi } from './useSpeedReader';

/** Başlıktaki "Hızlı oku" düğmesi: hızlı okumayı açar ve başlatır, açıkken kapatır */
export function SpeedReaderButton({
  open,
  onClick,
  ref,
}: {
  open: boolean;
  onClick(): void;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      data-testid="speed-read"
      aria-label="Hızlı oku"
      aria-pressed={open}
      onClick={onClick}
      className={`grid size-11 place-items-center rounded-full hover:bg-surface ${open ? 'text-accent' : ''}`}
    >
      <Gauge className="size-5" />
    </button>
  );
}

const MODES: { mode: SpeedMode; label: string }[] = [
  { mode: 'fixed', label: 'Süre' },
  { mode: 'wpm', label: 'Kelime/dk' },
  { mode: 'rsvp', label: 'RSVP' },
];

/** Kipin seçenekleri, seçili değeri ve seçeneğin adı */
function choicesOf(state: SpeedState | null) {
  const mode = state?.mode ?? 'fixed';
  if (mode === 'fixed')
    return {
      label: 'Cümle başına süre (saniye)',
      choices: SECONDS_CHOICES as readonly number[],
      value: state?.seconds ?? 5,
      name: (c: number) => `${c} saniye`,
    };
  return {
    label: 'Dakikada kelime',
    choices: (mode === 'wpm' ? WPM_CHOICES : RSVP_WPM_CHOICES) as readonly number[],
    value: (mode === 'wpm' ? state?.wpm : state?.rsvpWpm) ?? 250,
    name: (c: number) => `Dakikada ${c} kelime`,
  };
}

/**
 * Hızlı okuma çubuğu: sesli okuma çubuğuyla aynı yerde ve görünüşte (PlayerBar). Geniş ekranda tek satır; dar
 * ekranda oynatma düğmeleri (odak ya da RSVP'de "yavaş başla", kapatma), kip ve süre seçenekleri alt alta durur
 * (seçenekler sığmazsa yana kayar). Altındaki ince çizgi etkin cümlede geçen süreyi (RSVP'de okunan kelimeleri)
 * gösterir.
 */
export function SpeedReaderBar({
  sr,
  footerRef,
  ui,
  raised,
  onHeight,
}: {
  sr: SpeedReaderUi;
  /** menü açıkken çubuk bunun üstünde durur */
  footerRef: RefObject<HTMLElement | null>;
  ui: boolean;
  /** menü gizliyken altta sayfa düğmeleri var */
  raised: boolean;
  /** çubuğun yüksekliği (okuyucu kitabın altında o kadar yer ayırır) */
  onHeight?(height: number): void;
}) {
  const state = sr.state;
  const playing = state?.status === 'playing';
  const mode = state?.mode ?? 'fixed';
  const { label, choices, value, name } = choicesOf(state);
  const setValue = (c: number) =>
    mode === 'fixed' ? sr.setSeconds(c) : mode === 'wpm' ? sr.setWpm(c) : sr.setRsvpWpm(c);

  // Seçili süre görünsün (dar ekranda seçenekler yana kayar)
  const chipsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const group = chipsRef.current;
    const chip = group?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!group || !chip || group.scrollWidth <= group.clientWidth) return;
    group.scrollLeft = chip.offsetLeft - (group.clientWidth - chip.offsetWidth) / 2;
  }, [mode, value]);

  return (
    <PlayerBar
      label="Hızlı okuma"
      testId="speed-bar"
      footerRef={footerRef}
      ui={ui}
      raised={raised}
      onHeight={onHeight}
      className="relative flex w-full max-w-md flex-wrap items-center gap-x-0.5 gap-y-1 rounded-3xl pb-1.5 lg:w-auto lg:max-w-full lg:flex-nowrap lg:rounded-full"
    >
      <div className="order-1 flex items-center gap-0.5">
        <button
          type="button"
          aria-label="Önceki cümle"
          onClick={sr.prev}
          disabled={!state || state.current <= 0}
          className={iconButton}
        >
          <SkipBack className="size-5" />
        </button>
        <button
          type="button"
          data-testid="speed-play"
          aria-label={playing ? 'Duraklat' : 'Oynat'}
          onClick={sr.toggle}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-paper hover:opacity-90"
        >
          {playing ? <Pause className="size-5" /> : <Play className="size-5 translate-x-px" />}
        </button>
        <button type="button" aria-label="Sonraki cümle" onClick={sr.next} className={iconButton}>
          <SkipForward className="size-5" />
        </button>
      </div>

      <div
        role="group"
        aria-label="Süre kipi"
        className="order-3 flex w-full justify-center lg:order-2 lg:w-auto lg:border-l lg:border-line lg:pl-1.5"
      >
        <div className="flex rounded-full bg-paper">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              data-testid={`speed-mode-${m.mode}`}
              aria-pressed={mode === m.mode}
              onClick={() => sr.setMode(m.mode)}
              className={`min-h-11 rounded-full border px-3 text-sm ${
                mode === m.mode
                  ? 'border-accent font-semibold text-accent'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={chipsRef}
        role="group"
        aria-label={label}
        data-testid="speed-choices"
        className="relative order-4 flex w-full justify-center-safe gap-0.5 overflow-x-auto px-2 lg:px-0 [scrollbar-width:none] lg:order-3 lg:w-auto lg:border-l lg:border-line lg:pl-1.5"
      >
        {choices.map((c) => {
          const on = c === value;
          return (
            <button
              key={c}
              type="button"
              data-value={c}
              aria-pressed={on}
              aria-label={name(c)}
              onClick={() => setValue(c)}
              className={chipClass(on)}
            >
              {c}
            </button>
          );
        })}
      </div>

      <div className="order-2 ml-auto flex items-center gap-0.5 lg:order-4 lg:ml-0 lg:border-l lg:border-line lg:pl-1.5">
        {mode === 'rsvp' ? (
          <button
            type="button"
            data-testid="speed-ramp"
            aria-pressed={state?.ramp ?? true}
            aria-label="Yavaş başla: oynatınca ilk kelimeler yavaştan hızlanır"
            onClick={() => sr.setRamp(!(state?.ramp ?? true))}
            className={toggleClass(state?.ramp ?? true)}
          >
            <TrendingUp className="size-4" aria-hidden="true" /> Yavaş başla
          </button>
        ) : (
          <button
            type="button"
            data-testid="speed-focus"
            aria-pressed={sr.focus}
            aria-label="Odak: etkin cümle dışındakiler kararır"
            onClick={() => sr.setFocus(!sr.focus)}
            className={toggleClass(sr.focus)}
          >
            <Focus className="size-4" aria-hidden="true" /> Odak
          </button>
        )}
        <button
          type="button"
          data-testid="speed-close"
          aria-label="Hızlı okumayı kapat"
          onClick={sr.close}
          className={`${iconButton} text-muted`}
        >
          <X className="size-5" />
        </button>
      </div>

      <SentenceProgress sr={sr} />
    </PlayerBar>
  );
}

function toggleClass(on: boolean): string {
  return `flex min-h-11 shrink-0 items-center gap-1 rounded-full px-3 text-sm hover:bg-paper ${
    on ? 'font-semibold text-accent' : 'text-ink'
  }`;
}

/**
 * Etkin cümlede geçen süre: çubuğun altında ince çizgi (RSVP'de cümlenin okunan kelimeleri). Oynarken çizgi kalan
 * sürede dolar (Web Animations); duraklayınca geçen sürede durur. Denetleyicinin anlık durumunu kendisi izler.
 */
function SentenceProgress({ sr }: { sr: SpeedReaderUi }) {
  const state = sr.useLive();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !state) return;
    const { duration, elapsed, since, status } = state;
    const passed = elapsed + (since !== null ? Math.max(0, Date.now() - since) : 0);
    const unit = duration > 0 ? Math.min(1, passed / duration) : 0;
    // RSVP: cümlenin kelimeleri içinde, gösterilen kelimenin payı
    const n = state.mode === 'rsvp' ? Math.max(1, state.words.length) : 1;
    const base = state.mode === 'rsvp' ? state.word / n : 0;
    const done = base + unit / n;
    el.style.transform = `scaleX(${done})`;
    if (status !== 'playing' || since === null || typeof el.animate !== 'function') return;
    const anim = el.animate(
      [{ transform: `scaleX(${done})` }, { transform: `scaleX(${base + 1 / n})` }],
      {
        duration: Math.max(0, duration - passed),
        easing: 'linear',
        fill: 'forwards',
      },
    );
    return () => anim.cancel();
  }, [state]);
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-6 bottom-0.5 h-0.5 overflow-hidden rounded-full bg-line"
    >
      <div
        ref={ref}
        data-testid="speed-progress"
        data-sentence={state?.current ?? -1}
        className="h-full origin-left bg-accent"
        style={{ transform: 'scaleX(0)' }}
      />
    </div>
  );
}
