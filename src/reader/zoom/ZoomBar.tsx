import { Lock, Minus, Plus, RotateCcw } from 'lucide-react';
import type { RefObject } from 'react';
import { iconButton, useHeight } from '../modes/PlayerBar';
import { useZoomScale, type ZoomStore } from './useZoom';
import { MAX_ZOOM, MIN_ZOOM } from './zoomMath';

/**
 * Sayfa kilitliyken altta ortada yüzen küçük çubuk: kilidi açma, uzaklaştırma, yakınlaştırma oranı, yakınlaştırma
 * ve sıfırlama. Okuma modu çubukları gibi menü açıkken alt çubuğun, gizliyken ekranın altının (alt düğmeler varsa
 * onların) üstünde durur; okuma modu çubuğu açıksa onun da üstünde. Kilitliyken sayfa çevrilmek istenince üstünde
 * kısa bir "Sayfa kilitli" işareti belirir.
 */
export function ZoomBar({
  store,
  footerRef,
  ui,
  raised,
  lift,
  notice,
  onStep,
  onReset,
  onUnlock,
}: {
  store: ZoomStore;
  /** menü açıkken çubuk bunun üstünde durur */
  footerRef: RefObject<HTMLElement | null>;
  ui: boolean;
  /** menü gizliyken altta sayfa düğmeleri var */
  raised: boolean;
  /** altta açık okuma modu çubuğunun kapladığı yer (px) */
  lift: number;
  /** "Sayfa kilitli" işareti görünsün */
  notice: boolean;
  onStep(dir: 1 | -1): void;
  onReset(): void;
  onUnlock(): void;
}) {
  const scale = useZoomScale(store);
  const footer = useHeight(footerRef, ui);
  const bottom = ui
    ? `${footer + 8 + lift}px`
    : `calc(${(raised ? 56 : 8) + lift}px + env(safe-area-inset-bottom, 0px))`;
  const zoomed = scale > MIN_ZOOM + 1e-3;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center gap-2 px-2 transition-[bottom] duration-200"
      style={{ bottom }}
    >
      {notice && (
        <div
          data-testid="lock-notice"
          aria-hidden="true"
          className="flex items-center gap-1.5 rounded-full border border-line bg-surface/95 px-3 py-1 text-xs text-ink shadow-sm backdrop-blur"
        >
          <Lock className="size-3.5" /> Sayfa kilitli
        </div>
      )}
      <div
        role="toolbar"
        aria-label="Yakınlaştırma"
        data-testid="zoom-bar"
        className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-line bg-surface/95 p-1 shadow-lg backdrop-blur"
      >
        <button
          type="button"
          aria-label="Kilidi aç"
          title="Kilidi aç"
          data-testid="zoom-unlock"
          onClick={onUnlock}
          // Kilit vurgu renginde (başlıktaki basılı düğme gibi)
          className={iconButton.replace('text-ink', 'text-accent')}
        >
          <Lock className="size-5" />
        </button>
        <span aria-hidden="true" className="mx-0.5 h-6 w-px bg-line" />
        <button
          type="button"
          aria-label="Uzaklaştır"
          title="Uzaklaştır"
          data-testid="zoom-out"
          disabled={!zoomed}
          onClick={() => onStep(-1)}
          className={iconButton}
        >
          <Minus className="size-5" />
        </button>
        <span
          data-testid="zoom-level"
          className="min-w-12 text-center text-sm tabular-nums text-ink"
        >
          %{Math.round(scale * 100)}
        </span>
        <button
          type="button"
          aria-label="Yakınlaştır"
          title="Yakınlaştır"
          data-testid="zoom-in"
          disabled={scale >= MAX_ZOOM - 1e-3}
          onClick={() => onStep(1)}
          className={iconButton}
        >
          <Plus className="size-5" />
        </button>
        <button
          type="button"
          aria-label="Yakınlaştırmayı sıfırla"
          title="Yakınlaştırmayı sıfırla"
          data-testid="zoom-reset"
          disabled={!zoomed}
          onClick={onReset}
          className={iconButton}
        >
          <RotateCcw className="size-5" />
        </button>
      </div>
    </div>
  );
}
