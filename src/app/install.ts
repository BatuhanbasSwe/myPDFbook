import { useSyncExternalStore } from 'react';
import { createLocalStore } from './localStore';

/**
 * "Ana ekrana kur" kartının mantığı. Kurulu uygulamada (ana ekrandan açılmış) kart hiç görünmez; kapatılınca bu
 * cihazda bir daha gösterilmez.
 * - iOS/iPadOS: tarayıcı kurulum penceresi açamaz; Paylaş → Ana Ekrana Ekle yolu tarif edilir.
 * - Chromium (Android, masaüstü): `beforeinstallprompt` geldiyse "Uygulamayı yükle" düğmesi tarayıcının penceresini açar.
 */
export type InstallCardKind = 'ios' | 'prompt' | null;

export interface InstallEnv {
  /** ana ekrandan / kurulu uygulama olarak açıldı */
  standalone: boolean;
  /** iPhone, iPad (iPadOS masaüstü kimliğiyle de) */
  ios: boolean;
  /** tarayıcı `beforeinstallprompt` gönderdi, kurulum penceresi açılabilir */
  canPrompt: boolean;
  /** kullanıcı kartı kapattı */
  dismissed: boolean;
}

export function installCardKind({
  standalone,
  ios,
  canPrompt,
  dismissed,
}: InstallEnv): InstallCardKind {
  if (standalone || dismissed) return null;
  if (ios) return 'ios';
  return canPrompt ? 'prompt' : null;
}

/** iPadOS 13+ Safari kendini Mac olarak tanıtır; dokunmatik ekran onu Mac'ten ayırır. */
export function iosDevice(userAgent: string, maxTouchPoints: number): 'iPad' | 'iPhone' | null {
  if (/iPad/.test(userAgent)) return 'iPad';
  if (/iPhone|iPod/.test(userAgent)) return 'iPhone';
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return 'iPad';
  return null;
}

/** Kartın iOS satırı: "iPad'e kur" / "iPhone'a kur" (Türkçe ses uyumu) */
export function iosInstallHint(device: 'iPad' | 'iPhone'): string {
  return `${device === 'iPad' ? "iPad'e" : "iPhone'a"} kur: Paylaş → Ana Ekrana Ekle`;
}

export function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches;
}

/** Chromium'un kurulum olayı (standart DOM tiplerinde yok) */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const dismissal = createLocalStore('mypdfbook:install-card', (raw) => ({
  dismissed:
    typeof raw === 'object' && raw !== null && 'dismissed' in raw && raw.dismissed === true,
}));

export const dismissInstallCard = () => dismissal.set({ dismissed: true });

// Olay sayfa açılır açılmaz gelebilir: kütüphane çizilmeden önce yakalanıp saklanır (bu modül main.tsx'ten yüklenir).
let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // tarayıcının kendi bilgi çubuğu yerine kütüphanedeki kart
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });
}

/** Tarayıcının kurulum penceresini açar; olay yalnızca bir kez kullanılabilir. */
export async function promptInstall(): Promise<void> {
  const event = deferred;
  if (!event) return;
  deferred = null;
  notify();
  await event.prompt();
  if ((await event.userChoice).outcome === 'accepted') installed = true;
  notify();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const canPromptNow = () => deferred !== null;
const installedNow = () => installed;

/** Kütüphanedeki kartın türü ve (iOS'ta) cihaz adı */
export function useInstallCard(): { kind: InstallCardKind; device: 'iPad' | 'iPhone' } {
  const canPrompt = useSyncExternalStore(subscribe, canPromptNow, canPromptNow);
  const justInstalled = useSyncExternalStore(subscribe, installedNow, installedNow);
  const { dismissed } = dismissal.useValue();
  const device = iosDevice(navigator.userAgent, navigator.maxTouchPoints);
  const kind = installCardKind({
    standalone: justInstalled || isStandalone(),
    ios: device !== null,
    canPrompt,
    dismissed,
  });
  return { kind, device: device ?? 'iPad' };
}
