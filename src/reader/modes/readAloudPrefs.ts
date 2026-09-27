import { createLocalStore } from '../../app/localStore';
import { clampRate, RATE_RANGE } from './readAloud';

/** Sesli okuma tercihleri (cihaza özel): hız ve kitabın diline göre seçilen ses */
export interface ReadAloudPrefs {
  rate: number;
  /** dil ("tr", "en", "other") → ses kimliği (voiceURI) */
  voices: Record<string, string>;
}

export function parseReadAloudPrefs(raw: unknown): ReadAloudPrefs {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<
    Record<keyof ReadAloudPrefs, unknown>
  >;
  const voices: Record<string, string> = {};
  if (typeof o.voices === 'object' && o.voices !== null) {
    for (const [lang, id] of Object.entries(o.voices))
      if (typeof id === 'string') voices[lang] = id;
  }
  return {
    rate: typeof o.rate === 'number' ? clampRate(o.rate) : RATE_RANGE.default,
    voices,
  };
}

const store = createLocalStore('mypdfbook:read-aloud', parseReadAloudPrefs);
export const getReadAloudPrefs = store.get;
export const setReadAloudPrefs = store.set;
