import { expect, test } from '@playwright/test';
import { headerAction, importFixture } from './helpers';

/**
 * Eski WebKit (iPadOS/iOS 18 ve öncesi; iPad'deki Chrome da): `ReadableStream` üzerinde `for await` yok. Bu tarayıcıda
 * kitap "undefined is not a function (near '...e of t...')" hatasıyla dönüştürülemiyordu. Burada özellik hem sayfadan
 * hem pdf.js worker'ından silinir: kitap yine dönüştürülmeli ve okunmalı.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const strip = () => {
      const proto = ReadableStream.prototype as unknown as Record<PropertyKey, unknown>;
      delete proto[Symbol.asyncIterator];
      delete proto.values;
    };
    strip();
    // Worker'lar da özelliksiz başlar: asıl worker, özelliği silen bir girişten açılır
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        const target = new URL(String(url), location.href).href;
        const source =
          'const p = ReadableStream.prototype; delete p[Symbol.asyncIterator]; delete p.values;\n' +
          `await import(${JSON.stringify(target)});`;
        const blob = new Blob([source], { type: 'text/javascript' });
        super(URL.createObjectURL(blob), { ...options, type: 'module' });
      }
    } as typeof Worker;
  });
});

test('akış üzerinde for await olmayan tarayıcıda kitap dönüştürülür ve iki görünümde okunur', async ({
  page,
}) => {
  await page.goto('/');
  // Özellik gerçekten yok, uygulamanın tamamlayıcısı yerine koyar (sayfa yüklendikten sonra)
  await importFixture(page, 'novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf');
  await expect(page.getByTestId('convert-error')).toHaveCount(0);
  await page.getByTestId('book-open').click();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await expect(page.locator('[data-testid="flipbook"] [data-pdf-page="1"] img')).toBeVisible();
  await headerAction(page, 'view-toggle');
  await expect(page.getByRole('heading', { name: 'KAYIP ŞEHRİN IŞIKLARI' })).toBeVisible();
});
