import { expect, test, type Page } from '@playwright/test';
import {
  bookIndex,
  flipSettled,
  headerAction,
  headerActionTarget,
  importFixture,
  turnNextPage,
} from './helpers';

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

/**
 * Başlıktaki "Yer imi" eyleminin basılı olup olmadığı: geniş ekranda düğmenin aria-pressed'i, dar ekranda ⋯
 * menüsündeki öğenin aria-checked'i (menü açılıp kapatılır)
 */
async function headerBookmarkPressed(page: Page): Promise<string | null> {
  const target = await headerActionTarget(page, 'reader-bookmark');
  if ((await target.getAttribute('data-testid')) === 'reader-bookmark')
    return target.getAttribute('aria-pressed');
  await target.click();
  const item = page.getByTestId('more-reader-bookmark');
  await expect(item).toBeVisible();
  const checked = await item.getAttribute('aria-checked');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  return checked;
}

test('sayfa görünümü: başlıktaki "Yer imi" yer imi koyar; köşeye dokunma kaldırır, sayfayı çevirmez; yenilemede kalır; listeden gidilir ve kaldırılır', async ({
  page,
}, testInfo) => {
  await openNovel(page);
  await expect(page.locator('[data-testid="flipbook"] [data-pdf-page="1"] img')).toBeVisible();
  // İlk yuvada (çift sayfada boş yuvanın yanında) PDF'in 1. sayfası
  const index = await bookIndex(page);
  const corner = pdfCorner(page, 1);
  await expect(corner).toHaveAttribute('aria-pressed', 'false');
  await expect(corner).toHaveAttribute('aria-label', 'Yer imi');
  // Menü açıkken başlık sayfanın üst köşesini örter: yer imi başlıktaki "Yer imi" ile konur (dar ekranda ⋯ menüsü)
  expect(await headerBookmarkPressed(page)).toBe('false');
  await headerAction(page, 'reader-bookmark');
  await expect(corner).toHaveAttribute('aria-pressed', 'true');
  expect(await headerBookmarkPressed(page)).toBe('true');

  // Menü gizli: görünen (yer imli) köşeye dokunma yer imini kaldırır; sayfa çevrilmez, menü açılmaz
  await page.keyboard.press('m');
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'false');
  await tapCorner(page, corner);
  await expect(corner).toHaveAttribute('aria-pressed', 'false');
  await flipSettled(page);
  expect(await bookIndex(page)).toBe(index);
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'false');

  if (testInfo.project.use.hasTouch) {
    // Dokunmatik ekranda görünmeyen köşe dokunmayı almaz: yer imi B ile (ya da başlıktan) konur
    await page.keyboard.press('b');
  } else {
    // Farede köşe üstüne gelince belirir: dokunma yer imi koyar, sayfa çevrilmez
    await tapCorner(page, corner);
  }
  await expect(corner).toHaveAttribute('aria-pressed', 'true');
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

test('iPad: menü gizliyken sağ üst köşeye parmakla dokunma sayfayı çevirir, gizlice yer imi koymaz', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'ipad', 'dokunmatik iPad (WebKit)');
  await openNovel(page);
  await expect(page.locator('[data-testid="flipbook"] [data-pdf-page="1"] img')).toBeVisible();
  await page.keyboard.press('m');
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'false');
  await flipSettled(page);
  const index = await bookIndex(page);
  const corner = pdfCorner(page, 1);
  await expect(corner).toHaveAttribute('aria-pressed', 'false');
  const box = (await corner.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width - 6, box.y + 6);
  await expect.poll(() => bookIndex(page)).toBeGreaterThan(index);
  await flipSettled(page);
  await openBookmarks(page);
  await expect(page.getByTestId('bookmarks-empty')).toBeVisible();
});

test('"Kalemle her zaman çiz": Apple Pencil köşeden geçer, çizim köşeden başlar; yer imi konmaz', async ({
  page,
}) => {
  await openNovel(page);
  await expect(page.locator('[data-testid="flipbook"] [data-pdf-page="1"] img')).toBeVisible();
  await page.keyboard.press('m');
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'false');
  await flipSettled(page);
  const index = await bookIndex(page);
  const corner = pdfCorner(page, 1);
  const layer = page.locator(
    '[data-testid="flipbook"] [data-pdf-page="1"] [data-testid="annotation-layer"]',
  );
  // Kalem (pointerType 'pen') köşenin en ucuna basıp sayfaya doğru çizer; bırakınca köşeye tıklama da gelir
  // (Playwright'ın kalem girdisi yok: yapay olaylar)
  await corner.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const send = (type: string, x: number, y: number, target: Element) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 91,
          pointerType: 'pen',
          isPrimary: true,
          bubbles: true,
          cancelable: true,
          composed: true,
          button: type === 'pointermove' ? -1 : 0,
          buttons: type === 'pointerup' ? 0 : 1,
          clientX: x,
          clientY: y,
        }),
      );
    // Basış köşeye gelir; sürükleme ve bırakma (gerçekte yakalanan işaretçi) katmana
    const target = document.elementFromPoint(r.right - 3, r.top + 3)!;
    const layer = el.closest('[data-testid="annotation-layer"]')!;
    send('pointerdown', r.right - 3, r.top + 3, target);
    for (let k = 1; k <= 8; k++)
      send('pointermove', r.right - 3 - k * 20, r.top + 3 + k * 10, layer);
    send('pointerup', r.right - 163, r.top + 83, layer);
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  });
  await expect(layer.locator('path[data-kind="highlight"]')).toHaveCount(1);
  await expect(corner).toHaveAttribute('aria-pressed', 'false');
  await flipSettled(page);
  expect(await bookIndex(page)).toBe(index);
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'false');
});

test('içindekiler paneli: ←/→ sekmeler arasında geçer, odak seçilen sekmede', async ({ page }) => {
  await openNovel(page);
  await page.getByTestId('reader-toc').click();
  const toc = page.getByTestId('tab-toc');
  const marks = page.getByTestId('tab-bookmarks');
  await expect(toc).toHaveAttribute('aria-selected', 'true');
  await toc.focus();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.keyboard.press('ArrowRight');
  await expect(marks).toHaveAttribute('aria-selected', 'true');
  await expect(marks).toBeFocused();
  await expect(marks).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('ArrowLeft');
  await expect(toc).toHaveAttribute('aria-selected', 'true');
  await expect(toc).toBeFocused();
  expect(errors).toEqual([]);
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
    // Boş listede yer imlerinin PDF sayfasına konduğu da yazar
    await openBookmarks(page);
    await expect(page.getByTestId('bookmarks-empty')).toBeVisible();
    await expect(page.getByTestId('bookmarks-pdf-hint')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('reader-panel')).toHaveCount(0);
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
