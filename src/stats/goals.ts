import { createLocalStore } from '../app/localStore';

/** Okuma hedefleri (istatistikler ekranında değişir; yedeğin ayarlarına girer) */
export interface Goals {
  /** günlük okuma hedefi (dk) */
  dailyMinutes: number;
  /** yıllık kitap hedefi */
  yearlyBooks: number;
}

export const DEFAULT_GOALS: Goals = { dailyMinutes: 20, yearlyBooks: 12 };
/** Seçilebilen günlük hedefler (dk) */
export const DAILY_GOAL_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120] as const;
/** Yıllık kitap hedefinin sınırları */
export const YEARLY_GOAL_RANGE = { min: 1, max: 365 } as const;

const intIn = (v: unknown, min: number, max: number, d: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : d;

export function parseGoals(raw: unknown): Goals {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<
    Record<keyof Goals, unknown>
  >;
  return {
    dailyMinutes: intIn(o.dailyMinutes, 1, 24 * 60, DEFAULT_GOALS.dailyMinutes),
    yearlyBooks: intIn(
      o.yearlyBooks,
      YEARLY_GOAL_RANGE.min,
      YEARLY_GOAL_RANGE.max,
      DEFAULT_GOALS.yearlyBooks,
    ),
  };
}

export const GOALS_KEY = 'mypdfbook:goals';
const store = createLocalStore(GOALS_KEY, parseGoals);
export const setGoals = store.set;
export const useGoals = store.useValue;
