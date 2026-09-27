import { expect, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const fixtures = path.resolve(import.meta.dirname, '..', 'tests', 'fixtures');

/** Fixture PDF'ini dosya seçiciye verilecek biçimde okur (istenirse farklı bir dosya adıyla). */
export async function fixturePayload(file: string, name = file) {
  return { name, mimeType: 'application/pdf', buffer: await readFile(path.join(fixtures, file)) };
}

/**
 * Üst çubuğun ikincil eylemi (başlıktaki düğmesinin data-testid'si). Geniş ekranda düğme başlıktadır; dar ekranda
 * (telefon, pixel projesi) "Diğer" (⋯) menüsündedir. Hangisi görünüyorsa o döner (menü açılmaz).
 */
export async function headerActionTarget(page: Page, testId: string): Promise<Locator> {
  const button = page.getByTestId(testId);
  const more = page.getByRole('button', { name: 'Diğer' });
  // Biri görünene dek beklenir (üst çubuk henüz çizilmediyse yanlış yol seçilmesin)
  await expect(button.or(more).filter({ visible: true })).toBeVisible();
  return (await button.isVisible()) ? button : more;
}

/**
 * Üst çubuğun ikincil eylemine basar: düğmesi başlıkta görünüyorsa ona, değilse ⋯ menüsünü açıp öğesine
 * (`more-${testId}`).
 */
export async function headerAction(page: Page, testId: string): Promise<void> {
  const target = await headerActionTarget(page, testId);
  await target.click();
  if ((await target.getAttribute('data-testid')) === testId) return;
  await page.getByTestId(`more-${testId}`).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
}

/** Fixture PDF'ini (istenirse farklı bir dosya adıyla) içe aktarır. */
export async function importFixture(page: Page, file: string, name = file): Promise<void> {
  await page.getByTestId('file-input').setInputFiles(await fixturePayload(file, name));
}
