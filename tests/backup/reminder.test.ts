import { describe, expect, it } from 'vitest';
import { backupNotice, REMINDER_DAYS } from '../../src/backup/reminder';

const DAY = 24 * 60 * 60 * 1000;
const now = 100 * DAY;

describe('yedek hatırlatıcısı', () => {
  it('kitap yokken hiçbir şey gösterilmez', () => {
    expect(backupNotice({ bookCount: 0, now, hintDone: false })).toBeNull();
    expect(backupNotice({ bookCount: 0, now, lastBackupAt: 0, hintDone: true })).toBeNull();
  });

  it('ilk kitaptan sonra bir kez ipucu; kapatılınca ya da yedek alınınca gösterilmez', () => {
    expect(backupNotice({ bookCount: 1, now, since: now, hintDone: false })).toBe('hint');
    expect(backupNotice({ bookCount: 1, now, since: now, hintDone: true })).toBeNull();
    expect(backupNotice({ bookCount: 1, now, lastBackupAt: now, hintDone: false })).toBeNull();
  });

  it(`${REMINDER_DAYS} günden uzun süre yedek alınmazsa uyarı; kapatılınca süre yeniden başlar`, () => {
    const base = { bookCount: 3, now, hintDone: true };
    expect(backupNotice({ ...base, lastBackupAt: now - 13 * DAY })).toBeNull();
    expect(backupNotice({ ...base, lastBackupAt: now - 15 * DAY })).toBe('reminder');
    expect(
      backupNotice({ ...base, lastBackupAt: now - 30 * DAY, dismissedAt: now - 2 * DAY }),
    ).toBeNull();
    expect(
      backupNotice({ ...base, lastBackupAt: now - 30 * DAY, dismissedAt: now - 20 * DAY }),
    ).toBe('reminder');
  });

  it('hiç yedek alınmadıysa süre kitapların bu cihazda ilk görüldüğü andan sayılır', () => {
    const base = { bookCount: 2, now, hintDone: true };
    expect(backupNotice({ ...base, since: now - 3 * DAY })).toBeNull();
    expect(backupNotice({ ...base, since: now - 15 * DAY })).toBe('reminder');
    // Henüz kaydedilmediyse (ilk açılış) uyarı yok
    expect(backupNotice(base)).toBeNull();
  });
});
