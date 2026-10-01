import type { ReactNode } from 'react';

/**
 * Gruplu liste (iOS "inset grouped"): başlık, köşesi yuvarlatılmış grup ve altında açıklama. Satırlar arasında
 * soldan içeride ince çizgi.
 */
export function ListGroup({
  title,
  footer,
  children,
  testId,
}: {
  title?: string;
  footer?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="flex flex-col gap-1.5" data-testid={testId}>
      {title && <h2 className="px-4 text-[13px] font-medium text-secondary">{title}</h2>}
      <div className="ui-group flex flex-col overflow-hidden rounded-control bg-group">
        {children}
      </div>
      {footer && <p className="px-4 text-xs leading-snug text-secondary">{footer}</p>}
    </section>
  );
}

/** Grubun satırı: solda ad, sağda denetim (ya da serbest içerik) */
export function ListRow({
  label,
  children,
  className = '',
}: {
  label?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex min-h-11 items-center gap-3 px-4 py-1.5 text-[15px] ${className}`}>
      {label !== undefined && <span className="min-w-0 flex-1">{label}</span>}
      {children}
    </div>
  );
}

/** Açma/kapama satırı: satırın tamamı etikettir (dokununca değişir) */
export function SwitchRow({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange(v: boolean): void;
  testId?: string;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-4 py-1.5 text-[15px]">
      <span className="min-w-0 flex-1">{label}</span>
      <Switch checked={checked} onChange={onChange} testId={testId} />
    </label>
  );
}

/**
 * Açma/kapama düğmesi (switch). Yerel onay kutusu (role="switch") görünmez ama yerindedir: dokunma, klavye ve
 * ekran okuyucu onunla çalışır. Adı çevreleyen etiketten gelir.
 */
export function Switch({
  checked,
  onChange,
  testId,
  label,
  disabled,
  describedBy,
}: {
  checked: boolean;
  onChange(v: boolean): void;
  testId?: string;
  disabled?: boolean;
  /** çevreleyen etiket yoksa erişilebilir ad */
  label?: string;
  /** açıklamanın kimliği (aria-describedby): ekran okuyucu adın ardından okur */
  describedBy?: string;
}) {
  return (
    <span className="ui-switch">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        aria-describedby={describedBy}
        checked={checked}
        disabled={disabled}
        data-testid={testId}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="ui-switch-track" aria-hidden="true" />
    </span>
  );
}
