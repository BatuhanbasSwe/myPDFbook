import { useEffect, useState } from 'react';
import { createLocalStore } from '../app/localStore';

/**
 * Yedek hatırlatıcısı. Kitaplar yalnızca bu cihazdadır: kitap varken uzun süre yedek alınmadıysa kütüphanede küçük,
 * kapatılabilir bir uyarı; ilk kitaptan sonra da bir kez "Yedek almayı unutma" ipucu gösterilir. Durum cihaza
 * özeldir, yedeğe girmez (bkz. format.ts SETTINGS_KEYS).
 */

/** Bu kadar gün yedek alınmazsa uyarı çıkar */
export const REMINDER_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type BackupNoticeKind = 'hint' | 'reminder' | null;

export interface ReminderState {
  bookCount: number;
  now: number;
  /** son yedeğin alındığı an */
  lastBackupAt?: number;
  /** bu cihazda kitapların ilk görüldüğü an (hiç yedek alınmadıysa süre buradan sayılır) */
  since?: number;
  /** uyarının son kapatıldığı an (süre yeniden başlar) */
  dismissedAt?: number;
  /** ilk ipucu kapatıldı ya da yedek alındı/yüklendi */
  hintDone: boolean;
}

/** Kütüphanede hangi bildirimin görüneceği */
export function backupNotice(s: ReminderState): BackupNoticeKind {
  if (s.bookCount === 0) return null;
  if (s.lastBackupAt === undefined && !s.hintDone) return 'hint';
  const from = Math.max(s.lastBackupAt ?? s.since ?? s.now, s.dismissedAt ?? 0);
  return s.now - from > REMINDER_DAYS * DAY_MS ? 'reminder' : null;
}

const field = (raw: unknown, key: string): unknown =>
  typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)[key] : undefined;
const time = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

const lastBackup = createLocalStore('mypdfbook:last-backup', (raw) => ({
  at: time(field(raw, 'at')),
}));

const reminder = createLocalStore('mypdfbook:backup-reminder', (raw) => ({
  since: time(field(raw, 'since')),
  dismissedAt: time(field(raw, 'dismissedAt')),
  hintDone: field(raw, 'hintDone') === true,
}));

/** Yedek kaydedildi ya da paylaşıldı */
export function markBackedUp(now = Date.now()): void {
  lastBackup.set({ at: now });
  reminder.set({ hintDone: true });
}

/** Yedek yüklendi: kullanıcı yedeği biliyor, ilk ipucu gösterilmez */
export function markRestored(): void {
  reminder.set({ hintDone: true });
}

export function dismissBackupNotice(kind: Exclude<BackupNoticeKind, null>, now = Date.now()): void {
  reminder.set(kind === 'hint' ? { hintDone: true } : { dismissedAt: now });
}

/** Son yedeğin zamanı (yoksa undefined) */
export const useLastBackup = () => lastBackup.useValue().at;

/** Kütüphanedeki bildirim (kitap sayısı yüklenmediyse null) */
export function useBackupNotice(bookCount: number | undefined): BackupNoticeKind {
  const { at } = lastBackup.useValue();
  const state = reminder.useValue();
  // Sayfa açıkken geçen süre önemsiz: an açılışta bir kez alınır
  const [now] = useState(Date.now);
  useEffect(() => {
    if (bookCount && state.since === undefined) reminder.set({ since: Date.now() });
  }, [bookCount, state.since]);
  if (bookCount === undefined) return null;
  return backupNotice({ ...state, bookCount, now, lastBackupAt: at });
}
