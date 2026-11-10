import type { SessionRecord } from '../db/db';

/** Bu kadar etkinlik olmazsa okuma durmuş sayılır (ms): süre son etkinlikten bu kadar sonrasına dek işler */
export const IDLE_MS = 2 * 60_000;
/** Bundan kısa oturum kaydedilmez (göz atma) */
export const MIN_ACTIVE_MS = 30_000;
/** Süren oturum bu aralıkla yazılır: iPad sekmeyi habersiz kapatsa da okunan süre kaybolmasın */
export const SAVE_EVERY_MS = 60_000;
/** Boşta kalma bu aralıkla denetlenir (ms): olay başına zamanlayıcı kurulmaz */
export const CHECK_EVERY_MS = 15_000;
/**
 * Sayfa en az bu kadar açık kaldıysa okunmuş sayılır (ms): kaydırıcıyla ya da art arda çevirerek geçilen sayfalar
 * sayılmaz
 */
export const DWELL_MS = 5_000;

export interface TrackerOptions {
  bookId: string;
  /** oturumu yazar (aynı kimlikle yeniden çağrılır: güncellenir) */
  save(session: SessionRecord): void;
  now?: () => number;
  newId?: () => string;
  /** zamanlayıcılar (testlerde sahte) */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
}

interface Current {
  id: string;
  start: number;
  /** son etkinlik (sesli ya da hızlı okuma sürerken sürekli yenilenir) */
  last: number;
  /** okunmuş sayılan sayfalar */
  pages: Set<number>;
  /** oturum başlarken açık olan sayfalar: bu oturumda okunmuş sayılmaz */
  skip: Set<number>;
  words: number;
  /** son yazılan süre (değişmediyse yeniden yazılmaz) */
  savedMs: number;
}

/**
 * Okuma oturumlarını izler. Okuyucu görünürken okurun etkinliği (sayfa çevirme, dokunma, kalem, tuş, kaydırma) ya
 * da süren sesli/hızlı okuma süreyi işletir. 2 dk etkinlik olmazsa oturum biter (süre son etkinlikten 2 dk
 * sonrasına dek sayılır: uzun bir sayfa da okunur). Sekme gizlenince ya da okuyucu kapanınca oturum o an biter.
 * 30 sn'den kısa oturum yazılmaz. Etkinlik yalnızca bir zaman yazar: sayfa başına iş yoktur.
 *
 * Okunan sayfa: oturumda en az 5 sn açık kalmış sayfa (sayfadan çıkılınca ya da oturum bitince sayılır).
 * Okuyucu açılırken gelen ilk sayfalar ve oturum başladığında açık olanlar o oturumda sayılmaz.
 */
export class SessionTracker {
  private readonly opts: TrackerOptions;
  private readonly now: () => number;
  private current: Current | null = null;
  private visible = true;
  private playing = false;
  private timer: unknown = null;
  /** açık sayfalar ve açıldıkları an */
  private shown: number[] = [];
  private shownAt = 0;
  /** okuyucu açıldıktan sonra sayfalar geldi mi (ilk gelenler başlangıçtır, okunmuş sayılmaz) */
  private hasPages = false;
  private wordsOf: (page: number) => number = () => 0;
  private disposed = false;

  constructor(opts: TrackerOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  /** PDF sayfasının kelime sayısı (okunan kelimeler için) */
  setWords(wordsOf: (page: number) => number): void {
    this.wordsOf = wordsOf;
  }

  /** Okurun etkinliği: oturum yoksa başlar */
  activity(): void {
    if (this.disposed || !this.visible) return;
    const now = this.now();
    const c = this.current;
    if (c && now - c.last > IDLE_MS && !this.playing) this.end(c.last + IDLE_MS);
    if (!this.current) this.begin(now);
    else this.current.last = now;
  }

  /**
   * Açık PDF sayfaları değişti (sayfa çevrildi, atlandı). Çıkılan sayfalar en az 5 sn açık kaldıysa okunmuş sayılır.
   * Okuyucu açıldıktan sonraki ilk sayfalar başlangıçtır: etkinlik değildir, o oturumda okunmuş sayılmaz (etkinlik
   * önce gelse de).
   */
  pages(shown: readonly number[]): void {
    const changed = shown.length !== this.shown.length || shown.some((p, i) => p !== this.shown[i]);
    if (!changed) return;
    if (!this.hasPages) {
      this.hasPages = true;
      this.shown = [...shown];
      this.shownAt = this.now();
      for (const p of shown) this.current?.skip.add(p);
      return;
    }
    // Oturum bu çevirmeyle başlarsa önceki sayfalar onun başlangıcıdır (okunmuş sayılmaz)
    this.activity();
    const now = this.now();
    if (this.current) this.credit(this.current, now);
    this.shown = [...shown];
    this.shownAt = now;
  }

  /** Sesli ya da hızlı okuma sürüyor mu: sürerken okur dokunmasa da süre işler */
  setPlaying(on: boolean): void {
    if (on === this.playing) return;
    if (on) {
      this.activity();
      this.playing = true;
    } else {
      // Okuma durduğu an son etkinlik sayılır
      if (this.current) this.current.last = this.now();
      this.playing = false;
    }
  }

  /** Sekme görünür ya da gizli: gizlenince oturum biter ve yazılır */
  setVisible(on: boolean): void {
    if (on === this.visible) return;
    if (!on) {
      this.stop();
      this.visible = false;
    } else {
      this.visible = true;
      this.activity();
    }
  }

  /** Oturumu bitirir ve yazar (sayfa kapanıyor, sekme gizlendi) */
  stop(): void {
    const c = this.current;
    if (!c) return;
    const now = this.now();
    this.end(this.playing ? now : Math.min(now, c.last + IDLE_MS));
  }

  /** Okuyucu kapandı: oturum biter, zamanlayıcı durur */
  dispose(): void {
    this.stop();
    this.disposed = true;
  }

  private begin(now: number): void {
    const newId = this.opts.newId ?? randomId;
    this.current = {
      id: newId(),
      start: now,
      last: now,
      pages: new Set(),
      // Açık sayfalar oturumdan önce açılmıştı: bu oturumda okunmuş sayılmaz (sonra açılanlar sayılır)
      skip: new Set(this.shown),
      words: 0,
      savedMs: 0,
    };
    this.startTimer();
  }

  /** Açık sayfalar oturumda `until`'e dek en az 5 sn açık kaldıysa okunmuş sayılır */
  private credit(c: Current, until: number): void {
    if (until - Math.max(this.shownAt, c.start) < DWELL_MS) return;
    for (const p of this.shown) {
      if (c.skip.has(p) || c.pages.has(p)) continue;
      c.pages.add(p);
      c.words += this.wordsOf(p);
    }
  }

  private end(at: number): void {
    const c = this.current;
    if (!c) return;
    this.current = null;
    this.stopTimer();
    this.credit(c, at);
    this.write(c, at);
  }

  private write(c: Current, end: number): void {
    const activeMs = Math.max(0, end - c.start);
    if (activeMs < MIN_ACTIVE_MS) return;
    c.savedMs = activeMs;
    this.opts.save({
      id: c.id,
      bookId: this.opts.bookId,
      start: c.start,
      end,
      activeMs,
      pages: c.pages.size,
      words: c.words,
    });
  }

  /** Düzenli denetim: boşta kaldıysa oturum biter; sürüyorsa dakikada bir yazılır */
  private tick = (): void => {
    const c = this.current;
    if (!c) return;
    const now = this.now();
    if (this.playing) c.last = now;
    if (now - c.last > IDLE_MS) {
      this.end(c.last + IDLE_MS);
      return;
    }
    if (now - c.start - c.savedMs >= SAVE_EVERY_MS) this.write(c, now);
  };

  private startTimer(): void {
    if (this.timer !== null) return;
    const set = this.opts.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.timer = set(this.tick, CHECK_EVERY_MS);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    const clear = this.opts.clearInterval ?? ((id) => clearInterval(id as number));
    clear(this.timer);
    this.timer = null;
  }
}

/** 16 baytlık rastgele kimlik (onaltılık). `crypto.randomUUID` eski Safari'de yok; `getRandomValues` var. */
export function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
