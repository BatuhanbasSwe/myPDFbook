import { useSyncExternalStore } from 'react';

/**
 * Cihaza özel bir tercihi localStorage'da tutan küçük depo (tema dışındaki okuyucu ayarları).
 * Değer eşzamanlı okunur (ilk sayfalama bekletilmez); bozuk ya da eski kayıt `parse` ile geçerli değere çevrilir.
 */
export interface LocalStore<T> {
  get(): T;
  set(patch: Partial<T>): void;
  /** React hook: değer değişince bileşeni yeniden çizer */
  useValue(): T;
}

export function createLocalStore<T extends object>(
  key: string,
  parse: (raw: unknown) => T,
): LocalStore<T> {
  let cached: { raw: string | null; value: T } | undefined;
  const listeners = new Set<() => void>();

  const get = (): T => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      // gizli sekme vb.
    }
    // useSyncExternalStore aynı değer için aynı nesneyi ister
    if (cached && cached.raw === raw) return cached.value;
    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null; // bozuk kayıt: varsayılanlar
    }
    cached = { raw, value: parse(parsed) };
    return cached.value;
  };

  const set = (patch: Partial<T>): void => {
    const next = parse({ ...get(), ...patch });
    const raw = JSON.stringify(next);
    try {
      localStorage.setItem(key, raw);
      cached = { raw, value: next };
    } catch {
      // saklanamıyorsa yalnızca bu oturumda geçerli
      cached = { raw: cached?.raw ?? null, value: next };
    }
    listeners.forEach((listener) => listener());
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { get, set, useValue: () => useSyncExternalStore(subscribe, get, get) };
}
