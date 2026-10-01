import { useCallback, useSyncExternalStore } from 'react';

/** Tailwind'in sm eşiği: bunun altı telefon düzeni (alttan açılan panel, ⋯ menüsünde daha çok eylem) */
export const WIDE = '(min-width: 40rem)';

/** Medya sorgusu eşleşiyor mu (değişince yeniden çizilir) */
export function useMediaQuery(query: string): boolean {
  // Abonelik sorgu başına bir kez kurulur (her çizimde yeniden abone olunmasın)
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      // Eski Safari (13 öncesi) addListener ister; iPadOS 18 ve öncesi addEventListener'ı destekler
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Geniş ekran (iPad, bilgisayar) */
export const useWide = () => useMediaQuery(WIDE);
