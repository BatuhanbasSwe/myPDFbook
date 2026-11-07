import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Quality } from '../../src/pdf/pageCache';
import { PageRenderer, setPageTurning, type RendererOptions } from '../../src/pdf/pageRenderer';
import type { RenderControl } from '../../src/pdf/renderPage';

interface Call {
  job: string;
  control: RenderControl;
  finish(bytes?: number): void;
  fail(): void;
}

/** Elle bitirilen çizimler: her çizim bir Call; `finish` bitirir */
/** Keskin sayfa 400 KB, önizleme 30 KB (gerçeğe yakın: çizicinin ilk tahmini 350 / 35 KB) */
const SHARP = 400e3;
const PREVIEW = 30e3;

function setup(
  budget: Record<Quality, number> = { sharp: 100e6, preview: 10e6 },
  extra: Partial<RendererOptions> = {},
) {
  const calls: Call[] = [];
  const render: RendererOptions['render'] = (job, control) =>
    new Promise<Blob>((resolve, reject) => {
      control.signal?.addEventListener('abort', () =>
        reject(new DOMException('bırakıldı', 'AbortError')),
      );
      calls.push({
        job: `${job.quality === 'sharp' ? 'S' : 'p'}${job.page}`,
        control,
        finish: (bytes = job.quality === 'sharp' ? SHARP : PREVIEW) =>
          resolve(new Blob([new Uint8Array(bytes)])),
        fail: () => reject(new Error('bozuk')),
      });
    });
  let n = 0;
  const renderer = track(
    new PageRenderer({
      render,
      budget,
      createUrl: () => `blob:${++n}`,
      revokeUrl: () => undefined,
      idle: (run) => {
        const t = setTimeout(run, 0);
        return () => clearTimeout(t);
      },
      hidden: () => false,
      ...extra,
    }),
  );
  /** Sıradaki çizim başlayana dek bekler */
  const next = async (count = calls.length + 1) => {
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(count));
    return calls[count - 1]!;
  };
  return { renderer, calls, next };
}

const WIDTH = 800;

// Biten testin süren çizimi bırakılır: çizim sırası (enqueueRender) ortak, sonraki testi bekletmesin
const live: PageRenderer[] = [];
const track = (r: PageRenderer) => (live.push(r), r);
afterEach(() => {
  setPageTurning(false);
  live.splice(0).forEach((r) => r.dispose());
});

describe('PageRenderer', () => {
  it('ön plan isteği (açık sayfa) önce; sonra arka planda okuma yönünde', async () => {
    const { renderer, next } = setup();
    renderer.setFocus({ pages: [4, 5], count: 20, width: WIDTH });
    renderer.request(5, WIDTH);
    renderer.request(4, WIDTH);
    const first = await next();
    expect(first.job).toBe('S5'); // ikisi de açık (eşit uzaklık): önce istenen
    first.finish();
    const second = await next();
    expect(second.job).toBe('S4');
    second.finish();
    // Arka plan: yakın önizlemeler, sonra keskin sonraki sayfalar
    const third = await next();
    expect(third.job).toBe('p6');
    expect(renderer.best(4, WIDTH)?.quality).toBe('sharp');
  });

  it('ön plan isteği gelince süren arka plan çizimi bırakılır ve istenen sayfa çizilir', async () => {
    const { renderer, next } = setup();
    renderer.setFocus({ pages: [0], count: 20, width: WIDTH });
    renderer.request(0, WIDTH);
    (await next()).finish();
    const background = await next();
    expect(background.job).toBe('p1');
    // Komşu sayfa ekrana yaklaştı: önce önizlemesi yoksa önizleme... ama önce süren iş bırakılır
    renderer.request(9, WIDTH);
    expect(background.control.signal?.aborted).toBe(true);
    const fg = await next();
    // Görüntüsü olmayan komşu sayfanın önce önizlemesi çizilir
    expect(fg.job).toBe('p9');
    fg.finish();
    expect((await next()).job).toBe('S9');
  });

  it('sayfa çevrilirken arka plan çizimi başlamaz, süren çizim parçalar arasında bekler', async () => {
    const { renderer, calls, next } = setup();
    renderer.setFocus({ pages: [0], count: 20, width: WIDTH });
    const bg = await next();
    expect(bg.job).toBe('S0'); // açık sayfa arka planda da önce
    setPageTurning(true);
    const resume = vi.fn();
    bg.control.onContinue!(resume);
    expect(resume).not.toHaveBeenCalled();
    setPageTurning(false);
    await vi.waitFor(() => expect(resume).toHaveBeenCalled());
    // Bitti; çevirme yeniden başladı: yeni iş başlamaz
    setPageTurning(true);
    bg.finish();
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toHaveLength(1);
    setPageTurning(false);
    expect((await next()).job).toBe('p1');
  });

  it('bütçeye sığmayan uzak keskin sayfa çizilmez (önizlemeler sürer)', async () => {
    const { renderer, calls, next } = setup({ sharp: 3 * SHARP, preview: 10e6 });
    renderer.setFocus({ pages: [0], count: 8, width: WIDTH });
    // Hepsini bitirerek ilerle; iş kalmayınca durur
    for (let i = 1; ; i++) {
      const pending = next(i).catch(() => null);
      const call = await Promise.race([
        pending,
        new Promise<null>((r) => setTimeout(() => r(null), 200)),
      ]);
      if (!call) break;
      call.finish();
    }
    const sharp = calls.filter((c) => c.job.startsWith('S')).map((c) => c.job);
    // 3 keskin sayfa sığar: açık sayfa ve en yakın ikisi
    expect(sharp).toEqual(['S0', 'S1', 'S2']);
    expect(renderer.stats()).toMatchObject({ sharp: 3, sharpBytes: 3 * SHARP });
    // Keskin görüntüsü olmayan sayfaların hepsinin önizlemesi var
    expect(renderer.stats().preview).toBe(7);
  });

  it('uzağa atlayınca süren uzak arka plan çizimi bırakılır, sıra yeni yerden', async () => {
    const { renderer, next } = setup();
    renderer.setFocus({ pages: [0], count: 100, width: WIDTH });
    const bg = await next();
    renderer.setFocus({ pages: [60, 61], count: 100, width: WIDTH });
    expect(bg.control.signal?.aborted).toBe(true);
    expect((await next()).job).toBe('S60');
  });

  it('çizilemeyen sayfa yeniden denenmez, bozuk sayılır', async () => {
    const { renderer, next } = setup();
    renderer.request(3, WIDTH);
    (await next()).fail();
    await vi.waitFor(() => expect(renderer.isFailed(3, WIDTH)).toBe(true));
  });

  it('ilerlemeyen çizim takılmış sayılır; yavaş ama ilerleyen çizim bırakılmaz', async () => {
    const { renderer, next } = setup(undefined, { stallMs: 200 });
    // İlerlemiyor: bırakılır, sayfa çizilemedi sayılır
    renderer.request(3, WIDTH);
    const stuck = await next();
    await vi.waitFor(() => expect(renderer.isFailed(3, WIDTH)).toBe(true));
    expect(stuck.control.signal?.aborted).toBe(true);
    // Yavaş ama her 50 ms'de bir parça: süresi takılma süresini aşsa da biter
    renderer.request(4, WIDTH);
    const slow = await next();
    const ticks = setInterval(() => slow.control.onContinue?.(() => undefined), 50);
    await new Promise((r) => setTimeout(r, 600));
    clearInterval(ticks);
    expect(slow.control.signal?.aborted).toBe(false);
    slow.finish();
    await vi.waitFor(() => expect(renderer.best(4, WIDTH)?.quality).toBe('sharp'));
    expect(renderer.isFailed(4, WIDTH)).toBe(false);
  });
});
