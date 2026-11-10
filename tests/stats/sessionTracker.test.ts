import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRecord } from '../../src/db/db';
import {
  CHECK_EVERY_MS,
  DWELL_MS,
  IDLE_MS,
  MIN_ACTIVE_MS,
  randomId,
  SessionTracker,
} from '../../src/stats/sessionTracker';
import { pageWordCounts } from '../../src/stats/useSessionTracker';

const T0 = 1_000_000;
let saved: SessionRecord[];
let ids: number;

function tracker() {
  const t = new SessionTracker({
    bookId: 'kitap',
    save: (s) => saved.push({ ...s }),
    now: () => Date.now(),
    newId: () => `oturum-${++ids}`,
  });
  t.setWords((p) => (p + 1) * 100);
  return t;
}

/** Her kimliğin son yazılan hâli */
const latest = () => [...new Map(saved.map((s) => [s.id, s])).values()];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  saved = [];
  ids = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('oturum izleyici', () => {
  it('30 sn’den kısa göz atma yazılmaz', () => {
    const t = tracker();
    t.pages([0]);
    t.activity();
    vi.advanceTimersByTime(MIN_ACTIVE_MS - 1000);
    t.dispose();
    expect(saved).toEqual([]);
  });

  it('sayfa çevirdikçe süre işler; okuyucu kapanınca oturum o an biter', () => {
    const t = tracker();
    t.pages([4]); // açılış: okunmuş sayılmaz
    t.activity();
    vi.advanceTimersByTime(60_000);
    t.pages([5]);
    vi.advanceTimersByTime(60_000);
    t.pages([6]);
    vi.advanceTimersByTime(30_000);
    t.dispose();
    expect(latest()).toEqual([
      {
        id: 'oturum-1',
        bookId: 'kitap',
        start: T0,
        end: T0 + 150_000,
        activeMs: 150_000,
        pages: 2,
        words: 600 + 700,
      },
    ]);
  });

  it('2 dk etkinlik olmazsa oturum biter: süre son etkinlikten 2 dk sonrasına dek sayılır', () => {
    const t = tracker();
    t.pages([0]);
    t.activity();
    vi.advanceTimersByTime(60_000);
    t.pages([1]);
    vi.advanceTimersByTime(IDLE_MS + CHECK_EVERY_MS);
    expect(latest()).toMatchObject([{ activeMs: 60_000 + IDLE_MS, end: T0 + 60_000 + IDLE_MS }]);
    // Sonraki etkinlik yeni oturum başlatır
    vi.advanceTimersByTime(10 * 60_000);
    t.pages([2]);
    vi.advanceTimersByTime(40_000);
    t.dispose();
    const sessions = latest();
    expect(sessions).toHaveLength(2);
    // Yeni oturum önceki sayfada (1) başladı: yalnızca 2 okundu
    expect(sessions[1]).toMatchObject({ id: 'oturum-2', activeMs: 40_000, pages: 1 });
  });

  it('boşta kalınan zaman ölçülmez: dönüldüğünde zamanlayıcı geç çalışsa da', () => {
    const t = tracker();
    t.pages([0]);
    t.activity();
    vi.advanceTimersByTime(45_000);
    t.activity();
    // Zamanlayıcı kısılmış (arka plan): sistem saati ileri, zamanlayıcı çalışmadan etkinlik gelir
    vi.setSystemTime(Date.now() + 30 * 60_000);
    t.activity();
    expect(latest()).toMatchObject([{ id: 'oturum-1', activeMs: 45_000 + IDLE_MS }]);
    t.dispose();
  });

  it('sekme gizlenince oturum biter ve yazılır; görünür olunca yenisi başlar', () => {
    const t = tracker();
    t.pages([0]);
    t.activity();
    vi.advanceTimersByTime(50_000);
    t.setVisible(false);
    expect(latest()).toMatchObject([{ id: 'oturum-1', activeMs: 50_000 }]);
    // Gizliyken etkinlik sayılmaz
    vi.advanceTimersByTime(5 * 60_000);
    t.activity();
    t.setVisible(true);
    vi.advanceTimersByTime(35_000);
    t.dispose();
    expect(latest()).toHaveLength(2);
    expect(latest()[1]).toMatchObject({ id: 'oturum-2', activeMs: 35_000 });
  });

  it('sesli ya da hızlı okuma sürerken dokunulmasa da süre işler', () => {
    const t = tracker();
    t.pages([0]);
    t.setPlaying(true);
    vi.advanceTimersByTime(10 * 60_000);
    t.setPlaying(false);
    vi.advanceTimersByTime(IDLE_MS + CHECK_EVERY_MS);
    const [s] = latest();
    expect(s.activeMs).toBe(10 * 60_000 + IDLE_MS);
    expect(latest()).toHaveLength(1);
  });

  it('uzun oturum dakikada bir yazılır (aynı kimlikle)', () => {
    const t = tracker();
    t.pages([0]);
    t.activity();
    for (let i = 1; i <= 4; i++) {
      vi.advanceTimersByTime(30_000);
      t.pages([i]);
    }
    expect(saved.length).toBeGreaterThanOrEqual(1);
    expect(new Set(saved.map((s) => s.id))).toEqual(new Set(['oturum-1']));
    t.dispose();
    // 1–3 okundu; açılıştaki 0 sayılmaz, son açılan 4 hemen kapandı (5 sn açık kalmadı)
    expect(latest()).toMatchObject([{ activeMs: 120_000, pages: 3 }]);
  });

  it('geri dönülen sayfa yeniden sayılmaz; çift sayfada ikisi de sayılır', () => {
    const t = tracker();
    t.pages([0, 1]);
    t.activity();
    vi.advanceTimersByTime(10_000);
    t.pages([2, 3]);
    vi.advanceTimersByTime(10_000);
    t.pages([0, 1]); // açılıştaki sayfalar geri dönülse de bu oturumda sayılmaz
    vi.advanceTimersByTime(10_000);
    t.pages([2, 3]);
    vi.advanceTimersByTime(10_000);
    t.pages([100, 101]); // atlama: aradaki sayfalar sayılmaz
    vi.advanceTimersByTime(40_000);
    t.dispose();
    expect(latest()).toMatchObject([{ pages: 4, words: 300 + 400 + 10_100 + 10_200 }]);
  });

  it('açılıştaki sayfa okunmuş sayılmaz: etkinlik sayfalardan önce gelse de', () => {
    const t = tracker();
    t.activity(); // okuyucu açılınca (sayfalar henüz gelmedi)
    t.pages([7]);
    vi.advanceTimersByTime(60_000);
    t.dispose();
    expect(latest()).toMatchObject([{ activeMs: 60_000, pages: 0, words: 0 }]);

    const u = tracker();
    u.activity();
    u.pages([7]);
    vi.advanceTimersByTime(60_000);
    u.pages([8]);
    vi.advanceTimersByTime(60_000);
    u.dispose();
    expect(latest()[1]).toMatchObject({ pages: 1, words: 900 });
  });

  it('kaydırıcıyla geçilen sayfalar sayılmaz: yalnızca en az 5 sn açık kalan', () => {
    const t = tracker();
    t.pages([1]);
    t.activity();
    vi.advanceTimersByTime(60_000);
    // Kaydırıcı: 2–50 arası sayfalar art arda (her biri 200 ms)
    for (let p = 2; p <= 50; p++) {
      t.pages([p]);
      vi.advanceTimersByTime(200);
    }
    t.pages([51]);
    vi.advanceTimersByTime(DWELL_MS - 1);
    t.pages([52]); // 51 beş saniyeden kısa açıktı
    vi.advanceTimersByTime(60_000);
    t.dispose();
    expect(latest()).toMatchObject([{ pages: 1, words: 5300 }]);
  });

  it('sayfa başına zamanlayıcı kurulmaz', () => {
    const set = vi.fn(() => 1);
    const t = new SessionTracker({
      bookId: 'k',
      save: () => undefined,
      setInterval: set,
      clearInterval: () => undefined,
    });
    t.pages([0]);
    for (let i = 1; i < 50; i++) t.pages([i]);
    expect(set).toHaveBeenCalledTimes(1);
    t.dispose();
  });

  it('kimlik onaltılık ve rastgele', () => {
    const a = randomId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(randomId()).not.toBe(a);
  });
});

describe('sayfanın kelimeleri', () => {
  it('blokların kaynak sayfasına göre sayılır; görsel sayfa ve sahne arası 0', () => {
    expect(
      pageWordCounts([
        { kind: 'heading', level: 1, text: 'Birinci Bölüm', srcPage: 0 },
        { kind: 'para', text: '  bir  iki\nüç ', srcPage: 0 },
        { kind: 'break', srcPage: 1 },
        { kind: 'pageImage', srcPage: 2 },
        { kind: 'note', text: 'dipnot', srcPage: 3 },
      ]),
    ).toEqual(
      new Map([
        [0, 5],
        [3, 1],
      ]),
    );
  });
});
