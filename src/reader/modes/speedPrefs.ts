import { createLocalStore } from '../../app/localStore';
import { clampRsvpWpm, RSVP_WPM_RANGE } from './rsvp';
import {
  clampSeconds,
  clampWpm,
  SECONDS_RANGE,
  WPM_RANGE,
  type SpeedMode,
  type SpeedSettings,
} from './speedReader';

/** Hızlı okuma tercihleri (cihaza özel): kip, süreler, RSVP hızı, "yavaş başla" ve odak */
export interface SpeedPrefs extends SpeedSettings {
  /** etkin cümle dışındakiler kararır */
  focus: boolean;
}

const MODES: readonly SpeedMode[] = ['fixed', 'wpm', 'rsvp'];

export function parseSpeedPrefs(raw: unknown): SpeedPrefs {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<
    Record<keyof SpeedPrefs, unknown>
  >;
  return {
    mode: MODES.find((m) => m === o.mode) ?? 'fixed',
    seconds: typeof o.seconds === 'number' ? clampSeconds(o.seconds) : SECONDS_RANGE.default,
    wpm: typeof o.wpm === 'number' ? clampWpm(o.wpm) : WPM_RANGE.default,
    rsvpWpm: typeof o.rsvpWpm === 'number' ? clampRsvpWpm(o.rsvpWpm) : RSVP_WPM_RANGE.default,
    ramp: typeof o.ramp === 'boolean' ? o.ramp : true,
    focus: typeof o.focus === 'boolean' ? o.focus : true,
  };
}

const store = createLocalStore('mypdfbook:speed-reading', parseSpeedPrefs);
export const getSpeedPrefs = store.get;
export const setSpeedPrefs = store.set;
export const useSpeedPrefs = store.useValue;
