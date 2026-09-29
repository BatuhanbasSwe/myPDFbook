import { expect, test, type Page } from '@playwright/test';
import { bookIndex, flipSettled, headerAction, importFixture, turnNextPage } from './helpers';

const NOVEL = ['novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf'] as const;

async function openNovel(page: Page) {
  await page.goto('/');
  await importFixture(page, ...NOVEL);
  await page.getByTestId('book-open').click();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
}

/** PDF sayfasının (1'den) yer imi köşesi, sayfa görünümünde */
const pdfCorner = (page: Page, pdfPage: number) =>
  page.locator(
    `[data-testid="flipbook"] [data-pdf-page="${pdfPage}"] [data-testid="bookmark-corner"]`,
  );

/** Köşeye, sayfanın en köşesine yakın bir yerden dokunur (sağ üçte birlik çevirme bölgesinde) */
async function tapCorner(page: Page, corner: ReturnType<typeof pdfCorner>) {
  const box = await corner.boundingBox();
  if (!box) throw new Error('köşe görünmüyor');
  const right = (await corner.getAttribute('class'))?.includes('dog-ear-right');
  await page.mouse.click(right ? box.x + box.width - 6 : box.x + 6, box.y + 6);
}

/** Okuma yeri kaydedildi mi (yenilemeden önce beklenir: yer 400 ms sonra yazılır) */
const progressSaved = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const req = indexedDB.open('mypdfbook');
        req.onerror = () => resolve(false);
        req.onsuccess = () => {
          const db = req.result;
          const count = db.transaction('progress').objectStore('progress').count();
          count.onsuccess = () => {
            resolve(count.result > 0);
            db.close();
          };
          count.onerror = () => resolve(false);
        };
      }),
  );

/** İçindekiler panelinde yer imleri sekmesi */
async function openBookmarks(page: Page) {
  if ((await page.getByTestId('reader-header').getAttribute('data-shown')) !== 'true')
    await page.keyboard.press('m');
  await page.getByTestId('reader-toc').click();
  await page.getByTestId('tab-bookmarks').click();
  await expect(page.getByTestId('tab-bookmarks')).toHaveAttribute('aria-selected', 'true');
}

test('sayfa görünümü: köşeye dokunma yer imi koyar, sayfayı çevirmez; yenilemede kalır; listeden gidilir ve kaldırılır', async ({
  page,
}) => {
  await openNovel(page);
  await expect(page.locator('[data-testid="flipbook"] [data-pdf-page="1"] img')).toBeVisible();
  // İlk yuvada (çift sayfada boş yuvanın yanında) PDF'in 1. sayfası; menü gizlensin (dokunma bölgeleri etkin)
  await page.keyboard.press('m');
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'false');
  const index = await bookIndex(page);
  const corner = pdfCorner(page, 1);
  await expect(corner).toHaveAttribute('aria-pressed', 'false');
  await tapCorner(page, corner);
  await expect(corner).toHaveAttribute('aria-pressed', 'true');
  // Köşe sağ üstte, çevirme bölgesinde: sayfa çevrilmedi, menü açılmadı
  await flipSettled(page);
  expect(await bookIndex(page)).toBe(index);
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'false');

  // Yenileyince yer imi yerinde
  await page.reload();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await expect(pdfCorner(page, 1)).toHaveAttribute('aria-pressed', 'true');

  // Başka sayfaya gidilir; listeden yer imine dönülür
  await turnNextPage(page);
  await turnNextPage(page);
  expect(await bookIndex(page)).toBeGreaterThan(index);
  await openBookmarks(page);
  const item = page.getByTestId('bookmark-item');
  await expect(item).toHaveCount(1);
  await expect(item).toHaveAttribute('data-page', '1');
  await expect(item).toContainText('Sayfa 1');
  await item.getByTestId('bookmark-go').click();
  await expect(page.getByTestId('reader-panel')).toHaveCount(0);
  await expect.poll(() => bookIndex(page)).toBe(index);
  await flipSettled(page);

  // Listeden kaldırılır: köşe de düzleşir
  await openBookmarks(page);
  await expect(item.getByTestId('bookmark-go')).toHaveAttribute('aria-current', 'true');
  await item.getByTestId('bookmark-delete').click();
  await expect(page.getByTestId('bookmarks-empty')).toBeVisible();
  await expect(pdfCorner(page, 1)).toHaveAttribute('aria-pressed', 'false');
});

test('kalem kipinde köşe çizime engel olmaz (yer imi koymaz); B tuşu açıp kapar; kip kapanınca köşe yine çalışır', async ({
  page,
}) => {
  await openNovel(page);
  await expect(page.locator('[data-testid="flipbook"] [data-pdf-page="1"] img')).toBeVisible();
  await headerAction(page, 'pen-mode');
  await expect(page.getByTestId('pen-toolbar')).toBeVisible();
  const corner = pdfCorner(page, 1);
  const layer = page.locator(
    '[data-testid="flipbook"] [data-pdf-page="1"] [data-testid="annotation-layer"]',
  );
  // Köşenin en ucundan başlayan çizgi çizilir, yer imi konmaz
  const box = (await layer.boundingBox())!;
  await page.mouse.move(box.x + box.width - 3, box.y + 3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.2, { steps: 8 });
  await page.mouse.up();
  await expect(layer.locator('path[data-kind]')).toHaveCount(1);
  await expect(corner).toHaveAttribute('aria-pressed', 'false');

  // B kalem kipinde de çalışır
  await page.keyboard.press('b');
  await expect(corner).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Bitti' }).click();
  await expect(page.getByTestId('pen-toolbar')).toHaveCount(0);

  // Kip kapanınca köşeye dokunma yer imini kaldırır; B yeniden koyar
  await tapCorner(page, corner);
  await expect(corner).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('B');
  await expect(corner).toHaveAttribute('aria-pressed', 'true');
});

test.describe('metin görünümü', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem('mypdfbook:reader'))
        localStorage.setItem('mypdfbook:reader', JSON.stringify({ view: 'text' }));
    });
  });

  test('B tuşuyla yer imi; yenilemede kalır; listeden gidilir; köşeye dokununca kalkar', async ({
    page,
  }) => {
    await openNovel(page);
    await turnNextPage(page);
    const index = await bookIndex(page);
    const shown = page.locator(
      `[data-testid="flipbook"] .book-page[data-page="${index + 1}"] [data-testid="bookmark-corner"]`,
    );
    await expect(shown).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('b');
    await expect(shown).toHaveAttribute('aria-pressed', 'true');

    await expect.poll(() => progressSaved(page)).toBe(true);
    await page.reload();
    await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
    await expect.poll(() => bookIndex(page)).toBe(index);
    await expect(shown).toHaveAttribute('aria-pressed', 'true');

    // Başa dönülür; listeden yer imli sayfaya gidilir
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => bookIndex(page)).toBeLessThan(index);
    await flipSettled(page);
    await openBookmarks(page);
    const item = page.getByTestId('bookmark-item');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(`Sayfa ${index + 1}`);
    await item.getByTestId('bookmark-go').click();
    await expect.poll(() => bookIndex(page)).toBe(index);
    await flipSettled(page);

    // Köşeye dokununca yer imi kalkar, sayfa çevrilmez
    await tapCorner(page, shown);
    await expect(shown).toHaveAttribute('aria-pressed', 'false');
    await flipSettled(page);
    expect(await bookIndex(page)).toBe(index);
  });
});
