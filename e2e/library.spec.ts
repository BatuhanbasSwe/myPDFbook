import { expect, test } from '@playwright/test';
import { fixturePayload, importFixture } from './helpers';

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

test('kitap menüsünden yeniden adlandırılır ve silinir', async ({ page }) => {
  await page.goto('/');
  await importFixture(page, 'english.pdf');
  const card = page.getByTestId('book-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId('book-open')).toBeVisible();
  // Hiç açılmamış kitap "Yeni"
  await expect(card.getByTestId('book-progress')).toHaveText('Yeni');

  // ⋯: Yeniden adlandır
  await card.getByRole('button', { name: /seçenekleri$/ }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText(['Yeniden adlandır', 'Sil']);
  await menu.getByRole('menuitem', { name: 'Yeniden adlandır' }).click();
  await expect(menu).toHaveCount(0);
  await page.getByTestId('rename-input').fill('Yeni Başlık');
  await page.getByTestId('rename-save').click();
  await expect(page.getByTestId('rename-dialog')).toHaveCount(0);
  await expect(card.getByRole('heading')).toHaveText('Yeni Başlık');

  // Sağ tık da menüyü açar; Esc kapatır
  await card.getByTestId('book-open').click({ button: 'right' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // ⋯: Sil (onaylanınca)
  page.once('dialog', (dialog) => void dialog.accept());
  await card.getByRole('button', { name: /seçenekleri$/ }).click();
  await menu.getByRole('menuitem', { name: 'Sil' }).click();
  await expect(page.getByTestId('book-card')).toHaveCount(0);
  await expect(page.getByText('Henüz kitap yok')).toBeVisible();
});

test('dokunarak kapağa basılı tutunca kitabın menüsü açılır, kitap açılmaz', async ({ page }) => {
  await page.goto('/');
  await importFixture(page, 'english.pdf');
  const cover = page.getByTestId('book-open');
  await expect(cover).toBeVisible();
  const pointer = (type: string) =>
    cover.evaluate((el, type) => {
      const r = el.getBoundingClientRect();
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerType: 'touch',
          pointerId: 3,
          isPrimary: true,
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
        }),
      );
    }, type);
  await pointer('pointerdown');
  await expect(page.getByRole('menu')).toBeVisible();
  await pointer('pointerup');
  await cover.evaluate((el) => (el as HTMLElement).click());
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Sil' })).toBeVisible();
});

test('kütüphanenin üst çubuğu: büyük başlık, "+" ve ⋯ (yedek, tema, hakkında); boşken tek "PDF ekle"', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kitaplık');
  await expect(page.getByTestId('library-empty')).toBeVisible();
  await expect(page.getByTestId('empty-add')).toBeVisible();
  const more = page.getByRole('button', { name: 'Diğer' });
  await more.click();
  await expect(page.getByRole('menu').locator('[role^="menuitem"]')).toHaveText([
    'Yedekle / Geri yükle',
    'Tema',
    'Hakkında',
  ]);
  await page.getByTestId('more-library-theme').click();
  await expect(page.getByTestId('library-theme')).toBeVisible();
  await page.getByTestId('theme-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // Esc kapatır
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('library-theme')).toHaveCount(0);
  for (const control of [page.getByRole('button', { name: 'PDF ekle' }).first(), more]) {
    const box = (await control.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  }
});

test('birden çok dosya birlikte eklenir; açılamayan dosya adıyla bildirilir', async ({ page }) => {
  await page.goto('/');
  await page
    .getByTestId('file-input')
    .setInputFiles([
      await fixturePayload('novel-tr.pdf'),
      { name: 'bozuk.pdf', mimeType: 'application/pdf', buffer: Buffer.from('merhaba') },
      await fixturePayload('english.pdf'),
    ]);
  await expect(page.getByRole('status')).toContainText('“bozuk.pdf”: Bu dosya açılamadı');
  await expect(page.getByTestId('book-card')).toHaveCount(2);
  await expect(page.getByTestId('book-open')).toHaveCount(2); // ikisi de sırayla dönüştürüldü
});
