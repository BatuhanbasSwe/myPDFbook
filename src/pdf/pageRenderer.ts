import { PageCache, type CacheEntry, type Quality, type ShownImage } from './pageCache';
import type { PdfDocument } from './pdfjs';
import { renderPlan, turnDirection, type PlannedRender } from './renderPlan';
import { enqueueRender, renderPageToBlob, renderWaiting, type RenderControl } from './renderPage';

/** Keskin sayfa görüntüsünün en büyük genişliği (cihaz pikseli) */
const SHARP_MAX_WIDTH = 1600;
/** Sayfa en çok bu piksel oranıyla çizilir (iPad 2×; 3× telefonda bellek) */
const MAX_DPR = 2;
/** Önizleme keskin görüntünün bu kadarda biri genişliktedir */
const PREVIEW_DIVISOR = 4;
const PREVIEW_MIN_WIDTH = 120;

/**
 * Bellek bütçesi (sıkıştırılmış JPEG baytı). Ölçüm (Plan 10): iPad'in çift sayfasında keskin sayfa ~170–320 KB,
 * önizleme ~20–30 KB; 200 sayfalık kitabın tamamı ~60 MB. Eski iPad'in belleği için toplam 150 MB'ta durulur; telefonda
 * yarısından azı.
 */
const BUDGET_TABLET: Record<Quality, number> = { sharp: 136e6, preview: 14e6 };
const BUDGET_PHONE: Record<Quality, number> = { sharp: 64e6, preview: 8e6 };
/** Henüz giriş yokken tahmini boy (bütçeye sığar mı) */
const GUESS_BYTES: Record<Quality, number> = { sharp: 350e3, preview: 35e3 };
/** Bırakılan görüntünün adresi bu kadar sonra geri alınır: az önce ekrana verilmiş olabilir */
const REVOKE_DELAY_MS = 10_000;
/** Sayfa çevirme bitince arka plan çizimi bu kadar sonra sürer (çevirmenin ardından gelen çizim önce bitsin) */
const AFTER_TURN_MS = 150;
/** Boşta bekleme olmayan tarayıcıda (Safari) arka plan işleri arası nefes (ms) */
const IDLE_FALLBACK_MS = 40;
/** Atlamada süren arka plan çizimi yeni yere bundan uzaksa bırakılır (sayfa) */
const STILL_NEAR = 6;
const JPEG_QUALITY = 0.85;
/** Takılan çizim (ör. iOS belleği yüzünden ölen worker) çiziciyi durdurmasın: bu kadar sonra bırakılır (ms) */
const STALL_MS = 25_000;

/** Sayfa kutusunun CSS genişliğinden çizim genişliği (cihaz pikseli) */
export function pagePixelWidth(cssWidth: number, dpr = globalThis.devicePixelRatio || 1): number {
  return Math.min(SHARP_MAX_WIDTH, Math.round(cssWidth * Math.min(dpr, MAX_DPR)));
}

export const previewWidth = (sharpWidth: number) =>
  Math.max(PREVIEW_MIN_WIDTH, Math.round(sharpWidth / PREVIEW_DIVISOR));

export interface RenderFocus {
  /** açık PDF sayfaları (0'dan) */
  pages: number[];
  /** PDF'in sayfa sayısı */
  count: number;
  /** keskin çizim genişliği (cihaz pikseli) */
  width: number;
}

interface Job {
  page: number;
  width: number;
  quality: Quality;
}

interface Running extends Job {
  key: string;
  background: boolean;
  abort: AbortController;
  /** sayfa çevrilirken bekletilen pdf.js parçası */
  parked: (() => void) | null;
}

export interface RendererOptions {
  render(job: Job, control: RenderControl): Promise<Blob>;
  budget: Record<Quality, number>;
  createUrl(blob: Blob): string;
  revokeUrl(url: string): void;
  /** boşta çalıştırır; iptal işlevi döner */
  idle(run: () => void): () => void;
  /** sayfa gizli mi (sekme arka planda): arka plan çizimi durur */
  hidden(): boolean;
}

const jobKey = ({ page, width, quality }: Job) => `${quality}:${page}:${width}`;

// Sayfa çevriliyor mu (kıvrılma, kayma): bütün çiziciler için ortak
let turning = false;
const turnListeners = new Set<() => void>();

/** Kitap sayfa çevirirken (animasyon ya da parmakla çekme sürerken) çağrılır: arka plan çizimi bekler. */
export function setPageTurning(on: boolean): void {
  if (turning === on) return;
  turning = on;
  turnListeners.forEach((listener) => listener());
}

/**
 * Bir PDF belgesinin sayfa görüntülerini çizer ve saklar (PageCache). Aynı anda tek pdf.js çizimi (enqueueRender).
 * - Ön plan: ekrandaki ya da yakındaki sayfanın istediği görüntü (`request`), hep önce; okuma yerine en yakın olan önce.
 * - Arka plan: okuma yeri verildiyse (`setFocus`) boşta, tek tek, renderPlan sırasıyla; bütçeye sığmayan uzak sayfa
 *   çizilmez. Sayfa çevrilirken başlamaz, süren çizim parçalar arasında bekler; ön plan isteği ya da başka çizim (ör.
 *   yakınlaştırma) sıra beklerse bırakılır, sonra yeniden denenir.
 */
export class PageRenderer {
  readonly cache: PageCache;
  private readonly options: RendererOptions;
  private foreground = new Map<string, Job & { refs: number; order: number }>();
  private failed = new Set<string>();
  private running: Running | null = null;
  private focus: RenderFocus | null = null;
  private direction: 1 | -1 = 1;
  private plan: PlannedRender[] = [];
  private version = 0;
  private listeners = new Set<() => void>();
  private cancelIdle: (() => void) | null = null;
  private pumpTimer: ReturnType<typeof setTimeout> | undefined;
  private order = 0;
  /** Biten çizimlerin süresi (ölçüm): niteliğe göre toplam ms ve sayı */
  private timing: Record<Quality, { ms: number; n: number }> = {
    sharp: { ms: 0, n: 0 },
    preview: { ms: 0, n: 0 },
  };
  private disposed = false;

  constructor(options: RendererOptions) {
    this.options = options;
    this.cache = new PageCache({
      budget: options.budget,
      createUrl: options.createUrl,
      revokeUrl: options.revokeUrl,
    });
    turnListeners.add(this.onTurn);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = () => this.version;

  /** Gösterilecek en iyi görüntü (aynı genişlikte keskin; yoksa önizleme) */
  best(page: number, width: number): ShownImage | undefined {
    return this.cache.best(page, width);
  }

  /** Sayfa bu genişlikte çizilemedi (bozuk sayfa): yeniden denenmez */
  isFailed(page: number, width: number): boolean {
    return this.failed.has(jobKey({ page, width, quality: 'sharp' }));
  }

  pin(entry: CacheEntry): void {
    this.cache.pin(entry);
  }

  unpin(entry: CacheEntry): void {
    this.cache.unpin(entry);
  }

  /** Sayfanın keskin görüntüsünü ister (ön plan). Dönen işlev isteği geri alır (sayfa uzaklaştı, kaldırıldı). */
  request(page: number, width: number): () => void {
    const job: Job = { page, width, quality: 'sharp' };
    const key = jobKey(job);
    const existing = this.foreground.get(key);
    if (existing) existing.refs++;
    else this.foreground.set(key, { ...job, refs: 1, order: ++this.order });
    const run = this.running;
    if (run?.background) {
      // Aynı sayfa arka planda çiziliyorsa ön plana alınır; başka sayfa çiziliyorsa bırakılır
      if (run.key === key) this.promote(run);
      else run.abort.abort();
    }
    this.schedule();
    return () => {
      const entry = this.foreground.get(key);
      if (!entry) return;
      if (--entry.refs <= 0) this.foreground.delete(key);
    };
  }

  /** Okuma yeri (sayfa görünümü); null: arka planda çizme (metin görünümü, okuyucu kapanıyor) */
  setFocus(focus: RenderFocus | null): void {
    const before = this.focus;
    const same =
      before &&
      focus &&
      before.count === focus.count &&
      before.width === focus.width &&
      before.pages.join() === focus.pages.join();
    if (same || (!before && !focus)) return;
    if (focus && before?.pages.join() !== focus.pages.join())
      this.direction = turnDirection(before?.pages ?? null, focus.pages);
    this.focus = focus;
    this.cache.setFocus(focus && { pages: focus.pages, width: focus.width });
    this.plan = focus ? renderPlan(focus.pages, focus.count, this.direction) : [];
    // Atlamada uzakta kalan arka plan çizimi bırakılır
    const run = this.running;
    if (run?.background && (!focus || this.cache.distance(run.page) > STILL_NEAR))
      run.abort.abort();
    this.schedule();
  }

  stats() {
    return {
      ...this.cache.stats(),
      failed: this.failed.size,
      waiting: this.foreground.size,
      running: this.running
        ? `${this.running.key}${this.running.background ? ' (arka)' : ''}`
        : null,
      /** ortalama çizim süresi (ms; sıra beklemesi hariç) */
      ms: {
        sharp: Math.round(this.timing.sharp.ms / (this.timing.sharp.n || 1)),
        preview: Math.round(this.timing.preview.ms / (this.timing.preview.n || 1)),
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    turnListeners.delete(this.onTurn);
    this.running?.abort.abort();
    this.cancelIdle?.();
    clearTimeout(this.pumpTimer);
    this.foreground.clear();
    this.cache.clear();
    this.listeners.clear();
  }

  private notify() {
    this.version++;
    this.listeners.forEach((listener) => listener());
  }

  private onTurn = () => {
    const run = this.running;
    if (!turning && run?.parked) {
      // Çevirme bitti: bekleyen parça biraz sonra sürer
      const next = run.parked;
      run.parked = null;
      setTimeout(next, AFTER_TURN_MS);
    }
    if (!turning) this.schedule(AFTER_TURN_MS);
  };

  /** Arka plan çizimini ön plana alır: artık beklemez, bırakılmaz */
  private promote(run: Running) {
    run.background = false;
    const next = run.parked;
    run.parked = null;
    next?.();
  }

  /** Sıradaki işi biraz sonra (aynı çizimdeki bütün istekler ve okuma yeri gelince) seçer */
  private schedule(delay = 0) {
    if (this.disposed) return;
    clearTimeout(this.pumpTimer);
    this.pumpTimer = setTimeout(() => this.pump(), delay);
  }

  private pump() {
    if (this.disposed || this.running) return;
    const fg = this.pickForeground();
    if (fg) {
      this.cancelIdle?.();
      this.cancelIdle = null;
      this.run(fg, false);
      return;
    }
    if (!this.focus || turning || this.options.hidden() || this.cancelIdle) return;
    this.cancelIdle = this.options.idle(() => {
      this.cancelIdle = null;
      if (this.disposed || this.running) return;
      if (turning || this.options.hidden()) return;
      const job = this.pickForeground() ?? this.pickBackground();
      if (job) this.run(job, !this.foreground.has(jobKey(job)));
    });
  }

  private pickForeground(): Job | undefined {
    let best: (Job & { order: number }) | undefined;
    let bestDistance = Infinity;
    for (const [key, job] of this.foreground) {
      if (this.failed.has(key) || this.cache.has(job.page, job.width, job.quality)) continue;
      const distance = this.cache.distance(job.page);
      if (distance < bestDistance || (distance === bestDistance && job.order < best!.order)) {
        best = job;
        bestDistance = distance;
      }
    }
    if (!best) return undefined;
    // Açık olmayan (komşu) sayfanın hiç görüntüsü yoksa önce önizlemesi: yavaş cihazda çabuk çevrilirse boş kalmasın
    const small = previewWidth(best.width);
    const preview = { page: best.page, width: small, quality: 'preview' as const };
    if (
      bestDistance > 0 &&
      this.focus &&
      !this.cache.best(best.page, best.width) &&
      !this.failed.has(jobKey(preview))
    )
      return preview;
    return { page: best.page, width: best.width, quality: best.quality };
  }

  private pickBackground(): Job | undefined {
    const focus = this.focus;
    if (!focus) return undefined;
    const small = previewWidth(focus.width);
    let sharpFull = false;
    for (const { page, quality, distance } of this.plan) {
      if (quality === 'sharp' && sharpFull) continue;
      const width = quality === 'sharp' ? focus.width : small;
      const job = { page, width, quality };
      if (this.cache.has(page, width, quality) || this.failed.has(jobKey(job))) continue;
      // Keskin görüntüsü olan sayfanın önizlemesi gereksiz
      if (quality === 'preview' && this.cache.has(page, focus.width, 'sharp')) continue;
      const bytes = this.cache.averageBytes(quality) ?? GUESS_BYTES[quality];
      if (!this.cache.fits(quality, bytes, distance)) {
        // Bundan uzak keskin sayfalar da sığmaz (sıra uzaklığa göre); önizlemeler sürer
        if (quality === 'sharp') sharpFull = true;
        continue;
      }
      return job;
    }
    return undefined;
  }

  private run(job: Job, background: boolean) {
    const key = jobKey(job);
    const run: Running = {
      ...job,
      key,
      background,
      abort: new AbortController(),
      parked: null,
    };
    this.running = run;
    const onContinue = (next: () => void) => {
      if (!run.background) return next();
      // Ön plan isteği ya da başka bir çizim sıra bekliyor: arka plan çizimi bırakılır (sonra yeniden denenir)
      if (this.pickForeground() || renderWaiting()) return run.abort.abort();
      if (turning || this.options.hidden()) run.parked = next;
      else next();
    };
    let stalled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let started = 0;
    enqueueRender(() => {
      if (run.abort.signal.aborted) return Promise.resolve(null);
      started = performance.now();
      timer = setTimeout(() => {
        // Sayfa çevrilirken bekleyen çizim takılmış sayılmaz
        if (run.parked) return;
        stalled = true;
        run.abort.abort();
      }, STALL_MS);
      return this.options.render(job, { signal: run.abort.signal, onContinue });
    })
      .then((blob) => {
        if (!blob || this.disposed) return;
        const t = this.timing[job.quality];
        t.ms += performance.now() - started;
        t.n++;
        this.cache.put(job.page, job.width, job.quality, blob);
        this.notify();
      })
      .catch(() => {
        if ((run.abort.signal.aborted && !stalled) || this.disposed) return;
        this.failed.add(key);
        this.notify();
      })
      .finally(() => {
        clearTimeout(timer);
        if (this.running === run) this.running = null;
        this.schedule();
      });
  }
}

const renderers = new WeakMap<PdfDocument, PageRenderer>();

function defaultBudget(): Record<Quality, number> {
  if (import.meta.env.DEV) {
    // Testte bütçe küçültülebilir (önbelleğin sınırlı kaldığını görmek için)
    const override = (window as { __pageCacheBudget?: Record<Quality, number> }).__pageCacheBudget;
    if (override) return override;
  }
  const phone = Math.min(window.screen?.width || 1024, window.screen?.height || 1024) < 600;
  return phone ? BUDGET_PHONE : BUDGET_TABLET;
}

/** Boşta çalıştırır: requestIdleCallback (Safari'de yok) ya da kısa bir bekleme */
function idle(run: () => void): () => void {
  const w = window as Window & {
    requestIdleCallback?(cb: () => void, opts?: { timeout: number }): number;
    cancelIdleCallback?(handle: number): void;
  };
  if (w.requestIdleCallback && w.cancelIdleCallback) {
    const handle = w.requestIdleCallback(run, { timeout: 500 });
    return () => w.cancelIdleCallback!(handle);
  }
  const timer = setTimeout(run, IDLE_FALLBACK_MS);
  return () => clearTimeout(timer);
}

/** Belgenin çizicisi (ilk istekte kurulur) */
export function pageRenderer(doc: PdfDocument): PageRenderer {
  let renderer = renderers.get(doc);
  if (!renderer) {
    renderer = new PageRenderer({
      render: ({ page, width }, control) =>
        renderPageToBlob(doc, page, width, JPEG_QUALITY, control),
      budget: defaultBudget(),
      createUrl: (blob) => URL.createObjectURL(blob),
      revokeUrl: (url) => setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS),
      idle,
      hidden: () => document.visibilityState === 'hidden',
    });
    renderers.set(doc, renderer);
    if (import.meta.env.DEV) {
      // Testte: önbelleğin durumu (giriş sayısı, bayt)
      const current = renderer;
      (window as { __pageCache?: () => unknown }).__pageCache = () => current.stats();
    }
  }
  return renderer;
}

/** Belgenin kurulmuş çizicisi (kurmaz: belge kapandıysa yoktur) */
export const existingPageRenderer = (doc: PdfDocument) => renderers.get(doc);

/** Belge kapanırken: çizimler bırakılır, önbellek boşaltılır */
export function disposePageRenderer(doc: PdfDocument): void {
  renderers.get(doc)?.dispose();
  renderers.delete(doc);
}

if (typeof document !== 'undefined') {
  // Sekme yeniden görününce arka plan çizimi sürer
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') turnListeners.forEach((listener) => listener());
  });
}
