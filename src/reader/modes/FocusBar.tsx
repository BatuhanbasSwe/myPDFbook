import { ChevronDown, ChevronUp, Pin, X } from 'lucide-react';
import { useEffect, useState, type RefObject } from 'react';
import type { FocusDim } from './focusPrefs';
import { chipClass, iconButton, PlayerBar } from './PlayerBar';
import type { FocusModeUi } from './useFocusMode';

const DIMS: { dim: FocusDim; label: string; name: string }[] = [
  { dim: 'light', label: 'Hafif', name: 'Hafif karartma (%40)' },
  { dim: 'medium', label: 'Orta', name: 'Orta karartma (%70)' },
  { dim: 'strong', label: 'Güçlü', name: 'Güçlü karartma (%90)' },
  { dim: 'blur', label: 'Bulanık', name: 'Bulanık: odak dışındaki yazı bulanıklaşır' },
];

/** Açılınca bir süre gösterilen ipucu (ms) */
const HINT_MS = 6000;

/**
 * Kalemle odak çubuğu: okuma modu çubuklarının yerinde ve görünüşünde (PlayerBar). Cümle geri/ileri (↑/↓),
 * karartma düzeyi (bulanık yalnızca metin görünümünde), "Kalem kalkınca son cümle açık kalsın", kapat. Açılınca
 * kısa bir ipucu kalemin ve parmağın ne yaptığını söyler.
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

  const { dim, keep } = fm.prefs;
  const dims = DIMS.filter((d) => d.dim !== 'blur' || (textView && fm.canBlur));
  // Sayfa görünümünde bulanık yok: orta karartma seçili görünür
  const shownDim = dims.some((d) => d.dim === dim) ? dim : 'medium';

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
            className="max-w-md rounded-full bg-surface/95 px-3 py-1 text-center text-xs text-muted shadow-sm backdrop-blur"
          >
            Kalemi ya da fareyi cümlenin üstünde tutun; parmakla basılı tutup sürükleyin.
          </p>
        ) : undefined
      }
      className="flex w-full max-w-md flex-wrap items-center justify-center gap-x-0.5 gap-y-1 rounded-3xl sm:w-auto sm:max-w-full sm:flex-nowrap sm:rounded-full"
    >
      <div className="flex items-center gap-0.5">
        <button type="button" aria-label="Önceki cümle" onClick={fm.prev} className={iconButton}>
          <ChevronUp className="size-5" />
        </button>
        <button type="button" aria-label="Sonraki cümle" onClick={fm.next} className={iconButton}>
          <ChevronDown className="size-5" />
        </button>
      </div>

      <div
        role="group"
        aria-label="Karartma"
        data-testid="focus-dims"
        className="order-3 flex w-full justify-center gap-0.5 sm:order-none sm:w-auto sm:border-l sm:border-line sm:pl-1.5"
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

      <div className="ml-auto flex items-center gap-0.5 sm:ml-0 sm:border-l sm:border-line sm:pl-1.5">
        <button
          type="button"
          data-testid="focus-keep"
          aria-pressed={keep}
          aria-label="Kalem kalkınca son cümle açık kalsın"
          title="Kalem kalkınca son cümle açık kalsın"
          onClick={() => fm.setPrefs({ keep: !keep })}
          className={`flex min-h-11 shrink-0 items-center gap-1 rounded-full px-3 text-sm hover:bg-paper ${
            keep ? 'font-semibold text-accent' : 'text-ink'
          }`}
        >
          <Pin className="size-4" aria-hidden="true" /> Açık kalsın
        </button>
        <button
          type="button"
          data-testid="focus-close"
          aria-label="Odağı kapat"
          onClick={fm.close}
          className={`${iconButton} text-muted`}
        >
          <X className="size-5" />
        </button>
      </div>
    </PlayerBar>
  );
}
