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
  // Hemen görünmez (500 ms bekler): üzerine gelme ile ipucunun belirmesi arasındaki süre sayfada ölçülür (yük
  // altında testin kendi beklemesi kaymasın)
  await page.evaluate(() => {
    const w = window as unknown as { __enter?: number; __shown?: number };
    document
      .querySelector('[data-testid="reader-toc"]')!
      .addEventListener('pointerenter', () => (w.__enter = performance.now()), { once: true });
    new MutationObserver((_, obs) => {
      if (document.querySelector('[role="tooltip"]')) {
        w.__shown = performance.now();
        obs.disconnect();
      }
    }).observe(document.body, { childList: true });
  });
  await toc.hover();
  await expect(tooltip(page)).toHaveText('İçindekiler');
  const delay = await page.evaluate(() => {
    const w = window as unknown as { __enter?: number; __shown?: number };
    return (w.__shown ?? 0) - (w.__enter ?? 0);
  });
  expect(delay).toBeGreaterThanOrEqual(450);
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
  // Parmak kalkar, tarayıcı tıklama gönderir (tek seferde; ipucunun kalma süresi sayfada ölçülür: yük altında
  // testin kendi gecikmesi sonucu değiştirmesin)
  const afterClick = await toc.evaluate((el) => {
    const w = window as unknown as { __up?: number; __gone?: number };
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 7,
        pointerType: 'touch',
        isPrimary: true,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
      }),
    );
    w.__up = performance.now();
    new MutationObserver((_, obs) => {
      if (!document.querySelector('[role="tooltip"]')) {
        w.__gone = performance.now();
        obs.disconnect();
      }
    }).observe(document.body, { childList: true });
    (el as HTMLElement).click();
    return !!document.querySelector('[role="tooltip"]');
  });
  expect(afterClick).toBe(true);
  // Basılı tutma içindekileri açmadı
  await page.waitForTimeout(300);
  await expect(page.getByTestId('reader-panel')).toHaveCount(0);
  // ~1,5 sn sonra kaybolur
  await expect(tooltip(page)).toHaveCount(0, { timeout: 5000 });
  const linger = await page.evaluate(() => {
    const w = window as unknown as { __up?: number; __gone?: number };
    return (w.__gone ?? 0) - (w.__up ?? 0);
  });
  expect(linger).toBeGreaterThanOrEqual(1400);

  // Kısa dokunma düğmeye basar, ipucu yok (basma, kaldırma ve tıklama tek seferde: yük altında testin kendi
  // gecikmesi basılı tutmaya dönmesin)
  await toc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const init = {
      bubbles: true,
      cancelable: true,
      pointerId: 7,
      pointerType: 'touch',
      isPrimary: true,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    };
    el.dispatchEvent(new PointerEvent('pointerdown', init));
    el.dispatchEvent(new PointerEvent('pointerup', init));
    (el as HTMLElement).click();
  });
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
  const fine = await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches);
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
    // Kısayol yalnızca fare ve klavyeli cihazda (dokunmatik ekranda yalnızca ad)
    if (keys && fine) expect(text).toMatch(/ · \S+$/);
    else expect(text).toBe(label);
    // Ekranın içinde
    const tip = (await tooltip(page).boundingBox())!;
    expect(tip.x).toBeGreaterThanOrEqual(0);
    expect(tip.x + tip.width).toBeLessThanOrEqual(vp.width);
    expect(tip.y + tip.height).toBeLessThanOrEqual(vp.height);
  }
});

test('açık pencerenin (yedek penceresi) içindeki düğmenin ipucu pencerenin üstünde görünür', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Diğer' }).click();
  await page.getByTestId('more-backup-open').click();
  const dialog = page.getByTestId('backup-dialog');
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(300); // açılış hareketi
  const close = dialog.getByRole('button', { name: 'Pencereyi kapat' });
  await close.hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Pencereyi kapat');
  // Üst katmandaki pencerenin içinde çizilir: görünür (pencere tarafından örtülmez)
  expect(await tip.evaluate((el) => !!el.closest('dialog[open]'))).toBe(true);
  const box = (await tip.boundingBox())!;
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('dialog') !== null,
    [box.x + box.width / 2, box.y + box.height / 2] as const,
  );
  expect(hit).toBe(true);
  // Fareyle basınca ipucu kalkar, pencere kapanır
  await close.click();
  await expect(dialog).toHaveCount(0);
});
