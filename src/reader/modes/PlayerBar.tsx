import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

/** Okuma modu çubuklarındaki yuvarlak düğme */
export const iconButton =
  'grid size-11 shrink-0 place-items-center rounded-full text-ink hover:bg-paper disabled:opacity-40';

/** Çubuktaki seçenek düğmesi (hız, süre): seçiliyse vurgu renginde çerçeveli */
export function chipClass(on: boolean): string {
  return `min-h-11 min-w-12 shrink-0 rounded-full border px-2 text-sm tabular-nums ${
    on ? 'border-accent font-semibold text-accent' : 'border-transparent text-ink hover:bg-paper'
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
      className="pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center gap-2 px-2 transition-[bottom] duration-200"
      style={{ bottom }}
    >
      {message}
      <div
        className={`pointer-events-auto border border-line bg-surface/95 p-1 shadow-lg backdrop-blur ${className}`}
      >
        {children}
      </div>
    </div>
  );
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
