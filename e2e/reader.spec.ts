import { expect, test } from '@playwright/test';
import { importFixture } from './helpers';

test('kitap açılır, metin okunur, orijinal sayfa görülür, tema kalıcıdır', async ({ page }) => {
  await page.goto('/');
  await importFixture(page, 'novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf');
  await page.getByTestId('book-open').click();

  await expect(page.getByRole('heading', { name: 'BİRİNCİ BÖLÜM' })).toBeVisible();
  await expect(
    page.getByText('— Nereye gidiyorsun? dedi annesi mutfaktan seslenerek.'),
  ).toBeVisible();

  await page.getByTestId('original-page').click();
  await expect(page.getByRole('img', { name: /Orijinal sayfa/ })).toBeVisible();
  await page.getByRole('button', { name: 'Kapat' }).click();

  await page.getByTestId('reader-settings').click();
  await page.getByTestId('theme-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('heading', { name: 'BİRİNCİ BÖLÜM' })).toBeVisible();
});

test('taranmış PDF sayfaları görsel olarak gösterilir', async ({ page }) => {
  await page.goto('/');
  await importFixture(page, 'scanned.pdf');
  await page.getByTestId('book-open').click();
  await expect(page.getByRole('img', { name: 'Sayfa 1' })).toBeVisible({ timeout: 30_000 });
});

test('kaldığı yer korunur; kitabın başı ve kaldığı blok başlık çubuğunun altında kalmaz', async ({
  page,
}) => {
  await page.goto('/');
  await importFixture(page, 'novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf');
  await page.getByTestId('book-open').click();
  const headerBottom = async () => {
    const box = await page.locator('header').boundingBox();
    return box ? box.y + box.height : 0;
  };
  const topOf = async (selector: string) => (await page.locator(selector).boundingBox())?.y ?? -1;

  // İlk açılış: kitabın başı çubuğun altında görünür
  await expect(page.getByRole('heading', { name: 'KAYIP ŞEHRİN IŞIKLARI' })).toBeVisible();
  expect(await topOf('[data-block="0"]')).toBeGreaterThanOrEqual(await headerBottom());

  // 5. bloğu çubuğun hemen altına kaydır; ilerleme 400 ms sonra kaydedilir
  await page.locator('[data-block="5"]').evaluate((el) => {
    const inset = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - inset });
  });
  await page.waitForTimeout(1000);

  // İki kez yeniden aç: her seferinde aynı blok çubuğun hemen altında (geriye kayma yok)
  for (let i = 0; i < 2; i++) {
    await page.reload();
    await expect(page.locator('[data-block="5"]')).toBeVisible();
    // Piksel altı yuvarlama payı; geriye bir blok kayma onlarca piksel olurdu
    await expect
      .poll(async () => Math.abs((await topOf('[data-block="5"]')) - (await headerBottom())))
      .toBeLessThan(2);
    await page.waitForTimeout(600);
  }
});

test('dönüştürülemeyen kitap adresinden açılınca mesaj ve kütüphaneye dönüş bağlantısı görünür', async ({
  page,
}) => {
  await page.goto('/');
  await importFixture(page, 'english.pdf');
  const href = await page.getByTestId('book-open').getAttribute('href');
  const bookId = href?.split('/').pop() ?? '';
  await page.evaluate(async (id) => {
    // Uygulamanın kendi veritabanı modülü (Vite geliştirme sunucusunda aynı örnek)
    const url = '/src/db/db.ts';
    const { db } = await import(/* @vite-ignore */ url);
    // Dönüştürülemeyen kitabın metni yoktur (asıl hata yalnızca metin yokken görülüyordu)
    await db.books.update(id, { 'convert.state': 'failed' });
    await db.contents.delete(id);
  }, bookId);
  await page.goto(`/read/${bookId}`);
  await expect(page.getByText('Bu kitap dönüştürülemedi')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Kütüphaneye dön' })).toBeVisible();
});
