import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { useWide } from './useMediaQuery';

/** Açılır pencerenin ekran kenarından en az uzaklığı (px) */
const EDGE = 12;
/** Açılır pencerenin düğmesinden uzaklığı (px) */
const GAP = 8;

/**
 * Panel kabı: telefonda alttan açılan sayfa (iOS sheet: üstte tutamak, yuvarlak üst köşeler), iPad ve bilgisayarda
 * düğmesinin altında açılır pencere (popover). `phone="top"`: telefonda da üstten açılır (arama: klavye kutuyu
 * örtmesin). Buzlu cam malzemesi; içerik kendi kaydırmasını yapar.
 */
export function Sheet({
  id,
  label,
  testId,
  anchorRef,
  phone = 'bottom',
  onDismiss,
  ref,
  children,
}: {
  id?: string;
  /** erişilebilir ad */
  label?: string;
  testId?: string;
  /** açılır pencerenin bağlı olduğu düğme (geniş ekranda altında ortalanır) */
  anchorRef?: RefObject<HTMLElement | null>;
  phone?: 'bottom' | 'top';
  /**
   * Dışarı dokunulunca ya da Esc'e basılınca kapatır (panelin düğmesine dokunma hariç: düğme kendisi açıp kapatır).
   * Okuyucu kapatmayı kendisi yönetir (kitaba dokunma sayfa çevirmesin), vermez.
   */
  onDismiss?(): void;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const wide = useWide();
  const box = useRef<HTMLDivElement>(null);

  // Geniş ekranda düğmesinin altına ortalanır, ekranın dışına taşmaz; ekran boyutu değişince yeniden yerleşir
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (!wide) {
      el.style.left = '';
      el.style.top = '';
      return;
    }
    const place = () => {
      const a = anchorRef?.current?.getBoundingClientRect();
      const width = el.offsetWidth;
      const vw = document.documentElement.clientWidth;
      const center = a && a.width > 0 ? a.left + a.width / 2 : vw - EDGE - width / 2;
      const left = Math.min(Math.max(EDGE, center - width / 2), vw - EDGE - width);
      el.style.left = `${Math.max(EDGE, left)}px`;
      if (a && a.height > 0) el.style.top = `${a.bottom + GAP}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [wide, anchorRef]);

  useImperativeHandle(ref, () => box.current as HTMLDivElement, []);

  useEffect(() => {
    if (!onDismiss) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target instanceof Node ? e.target : null;
      if (!t || box.current?.contains(t) || anchorRef?.current?.contains(t)) return;
      onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onDismiss();
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onDismiss, anchorRef]);

  const shape = wide
    ? 'ui-pop fixed top-[calc(3.75rem+env(safe-area-inset-top))] w-[min(24rem,calc(100vw-1.5rem))] rounded-panel'
    : phone === 'top'
      ? 'ui-pop fixed inset-x-2 top-[calc(3.75rem+env(safe-area-inset-top))] rounded-panel'
      : 'ui-sheet-up fixed inset-x-0 bottom-0 rounded-t-sheet pb-[env(safe-area-inset-bottom)]';

  return (
    <div
      ref={box}
      id={id}
      role="dialog"
      aria-label={label}
      data-testid={testId}
      data-sheet={wide ? 'popover' : phone === 'top' ? 'top' : 'bottom'}
      className={`material z-(--ui-z-panel) overflow-hidden text-ink ${shape}`}
    >
      {!wide && phone === 'bottom' && (
        <div aria-hidden="true" className="flex justify-center pt-2 pb-1">
          <span className="h-[5px] w-9 rounded-full bg-fill-strong" />
        </div>
      )}
      {children}
    </div>
  );
}
