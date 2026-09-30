import { DatabaseBackup, X } from 'lucide-react';
import {
  dismissBackupNotice,
  REMINDER_DAYS,
  useLastBackup,
  type BackupNoticeKind,
} from './reminder';

/**
 * Kütüphanede küçük, kapatılabilir yedek bildirimi: ilk kitaptan sonra bir kez ipucu, uzun süre yedek alınmazsa
 * hatırlatma (bkz. reminder.ts).
 */
export function BackupNotice({
  kind,
  onBackup,
}: {
  kind: Exclude<BackupNoticeKind, null>;
  onBackup(): void;
}) {
  const lastBackup = useLastBackup();
  const title =
    kind === 'hint'
      ? 'Yedek almayı unutma'
      : lastBackup
        ? `${REMINDER_DAYS} günden uzun süredir yedek almadın`
        : 'Henüz yedek almadın';
  return (
    <section
      data-testid="backup-notice"
      data-kind={kind}
      aria-label="Yedek hatırlatması"
      className="mb-6 flex items-center gap-3 rounded-xl border border-line bg-surface py-2 pr-2 pl-4"
    >
      <DatabaseBackup className="size-5 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1 py-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted">
          Kitapların ve notların yalnızca bu cihazda duruyor. Yedek dosyasıyla cihaz sıfırlansa da
          ya da başka cihaza geçsen de geri yüklersin.
        </p>
      </div>
      <button
        type="button"
        onClick={onBackup}
        data-testid="backup-notice-open"
        className="min-h-9 shrink-0 rounded-full bg-accent px-3 text-sm font-medium text-paper"
      >
        Yedekle
      </button>
      <button
        type="button"
        onClick={() => dismissBackupNotice(kind)}
        aria-label="Yedek hatırlatmasını kapat"
        data-testid="backup-notice-close"
        className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-paper"
      >
        <X className="size-5" />
      </button>
    </section>
  );
}
