import { createLocalStore } from '../../app/localStore';
import {
  clampSeconds,
  clampWpm,
  SECONDS_RANGE,
  WPM_RANGE,
  type SpeedMode,
  type SpeedSettings,
} from './speedReader';

/** Hızlı okuma tercihleri (cihaza özel): süre kipi, saniye, dakikada kelime ve odak */
export interface SpeedPrefs extends SpeedSettings {
  /** etkin cümle dışındakiler kararır */
  focus: boolean;
}

export function parseSpeedPrefs(raw: unknown): SpeedPrefs {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<
    Record<keyof SpeedPrefs, unknown>
  >;
  const mode: SpeedMode = o.mode === 'wpm' ? 'wpm' : 'fixed';
  return {
    mode,
    seconds: typeof o.seconds === 'number' ? clampSeconds(o.seconds) : SECONDS_RANGE.default,
    wpm: typeof o.wpm === 'number' ? clampWpm(o.wpm) : WPM_RANGE.default,
    focus: typeof o.focus === 'boolean' ? o.focus : true,
  };
}

const store = createLocalStore('mypdfbook:speed-reading', parseSpeedPrefs);
export const getSpeedPrefs = store.get;
export const setSpeedPrefs = store.set;
export const useSpeedPrefs = store.useValue;
