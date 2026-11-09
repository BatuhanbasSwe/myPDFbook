import type { BookRecord, SessionRecord } from '../db/db';

/**
 * Oturumlardan istatistikler (saf fonksiyonlar). Günler yerel saate göredir (cihazın saat dilimi): gece yarısını
 * aşan oturum, süresi iki güne paylaştırılarak bölünür. Hafta pazartesi başlar.
 */

const MINUTE = 60_000;

/** Bir oturumun en uzun aralığı: daha uzunu (bozuk saat, bozuk yedek) bu kadarla sınırlanır */
export const MAX_SESSION_MS = 24 * 60 * MINUTE;
/** Bundan hızlı oturum (sayfa/dk) hız hesabına girmez: kaydırıcıyla sayfa geçmek okumak değildir */
export const MAX_PAGES_PER_MIN = 6;

/** Günü okunmuş saymak için en az süre (seri) */
export const MIN_DAY_MS = MINUTE;
/** Hız ölçümü için en az okuma süresi ve sayfa (yoksa tahmin gösterilmez) */
export const MIN_PACE_MS = 5 * MINUTE;
export const MIN_PACE_PAGES = 3;

const pad = (n: number) => String(n).padStart(2, '0');

/** Yerel gün anahtarı: "2026-10-02" */
export function dayKey(t: number | Date): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Yerel günün başlangıcı (ms); `offset` gün sonrası (yaz saatinde de doğru: takvimle sayılır) */
export function startOfDay(t: number, offset = 0): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset).getTime();
}

/** Yerel haftanın (pazartesi) başlangıcı */
export function startOfWeek(t: number): number {
  const d = new Date(t);
  const back = (d.getDay() + 6) % 7; // pazartesi 0
  return startOfDay(t, -back);
}

/**
 * Günlere düşen okuma süresi (ms): gece yarısını aşan oturum, duvar saatine göre orantılı paylaştırılır. Bozuk oturum
 * (sayı olmayan zaman) atlanır; aralık 24 saatle, süre aralıkla sınırlanır (döngü en çok iki gün döner).
 */
export function dailyTotals(sessions: readonly SessionRecord[]): Map<string, number> {
  const days = new Map<string, number>();
  const add = (key: string, ms: number) => days.set(key, (days.get(key) ?? 0) + ms);
  for (const s of sessions) {
    if (!(s.activeMs > 0) || !Number.isFinite(s.start) || !Number.isFinite(s.end)) continue;
    const end = Math.min(Math.max(s.end, s.start), s.start + MAX_SESSION_MS);
    const span = end - s.start;
    const activeMs = span > 0 ? Math.min(s.activeMs, span) : Math.min(s.activeMs, MAX_SESSION_MS);
    if (span <= 0 || startOfDay(s.start) === startOfDay(end)) {
      add(dayKey(s.start), activeMs);
      continue;
    }
    let from = s.start;
    for (let guard = 0; from < end && guard < 3; guard++) {
      const to = Math.min(end, startOfDay(from, 1));
      add(dayKey(from), (activeMs * (to - from)) / span);
      from = to;
    }
  }
  return days;
}

/**
 * Okuma serisi: art arda okunan günler (en az 1 dk). Bugün henüz okunmadıysa seri dünden sürer (gün bitmedi).
 * `best` en uzun seri.
 */
export function streaks(
  daily: ReadonlyMap<string, number>,
  now: number,
): { current: number; best: number } {
  const read = (key: string) => (daily.get(key) ?? 0) >= MIN_DAY_MS;
  let current = 0;
  let day = read(dayKey(now)) ? 0 : -1;
  while (read(dayKey(startOfDay(now, day)))) {
    current++;
    day--;
  }
  const keys = [...daily.keys()].filter(read).sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const key of keys) {
    run = prev !== null && nextKey(prev) === key ? run + 1 : 1;
    best = Math.max(best, run);
    prev = key;
  }
  return { current, best: Math.max(best, current) };
}

function nextKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + 1));
}

export interface DayValue {
  key: string;
  /** günün başlangıcı (ms) */
  date: number;
  ms: number;
}

/** Bu haftanın günleri (pazartesiden pazara) ve okuma süreleri */
export function weekDays(daily: ReadonlyMap<string, number>, now: number): DayValue[] {
  const monday = startOfWeek(now);
  return Array.from({ length: 7 }, (_, i) => {
    const date = startOfDay(monday, i);
    const key = dayKey(date);
    return { key, date, ms: daily.get(key) ?? 0 };
  });
}

export interface HeatCell extends DayValue {
  /** 0: okunmadı; 1: hedefin yarısından az; 2: hedefe yakın; 3: hedef; 4: hedefin iki katı */
  level: 0 | 1 | 2 | 3 | 4;
  /** bugünden sonra (boş çizilir) */
  future: boolean;
}

/** Günün dilimi: günlük hedefe göre */
export function heatLevel(ms: number, goalMs: number): HeatCell['level'] {
  if (ms < MIN_DAY_MS) return 0;
  const r = goalMs > 0 ? ms / goalMs : 1;
  if (r < 0.5) return 1;
  if (r < 1) return 2;
  if (r < 2) return 3;
  return 4;
}

/**
 * Isı haritası: son `weeks` hafta, sütun başına bir hafta (pazartesiden pazara). Son sütun bu hafta; bugünden
 * sonraki günler `future`.
 */
export function heatmap(
  daily: ReadonlyMap<string, number>,
  now: number,
  goalMs: number,
  weeks = 53,
): HeatCell[][] {
  const first = startOfDay(startOfWeek(now), -7 * (weeks - 1));
  const today = startOfDay(now);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = startOfDay(first, w * 7 + d);
      const key = dayKey(date);
      const ms = daily.get(key) ?? 0;
      return { key, date, ms, level: heatLevel(ms, goalMs), future: date > today };
    }),
  );
}

export interface Pace {
  activeMs: number;
  pages: number;
  words: number;
  /** sayfa/dk ve kelime/dk (veri azsa null) */
  pagesPerMin: number | null;
  wordsPerMin: number | null;
}

/** Okuma hızı: toplam sayfa (kelime) / toplam süre. En az 5 dk ve 3 sayfa okunmadıysa hız yok. */
export function pace(
  sessions: readonly Pick<SessionRecord, 'activeMs' | 'pages' | 'words'>[],
): Pace {
  let activeMs = 0;
  let pages = 0;
  let words = 0;
  // Hız yalnızca okuma hızındaki oturumlardan: dakikada 6 sayfadan hızlısı (sayfaları kaydırıcıyla geçmek) aykırıdır
  let paceMs = 0;
  let pacePages = 0;
  let paceWords = 0;
  for (const s of sessions) {
    activeMs += s.activeMs;
    pages += s.pages;
    words += s.words;
    if (s.activeMs > 0 && s.pages / (s.activeMs / MINUTE) <= MAX_PAGES_PER_MIN) {
      paceMs += s.activeMs;
      pacePages += s.pages;
      paceWords += s.words;
    }
  }
  const enough = paceMs >= MIN_PACE_MS && pacePages >= MIN_PACE_PAGES;
  const minutes = paceMs / MINUTE;
  return {
    activeMs,
    pages,
    words,
    pagesPerMin: enough ? Math.min(MAX_PAGES_PER_MIN, pacePages / minutes) : null,
    wordsPerMin: enough && paceWords > 0 ? paceWords / minutes : null,
  };
}

/** Tahminde kullanılan hız: önce bu kitabınki, yoksa bütün kitaplarınki (yoksa null: tahmin gösterilmez) */
export function readingPace(sessions: readonly SessionRecord[], bookId: string): number | null {
  const own = pace(sessions.filter((s) => s.bookId === bookId)).pagesPerMin;
  return own ?? pace(sessions).pagesPerMin;
}

/**
 * Hız iki anlamlı basamağa yuvarlanır (0,63; 1,2): okurken oturum dakikada bir yazıldıkça hız azıcık değişir, okuyucu
 * her seferinde yeniden çizilmesin (tahmin zaten yaklaşık).
 */
export function roundPace(p: number | null): number | null {
  if (p === null || !(p > 0)) return p;
  return Number(p.toPrecision(2));
}

/** Kalan sayfaların tahmini süresi (ms); hız yoksa null */
export function estimateMs(pagesLeft: number, pagesPerMin: number | null): number | null {
  if (pagesPerMin === null || !(pagesPerMin > 0) || pagesLeft < 0) return null;
  return (pagesLeft / pagesPerMin) * MINUTE;
}

/** "~8 dk", "~3 sa 20 dk", "~2 sa", "1 dk'dan az" (tahmin) */
export function formatEstimate(ms: number): string {
  if (ms < MINUTE) return "1 dk'dan az";
  return `~${formatDuration(ms)}`;
}

/** Süre: "45 dk", "3 sa 20 dk", "2 sa", "0 dk" (dakikaya yuvarlanır) */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / MINUTE);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} dk`;
  return m === 0 ? `${h} sa` : `${h} sa ${m} dk`;
}

export interface BookTotals {
  activeMs: number;
  sessions: number;
  pages: number;
  words: number;
  /** son oturumun bitişi */
  lastRead: number;
}

/** Kitap başına toplamlar */
export function bookTotals(sessions: readonly SessionRecord[]): Map<string, BookTotals> {
  const books = new Map<string, BookTotals>();
  for (const s of sessions) {
    const t = books.get(s.bookId) ?? { activeMs: 0, sessions: 0, pages: 0, words: 0, lastRead: 0 };
    t.activeMs += s.activeMs;
    t.sessions++;
    t.pages += s.pages;
    t.words += s.words;
    t.lastRead = Math.max(t.lastRead, s.end);
    books.set(s.bookId, t);
  }
  return books;
}

/** Bu yıl (yerel) biten kitaplar, bitiş tarihine göre */
export function finishedInYear(books: readonly BookRecord[], now: number): BookRecord[] {
  const year = new Date(now).getFullYear();
  return books
    .filter(
      (b) =>
        b.readingStatus === 'finished' &&
        b.finishedAt !== undefined &&
        new Date(b.finishedAt).getFullYear() === year,
    )
    .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
}

/** Toplam okuma süresi (ms) */
export const totalMs = (sessions: readonly SessionRecord[]) =>
  sessions.reduce((n, s) => n + s.activeMs, 0);
