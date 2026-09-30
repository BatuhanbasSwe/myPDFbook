import { Lock, Minus, Plus, RotateCcw } from 'lucide-react';
import type { RefObject } from 'react';
import { IconButton } from '../../ui/IconButton';
import { useHeight } from '../modes/PlayerBar';
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
      className="pointer-events-none absolute inset-x-0 z-(--ui-z-bar) flex flex-col items-center gap-2 px-2 transition-[bottom] duration-200 ease-ios"
      style={{ bottom }}
    >
      {notice && (
        <div
          data-testid="lock-notice"
          aria-hidden="true"
          className="material flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-ink"
        >
          <Lock className="size-3.5" /> Sayfa kilitli
        </div>
      )}
      <div
        role="toolbar"
        aria-label="Yakınlaştırma"
        data-testid="zoom-bar"
        className="material pointer-events-auto flex items-center gap-0.5 rounded-full p-1"
      >
        {/* Kilit vurgu renginde (başlıktaki basılı düğme gibi) */}
        <IconButton
          label="Kilidi aç"
          shortcut="L"
          tipSide="above"
          testId="zoom-unlock"
          Icon={Lock}
          active
          onClick={onUnlock}
        />
        <span aria-hidden="true" className="mx-0.5 h-6 w-px bg-hairline" />
        <IconButton
          label="Uzaklaştır"
          shortcut="−"
          tipSide="above"
          testId="zoom-out"
          Icon={Minus}
          disabled={!zoomed}
          onClick={() => onStep(-1)}
        />
        <span
          data-testid="zoom-level"
          className="min-w-12 text-center text-[15px] font-medium tabular-nums text-ink"
        >
          %{Math.round(scale * 100)}
        </span>
        <IconButton
          label="Yakınlaştır"
          shortcut="+"
          tipSide="above"
          testId="zoom-in"
          Icon={Plus}
          disabled={scale >= MAX_ZOOM - 1e-3}
          onClick={() => onStep(1)}
        />
        <IconButton
          label="Yakınlaştırmayı sıfırla"
          shortcut="0"
          tipSide="above"
          testId="zoom-reset"
          Icon={RotateCcw}
          disabled={!zoomed}
          onClick={onReset}
        />
      </div>
    </div>
  );
}
