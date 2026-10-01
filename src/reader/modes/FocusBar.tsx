import { ChevronDown, ChevronUp, Pin, X } from 'lucide-react';
import { useEffect, useState, type RefObject } from 'react';
import { FOCUS_WORDS, type FocusDim, type FocusUnit } from './focusPrefs';
import { IconButton } from '../../ui/IconButton';
import { chipClass, PlayerBar } from './PlayerBar';
import type { FocusModeUi } from './useFocusMode';

const DIMS: { dim: FocusDim; label: string; name: string }[] = [
  { dim: 'light', label: 'Hafif', name: 'Hafif karartma (%40)' },
  { dim: 'medium', label: 'Orta', name: 'Orta karartma (%70)' },
  { dim: 'strong', label: 'Güçlü', name: 'Güçlü karartma (%90)' },
  { dim: 'blur', label: 'Bulanık', name: 'Bulanık: odak dışındaki yazı bulanıklaşır' },
];

const UNITS: { unit: FocusUnit; label: string; name: string }[] = [
  { unit: 'word', label: 'Kelime', name: 'Kalemin çevresindeki kelimeler açık' },
  { unit: 'sentence', label: 'Cümle', name: 'Kalemin altındaki cümle açık' },
];

/** Açılınca bir süre gösterilen ipucu (ms) */
const HINT_MS = 6000;

/** Dar ekranda satır sonu (geniş ekranda çubuk tek satır) */
const ROW_BREAK = 'h-0 basis-full lg:hidden';
/** Geniş ekranda öbekler arasındaki çizgi */
const DIVIDER = 'lg:border-l lg:border-hairline lg:pl-1.5';

/**
 * Kalemle odak çubuğu: okuma modu çubuklarının yerinde ve görünüşünde (PlayerBar). Açık kalan yer (kalemin
 * çevresindeki kelimeler ya da cümle), kelime penceresinin boyu (kalemin iki yanında 3, 5, 8, 12 kelime), geri/ileri
 * (↑/↓: cümle ya da pencere boyu kadar kelime), karartma düzeyi (bulanık yalnızca metin görünümünde), "Kalem kalkınca
 * açık kalsın", kapat. Geniş ekranda tek satır, dar ekranda üç satır. Açılınca kısa bir ipucu kalemin ve parmağın ne
 * yaptığını söyler.
 */
export function FocusBar({
  fm,
  textView,
  footerRef,
  ui,
  raised,
  onHeight,
}: {
  fm: FocusModeUi;
  textView: boolean;
  /** menü açıkken çubuk bunun üstünde durur */
  footerRef: RefObject<HTMLElement | null>;
  ui: boolean;
  /** menü gizliyken altta sayfa düğmeleri var */
  raised: boolean;
  /** çubuğun yüksekliği (okuyucu kitabın altında o kadar yer ayırır) */
  onHeight?(height: number): void;
}) {
  const [hint, setHint] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setHint(false), HINT_MS);
    return () => clearTimeout(timer);
  }, []);

  const { dim, keep, unit, words } = fm.prefs;
  const byWord = unit === 'word';
  const dims = DIMS.filter((d) => d.dim !== 'blur' || (textView && fm.canBlur));
  // Sayfa görünümünde bulanık yok: orta karartma seçili görünür
  const shownDim = dims.some((d) => d.dim === dim) ? dim : 'medium';
  const keepName = byWord
    ? 'Kalem kalkınca son kelimeler açık kalsın'
    : 'Kalem kalkınca son cümle açık kalsın';

  return (
    <PlayerBar
      label="Kalemle odak"
      testId="focus-bar"
      footerRef={footerRef}
      ui={ui}
      raised={raised}
      onHeight={onHeight}
      message={
        hint ? (
          <p
            role="status"
            data-testid="focus-hint"
            className="material max-w-md rounded-full px-3 py-1 text-center text-xs text-secondary"
          >
            {byWord
              ? 'Kalemi ya da fareyi yazıda gezdirin; parmakla basılı tutup sürükleyin.'
              : 'Kalemi ya da fareyi cümlenin üstünde tutun; parmakla basılı tutup sürükleyin.'}
          </p>
        ) : undefined
      }
      className="flex w-full max-w-md flex-wrap items-center justify-center gap-x-0.5 gap-y-1 rounded-sheet lg:w-auto lg:max-w-full lg:flex-nowrap lg:rounded-full"
    >
      <div className="order-1 flex items-center gap-0.5 lg:order-none">
        <IconButton
          label={byWord ? `${words} kelime geri` : 'Önceki cümle'}
          shortcut="↑"
          tipSide="above"
          Icon={ChevronUp}
          onClick={fm.prev}
        />
        <IconButton
          label={byWord ? `${words} kelime ileri` : 'Sonraki cümle'}
          shortcut="↓"
          tipSide="above"
          Icon={ChevronDown}
          onClick={fm.next}
        />
      </div>

      <div
        role="group"
        aria-label="Açık kalan yer"
        data-testid="focus-units"
        className={`order-2 flex gap-0.5 lg:order-none ${DIVIDER}`}
      >
        {UNITS.map((u) => (
          <button
            key={u.unit}
            type="button"
            data-testid={`focus-unit-${u.unit}`}
            aria-pressed={unit === u.unit}
            aria-label={u.name}
            onClick={() => fm.setPrefs({ unit: u.unit })}
            className={`${chipClass(unit === u.unit)} px-3`}
          >
            {u.label}
          </button>
        ))}
      </div>

      <div className={`order-4 ${ROW_BREAK}`} aria-hidden="true" />

      {byWord && (
        <div
          role="group"
          aria-label="Kalemin iki yanında açık kalan kelime"
          data-testid="focus-sizes"
          className={`order-5 flex gap-0.5 lg:order-none ${DIVIDER}`}
        >
          {FOCUS_WORDS.map((n) => (
            <button
              key={n}
              type="button"
              data-testid={`focus-words-${n}`}
              aria-pressed={words === n}
              aria-label={`Kalemin iki yanında ${n} kelime`}
              onClick={() => fm.setPrefs({ words: n })}
              className={chipClass(words === n)}
            >
              ±{n}
            </button>
          ))}
        </div>
      )}

      <div
        role="group"
        aria-label="Karartma"
        data-testid="focus-dims"
        className={`order-8 flex justify-center gap-0.5 lg:order-none ${DIVIDER}`}
      >
        {dims.map((d) => (
          <button
            key={d.dim}
            type="button"
            data-testid={`focus-dim-${d.dim}`}
            aria-pressed={shownDim === d.dim}
            aria-label={d.name}
            onClick={() => fm.setPrefs({ dim: d.dim })}
            className={`${chipClass(shownDim === d.dim)} px-3`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        data-testid="focus-keep"
        aria-pressed={keep}
        aria-label={keepName}
        title={keepName}
        onClick={() => fm.setPrefs({ keep: !keep })}
        className={`ui-press order-6 flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-[15px] lg:order-none ${DIVIDER} ${
          keep ? 'bg-tint font-semibold text-accent' : 'text-ink hover:bg-fill'
        }`}
      >
        <Pin className="size-4" aria-hidden="true" /> Açık kalsın
      </button>

      <div className={`order-7 ${ROW_BREAK}`} aria-hidden="true" />

      <IconButton
        testId="focus-close"
        label="Odağı kapat"
        shortcut="Esc"
        tipSide="above"
        variant="muted"
        Icon={X}
        onClick={fm.close}
        className="order-3 lg:order-none"
      />
    </PlayerBar>
  );
}
