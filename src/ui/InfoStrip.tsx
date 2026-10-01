import { X, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from './IconButton';

/**
 * Sade bilgi şeridi (kütüphanede kurulum ve yedek hatırlatması): solda simge, ortada başlık ve kısa açıklama,
 * sağda tek eylem ve kapatma. Dar ekranda eylem açıklamanın altına iner.
 */
export function InfoStrip({
  Icon,
  title,
  children,
  action,
  onClose,
  closeLabel,
  closeTestId,
  label,
  testId,
  kind,
}: {
  Icon: LucideIcon;
  title: ReactNode;
  children: ReactNode;
  /** tek eylem düğmesi */
  action?: ReactNode;
  onClose(): void;
  closeLabel: string;
  closeTestId?: string;
  /** bölgenin erişilebilir adı */
  label: string;
  testId: string;
  kind?: string;
}) {
  return (
    <section
      data-testid={testId}
      data-kind={kind}
      aria-label={label}
      className="flex items-center gap-3 rounded-panel bg-group py-2 pr-1.5 pl-3 shadow-control"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-tint text-accent">
        <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 py-1">
        <div className="min-w-0 flex-1 basis-60">
          <p className="text-[15px] font-semibold">{title}</p>
          <p className="text-[13px] leading-snug text-secondary">{children}</p>
        </div>
        {action}
      </div>
      <IconButton
        label={closeLabel}
        testId={closeTestId}
        Icon={X}
        variant="muted"
        onClick={onClose}
      />
    </section>
  );
}

/** Şeridin eylem düğmesinin görünüşü */
export const stripAction =
  'ui-press min-h-11 shrink-0 rounded-full bg-accent px-4 text-[15px] font-semibold text-paper hover:opacity-90';
