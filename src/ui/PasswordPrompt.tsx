import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  answerPasswordRequest,
  usePasswordRequest,
  type PendingPassword,
} from './passwordRequests';

/** `<dialog>` kipli açılabiliyor mu (Safari 15.4+); değilse sabit bir katman kullanılır */
const modalDialogs =
  typeof HTMLDialogElement === 'function' &&
  typeof HTMLDialogElement.prototype.showModal === 'function';

/**
 * Şifre penceresi: uygulamanın kökünde bir kez kurulur, sıradaki şifre sorusunu gösterir (bkz. passwordRequests.ts).
 * Her soru yeni bir pencere açar; yanlış şifreden sonra gelen soruda uyarı yazar.
 */
export function PasswordPrompt() {
  const request = usePasswordRequest();
  if (!request) return null;
  return <PasswordDialog key={request.id} request={request} />;
}

function PasswordDialog({ request }: { request: PendingPassword }) {
  const [value, setValue] = useState('');
  const titleId = useId();
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const answer = (v: string | null) => answerPasswordRequest(request.id, v);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (value) answer(value);
  }

  return (
    <Modal labelledBy={titleId} onCancel={() => answer(null)} initialFocus={inputRef}>
      <form onSubmit={submit} className="flex flex-col gap-3 p-5">
        <h2 id={titleId} className="text-[17px] font-semibold break-words">
          “{request.title}” şifreli
        </h2>
        <div className="flex flex-col gap-1.5">
          <p id={hintId} className="text-[13px] text-secondary">
            Kitabı açmak için PDF'in şifresini gir.
          </p>
          <label htmlFor={inputId} className="sr-only">
            Şifre
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            aria-invalid={request.retry || undefined}
            aria-describedby={request.retry ? `${hintId} ${errorId}` : hintId}
            data-testid="password-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="ui-focus min-h-11 rounded-control bg-fill px-3 text-[16px] text-ink"
          />
        </div>
        {request.retry && (
          <p id={errorId} role="alert" className="text-[13px] text-danger">
            Şifre yanlış, tekrar dene.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="password-cancel"
            onClick={() => answer(null)}
            className="ui-press min-h-11 rounded-full px-4 text-[15px] text-ink hover:bg-fill"
          >
            Vazgeç
          </button>
          <button
            type="submit"
            data-testid="password-submit"
            disabled={!value}
            className="ui-press min-h-11 rounded-full bg-accent px-5 text-[15px] font-semibold text-paper hover:opacity-90 disabled:opacity-40"
          >
            Aç
          </button>
        </div>
      </form>
    </Modal>
  );
}

const BOX =
  'ui-pop w-[min(22rem,calc(100vw-2rem))] rounded-sheet bg-surface p-0 text-ink shadow-float';

/** Odaklanabilen denetimler (eski tarayıcıdaki katmanda odak içeride döner) */
const FOCUSABLE =
  'input:not(:disabled), button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Kipli pencere: `<dialog>` üst katmanda açılır (açık başka bir pencerenin de üstünde), Esc vazgeçer. `<dialog>`
 * olmayan eski tarayıcıda sayfanın üstünde sabit bir katman: Esc belge düzeyinde dinlenir, Tab odağı içeride tutar.
 * Açılınca odak `initialFocus`'a (şifre kutusu) geçer.
 */
function Modal({
  labelledBy,
  onCancel,
  initialFocus,
  children,
}: {
  labelledBy: string;
  onCancel(): void;
  initialFocus: RefObject<HTMLElement | null>;
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
    // showModal kendi seçtiği öğeye odaklanır: şifre kutusuna geçilir (iOS'ta klavye açılsın)
    initialFocus.current?.focus({ preventScroll: true });
    return () => dialog?.close?.();
  }, [initialFocus]);

  useEffect(() => {
    if (modalDialogs) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
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
      <div className="fixed inset-0 z-(--ui-z-dialog) grid place-items-center bg-black/40 p-4">
        <div
          ref={box}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          data-testid="password-dialog"
          className={BOX}
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
      data-testid="password-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className={`m-auto backdrop:bg-black/40 ${BOX}`}
    >
      {children}
    </dialog>
  );
}
