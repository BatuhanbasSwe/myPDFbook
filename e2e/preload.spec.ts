import { expect, test, type Page } from '@playwright/test';
import { flipSettled, importFixture, statusPages, turnNextPage } from './helpers';

/** 60 sayfalık test kitabı (scripts/make-fixtures.ts → long-tr.pdf) */
const LONG = ['long-tr.pdf', 'Uzun Yol.pdf'] as const;

interface CacheStats {
  sharp: number;
  preview: number;
  sharpBytes: number;
  previewBytes: number;
  pages: { sharp: number[]; preview: number[] };
  pinnedBytes: { sharp: number; preview: number };
}

/** Sayfa önbelleğinin durumu (pdf/pageRenderer.ts, yalnızca geliştirmede) */
const cacheStats = (page: Page) =>
  page.evaluate(() => (window as { __pageCache?: () => CacheStats }).__pageCache?.() ?? null);

async function openLong(page: Page) {
  await page.goto('/');
  await importFixture(page, ...LONG);
  await page.getByTestId('book-open').click();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
}

/**
 * Görünen sayfa kutularının durumunu her karede ve her değişiklikte kaydeder: bir sayfa "loading" (ne keskin görüntü
 * ne önizleme) göründü mü
 */
async function watchStates(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as { __seen?: string[] }).__seen = seen;
    const record = () => {
      for (const el of document.querySelectorAll<HTMLElement>(
        '[data-testid="flipbook"] [data-pdf-page] .page-image',
      )) {
        // Kitabın gizlediği (görünmeyen) sayfa sayılmaz
        if (!el.getClientRects().length) continue;
        const page = el.closest<HTMLElement>('[data-pdf-page]')!.dataset.pdfPage;
        const entry = `${page}:${el.dataset.state}`;
        if (seen[seen.length - 1] !== entry && !seen.includes(entry)) seen.push(entry);
      }
    };
    new MutationObserver(record).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-state', 'style'],
    });
    const frame = () => {
      record();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

const seenStates = (page: Page) =>
  page.evaluate(() => (window as { __seen?: string[] }).__seen ?? []);

async function jumpTo(page: Page, n: number) {
  if ((await page.getByTestId('reader-header').getAttribute('data-shown')) !== 'true') {
    const box = (await page.getByTestId('flipbook').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  await page.getByTestId('page-status').click();
  await page.getByTestId('page-jump').fill(String(n));
  await page.keyboard.press('Enter');
}

test('kitap açılıp biraz beklenince ileri çevirmede sayfa hiç "yükleniyor" görünmez', async ({
  page,
}) => {
  await openLong(page);
  // Arka planda sonraki sayfalar çizilir
  await expect.poll(async () => (await cacheStats(page))?.sharp ?? 0).toBeGreaterThanOrEqual(12);
  await watchStates(page);
  await page.getByTestId('flipbook').focus();
  for (let i = 0; i < 4; i++) await turnNextPage(page);
  // Hızlı çevirme de (çevirme bitmeden yeni basış)
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(120);
  }
  await flipSettled(page);
  const seen = await seenStates(page);
  expect(seen.filter((s) => s.endsWith(':loading'))).toEqual([]);
  expect(seen.some((s) => s.endsWith(':sharp'))).toBe(true);
  // Kitap açık sayfanın ±6 komşusunu kurar, ama keskin görüntü (çözülmüş büyük <img>) yalnızca açık sayfa ve en çok 2
  // komşusunda: öbürleri yalnızca önizleme
  await expect
    .poll(() => page.locator('[data-testid="flipbook"] [data-pdf-page]').count())
    .toBeGreaterThan(6);
  expect(
    await page.locator('[data-testid="flipbook"] .page-image img:not([data-sharp])').count(),
  ).toBeLessThanOrEqual(6);
  // Yükleniyor yazısı yalnızca ekran okuyucu için (gözle görünmez)
  await expect(page.getByText(/yükleniyor/).filter({ visible: true })).toHaveCount(0);
});

test('uzağa atlayınca önce önizleme, sonra keskin sayfa görünür', async ({ page }) => {
  await openLong(page);
  // Uzak sayfaların önizlemeleri keskinlerinden önce hazırlanır
  await expect
    .poll(async () => (await cacheStats(page))?.pages.preview.includes(49) ?? false)
    .toBe(true);
  const stats = (await cacheStats(page))!;
  expect(stats.pages.sharp).not.toContain(49);
  await watchStates(page);
  await jumpTo(page, 50);
  await expect.poll(async () => (await statusPages(page)).includes(50)).toBe(true);
  const sharp = page.locator('[data-testid="flipbook"] [data-pdf-page="50"] img');
  await expect(sharp).toBeVisible();
  const seen = (await seenStates(page)).filter((s) => s.startsWith('50:'));
  expect(seen).toEqual(['50:preview', '50:sharp']);
});

test('önbellek bellek bütçesiyle sınırlı kalır; sayfalar yine görünür', async ({ page }) => {
  // Küçük bütçe: ~8 keskin sayfa ve ~30 önizleme
  const budget = { sharp: 1_500_000, preview: 600_000 };
  await page.addInitScript((b) => {
    (window as { __pageCacheBudget?: typeof b }).__pageCacheBudget = b;
  }, budget);
  await openLong(page);
  await page.waitForTimeout(4000);
  // Ekranda gösterilen (iğnelenmiş) sayfalar dışındakiler bütçeyi aşmaz; kitabın tamamı bellekte tutulmaz
  const bounded = async () => {
    const s = (await cacheStats(page))!;
    expect(s.sharpBytes - s.pinnedBytes.sharp).toBeLessThanOrEqual(budget.sharp);
    expect(s.previewBytes - s.pinnedBytes.preview).toBeLessThanOrEqual(budget.preview);
    expect(s.sharp).toBeGreaterThan(0);
    expect(s.sharp).toBeLessThan(40);
    expect(s.preview).toBeLessThan(60);
    return s;
  };
  await bounded();
  await page.getByTestId('flipbook').focus();
  for (let i = 0; i < 3; i++) await turnNextPage(page);
  const [shown] = await statusPages(page);
  await expect(
    page.locator(`[data-testid="flipbook"] [data-pdf-page="${shown}"] img`),
  ).toBeVisible();
  await page.waitForTimeout(2000);
  const after = await bounded();
  // Okuma yeri ilerledi: önbellek de onunla ilerler (en uzak sayfalar çıkar)
  expect(Math.max(...after.pages.sharp)).toBeGreaterThan(shown);
  await expect(page.getByText(/gösterilemedi/)).toHaveCount(0);
});
