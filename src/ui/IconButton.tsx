import type { LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { chain, useTooltip } from './Tooltip';
import type { TooltipSide } from './tooltipTiming';

export type IconButtonVariant = 'plain' | 'filled' | 'muted';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
> {
  /** erişilebilir ad; araç ipucunun yazısı da budur */
  label: string;
  Icon?: LucideIcon;
  /** simge yerine (ör. "Aa") */
  children?: ReactNode;
  /** klavye kısayolu (ipucunda "Ad · L") */
  shortcut?: string;
  /** ipucunun tercih edilen yanı */
  tipSide?: TooltipSide;
  /** ipucu olmasın (yazısı görünen düğme) */
  noTip?: boolean;
  /**
   * plain: yalnızca simge (basılıyken vurgu zemini); filled: vurgu renginde dolu (oynat); muted: soluk simge
   * (kapat)
   */
  variant?: IconButtonVariant;
  /** basılı ya da açık görünür (aria-pressed olmadan: menü düğmesi) */
  active?: boolean;
  testId?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** Yuvarlak 44 px simge düğmesinin görünüşü (ipucu olmayan yerlerde de kullanılır) */
export function iconButtonClass(variant: IconButtonVariant = 'plain', on = false): string {
  const base =
    'ui-press grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-35 disabled:pointer-events-none';
  if (variant === 'filled') return `${base} bg-accent text-paper hover:opacity-90`;
  if (on) return `${base} bg-tint text-accent`;
  return `${base} ${variant === 'muted' ? 'text-secondary' : 'text-ink'} hover:bg-fill active:bg-fill-strong`;
}

/**
 * Kabuğun simge düğmesi: 44 px dokunma hedefi, basınca hafif küçülme, görünür odak halkası ve araç ipucu (fareyle
 * üzerinde bekleyince, dokunarak basılı tutunca, klavye odağında). Basılı (aria-pressed) ya da açık düğme vurgu
 * zeminiyle görünür.
 */
export function IconButton({
  label,
  Icon,
  children,
  shortcut,
  tipSide,
  noTip,
  variant = 'plain',
  active,
  testId,
  className = '',
  ref,
  ...rest
}: IconButtonProps) {
  const { handlers, tip } = useTooltip({ label, shortcut, side: tipSide, disabled: noTip });
  const on = active ?? rest['aria-pressed'] === true;
  return (
    <>
      <button
        ref={ref}
        type="button"
        data-testid={testId}
        aria-label={label}
        aria-keyshortcuts={shortcut ? keyShortcut(shortcut) : undefined}
        {...rest}
        onPointerEnter={chain(handlers.onPointerEnter, rest.onPointerEnter)}
        onPointerLeave={chain(handlers.onPointerLeave, rest.onPointerLeave)}
        onPointerDown={chain(handlers.onPointerDown, rest.onPointerDown)}
        onPointerMove={chain(handlers.onPointerMove, rest.onPointerMove)}
        onPointerUp={chain(handlers.onPointerUp, rest.onPointerUp)}
        onPointerCancel={chain(handlers.onPointerCancel, rest.onPointerCancel)}
        onFocus={chain(handlers.onFocus, rest.onFocus)}
        onBlur={chain(handlers.onBlur, rest.onBlur)}
        onClickCapture={chain(handlers.onClickCapture, rest.onClickCapture)}
        onContextMenu={chain(handlers.onContextMenu, rest.onContextMenu)}
        className={`${iconButtonClass(variant, on)} ${className}`}
      >
        {Icon ? <Icon className="size-[22px]" strokeWidth={1.75} aria-hidden="true" /> : children}
      </button>
      {tip}
    </>
  );
}

/** "Boşluk" → "Space", "Esc" → "Escape" (aria-keyshortcuts tuş adları) */
function keyShortcut(s: string): string {
  const names: Record<string, string> = {
    Boşluk: 'Space',
    Esc: 'Escape',
    '←': 'ArrowLeft',
    '→': 'ArrowRight',
    '↑': 'ArrowUp',
    '↓': 'ArrowDown',
    '−': '-',
  };
  return names[s] ?? s;
}
