import { X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useRegisterSW } from 'virtual:pwa-register/react';

/** Ana ekrandaki uygulama günlerce açık kalabilir: yeni sürüm en çok bu aralıkla (ve uygulamaya dönünce) aranır. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

function watchForUpdates(registration: ServiceWorkerRegistration) {
  let lastCheck = Date.now();
  const check = () => {
    if (!navigator.onLine || Date.now() - lastCheck < UPDATE_CHECK_MS) return;
    lastCheck = Date.now();
    registration.update().catch(() => undefined);
  };
  setInterval(check, UPDATE_CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}

/**
 * Service worker'ı kaydeder ve yeni sürüm indirilince "Yeni sürüm hazır — Yenile" bildirimini gösterir.
 * Yeni sürüm kendiliğinden devreye girmez, sayfa kendiliğinden yenilenmez: okuma bölünmesin diye bildirim
 * okuma ekranında gizli kalır, kütüphaneye dönünce görünür. Geliştirme sunucusunda service worker yoktur (etkisiz).
 */
export function UpdatePrompt() {
  const { pathname } = useLocation();
  const registration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  // Yenile'ye bu pencerede mi basıldı
  const requested = useRef(false);
  const [later, setLater] = useState(false);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, r) {
      registration.current = r;
      if (r) watchForUpdates(r);
    },
    onNeedReload() {
      // Yeni sürüm devreye girdi. Başka bir pencerede (ör. iPad bölünmüş ekran) istendiyse bu pencere okumayı
      // bölmez, yalnızca bildirimi gösterir.
      if (requested.current) window.location.reload();
      else setNeedRefresh(true);
    },
  });

  async function refresh() {
    requested.current = true;
    // Bekleyen sürüm varsa devreye girince (onNeedReload) yenilenir; başka pencerede devreye girdiyse hemen
    if (registration.current?.waiting) await updateServiceWorker();
    else window.location.reload();
  }

  if (!needRefresh || later || pathname.startsWith('/read/')) return null;
  return (
    <div
      role="status"
      data-testid="update-prompt"
      className="material ui-pop fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-(--ui-z-dialog) mx-auto flex w-max max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full py-1 pr-1 pl-4 text-[15px] text-ink"
    >
      <span>Yeni sürüm hazır —</span>
      <button
        type="button"
        onClick={() => void refresh()}
        className="ui-press min-h-11 rounded-full bg-accent px-4 font-semibold text-paper hover:opacity-90"
      >
        Yenile
      </button>
      <button
        type="button"
        onClick={() => setLater(true)}
        aria-label="Sonra"
        className="ui-press grid size-11 place-items-center rounded-full text-secondary hover:bg-fill"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
