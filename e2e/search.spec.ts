import { expect, test, type Page } from '@playwright/test';
import { bookIndex, flipSettled, headerAction, importFixture } from './helpers';

const NOVEL = ['novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf'] as const;

async function openNovel(page: Page) {
  await page.goto('/');
  await importFixture(page, ...NOVEL);
  await page.getByTestId('book-open').click();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
}

/** Menü gizliyse açar, "Ara" ile paneli açar: kutu odaklıdır */
async function openSearch(page: Page) {
  if ((await page.getByTestId('reader-header').getAttribute('data-shown')) !== 'true')
    await page.keyboard.press('m');
  await headerAction(page, 'reader-search');
  await expect(page.getByTestId('search-input')).toBeFocused();
}

/** Metin görünümünde arama vurgusunun metni (Highlight API ya da yedek kutular) */
const textHighlight = (page: Page) =>
  page.evaluate(() => {
    const h = typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : null;
    if (!h) return document.querySelector('.search-fallback') ? '(yedek)' : '';
    const hl = h.get('mypdfbook-search');
    return hl ? [...hl].map((r) => (r as Range).toString()).join('|') : '';
  });

test.describe('sayfa görünümü', () => {
  test('arama → sonuçlar → sonuca gitme → PDF sayfasında vurgu; dokununca kalkar', async ({
    page,
  }) => {
    await openNovel(page);
    await expect(page.locator('[data-testid="flipbook"] [data-pdf-page="1"] img')).toBeVisible();
    await openSearch(page);

    // Büyük/küçük harf ve Türkçe harf duyarsız, çok kelimeli arama
    await page.getByTestId('search-input').fill('KİTAPÇININ sahibi');
    await expect(page.getByTestId('search-status')).toHaveText('1 sonuç');
    const result = page.getByTestId('search-result');
    await expect(result).toHaveCount(1);
    await expect(result).toContainText('s. 4');
    await expect(result.locator('mark')).toHaveText('Kitapçının sahibi');
    // Bulunduğu bölümün (içindekilerdeki en yakın başlık) altında
    await expect(page.getByRole('group', { name: 'Sisli Sabah' })).toBeVisible();

    // ↓ ile seçilir, Enter ile gidilir: panel kapanır, PDF'in 4. sayfası açılır, eşleşme vurgulanır
    await page.keyboard.press('ArrowDown');
    await expect(result).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('search-panel')).toHaveCount(0);
    await flipSettled(page);
    const target = page.locator('[data-testid="flipbook"] [data-pdf-page="4"]');
    await expect(target).toBeVisible();
    const marks = target.locator('[data-testid="search-overlay"] .search-mark');
    await expect(marks).toHaveCount(1);
    // Vurgu sayfanın içinde, gövde metninin üst yarısında (paragrafın ilk satırı)
    const box = await marks.first().boundingBox();
    const pageBox = await target.boundingBox();
    expect(box && pageBox).toBeTruthy();
    expect(box!.width).toBeGreaterThan(20);
    expect(box!.x).toBeGreaterThan(pageBox!.x);
    expect(box!.y).toBeGreaterThan(pageBox!.y);
    expect(box!.y + box!.height).toBeLessThan(pageBox!.y + pageBox!.height / 2);

    // Bir sonraki dokunuşta vurgu kalkar (ortaya dokunma menüyü açar, sayfa çevrilmez)
    const index = await bookIndex(page);
    const book = await page.getByTestId('flipbook').boundingBox();
    await page.mouse.click(book!.x + book!.width / 2, book!.y + book!.height / 2);
    await expect(page.locator('[data-testid="search-overlay"]')).toHaveCount(0);
    expect(await bookIndex(page)).toBe(index);
  });

  test('aynı kelimenin birçok geçişi: ↑/↓ gezinir, doğru geçiş vurgulanır; Esc kapatır; son aramalar', async ({
    page,
  }) => {
    await openNovel(page);
    await openSearch(page);
    await page.getByTestId('search-input').fill('ışık');
    const results = page.getByTestId('search-result');
    // "ışıkları", "Işıklar", "ışık" (ve başlık sayfasındaki "IŞIKLARI")
    await expect(results).not.toHaveCount(0);
    const texts = await results.locator('mark').allTextContents();
    expect(texts).toEqual(expect.arrayContaining(['ışık', 'Işık', 'ışık']));
    // ↑ sondan başlar: son sonuç "hiç görmedikleri bir ışık" (PDF 5. sayfa, paragrafın sonu)
    await page.keyboard.press('ArrowUp');
    const last = results.last();
    await expect(last).toHaveAttribute('aria-selected', 'true');
    await expect(last).toContainText('görmedikleri bir ışık');
    await last.click();
    const target = page.locator('[data-testid="flipbook"] [data-pdf-page="5"]');
    const mark = target.locator('[data-testid="search-overlay"] .search-mark');
    await expect(mark).toHaveCount(1);
    // Aynı sayfadaki "Işıklar" (ilk satır) değil, alttaki "ışık" vurgulanır
    const box = await mark.boundingBox();
    const pageBox = await target.boundingBox();
    expect(box!.y).toBeGreaterThan(pageBox!.y + pageBox!.height * 0.2);

    // Yeniden açılınca son arama listededir; seçilince aranır. Esc paneli kapatır, odak düğmeye döner
    await openSearch(page);
    await expect(page.getByTestId('search-recent').first()).toHaveText('ışık');
    await page.getByTestId('search-recent').first().click();
    await expect(page.getByTestId('search-input')).toHaveValue('ışık');
    await expect(results).not.toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('search-panel')).toHaveCount(0);

    // Bulunmayan arama
    await openSearch(page);
    await page.getByTestId('search-input').fill('zümrüdüanka');
    await expect(page.getByTestId('search-status')).toHaveText('Sonuç yok');
  });
});

test.describe('metin görünümü', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem('mypdfbook:reader'))
        localStorage.setItem('mypdfbook:reader', JSON.stringify({ view: 'text' }));
    });
  });

  test('arama → sonuca gitme → CSS Highlight ile vurgu; sayfa çevirince kalkar', async ({
    page,
  }) => {
    await openNovel(page);
    await openSearch(page);
    await page.getByTestId('search-input').fill('MÜZAYEDEDEN');
    const result = page.getByTestId('search-result');
    await expect(result).toHaveCount(1);
    await expect(result.locator('mark')).toHaveText('müzayededen');
    await result.click();
    await expect(page.getByTestId('search-panel')).toHaveCount(0);
    await flipSettled(page);
    // Sonucun bulunduğu sayfa açık, eşleşme vurgulu
    await expect.poll(() => textHighlight(page)).toMatch(/^(müzayededen|\(yedek\))$/);
    await expect(
      page.locator('[data-testid="flipbook"] .book-page-content', { hasText: 'müzayededen' }),
    ).not.toHaveCount(0);

    // Sayfa çevrilince vurgu kalkar
    const before = await bookIndex(page);
    await page.keyboard.press(before > 0 ? 'ArrowLeft' : 'ArrowRight');
    await expect.poll(() => bookIndex(page)).not.toBe(before);
    await expect.poll(() => textHighlight(page)).toBe('');
  });
});
