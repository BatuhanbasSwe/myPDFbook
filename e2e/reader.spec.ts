import { expect, test } from '@playwright/test';
import { importFixture } from './helpers';

test('kitap açılır, metin okunur, orijinal sayfa görülür, tema kalıcıdır', async ({ page }) => {
  await page.goto('/');
  await importFixture(page, 'novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf');
  await page.getByTestId('book-open').click();

  await expect(page.getByRole('heading', { name: 'BİRİNCİ BÖLÜM' })).toBeVisible();
  await expect(page.getByText('— Nereye gidiyorsun? dedi annesi mutfaktan seslenerek.')).toBeVisible();

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
