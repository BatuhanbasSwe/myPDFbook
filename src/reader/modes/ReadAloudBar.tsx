import {
  LoaderCircle,
  Moon,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Volume2,
  X,
} from 'lucide-react';
import { useEffect, useState, type Ref, type RefObject } from 'react';
import { realClock } from './clock';
import { chipClass, iconButton, PlayerBar } from './PlayerBar';
import { RATE_CHOICES } from './readAloud';
import type { ReadAloudUi } from './useReadAloud';
import { NeuralSuggestion, VoiceButton, VoiceMenu } from './VoiceMenu';

/** Uyku zamanlayıcısı seçenekleri (dakika) */
const SLEEP_OPTIONS = [15, 30, 60] as const;

/** Başlıktaki "Sesli oku" düğmesi: okumayı açar ve başlatır (dokunuşun içinde: iOS), açıkken kapatır */
export function ReadAloudButton({
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

const selectClass =
  'min-h-11 min-w-0 rounded-full border border-line bg-paper px-3 text-sm text-ink';

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
  onHeight,
}: {
  ra: ReadAloudUi;
  /** menü açıkken çubuk bunun üstünde durur */
  footerRef: RefObject<HTMLElement | null>;
  ui: boolean;
  /** menü gizliyken altta sayfa düğmeleri var */
  raised: boolean;
  /** çubuğun yüksekliği (okuyucu kitabın altında o kadar yer ayırır) */
  onHeight?(height: number): void;
}) {
  const [more, setMore] = useState(false);
  const state = ra.state;
  const playing = state?.status === 'playing';
  const rate = state?.rate ?? 1;
  const [sleepLeft, tick] = useMinutesLeft(state?.sleepAt ?? null);

  return (
    <PlayerBar
      label="Sesli okuma"
      testId="read-aloud-bar"
      footerRef={footerRef}
      ui={ui}
      raised={raised}
      onHeight={onHeight}
      message={
        state?.error && (
          <p
            role="status"
            className="pointer-events-auto rounded-full bg-surface/95 px-3 py-1 text-xs text-muted shadow-sm backdrop-blur"
          >
            {state.error === 'not-allowed'
              ? 'Okumak için oynat düğmesine dokunun.'
              : 'Ses çalınamadı. Başka bir ses seçip yeniden deneyin.'}
          </p>
        )
      }
      // Dar ekranda satırlar: oynatma ve kapatma, hız, (açılınca) ses ve uyku; genişte hepsi tek satır
      className="flex w-full max-w-sm flex-wrap items-center gap-x-0.5 gap-y-1 rounded-3xl md:w-auto md:max-w-full md:flex-nowrap md:rounded-full"
    >
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
          aria-busy={playing && ra.preparing}
          title={playing && ra.preparing ? 'Ses hazırlanıyor' : undefined}
          onClick={ra.toggle}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-paper hover:opacity-90"
        >
          {playing && ra.preparing ? (
            <LoaderCircle className="size-5 animate-spin" data-testid="read-aloud-preparing" />
          ) : playing ? (
            <Pause className="size-5" />
          ) : (
            <Play className="size-5 translate-x-px" />
          )}
        </button>
        <button type="button" aria-label="Sonraki cümle" onClick={ra.next} className={iconButton}>
          <SkipForward className="size-5" />
        </button>
      </div>

      <div
        role="group"
        aria-label="Okuma hızı"
        data-testid="read-aloud-rates"
        className="order-3 flex w-full justify-center gap-1 md:order-2 md:w-auto md:border-l md:border-line md:pl-1.5"
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
              className={chipClass(on)}
            >
              {formatRate(r)}
            </button>
          );
        })}
      </div>

      <div
        data-testid="read-aloud-more"
        className={`order-4 w-full items-center justify-center gap-2 md:order-3 md:flex md:w-auto md:border-l md:border-line md:pl-1.5 ${
          more ? 'flex' : 'hidden'
        }`}
      >
        <VoiceButton ra={ra} className={selectClass} />
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

      {ra.voiceMenu && <VoiceMenu ra={ra} lang={ra.lang} />}
      {ra.suggest && <NeuralSuggestion ra={ra} />}

      <div className="order-2 ml-auto flex items-center gap-0.5 md:order-4 md:ml-0">
        <button
          type="button"
          data-testid="read-aloud-options"
          aria-label="Ses ve uyku zamanlayıcısı"
          aria-expanded={more}
          onClick={() => setMore((v) => !v)}
          className={`${iconButton} md:hidden ${more ? 'text-accent' : ''}`}
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
    </PlayerBar>
  );
}

/**
 * Uyku zamanlayıcısının kalan dakikası (kapalıysa null; denetleyicinin saatiyle). Saat on beş saniyede bir
 * ilerler; zamanlayıcı kurulurken `tick` ile hemen güncellenir.
 */
function useMinutesLeft(sleepAt: number | null): [number | null, () => void] {
  const [now, setNow] = useState(() => realClock.now());
  useEffect(() => {
    if (sleepAt === null) return;
    const timer = setInterval(() => setNow(realClock.now()), 15_000);
    return () => clearInterval(timer);
  }, [sleepAt]);
  const left = sleepAt === null ? null : Math.max(1, Math.ceil((sleepAt - now) / 60_000));
  return [left, () => setNow(realClock.now())];
}
