import { expect, test } from '@playwright/test';

/** Kütüphanenin ⋯ menüsünü açar ve "Uygulamayı yükle"ye basar */
async function installFromMenu(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Diğer' }).click();
  await page.getByTestId('more-library-install').click();
}

test('kurulum şeridi kapatılınca ⋯ → Uygulamayı yükle adımları yeniden gösterir', async ({
  page,
}, testInfo) => {
  // Chromium'da tarayıcının kurulum olayı (sahte): iPad'de Paylaş → Ana Ekrana Ekle tarifi
  const ios = testInfo.project.name === 'ipad';
  await page.goto('/');
  if (!ios)
    await page.evaluate(() => {
      const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt: async () => {
          (window as { __prompted?: number }).__prompted =
            ((window as { __prompted?: number }).__prompted ?? 0) + 1;
        },
        userChoice: Promise.resolve({ outcome: 'dismissed' }),
      });
      window.dispatchEvent(e);
    });
  const strip = page.getByTestId('install-card');
  await expect(strip).toBeVisible();
  await page.getByRole('button', { name: 'Kurulum kartını kapat' }).click();
  await expect(strip).toHaveCount(0);

  await installFromMenu(page);
  if (ios) {
    const sheet = page.getByTestId('install-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Paylaş');
    await expect(sheet).toContainText('Ana Ekrana Ekle');
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  } else {
    // Yakalanan olayla tarayıcının kurulum penceresi açılır
    await expect
      .poll(() => page.evaluate(() => (window as { __prompted?: number }).__prompted ?? 0))
      .toBe(1);
    // Olay bir kez kullanılır: sonra tarayıcının menüsünden kurma adımı
    await installFromMenu(page);
    await expect(page.getByTestId('install-sheet')).toContainText('Tarayıcının menüsünden');
  }
  // Şerit kapalı kalır
  await expect(strip).toHaveCount(0);
});

test('uygulama olarak (ana ekrandan) açıldıysa menüde "Uygulamayı yükle" yok', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Diğer' }).click();
  await expect(page.getByTestId('more-library-theme')).toBeVisible();
  await expect(page.getByTestId('more-library-install')).toHaveCount(0);
});
