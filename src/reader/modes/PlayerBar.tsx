import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { iconButtonClass } from '../../ui/IconButton';

/** Okuma modu çubuklarındaki yuvarlak düğme (ipucu olmayan yerlerde; ipuçlu olanı IconButton) */
export const iconButton = iconButtonClass();

/** Çubuktaki seçenek düğmesi (hız, süre): seçiliyse vurgu renginde yumuşak zemin */
export function chipClass(on: boolean): string {
  return `ui-press min-h-11 min-w-12 shrink-0 rounded-full px-2.5 text-[15px] tabular-nums ${
    on ? 'bg-tint font-semibold text-accent' : 'text-ink hover:bg-fill'
  }`;
}

/**
 * Okuma modu çubuğunun kabı (sesli okuma, hızlı okuma): altta ortada yüzer. Menü açıkken alt çubuğun (sayfa
 * kaydırıcısı ve sayfa numarası) üstünde, gizliyken ekranın altında durur (alt düğmeler açıksa onların üstünde).
 * Yüksekliğini bildirir: okuyucu kitabın altında o kadar yer ayırır.
 */
export function PlayerBar({
  label,
  testId,
  footerRef,
  ui,
  raised,
  onHeight,
  message,
  className,
  children,
}: {
  label: string;
  testId: string;
  /** menü açıkken çubuk bunun üstünde durur */
  footerRef: RefObject<HTMLElement | null>;
  ui: boolean;
  /** menü gizliyken altta sayfa düğmeleri var */
  raised: boolean;
  /** çubuğun yüksekliği */
  onHeight?(height: number): void;
  /** çubuğun üstündeki kısa bildirim */
  message?: ReactNode;
  /** çubuğun yerleşimi (satırlar) */
  className: string;
  children: ReactNode;
}) {
  const footer = useHeight(footerRef, ui);
  const barRef = useRef<HTMLDivElement>(null);
  const height = useHeight(barRef, true);
  useEffect(() => {
    onHeight?.(height);
  }, [height, onHeight]);

  const bottom = ui
    ? `${footer + 8}px`
    : `calc(${raised ? 56 : 8}px + env(safe-area-inset-bottom, 0px))`;

  return (
    <div
      ref={barRef}
      role="region"
      aria-label={label}
      data-testid={testId}
      className="pointer-events-none absolute inset-x-0 z-(--ui-z-bar) flex flex-col items-center gap-2 px-2 transition-[bottom] duration-200 ease-ios"
      style={{ bottom }}
    >
      {message}
      {/* Saydam 1 px kenar: çubuğun yüksekliği eskisiyle aynı (kitabın altında ayrılan yer değişmez) */}
      <div
        className={`material pointer-events-auto border border-transparent p-1 text-ink ${className}`}
      >
        {children}
      </div>
    </div>
  );
}

/** Öğenin yüksekliği (`active` iken izlenir) */
export function useHeight(ref: RefObject<HTMLElement | null>, active: boolean): number {
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
