import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BookRecord, SessionRecord } from '../../src/db/db';
import {
  bookTotals,
  dailyTotals,
  dayKey,
  estimateMs,
  finishedInYear,
  formatDuration,
  formatEstimate,
  heatLevel,
  heatmap,
  pace,
  readingPace,
  roundPace,
  startOfDay,
  streaks,
  weekDays,
} from '../../src/stats/aggregate';

const MIN = 60_000;
let n = 0;
/** Yerel saatle oturum: başlangıç [yıl, ay (1'den), gün, saat, dakika], süre dakika */
function session(
  [y, mo, d, h = 12, mi = 0]: number[],
  minutes: number,
  extra: Partial<SessionRecord> = {},
): SessionRecord {
  const start = new Date(y, mo - 1, d, h, mi).getTime();
  return {
    id: `s${++n}`,
    bookId: 'a',
    start,
    end: start + minutes * MIN,
    activeMs: minutes * MIN,
    pages: 0,
    words: 0,
    ...extra,
  };
}
const at = (y: number, mo: number, d: number, h = 12) => new Date(y, mo - 1, d, h).getTime();

/** Testler iki saat diliminde koşar: gün sınırları yerel saate göredir */
for (const tz of ['Europe/Istanbul', 'America/New_York']) {
  describe(`istatistik hesapları (${tz})`, () => {
    let before: string | undefined;
    beforeAll(() => {
      before = process.env.TZ;
      process.env.TZ = tz;
    });
    afterAll(() => {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    });

    it('saat dilimi gerçekten değişti', () => {
      const offset = new Date(Date.UTC(2026, 0, 15)).getTimezoneOffset();
      expect(offset).toBe(tz === 'Europe/Istanbul' ? -180 : 300);
    });

    it('gün anahtarı yerel tarihtir', () => {
      expect(dayKey(new Date(2026, 9, 2, 0, 5))).toBe('2026-10-02');
      expect(dayKey(new Date(2026, 9, 1, 23, 59))).toBe('2026-10-01');
    });

    it('gece yarısını aşan oturum iki güne orantılı bölünür', () => {
      const days = dailyTotals([session([2026, 10, 1, 23, 40], 40)]);
      expect(days.get('2026-10-01')).toBeCloseTo(20 * MIN);
      expect(days.get('2026-10-02')).toBeCloseTo(20 * MIN);
    });

    it('duraklı oturumda okunan süre duvar saatine göre paylaştırılır', () => {
      // 23:30–00:30 arası, 30 dk okundu
      const s = session([2026, 10, 1, 23, 30], 60, { activeMs: 30 * MIN });
      const days = dailyTotals([s]);
      expect(days.get('2026-10-01')).toBeCloseTo(15 * MIN);
      expect(days.get('2026-10-02')).toBeCloseTo(15 * MIN);
    });

    it('yaz saati değişen gün de bir gündür', () => {
      // ABD'de 8 Mart 2026 ve 1 Kasım 2026 (Türkiye'de değişmez)
      const days = dailyTotals([
        session([2026, 3, 7, 23, 0], 120),
        session([2026, 11, 1, 23, 30], 60),
      ]);
      expect(days.get('2026-03-07')).toBeGreaterThan(0);
      expect(days.get('2026-03-08')).toBeGreaterThan(0);
      const total = [...days.values()].reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(180 * MIN);
      expect(startOfDay(at(2026, 3, 8), 1)).toBe(new Date(2026, 2, 9).getTime());
    });

    it('seri: art arda günler; bugün okunmadıysa dünden sürer', () => {
      const daily = dailyTotals([
        session([2026, 9, 20], 30),
        session([2026, 9, 21], 30),
        session([2026, 9, 22], 30),
        session([2026, 9, 23], 30),
        // ara
        session([2026, 9, 29], 10),
        session([2026, 9, 30], 10),
        session([2026, 10, 1], 10),
      ]);
      expect(streaks(daily, at(2026, 10, 1))).toEqual({ current: 3, best: 4 });
      // 2 Ekim'de henüz okunmadı: seri bozulmaz
      expect(streaks(daily, at(2026, 10, 2))).toEqual({ current: 3, best: 4 });
      // 3 Ekim: dün de okunmadı, seri biter
      expect(streaks(daily, at(2026, 10, 3))).toEqual({ current: 0, best: 4 });
    });

    it('seri ay ve yıl sınırını aşar; bir dakikadan kısa gün sayılmaz', () => {
      const daily = dailyTotals([
        session([2025, 12, 31], 5),
        session([2026, 1, 1], 5),
        session([2026, 1, 2, 9], 0.5),
      ]);
      expect(streaks(daily, at(2026, 1, 2))).toEqual({ current: 2, best: 2 });
    });

    it('hafta pazartesi başlar', () => {
      // 2 Ekim 2026 cuma
      const week = weekDays(dailyTotals([session([2026, 9, 28], 25)]), at(2026, 10, 2));
      expect(week.map((d) => d.key)).toEqual([
        '2026-09-28',
        '2026-09-29',
        '2026-09-30',
        '2026-10-01',
        '2026-10-02',
        '2026-10-03',
        '2026-10-04',
      ]);
      expect(week[0].ms).toBe(25 * MIN);
    });

    it('ısı haritası: 53 hafta, son sütun bu hafta, dilimler hedefe göre', () => {
      const goal = 20 * MIN;
      const grid = heatmap(
        dailyTotals([session([2026, 10, 1], 5), session([2026, 10, 2], 45)]),
        at(2026, 10, 2),
        goal,
      );
      expect(grid).toHaveLength(53);
      expect(grid.every((w) => w.length === 7)).toBe(true);
      const last = grid[52];
      expect(last[0].key).toBe('2026-09-28');
      expect(last[3]).toMatchObject({ key: '2026-10-01', level: 1, future: false });
      expect(last[4]).toMatchObject({ key: '2026-10-02', level: 4, future: false });
      expect(last[5].future).toBe(true);
      expect(grid[0][0].key).toBe(dayKey(new Date(2025, 8, 29)));
    });

    it('ısı dilimleri', () => {
      const g = 20 * MIN;
      expect(heatLevel(0, g)).toBe(0);
      expect(heatLevel(30_000, g)).toBe(0);
      expect(heatLevel(5 * MIN, g)).toBe(1);
      expect(heatLevel(10 * MIN, g)).toBe(2);
      expect(heatLevel(20 * MIN, g)).toBe(3);
      expect(heatLevel(40 * MIN, g)).toBe(4);
    });
  });
}

describe('hız ve tahmin', () => {
  it('hız: sayfa/dk ve kelime/dk; az veride yok', () => {
    expect(pace([{ activeMs: 4 * MIN, pages: 10, words: 3000 }]).pagesPerMin).toBeNull();
    expect(pace([{ activeMs: 10 * MIN, pages: 2, words: 600 }]).pagesPerMin).toBeNull();
    const p = pace([
      { activeMs: 6 * MIN, pages: 3, words: 900 },
      { activeMs: 4 * MIN, pages: 2, words: 600 },
    ]);
    expect(p.pagesPerMin).toBeCloseTo(0.5);
    expect(p.wordsPerMin).toBeCloseTo(150);
  });

  it('tahmin önce bu kitabın hızıyla, yoksa genel hızla; veri yoksa yok', () => {
    const sessions: SessionRecord[] = [
      { id: '1', bookId: 'a', start: 0, end: 1, activeMs: 10 * MIN, pages: 10, words: 0 },
      { id: '2', bookId: 'b', start: 0, end: 1, activeMs: 10 * MIN, pages: 5, words: 0 },
    ];
    expect(readingPace(sessions, 'a')).toBeCloseTo(1);
    expect(readingPace(sessions, 'b')).toBeCloseTo(0.5);
    // c'nin verisi yok: genel hız
    expect(readingPace(sessions, 'c')).toBeCloseTo(0.75);
    expect(readingPace([], 'c')).toBeNull();
  });

  it('hız: dakikada 6 sayfadan hızlı oturum (kaydırıcı) hıza girmez; hız 6 sayfa/dk’yı aşmaz', () => {
    const p = pace([
      { activeMs: 10 * MIN, pages: 5, words: 1500 },
      // 1 dakikada 40 sayfa: aykırı
      { activeMs: MIN, pages: 40, words: 12_000 },
    ]);
    expect(p.pagesPerMin).toBeCloseTo(0.5);
    expect(p.wordsPerMin).toBeCloseTo(150);
    // Toplamlar bütün oturumlardan
    expect(p).toMatchObject({ activeMs: 11 * MIN, pages: 45 });
    expect(pace([{ activeMs: 5 * MIN, pages: 30, words: 0 }]).pagesPerMin).toBe(6);
    expect(pace([{ activeMs: MIN, pages: 200, words: 0 }]).pagesPerMin).toBeNull();
  });

  it('hız iki anlamlı basamağa yuvarlanır (okuyucu her dakika yeniden çizilmesin)', () => {
    expect(roundPace(0.6347)).toBe(0.63);
    expect(roundPace(1.234)).toBe(1.2);
    expect(roundPace(null)).toBeNull();
  });

  it('bozuk oturum günlere dağıtılırken döngüye girmez: aralık 24 saatle, süre aralıkla sınırlı', () => {
    const start = new Date(2026, 9, 1, 12).getTime();
    const days = dailyTotals([
      {
        id: 'x',
        bookId: 'a',
        start,
        end: start + 400 * 86_400_000,
        activeMs: 1e12,
        pages: 0,
        words: 0,
      },
      { id: 'y', bookId: 'a', start: NaN, end: NaN, activeMs: MIN, pages: 0, words: 0 },
    ]);
    const total = [...days.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(24 * 60 * MIN);
    expect(days.size).toBe(2);
  });

  it('kalan süre ve biçimi', () => {
    expect(estimateMs(8, 1)).toBe(8 * MIN);
    expect(estimateMs(8, null)).toBeNull();
    expect(formatEstimate(8 * MIN)).toBe('~8 dk');
    expect(formatEstimate((3 * 60 + 20) * MIN)).toBe('~3 sa 20 dk');
    expect(formatEstimate(120 * MIN)).toBe('~2 sa');
    expect(formatEstimate(20_000)).toBe("1 dk'dan az");
    expect(formatDuration(0)).toBe('0 dk');
  });

  it('kitap başına toplamlar ve bu yıl biten kitaplar', () => {
    const t = bookTotals([
      { id: '1', bookId: 'a', start: 0, end: 50, activeMs: MIN, pages: 1, words: 10 },
      { id: '2', bookId: 'a', start: 60, end: 90, activeMs: 2 * MIN, pages: 2, words: 20 },
    ]);
    expect(t.get('a')).toEqual({
      activeMs: 3 * MIN,
      sessions: 2,
      pages: 3,
      words: 30,
      lastRead: 90,
    });
    const book = (id: string, extra: Partial<BookRecord>) => ({ id, ...extra }) as BookRecord;
    const done = finishedInYear(
      [
        book('x', { readingStatus: 'finished', finishedAt: at(2026, 3, 1) }),
        book('y', { readingStatus: 'finished', finishedAt: at(2025, 12, 31) }),
        book('z', { readingStatus: 'reading', finishedAt: at(2026, 3, 1) }),
        book('w', { readingStatus: 'finished', finishedAt: at(2026, 1, 1) }),
      ],
      at(2026, 10, 2),
    );
    expect(done.map((b) => b.id)).toEqual(['w', 'x']);
  });
});
