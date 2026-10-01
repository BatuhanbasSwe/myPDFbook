import {
  LoaderCircle,
  Moon,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useEffect, useState, type RefObject } from 'react';
import { realClock } from './clock';
import { IconButton } from '../../ui/IconButton';
import { chipClass, PlayerBar } from './PlayerBar';
import { RATE_CHOICES } from './readAloud';
import type { ReadAloudUi } from './useReadAloud';
import { NeuralSuggestion, VoiceButton, VoiceMenu } from './VoiceMenu';

/** Uyku zamanlayıcısı seçenekleri (dakika) */
const SLEEP_OPTIONS = [15, 30, 60] as const;

/** "1,25×" */
export function formatRate(rate: number): string {
  return `${rate.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}×`;
}

const selectClass =
  'ui-focus min-h-11 min-w-0 rounded-full bg-fill px-3 text-[15px] text-ink hover:bg-fill-strong';

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
            className="material pointer-events-auto rounded-full px-3 py-1 text-xs text-secondary"
          >
            {state.error === 'not-allowed'
              ? 'Okumak için oynat düğmesine dokunun.'
              : 'Ses çalınamadı. Başka bir ses seçip yeniden deneyin.'}
          </p>
        )
      }
      // Dar ekranda satırlar: oynatma ve kapatma, hız, (açılınca) ses ve uyku; genişte hepsi tek satır
      className="flex w-full max-w-sm flex-wrap items-center gap-x-0.5 gap-y-1 rounded-sheet md:w-auto md:max-w-full md:flex-nowrap md:rounded-full"
    >
      <div className="order-1 flex items-center gap-0.5">
        <IconButton
          label="Önceki cümle"
          shortcut="←"
          tipSide="above"
          Icon={SkipBack}
          onClick={ra.prev}
          disabled={!state || state.current <= 0}
        />
        <IconButton
          testId="read-aloud-play"
          label={playing ? 'Duraklat' : 'Oynat'}
          shortcut="Boşluk"
          tipSide="above"
          variant="filled"
          aria-busy={playing && ra.preparing}
          onClick={ra.toggle}
        >
          {playing && ra.preparing ? (
            <LoaderCircle className="size-5 animate-spin" data-testid="read-aloud-preparing" />
          ) : playing ? (
            <Pause className="size-5" fill="currentColor" strokeWidth={1.5} />
          ) : (
            <Play className="size-5 translate-x-px" fill="currentColor" strokeWidth={1.5} />
          )}
        </IconButton>
        <IconButton
          label="Sonraki cümle"
          shortcut="→"
          tipSide="above"
          Icon={SkipForward}
          onClick={ra.next}
        />
      </div>

      <div
        role="group"
        aria-label="Okuma hızı"
        data-testid="read-aloud-rates"
        className="order-3 flex w-full justify-center gap-1 md:order-2 md:w-auto md:border-l md:border-hairline md:pl-1.5"
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
        className={`order-4 w-full items-center justify-center gap-2 md:order-3 md:flex md:w-auto md:border-l md:border-hairline md:pl-1.5 ${
          more ? 'flex' : 'hidden'
        }`}
      >
        <VoiceButton ra={ra} className={selectClass} />
        <label className="flex min-w-0 items-center gap-1 text-secondary">
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
        <IconButton
          testId="read-aloud-options"
          label="Ses ve uyku zamanlayıcısı"
          tipSide="above"
          Icon={SlidersHorizontal}
          aria-expanded={more}
          active={more}
          onClick={() => setMore((v) => !v)}
          className="md:hidden"
        />
        <IconButton
          testId="read-aloud-close"
          label="Sesli okumayı kapat"
          shortcut="Esc"
          tipSide="above"
          variant="muted"
          Icon={X}
          onClick={ra.close}
        />
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
