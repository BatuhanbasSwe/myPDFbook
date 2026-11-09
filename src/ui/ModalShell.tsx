import { useEffect, useRef, type ReactNode } from 'react';

/** `<dialog>` kipli açılabiliyor mu (Safari 15.4+); değilse sabit bir katman kullanılır (bkz. PasswordPrompt) */
export const modalDialogs =
  typeof HTMLDialogElement === 'function' &&
  typeof HTMLDialogElement.prototype.showModal === 'function';

/** Odaklanabilen denetimler (eski tarayıcıdaki katmanda odak içeride döner) */
const FOCUSABLE =
  'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Kipli pencere kabı (kitap günlüğü): `<dialog>` üst katmanda açılır, Esc kapatır. `<dialog>` olmayan eski
 * tarayıcıda (iPadOS 15.4 öncesi) sayfanın üstünde sabit bir katman: Esc belge düzeyinde dinlenir, Tab odağı içeride
 * tutar, kapanınca odak açan öğeye döner. Açılınca odak başlığa (`[data-autofocus]`) geçer.
 */
export function ModalShell({
  labelledBy,
  testId,
  className,
  onClose,
  children,
}: {
  labelledBy: string;
  testId: string;
  /** kutunun görünüşü (boyut, köşe, zemin) */
  className: string;
  onClose(): void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // Esc dinleyicisi her çizimde yeniden kurulmasın: güncel geri çağrı ref'te
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    const el = dialog ?? boxRef.current;
    el?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    if (modalDialogs) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      const el = boxRef.current;
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
        className="fixed inset-0 z-(--ui-z-dialog) grid place-items-center bg-black/40 p-4"
        data-modal-fallback=""
      >
        <div
          ref={boxRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          data-testid={testId}
          className={className}
        >
          {children}
        </div>
      </div>
    );
  }
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={labelledBy}
      data-testid={testId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={`m-auto backdrop:bg-black/40 ${className}`}
    >
      {children}
    </dialog>
  );
}
