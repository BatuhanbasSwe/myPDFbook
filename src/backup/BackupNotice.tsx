import { DatabaseBackup } from 'lucide-react';
import { InfoStrip, stripAction } from '../ui/InfoStrip';
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
    <InfoStrip
      testId="backup-notice"
      kind={kind}
      label="Yedek hatırlatması"
      Icon={DatabaseBackup}
      title={title}
      onClose={() => dismissBackupNotice(kind)}
      closeLabel="Yedek hatırlatmasını kapat"
      closeTestId="backup-notice-close"
      action={
        <button
          type="button"
          onClick={onBackup}
          data-testid="backup-notice-open"
          className={stripAction}
        >
          Yedekle
        </button>
      }
    >
      Kitapların ve notların yalnızca bu cihazda duruyor. Yedek dosyasıyla cihaz sıfırlansa da ya da
      başka cihaza geçsen de geri yüklersin.
    </InfoStrip>
  );
}
