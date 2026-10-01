import { setThemeSetting, THEMES, type ThemeSetting } from '../app/theme';
import { BACKUP_MIME } from './format';

/**
 * Yedek dosyasını cihazdan çıkarma. iPad/iPhone'da paylaşım sayfası (Web Share, iOS 15+) AirDrop, "Dosyalar'a
 * Kaydet" ve Mesajlar'ı açar; paylaşamayan tarayıcıda (masaüstü, Android Chrome ZIP paylaşamaz) dosya indirilir
 * (`<a download>`; iOS Safari 13+ indirmeyi Dosyalar'a kaydeder).
 */

export const backupFile = (blob: Blob, fileName: string) =>
  new File([blob], fileName, { type: BACKUP_MIME });

/** Bu tarayıcı dosyayı paylaşım sayfasıyla gönderebilir mi */
export function canShareFile(file: File): boolean {
  try {
    return (
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] })
    );
  } catch {
    return false;
  }
}

/**
 * Paylaşım sayfasını açar. Kullanıcı vazgeçerse 'cancelled'. Başka hata (izin yok, dosya çok büyük) fırlatılır:
 * çağıran indirmeye düşer. Dokunuşun içinde çağrılmalı (iOS kullanıcı etkileşimi ister).
 */
export async function shareFile(file: File): Promise<'shared' | 'cancelled'> {
  try {
    // Başlık verilmez: bazı hedefler (Notlar, Mesajlar) dosyanın yanına ayrıca metin olarak ekliyor
    await navigator.share({ files: [file] });
    return 'shared';
  } catch (e) {
    if ((e as { name?: string } | null)?.name === 'AbortError') return 'cancelled';
    throw e;
  }
}

/** Dosyayı indirir (paylaşım olmayan ya da başarısız olan tarayıcıda) */
export function downloadFile(url: string, fileName: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
}

/**
 * Yedekten yazılan ayarları açık sayfaya uygular: tema hemen değişir, öteki ayar depoları (localStore) başka
 * sekmeden gelmiş gibi yeniden okunur.
 */
export function refreshSettings(keys: readonly string[]): void {
  for (const key of keys) {
    if (key === 'mypdfbook:theme') {
      let value: string | null = null;
      try {
        value = localStorage.getItem(key);
      } catch {
        // gizli sekme vb.
      }
      if ((THEMES as readonly (string | null)[]).includes(value))
        setThemeSetting(value as ThemeSetting);
    } else {
      window.dispatchEvent(new StorageEvent('storage', { key }));
    }
  }
}
