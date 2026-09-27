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
    const acquire = () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      navigator.wakeLock.request('screen').then(
        (l) => {
          if (alive) lock = l;
          else void l.release().catch(() => undefined);
        },
        () => undefined, // izin yok, pil tasarrufu vb.
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
