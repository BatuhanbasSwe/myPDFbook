import { expect, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const fixtures = path.resolve(import.meta.dirname, '..', 'tests', 'fixtures');

/** Fixture PDF'ini dosya seçiciye verilecek biçimde okur (istenirse farklı bir dosya adıyla). */
export async function fixturePayload(file: string, name = file) {
  return { name, mimeType: 'application/pdf', buffer: await readFile(path.join(fixtures, file)) };
}

/**
 * Üst çubuğun eylemi (başlıktaki düğmesinin data-testid'si). Düğme başlıkta görünüyorsa o; değilse eylemi içeren
 * menünün düğmesi: "Okuma modları" (sesli oku, hızlı oku, odak) ya da ⋯ "Diğer" (yer imi, notlar, görünüm; telefonda
 * ara, kalem ve kilit de). Menü düğmesinin `data-actions`'ı içindeki eylemlerdir. Menü açılmaz.
 */
export async function headerActionTarget(page: Page, testId: string): Promise<Locator> {
  const button = page.getByTestId(testId);
  const menu = page.locator(`[data-actions~="${testId}"]`);
  // Biri görünene dek beklenir (üst çubuk henüz çizilmediyse yanlış yol seçilmesin)
  await expect(button.or(menu).filter({ visible: true })).toBeVisible();
  return (await button.isVisible()) ? button : menu.filter({ visible: true });
}

/**
 * Üst çubuğun eylemine basar: düğmesi başlıkta görünüyorsa ona, değilse eylemi içeren menüyü açıp öğesine
 * (`more-${testId}`).
 */
export async function headerAction(page: Page, testId: string): Promise<void> {
  const target = await headerActionTarget(page, testId);
  await target.click();
  if ((await target.getAttribute('data-testid')) === testId) return;
  await page.getByTestId(`more-${testId}`).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
}

/** Okuyucunun açık görünümü: sayfa (PDF) ya da metin */
export async function expectView(page: Page, view: 'page' | 'text'): Promise<void> {
  await expect(page.getByTestId('reader')).toHaveAttribute('data-view', view);
}

/**
 * Durum satırındaki açık sayfa(lar) ("Sayfa 3 / 6 · …" → [3], "Sayfa 2–3 / 6" → [2, 3]); sayfa görünümünde PDF
 * sayfası, metin görünümünde kitabın sayfası
 */
export async function statusPages(page: Page): Promise<number[]> {
  const text = (await page.getByTestId('page-status').textContent()) ?? '';
  return text
    .replace(/^\s*Sayfa\s*/, '')
    .split('/')[0]
    .trim()
    .split('–')
    .map(Number);
}

/** Kitabın açık (çift sayfada soldaki) yuvası */
export const bookIndex = async (page: Page) =>
  Number(await page.getByTestId('flipbook').getAttribute('data-index'));

/** Kıvrılan sayfa çevrilmiyor: süren çevirme bitti (CurlEngine, data-flipping) */
export async function flipSettled(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="flipbook"][data-flipping]')).toHaveCount(0);
}

/**
 * Sonraki sayfaya → tuşuyla çevirir ve çevirmenin bitmesini bekler (yük altında kıvrılma 650 ms'den uzun sürebilir:
 * sabit bir bekleme yerine kitabın yuvası ve data-flipping izlenir). Odak kitapta olmalı.
 */
export async function turnNextPage(page: Page): Promise<void> {
  await flipSettled(page);
  const before = await bookIndex(page);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => bookIndex(page)).not.toBe(before);
  await flipSettled(page);
}

/** Fixture PDF'ini (istenirse farklı bir dosya adıyla) içe aktarır. */
export async function importFixture(page: Page, file: string, name = file): Promise<void> {
  await page.getByTestId('file-input').setInputFiles(await fixturePayload(file, name));
}
