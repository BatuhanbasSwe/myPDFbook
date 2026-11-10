import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { isTopModal, pushModal } from './modalStack';

/** `<dialog>` kipli açılabiliyor mu (Safari 15.4+); değilse sabit bir katman kullanılır */
const modalDialogs =
  typeof HTMLDialogElement === 'function' &&
  typeof HTMLDialogElement.prototype.showModal === 'function';

/** Odaklanabilen denetimler (eski tarayıcıdaki katmanda odak içeride döner) */
const FOCUSABLE =
  'input:not(:disabled), button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Kipli pencere: `<dialog>` üst katmanda açılır (açık başka bir pencerenin de üstünde), Esc vazgeçer. `<dialog>`
 * olmayan eski tarayıcıda sayfanın üstünde sabit bir katman: Esc belge düzeyinde dinlenir, Tab odağı içeride tutar.
 * Açılınca odak `initialFocus`'a geçer (yoksa tarayıcının seçtiğine). Pencerede basılan tuşlar sayfanın kısayollarına
 * (okuyucuda sayfa çevirme, menü) gitmez. `placement="bottom"`: eski tarayıcıdaki katmanda alta yaslanır (telefonda
 * alttan açılan pencere); `<dialog>`'un yeri `className`'dedir.
 */
export function Modal({
  labelledBy,
  onCancel,
  initialFocus,
  testId,
  className,
  placement = 'center',
  children,
}: {
  labelledBy: string;
  onCancel(): void;
  initialFocus?: RefObject<HTMLElement | null>;
  testId?: string;
  /** pencerenin kutusu (boyut, köşe, zemin, yer) */
  className: string;
  placement?: 'center' | 'bottom';
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Esc dinleyicisi her çizimde yeniden kurulmasın: güncel geri çağrı ref'te
  const cancel = useRef(onCancel);
  useEffect(() => {
    cancel.current = onCancel;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal?.();
    // showModal kendi seçtiği öğeye odaklanır: istenen öğeye geçilir (iOS'ta klavye açılsın)
    initialFocus?.current?.focus({ preventScroll: true });
    return () => dialog?.close?.();
  }, [initialFocus]);

  // Açık pencereler yığını: okuyucunun yakalama aşamasındaki tuş dinleyicileri pencere açıkken tuşları bırakır;
  // üst üste pencerede Esc'i yalnızca en üstteki işler
  const modalId = useRef<symbol | null>(null);
  useLayoutEffect(() => {
    const m = pushModal();
    modalId.current = m.id;
    return m.pop;
  }, []);
  const top = () => modalId.current !== null && isTopModal(modalId.current);

  // Odak pencerenin dışına düştüyse (odaktaki düğme kayboldu: odak sayfada) tuşlar yine pencerenin: sayfanın
  // kısayollarına gitmez, Esc pencereyi kapatır
  useEffect(() => {
    if (!modalDialogs) return;
    const onKey = (e: KeyboardEvent) => {
      const dialog = ref.current;
      if (!top() || !dialog?.open) return;
      if (e.target instanceof Node && dialog.contains(e.target)) return;
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
    if (modalDialogs) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (!top()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel.current();
        return;
      }
      const el = box.current;
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = el.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      before?.focus({ preventScroll: true });
    };
  }, []);

  if (!modalDialogs) {
    return (
      <div
        className={`fixed inset-0 z-(--ui-z-dialog) grid bg-black/40 ${
          placement === 'bottom' ? 'items-end' : 'place-items-center p-4'
        }`}
      >
        <div
          ref={box}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          data-testid={testId}
          onKeyDown={(e) => e.stopPropagation()}
          className={className}
        >
          {children}
        </div>
      </div>
    );
  }
  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      data-testid={testId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={`backdrop:bg-black/40 ${className}`}
    >
      {children}
    </dialog>
  );
}
