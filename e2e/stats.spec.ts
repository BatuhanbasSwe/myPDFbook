import { expect, test, type Page } from '@playwright/test';
import { importFixture, turnNextPage } from './helpers';

const NOVEL = ['novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf'] as const;

async function openNovel(page: Page) {
  await page.goto('/');
  await importFixture(page, ...NOVEL);
  await page.getByTestId('book-open').click();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
}

/** Kitabın sayfa sayısı (durum satırı "Sayfa 1 / 6 · …") */
async function pageCount(page: Page): Promise<number> {
  const text = (await page.getByTestId('page-status').textContent()) ?? '';
  return Number(/\/\s*(\d+)/.exec(text)?.[1]);
}

async function goToPage(page: Page, n: number) {
  await page.getByTestId('page-status').click();
  await page.getByTestId('page-jump').fill(String(n));
  await page.keyboard.press('Enter');
}

/** Kütüphanede kitabın ⋯ menüsünden günlüğü açar */
async function openJournalFromLibrary(page: Page) {
  await page.getByTestId('book-menu').click();
  await page.getByTestId('more-book-journal').click();
  await expect(page.getByTestId('journal-dialog')).toBeVisible();
}

test('okudukça süre işler: istatistiklerde bugünün dakikaları, kitap ve günlükte süre', async ({
  page,
}) => {
  await page.clock.install({ time: new Date(2026, 9, 2, 10, 0) });
  await openNovel(page);
  // Etkin okuma: sayfa çevrilir, arada zaman ilerler (2 dk'yı aşmayan aralarla)
  for (let i = 0; i < 3; i++) {
    await page.clock.fastForward('01:00');
    await page.locator('[data-testid="flipbook"]').focus();
    await turnNextPage(page);
  }
  await page.clock.fastForward('00:30');
  // Kütüphaneye dönünce oturum yazılır (menü gizli: M açar)
  await page.keyboard.press('m');
  await page.getByRole('link', { name: 'Kütüphaneye dön' }).click();
  await page.getByTestId('library-more').click();
  await page.getByTestId('more-library-stats').click();
  await expect(page.getByTestId('stats-page')).toBeVisible();
  await expect(page.getByTestId('goal-ring')).toHaveAttribute('data-minutes', '3');
  await expect(page.getByTestId('stats-total')).toContainText('4 dk');
  await expect(page.getByTestId('stats-streak')).toContainText('1 gün');
  await expect(page.getByTestId('stats-book')).toHaveCount(1);
  await expect(page.getByTestId('stats-book')).toContainText('Kayıp Şehrin Işıkları');
  // Bugünün sütunu dolu (cuma: haftanın 5. günü)
  await expect(page.getByTestId('week-day-4')).not.toHaveAttribute('data-ms', '0');
  // Kitaba dokununca günlüğü açılır; okuma süresi orada da
  await page.getByTestId('stats-book').click();
  await expect(page.getByTestId('journal-total')).toHaveText('4 dk');
});

test('istatistik: veri yokken boş ekran; hedefler değişir ve kalır', async ({ page }) => {
  await page.goto('/istatistik');
  await expect(page.getByTestId('stats-empty')).toBeVisible();
  await expect(page.getByTestId('goal-daily')).toHaveText('20 dk');
  await page.getByTestId('goal-daily-up').click();
  await expect(page.getByTestId('goal-daily')).toHaveText('30 dk');
  await page.getByTestId('goal-yearly-down').click();
  await expect(page.getByTestId('goal-yearly')).toHaveText('11 kitap');
  await page.reload();
  await expect(page.getByTestId('goal-daily')).toHaveText('30 dk');
  await expect(page.getByTestId('goal-yearly')).toHaveText('11 kitap');
});

test('kitap günlüğü: durum, puan ve inceleme yenilemeden sonra da kalır; kartta görünür', async ({
  page,
}) => {
  await page.goto('/');
  await importFixture(page, ...NOVEL);
  await expect(page.getByTestId('book-open')).toBeVisible();
  await openJournalFromLibrary(page);
  const dialog = page.getByTestId('journal-dialog');
  await dialog.getByTestId('journal-status-finished').click();
  await expect(dialog.getByTestId('journal-status-finished')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Bitti seçilince bitiş tarihi bugün
  await expect(dialog.getByTestId('journal-finished')).not.toHaveValue('');
  await dialog.getByRole('radio', { name: '4,5 yıldız' }).check();
  await expect(dialog.getByTestId('journal-rating')).toHaveAttribute('data-value', '4.5');
  await dialog.getByTestId('journal-review').fill('Sonu çok güzeldi.');
  await expect(dialog.getByTestId('journal-review-state')).toHaveText('Kaydedildi');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  const card = page.getByTestId('book-card');
  await expect(card.getByTestId('book-progress')).toHaveText('Bitti · ★ 4,5 yıldız');

  await page.reload();
  await expect(card.getByTestId('book-progress')).toHaveAttribute('data-status', 'finished');
  await openJournalFromLibrary(page);
  await expect(dialog.getByTestId('journal-status-finished')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(dialog.getByRole('radio', { name: '4,5 yıldız' })).toBeChecked();
  await expect(dialog.getByTestId('journal-review')).toHaveValue('Sonu çok güzeldi.');
  // Klavyeyle puan: oklar yarım adım değiştirir
  await dialog.getByRole('radio', { name: '4,5 yıldız' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(dialog.getByTestId('journal-rating')).toHaveAttribute('data-value', '4');
});

test('son sayfada "Kitabı bitirdin mi?": Evet kitabı bitirir, puan sorulur; bir daha sorulmaz', async ({
  page,
}) => {
  await openNovel(page);
  await expect(page.getByTestId('finish-prompt')).toHaveCount(0);
  const last = await pageCount(page);
  await goToPage(page, last);
  const prompt = page.getByTestId('finish-prompt');
  await expect(prompt).toBeVisible();
  await prompt.getByTestId('finish-yes').click();
  await expect(prompt).toHaveAttribute('data-stage', 'rate');
  await prompt.getByRole('radio', { name: '4 yıldız' }).check();
  await prompt.getByTestId('finish-close').click();
  await expect(prompt).toHaveCount(0);

  // Okuyucunun ⋯ menüsünden günlük: bitti, bugün, 4 yıldız
  await page.getByTestId('reader-more').click();
  await page.getByTestId('more-reader-journal').click();
  const dialog = page.getByTestId('journal-dialog');
  await expect(dialog.getByTestId('journal-status-finished')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(dialog.getByTestId('journal-rating')).toHaveAttribute('data-value', '4');
  await dialog.getByTestId('journal-close').click();

  // Yeniden açınca son sayfada soru yok
  await page.reload();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await expect(page.getByTestId('finish-prompt')).toHaveCount(0);
});

test('son sayfada "Henüz değil": kart kapanır, kitap bitmez, bir daha sorulmaz', async ({
  page,
}) => {
  await openNovel(page);
  await goToPage(page, await pageCount(page));
  await page.getByTestId('finish-not-yet').click();
  await expect(page.getByTestId('finish-prompt')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await expect(page.getByTestId('finish-prompt')).toHaveCount(0);
  await page.goto('/');
  await expect(page.getByTestId('book-progress')).not.toHaveAttribute('data-status', 'finished');
});
