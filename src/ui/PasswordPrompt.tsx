import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
  const errorId = useId();
  const answer = (v: string | null) => answerPasswordRequest(request.id, v);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (value) answer(value);
  }

  return (
    <Modal labelledBy={titleId} onCancel={() => answer(null)}>
      <form onSubmit={submit} className="flex flex-col gap-3 p-5">
        <h2 id={titleId} className="text-[17px] font-semibold break-words">
          “{request.title}” şifreli
        </h2>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] text-secondary">
            Kitabı açmak için PDF'in şifresini gir.
          </span>
          <input
            type="password"
            autoFocus
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            aria-label="Şifre"
            aria-invalid={request.retry || undefined}
            aria-describedby={request.retry ? errorId : undefined}
            data-testid="password-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="ui-focus min-h-11 rounded-control bg-fill px-3 text-[16px] text-ink"
          />
        </label>
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

/**
 * Kipli pencere: `<dialog>` üst katmanda açılır (açık başka bir pencerenin de üstünde), Esc vazgeçer. `<dialog>`
 * olmayan eski tarayıcıda sayfanın üstünde sabit bir katman.
 */
function Modal({
  labelledBy,
  onCancel,
  children,
}: {
  labelledBy: string;
  onCancel(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal?.();
    return () => dialog?.close?.();
  }, []);

  if (!modalDialogs) {
    return (
      <div className="fixed inset-0 z-(--ui-z-dialog) grid place-items-center bg-black/40 p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          data-testid="password-dialog"
          className={BOX}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel();
          }}
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
