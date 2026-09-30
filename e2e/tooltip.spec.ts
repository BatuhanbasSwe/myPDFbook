import { expect, test, type Locator, type Page } from '@playwright/test';
import { importFixture } from './helpers';

const NOVEL = ['novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf'] as const;

async function openNovel(page: Page) {
  await page.goto('/');
  await importFixture(page, ...NOVEL);
  await page.getByTestId('book-open').click();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'true');
}

const tooltip = (page: Page) => page.getByRole('tooltip');

/** Düğmenin ortasına işaretçi olayları gönderir (dokunma ya da kalem) */
async function pointer(control: Locator, type: string, pointerType: 'touch' | 'pen') {
  await control.evaluate(
    (el, [type, pointerType]) => {
      const r = el.getBoundingClientRect();
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 7,
          pointerType,
          isPrimary: true,
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
        }),
      );
    },
    [type, pointerType] as const,
  );
}

/** Dokunmanın ardından tarayıcının gönderdiği tıklama */
const click = (control: Locator) => control.evaluate((el) => (el as HTMLElement).click());

test('fareyle üzerine gelince ipucu yarım saniye sonra görünür, çıkınca kaybolur', async ({
  page,
}) => {
  await openNovel(page);
  const toc = page.getByTestId('reader-toc');
  await toc.hover();
  // Hemen görünmez (500 ms bekler)
  await page.waitForTimeout(200);
  await expect(tooltip(page)).toHaveCount(0);
  await expect(tooltip(page)).toHaveText('İçindekiler');
  // Ekranın içinde, düğmenin altında
  const tip = (await tooltip(page).boundingBox())!;
  const button = (await toc.boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(tip.y).toBeGreaterThanOrEqual(button.y + button.height);
  expect(tip.x).toBeGreaterThanOrEqual(0);
  expect(tip.x + tip.width).toBeLessThanOrEqual(vw);

  await page.mouse.move(vw / 2, page.viewportSize()!.height / 2);
  await expect(tooltip(page)).toHaveCount(0);

  // Basınca ipucu kalkar, düğme çalışır
  await toc.hover();
  await expect(tooltip(page)).toBeVisible();
  await toc.click();
  await expect(tooltip(page)).toHaveCount(0);
  await expect(page.getByTestId('reader-panel')).toBeVisible();
});

test('dokunarak basılı tutunca ipucu görünür, düğme çalışmaz; bırakınca bir süre kalır; kısa dokunma çalışır', async ({
  page,
}) => {
  await openNovel(page);
  const toc = page.getByTestId('reader-toc');

  await pointer(toc, 'pointerdown', 'touch');
  await expect(tooltip(page)).toHaveText('İçindekiler');
  await pointer(toc, 'pointerup', 'touch');
  await click(toc);
  // Basılı tutma içindekileri açmadı; ipucu parmak kalktıktan sonra da görünür
  await page.waitForTimeout(300);
  await expect(page.getByTestId('reader-panel')).toHaveCount(0);
  await expect(tooltip(page)).toBeVisible();
  // ~1,5 sn sonra kaybolur
  await expect(tooltip(page)).toHaveCount(0, { timeout: 3000 });

  // Kısa dokunma düğmeye basar, ipucu yok
  await pointer(toc, 'pointerdown', 'touch');
  await page.waitForTimeout(80);
  await pointer(toc, 'pointerup', 'touch');
  await click(toc);
  await expect(page.getByTestId('reader-panel')).toBeVisible();
  await expect(tooltip(page)).toHaveCount(0);
});

test('dokunmatik ekranda gerçek basılı tutma (iPad, telefon): ipucu görünür, düğme çalışmaz', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(testInfo.project.name === 'masaustu-chrome', 'dokunmatik ekran');
  test.skip(browserName !== 'chromium', 'CDP dokunma olayları');
  await openNovel(page);
  const toc = page.getByTestId('reader-toc');
  const box = (await toc.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const point = [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point });
  await expect(tooltip(page)).toHaveText('İçindekiler');
  await page.waitForTimeout(250);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(400);
  await expect(page.getByTestId('reader-panel')).toHaveCount(0);
  await expect(tooltip(page)).toBeVisible();

  // Kısa dokunma içindekileri açar
  await expect(tooltip(page)).toHaveCount(0, { timeout: 3000 });
  await toc.tap();
  await expect(page.getByTestId('reader-panel')).toBeVisible();
  await expect(tooltip(page)).toHaveCount(0);
});

test('kalemle basılı tutma ipucu göstermez, düğmeye basar', async ({ page }) => {
  await openNovel(page);
  const toc = page.getByTestId('reader-toc');
  await pointer(toc, 'pointerover', 'pen');
  await pointer(toc, 'pointerenter', 'pen');
  await pointer(toc, 'pointerdown', 'pen');
  await page.waitForTimeout(900);
  await expect(tooltip(page)).toHaveCount(0);
  await pointer(toc, 'pointerup', 'pen');
  await click(toc);
  await expect(page.getByTestId('reader-panel')).toBeVisible();
  await expect(tooltip(page)).toHaveCount(0);
});

test('klavyeyle odaklanan düğmenin ipucu görünür', async ({ page }) => {
  await openNovel(page);
  await page.getByTestId('reader-toc').focus();
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  const label = await focused.getAttribute('aria-label');
  expect(label).toBeTruthy();
  await expect(tooltip(page)).toContainText(label!);
  // Tuşa basınca kalkar
  await page.keyboard.press('Shift+Tab');
  await expect(tooltip(page)).toHaveText('İçindekiler');
});

test('üst çubuktaki her düğmenin ipucu var: adı ve varsa kısayolu', async ({ page }) => {
  await openNovel(page);
  const header = page.getByTestId('reader-header');
  const controls = header.locator('button, a[href]').filter({ visible: true });
  const n = await controls.count();
  expect(n).toBeGreaterThanOrEqual(4);
  const vp = page.viewportSize()!;
  for (let i = 0; i < n; i++) {
    const control = controls.nth(i);
    const label = await control.getAttribute('aria-label');
    expect(label, `düğme ${i} adsız`).toBeTruthy();
    const keys = await control.getAttribute('aria-keyshortcuts');
    await page.mouse.move(vp.width / 2, vp.height / 2);
    await expect(tooltip(page)).toHaveCount(0);
    await control.hover();
    await expect(tooltip(page)).toBeVisible();
    const text = (await tooltip(page).textContent()) ?? '';
    expect(text.startsWith(label!)).toBe(true);
    if (keys) expect(text).toMatch(/ · \S+$/);
    // Ekranın içinde
    const tip = (await tooltip(page).boundingBox())!;
    expect(tip.x).toBeGreaterThanOrEqual(0);
    expect(tip.x + tip.width).toBeLessThanOrEqual(vp.width);
    expect(tip.y + tip.height).toBeLessThanOrEqual(vp.height);
  }
});
