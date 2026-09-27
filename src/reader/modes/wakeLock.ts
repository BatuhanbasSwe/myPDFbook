import { useEffect } from 'react';

/**
 * Ekran açık kalsın (Screen Wake Lock) — `active` iken. Sekme gizlenince tarayıcı kilidi bırakır: sayfa yeniden
 * görünür olunca yeniden istenir. Desteklenmiyorsa ya da izin verilmezse bir şey yapmaz.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let alive = true;
    /** istek sürüyor: art arda görünürlük olayları ikinci kilit istemesin */
    let pending = false;
    const acquire = () => {
      if (pending || document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      pending = true;
      navigator.wakeLock.request('screen').then(
        (l) => {
          pending = false;
          if (alive) lock = l;
          else void l.release().catch(() => undefined);
        },
        () => {
          pending = false; // izin yok, pil tasarrufu vb.
        },
      );
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}
