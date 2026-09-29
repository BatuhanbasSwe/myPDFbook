import { createLocalStore } from '../../app/localStore';

/**
 * Kalemle odakta cümle dışının görünüşü: hafif (%40), orta (%70), güçlü (%90) karartma; bulanık yalnızca metin
 * görünümünde (sayfa görünümünde orta karartma olur).
 */
export type FocusDim = 'light' | 'medium' | 'strong' | 'blur';

export const FOCUS_DIMS: readonly FocusDim[] = ['light', 'medium', 'strong', 'blur'];

/**
 * Açık kalan yer: kalemin altındaki kelime ve iki yanındaki birkaç kelime (varsayılan) ya da kalemin altındaki
 * cümlenin tamamı
 */
export type FocusUnit = 'word' | 'sentence';

export const FOCUS_UNITS: readonly FocusUnit[] = ['word', 'sentence'];

/** Kelime penceresinde kalemin önünde ve arkasında açık kalan kelime sayısı */
export const FOCUS_WORDS = [3, 5, 8, 12] as const;
export type FocusWords = (typeof FOCUS_WORDS)[number];

/** Kalemle odak tercihleri (cihaza özel) */
export interface FocusPrefs {
  dim: FocusDim;
  /** "Kalem kalkınca açık kalsın": kapalıyken kalem (fare) kitaptan çıkınca karartma söner */
  keep: boolean;
  unit: FocusUnit;
  /** kelime penceresinde kalemin iki yanındaki kelime sayısı */
  words: FocusWords;
}

export function parseFocusPrefs(raw: unknown): FocusPrefs {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<
    Record<keyof FocusPrefs, unknown>
  >;
  return {
    dim: FOCUS_DIMS.find((d) => d === o.dim) ?? 'medium',
    keep: typeof o.keep === 'boolean' ? o.keep : true,
    unit: FOCUS_UNITS.find((u) => u === o.unit) ?? 'word',
    words: FOCUS_WORDS.find((n) => n === o.words) ?? 5,
  };
}

const store = createLocalStore('mypdfbook:focus', parseFocusPrefs);
export const getFocusPrefs = store.get;
export const setFocusPrefs = store.set;
export const useFocusPrefs = store.useValue;
