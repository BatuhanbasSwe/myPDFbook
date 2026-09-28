import { createLocalStore } from '../../app/localStore';

/**
 * Kalemle odakta cümle dışının görünüşü: hafif (%40), orta (%70), güçlü (%90) karartma; bulanık yalnızca metin
 * görünümünde (sayfa görünümünde orta karartma olur).
 */
export type FocusDim = 'light' | 'medium' | 'strong' | 'blur';

export const FOCUS_DIMS: readonly FocusDim[] = ['light', 'medium', 'strong', 'blur'];

/** Kalemle odak tercihleri (cihaza özel) */
export interface FocusPrefs {
  dim: FocusDim;
  /** "Kalem kalkınca son cümle açık kalsın": kapalıyken kalem (fare) kitaptan çıkınca karartma söner */
  keep: boolean;
}

export function parseFocusPrefs(raw: unknown): FocusPrefs {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<
    Record<keyof FocusPrefs, unknown>
  >;
  return {
    dim: FOCUS_DIMS.find((d) => d === o.dim) ?? 'medium',
    keep: typeof o.keep === 'boolean' ? o.keep : true,
  };
}

const store = createLocalStore('mypdfbook:focus', parseFocusPrefs);
export const getFocusPrefs = store.get;
export const setFocusPrefs = store.set;
export const useFocusPrefs = store.useValue;
