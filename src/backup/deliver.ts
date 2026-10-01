import { iosDevice, isStandalone } from '../app/install';
import { setThemeSetting, THEMES, type ThemeSetting } from '../app/theme';
import { BACKUP_MIME } from './format';

/**
 * Yedek dosyasını cihazdan çıkarma. iPad/iPhone'da paylaşım sayfası (Web Share, iOS 15+) AirDrop, "Dosyalar'a
 * Kaydet" ve Mesajlar'ı açar; paylaşamayan tarayıcıda (masaüstü, Android Chrome ZIP paylaşamaz) dosya indirilir.
 * İndirme yalnızca kullanıcının dokunduğu gerçek bağlantıyla olur (`<a download>`; iOS Safari 13+ indirmeyi
 * Dosyalar'a kaydeder): bir `await`'ten sonra programla tıklanan bağlantıyı tarayıcılar engelleyebilir.
 */

/** Yedeğin çıkacağı cihaz */
export interface BackupDevice {
  /** iPad ya da iPhone (iPadOS kendini Mac olarak tanıtır: dokunmatik ekranla ayrılır) */
  ios: 'iPad' | 'iPhone' | null;
  /**
   * Ana ekrana eklenmiş uygulama olarak açıldı. iOS'ta orada Blob bağlantısı (`<a download>`) hiçbir şey yapmayabilir
   * ya da uygulamanın sayfasını dosyaya götürebilir: yedek paylaşım sayfasıyla kaydedilir.
   */
  standalone: boolean;
}

export function currentBackupDevice(): BackupDevice {
  return {
    ios: iosDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0),
    standalone: isStandalone(),
  };
}

/**
 * PDF'leri bu boyu aşan yedekte bellek uyarısı: WebKit (iPad, iPhone) yedeği bellekte üretir ve bellek sınırı
 * düşüktür; öteki cihazlarda sınır daha yüksektir.
 */
export const largePdfBytes = (ios: boolean) => (ios ? 400e6 : 500e6);

/** "PDF'leri de ekle"nin varsayılanı: iPad/iPhone'da PDF'ler büyükse kapalı (PDF'siz yedek önerilir) */
export const defaultIncludePdfs = (pdfBytes: number, ios: boolean) =>
  !(ios && pdfBytes > largePdfBytes(true));

/** İndirme bağlantısına verilen adres bu kadar sonra bırakılır (indirme sürerken bırakılmasın) */
export const DOWNLOAD_URL_TTL_MS = 5 * 60_000;
/** Pencere kapanınca adresler bu kadar sonra bırakılır (dokunup hemen kapatınca indirme yine başlasın) */
export const DOWNLOAD_URL_GRACE_MS = 10_000;

/** Bağlantılara verilmiş, henüz bırakılmamış adresler ve bırakılma zamanlayıcıları */
const liveUrls = new Map<string, ReturnType<typeof setTimeout>>();

function releaseUrl(url: string): void {
  clearTimeout(liveUrls.get(url));
  liveUrls.delete(url);
  URL.revokeObjectURL(url);
}

/**
 * İndirme bağlantısına dokunulunca çağrılır (tıklama olayının içinde): dosyanın adresi bağlantıya o an verilir,
 * tarayıcı bağlantıyı bu adresle izler. Adres süresi dolunca, pencere kapanınca (kısa bir payla) ya da sayfa
 * kapanınca bırakılır. Dokunulmadan adres hiç oluşmaz: bellekteki yedek boşuna tutulmaz.
 */
export function attachDownloadUrl(
  link: HTMLAnchorElement,
  file: Blob,
  ttl = DOWNLOAD_URL_TTL_MS,
): void {
  const url = URL.createObjectURL(file);
  link.href = url;
  liveUrls.set(
    url,
    setTimeout(() => releaseUrl(url), ttl),
  );
}

/**
 * Yedek penceresi kapandı: adresler `grace` sonra bırakılır (indirme o ana dek başlamıştır; bellekteki yedek
 * pencereden sonra en çok bu kadar tutulur). 0: hemen.
 */
export function releaseDownloadUrls(grace = DOWNLOAD_URL_GRACE_MS): void {
  for (const url of [...liveUrls.keys()]) {
    if (grace <= 0) releaseUrl(url);
    else {
      clearTimeout(liveUrls.get(url));
      liveUrls.set(
        url,
        setTimeout(() => releaseUrl(url), grace),
      );
    }
  }
}

// Sayfa kapanırken (ya da önbelleğe alınırken) adresler hemen bırakılır
if (typeof window !== 'undefined')
  window.addEventListener('pagehide', () => releaseDownloadUrls(0));

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
 * çağıran kullanıcıya "İndir" bağlantısını gösterir (programla indirmez). Dokunuşun içinde çağrılmalı (iOS
 * kullanıcı etkileşimi ister).
 */
export async function shareFile(file: File): Promise<'shared' | 'cancelled'> {
  try {
    // Başlık verilmez: bazı hedefler (Notlar, Mesajlar) dosyanın yanına ayrıca metin olarak ekliyor
    await navigator.share({ files: [file] });
    return 'shared';
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    // InvalidStateError: önceki paylaşım sayfası hâlâ açık (çift dokunuş); hata sayılmaz
    if (name === 'AbortError' || name === 'InvalidStateError') return 'cancelled';
    throw e;
  }
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
