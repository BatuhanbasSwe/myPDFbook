import { expect, test } from '@playwright/test';
import { importFixture } from './helpers';

test('PDF içe aktarılır, dönüştürülür ve kütüphanede görünür', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Henüz kitap yok')).toBeVisible();
  await importFixture(page, 'novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf');
  const card = page.getByTestId('book-card').filter({ hasText: 'Kayıp Şehrin Işıkları' });
  await expect(card).toContainText('Deniz Aksoy');
  await expect(card.getByTestId('book-open')).toBeVisible();
  await expect(card.locator('img')).toBeVisible(); // başlık sayfası kapak olarak çizildi
});

test('aynı PDF ikinci kez eklenmez', async ({ page }) => {
  await page.goto('/');
  await importFixture(page, 'english.pdf');
  await expect(page.getByTestId('book-open')).toHaveCount(1);
  await importFixture(page, 'english.pdf', 'kopya.pdf');
  await expect(page.getByRole('status')).toContainText('zaten kütüphanende');
  await expect(page.getByTestId('book-card')).toHaveCount(1);
});

test('kitap silinebilir', async ({ page }) => {
  await page.goto('/');
  await importFixture(page, 'english.pdf');
  await expect(page.getByTestId('book-card')).toHaveCount(1);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: /kitabını sil/ }).click();
  await expect(page.getByTestId('book-card')).toHaveCount(0);
  await expect(page.getByText('Henüz kitap yok')).toBeVisible();
});
