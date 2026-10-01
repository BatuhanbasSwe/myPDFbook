import { expect, test, type Page } from '@playwright/test';
import { importFixture } from './helpers';

/** tests/fixtures/encrypted.pdf: açma şifresi "gizli", başlığı "Gizli Defter" (scripts/make-encrypted-fixture.ts) */
const ENCRYPTED = ['encrypted.pdf', 'Gizli Defter.pdf'] as const;

/** Tarayıcının kendi penceresi (window.prompt) açılmamalı: ana ekrandaki iOS uygulamasında çalışmayabilir */
function forbidNativeDialogs(page: Page) {
  page.on('dialog', (d) => {
    throw new Error(`Tarayıcı penceresi açıldı: ${d.type()} ${d.message()}`);
  });
}

async function answer(page: Page, password: string) {
  const dialog = page.getByTestId('password-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('password-input').fill(password);
  await dialog.getByTestId('password-submit').click();
}

/**
 * Kitabın kayıtlı şifresini siler (şifresiz yedekten gelmiş gibi). `withoutText`: dönüştürülmüş metni de silinir,
 * kitap sıraya döner (yedekten metinsiz gelmiş gibi).
 */
function forgetPassword(page: Page, { withoutText = false } = {}) {
  return page.evaluate(
    (withoutText) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('mypdfbook');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const idb = req.result;
          const tx = idb.transaction(['books', 'contents'], 'readwrite');
          const store = tx.objectStore('books');
          const all = store.getAll();
          all.onsuccess = () => {
            for (const book of all.result as { password?: string; convert: object }[]) {
              delete book.password;
              if (withoutText) book.convert = { state: 'pending', progress: 0, version: 1 };
              store.put(book);
            }
          };
          if (withoutText) tx.objectStore('contents').clear();
          tx.oncomplete = () => {
            idb.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    withoutText,
  );
}

test('şifreli PDF içe aktarılırken şifre uygulama içi pencereden sorulur; yanlışsa uyarır, doğrusu kaydedilir', async ({
  page,
}) => {
  forbidNativeDialogs(page);
  await page.goto('/');
  await importFixture(page, ...ENCRYPTED);
  const dialog = page.getByTestId('password-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading')).toHaveText('“Gizli Defter” şifreli');
  await expect(dialog.getByTestId('password-input')).toBeFocused();
  await expect(dialog.getByTestId('password-input')).toHaveAttribute('autocomplete', 'off');
  await expect(dialog.getByTestId('password-submit')).toBeDisabled(); // boş şifre gönderilmez
  await expect(dialog.getByRole('alert')).toHaveCount(0);

  await answer(page, 'yanlis');
  await expect(dialog.getByRole('alert')).toHaveText('Şifre yanlış, tekrar dene.');
  await expect(dialog.getByTestId('password-input')).toHaveValue('');
  // Enter ile de gönderilir
  await dialog.getByTestId('password-input').fill('gizli');
  await dialog.getByTestId('password-input').press('Enter');
  await expect(dialog).toHaveCount(0);

  const card = page.getByTestId('book-card');
  await expect(card).toContainText('Gizli Defter');
  await expect(card.getByTestId('book-open')).toBeVisible();
  // Şifre kaydedildi: okuyucu yeniden sormaz
  await card.getByTestId('book-open').click();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await expect(page.locator('[data-testid="flipbook"] [data-pdf-page="1"] img')).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test('şifre penceresinde vazgeçilirse kitap eklenmez', async ({ page }) => {
  forbidNativeDialogs(page);
  await page.goto('/');
  await importFixture(page, ...ENCRYPTED);
  await expect(page.getByTestId('password-dialog')).toBeVisible();
  await page.getByTestId('password-cancel').click();
  await expect(page.getByTestId('password-dialog')).toHaveCount(0);
  await expect(page.getByRole('status').first()).toContainText(
    'Şifre girilmediği için kitap eklenmedi.',
  );
  await expect(page.getByTestId('book-card')).toHaveCount(0);

  // Esc de vazgeçer
  await importFixture(page, ...ENCRYPTED);
  await expect(page.getByTestId('password-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('password-dialog')).toHaveCount(0);
  await expect(page.getByTestId('book-card')).toHaveCount(0);
});

test('şifresi kayıtlı olmayan kitap okuyucuda açılırken şifre pencereden sorulur', async ({
  page,
}) => {
  forbidNativeDialogs(page);
  await page.goto('/');
  await importFixture(page, ...ENCRYPTED);
  await answer(page, 'gizli');
  await expect(page.getByTestId('book-open')).toBeVisible();
  await forgetPassword(page);

  await page.getByTestId('book-open').click();
  const dialog = page.getByTestId('password-dialog');
  await expect(dialog.getByRole('heading')).toHaveText('“Gizli Defter” şifreli');
  await answer(page, 'gizli');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-testid="flipbook"] [data-pdf-page="1"] img')).toBeVisible();
});

test('şifresi kayıtlı olmayan kitap "dönüştürülemedi" olur; "Tekrar dene" şifreyi pencereden sorar', async ({
  page,
}) => {
  forbidNativeDialogs(page);
  await page.goto('/');
  await importFixture(page, ...ENCRYPTED);
  await answer(page, 'gizli');
  await expect(page.getByTestId('book-open')).toBeVisible();
  await forgetPassword(page, { withoutText: true });

  // Açılışta sürdürülen dönüştürme şifre sormaz: nedeniyle "dönüştürülemedi"
  await page.reload();
  const card = page.getByTestId('book-card');
  await expect(card.getByTestId('convert-error')).toContainText('şifresi bu cihazda kayıtlı değil');
  await expect(page.getByTestId('password-dialog')).toHaveCount(0);

  await card.getByRole('button', { name: /dönüştürmesini tekrar dene/ }).click();
  await expect(page.getByTestId('password-dialog').getByRole('heading')).toHaveText(
    '“Gizli Defter” şifreli',
  );
  await answer(page, 'gizli');
  await expect(card.getByTestId('book-open')).toBeVisible();
  await expect(card.getByTestId('convert-error')).toHaveCount(0);
});
