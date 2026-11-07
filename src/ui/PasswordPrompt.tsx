import { useId, useRef, useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import {
  answerPasswordRequest,
  usePasswordRequest,
  type PendingPassword,
} from './passwordRequests';

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
    <Modal
      labelledBy={titleId}
      onCancel={() => answer(null)}
      initialFocus={inputRef}
      testId="password-dialog"
      className={BOX}
    >
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
  'ui-pop m-auto w-[min(22rem,calc(100vw-2rem))] rounded-sheet bg-surface p-0 text-ink shadow-float';
