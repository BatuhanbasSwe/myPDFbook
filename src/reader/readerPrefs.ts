import { createLocalStore } from '../app/localStore';

/** Sayfa çevirme efekti: kıvrılan kitap sayfası, kayan slayt ya da anında değişim */
export type FlipEffect = 'curl' | 'slide' | 'none';

/** Sayfa: PDF'in kendi sayfaları (görüntü); metin: yeniden dizilmiş metin (tipografi, karanlık tema) */
export type ReaderView = 'page' | 'text';

export interface ReaderPrefs {
  view: ReaderView;
  effect: FlipEffect;
  /** ekranın sağ/sol üçte birine dokununca sayfa çevrilir, ortası menüyü açar */
  tap: boolean;
  /** sağdan sola / soldan sağa kaydırınca sayfa çevrilir */
  swipe: boolean;
  /** sayfanın altında küçük ‹ › düğmeleri */
  buttons: boolean;
}

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const DEFAULT_PREFS: ReaderPrefs = {
  view: 'page',
  effect: 'curl',
  tap: true,
  swipe: true,
  buttons: false,
};

export function parsePrefs(raw: unknown): ReaderPrefs {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<
    Record<keyof ReaderPrefs, unknown>
  >;
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const effects: FlipEffect[] = ['curl', 'slide', 'none'];
  // Hareketi azalt açıksa varsayılan efekt anında değişim
  const defaultEffect = reducedMotion() ? 'none' : DEFAULT_PREFS.effect;
  return {
    view: o.view === 'text' ? 'text' : DEFAULT_PREFS.view,
    effect: effects.includes(o.effect as FlipEffect) ? (o.effect as FlipEffect) : defaultEffect,
    tap: bool(o.tap, DEFAULT_PREFS.tap),
    swipe: bool(o.swipe, DEFAULT_PREFS.swipe),
    buttons: bool(o.buttons, DEFAULT_PREFS.buttons),
  };
}

const store = createLocalStore('mypdfbook:reader', parsePrefs);
export const setReaderPrefs = store.set;
export const useReaderPrefs = store.useValue;
