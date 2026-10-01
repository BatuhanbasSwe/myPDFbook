/** Sayfa görüntüsünün niteliği: ekrandaki keskin görüntü ya da küçük ölçekli önizleme */
export type Quality = 'sharp' | 'preview';

export interface CacheEntry {
  /** PDF sayfası (0'dan) */
  page: number;
  /** çizim genişliği (cihaz pikseli) */
  width: number;
  quality: Quality;
  url: string;
  /** sıkıştırılmış görüntünün boyu (bayt): bütçe bununla sayılır */
  bytes: number;
  /** ekranda gösteren sayfa sayısı: iğnelenmiş giriş çıkarılmaz */
  pins: number;
  /** son kullanım sırası (eşit uzaklıkta önce en eski çıkar) */
  used: number;
}

/** Okuma yeri: açık sayfalar ve keskin çizim genişliği (bunun dışındaki genişlikler eskimiştir) */
export interface CacheFocus {
  pages: number[];
  width: number;
}

export interface PageCacheOptions {
  /** bayt bütçesi, niteliğe göre ayrı */
  budget: Record<Quality, number>;
  createUrl(blob: Blob): string;
  /** çıkarılan girişin adresi: ekrana az önce verilmiş olabilir, çağıran biraz sonra bırakabilir */
  revokeUrl(url: string): void;
}

/** Gösterilecek en iyi görüntü: aynı genişlikte keskin; yoksa (önizleme gibi) başka genişlikte keskin ya da önizleme */
export interface ShownImage {
  url: string;
  quality: Quality;
  entry: CacheEntry;
}

const key = (page: number, width: number, quality: Quality) => `${quality}:${page}:${width}`;

/**
 * Çizilmiş sayfa görüntülerinin bellekteki önbelleği. Görüntüler sıkıştırılmış (JPEG) Blob olarak durur; boyları bayt
 * olarak sayılır, bütçe aşılınca okuma yerine en uzak giriş çıkar (uzaklık eşitse en eski kullanılan). Okuma yerinin
 * genişliğinden farklı genişlikte çizilmiş keskin girişler (ekran döndü, boyut değişti) önce çıkar. Ekranda gösterilen
 * (iğnelenmiş) giriş hiç çıkmaz.
 */
export class PageCache {
  private entries = new Map<string, CacheEntry>();
  private bytes: Record<Quality, number> = { sharp: 0, preview: 0 };
  private clock = 0;
  private focus: CacheFocus | null = null;
  private readonly options: PageCacheOptions;

  constructor(options: PageCacheOptions) {
    this.options = options;
  }

  setFocus(focus: CacheFocus | null): void {
    this.focus = focus;
  }

  /** Sayfanın okuma yerine uzaklığı (sayfa); okuma yeri yoksa 0 */
  distance(page: number): number {
    const pages = this.focus?.pages;
    if (!pages?.length) return 0;
    return Math.min(...pages.map((p) => Math.abs(page - p)));
  }

  get(page: number, width: number, quality: Quality): CacheEntry | undefined {
    return this.entries.get(key(page, width, quality));
  }

  has(page: number, width: number, quality: Quality): boolean {
    return this.entries.has(key(page, width, quality));
  }

  /** Gösterilecek en iyi görüntü (bkz. ShownImage); yoksa undefined */
  best(page: number, width: number): ShownImage | undefined {
    const exact = this.get(page, width, 'sharp');
    if (exact) return this.touch({ url: exact.url, quality: 'sharp', entry: exact });
    // Başka genişlikteki keskin (ör. ekran döndü): en yakın genişlik, önizleme yerine
    let other: CacheEntry | undefined;
    let preview: CacheEntry | undefined;
    for (const e of this.entries.values()) {
      if (e.page !== page) continue;
      if (e.quality === 'preview') preview = e;
      else if (!other || Math.abs(e.width - width) < Math.abs(other.width - width)) other = e;
    }
    const found = other ?? preview;
    return found && this.touch({ url: found.url, quality: 'preview', entry: found });
  }

  /** Girişi ekler (aynısı varsa yenisiyle değiştirir) ve bütçeye sığdırır. */
  put(page: number, width: number, quality: Quality, blob: Blob): CacheEntry {
    const k = key(page, width, quality);
    const old = this.entries.get(k);
    if (old) this.remove(k, old);
    const entry: CacheEntry = {
      page,
      width,
      quality,
      url: this.options.createUrl(blob),
      bytes: blob.size,
      pins: 0,
      used: ++this.clock,
    };
    this.entries.set(k, entry);
    this.bytes[quality] += entry.bytes;
    this.fit(quality, entry);
    return entry;
  }

  /**
   * Okuma yerine `distance` uzaklıktaki yeni bir giriş (`bytes` boyunda) bütçeye sığar mı: yer varsa ya da ondan daha
   * uzak (ya da eskimiş) yeterince giriş çıkarılabiliyorsa. Sığmıyorsa arka planda çizilmez.
   */
  fits(quality: Quality, bytes: number, distance: number): boolean {
    let free = this.options.budget[quality] - this.bytes[quality];
    if (free >= bytes) return true;
    for (const e of this.entries.values()) {
      if (e.quality !== quality || e.pins > 0) continue;
      if (this.stale(e) || this.distance(e.page) > distance) free += e.bytes;
      if (free >= bytes) return true;
    }
    return false;
  }

  /** Bu niteliğin ortalama giriş boyu (henüz giriş yoksa undefined) */
  averageBytes(quality: Quality): number | undefined {
    let n = 0;
    for (const e of this.entries.values()) if (e.quality === quality) n++;
    return n ? this.bytes[quality] / n : undefined;
  }

  pin(entry: CacheEntry): void {
    entry.pins++;
  }

  unpin(entry: CacheEntry): void {
    entry.pins = Math.max(0, entry.pins - 1);
    // İğnesi kalkan giriş bütçeyi aşıyorsa şimdi çıkabilir
    if (entry.pins === 0) this.fit(entry.quality);
  }

  /** Durum (testler ve ölçüm): giriş sayısı, bayt, hangi sayfalar */
  stats() {
    const pages: Record<Quality, number[]> = { sharp: [], preview: [] };
    // Ekranda gösterilen girişler bütçeyi aşabilir (çıkarılamaz)
    const pinnedBytes: Record<Quality, number> = { sharp: 0, preview: 0 };
    for (const e of this.entries.values()) {
      pages[e.quality].push(e.page);
      if (e.pins > 0) pinnedBytes[e.quality] += e.bytes;
    }
    return {
      entries: this.entries.size,
      sharp: pages.sharp.length,
      preview: pages.preview.length,
      pages,
      pinnedBytes,
      sharpBytes: this.bytes.sharp,
      previewBytes: this.bytes.preview,
      bytes: this.bytes.sharp + this.bytes.preview,
      budget: this.options.budget.sharp + this.options.budget.preview,
    };
  }

  clear(): void {
    for (const [k, e] of this.entries) this.remove(k, e);
  }

  /** Eskimiş giriş: okuma yerinin genişliğinden farklı genişlikte çizilmiş keskin görüntü */
  private stale(e: CacheEntry): boolean {
    return e.quality === 'sharp' && !!this.focus && e.width !== this.focus.width;
  }

  private touch(shown: ShownImage): ShownImage {
    shown.entry.used = ++this.clock;
    return shown;
  }

  /** Bütçe aşılmışsa iğnelenmemiş girişleri çıkarır: önce eskimiş, sonra en uzak, eşitse en eski kullanılan */
  private fit(quality: Quality, keep?: CacheEntry): void {
    const budget = this.options.budget[quality];
    if (this.bytes[quality] <= budget) return;
    const candidates = [...this.entries]
      .filter(([, e]) => e.quality === quality && e.pins === 0 && e !== keep)
      .sort(([, a], [, b]) => {
        const staleness = Number(this.stale(b)) - Number(this.stale(a));
        if (staleness) return staleness;
        return this.distance(b.page) - this.distance(a.page) || a.used - b.used;
      });
    for (const [k, e] of candidates) {
      if (this.bytes[quality] <= budget) return;
      this.remove(k, e);
    }
  }

  private remove(k: string, e: CacheEntry): void {
    this.entries.delete(k);
    this.bytes[e.quality] -= e.bytes;
    this.options.revokeUrl(e.url);
  }
}
