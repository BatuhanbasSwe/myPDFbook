import { expect, test, type Page } from '@playwright/test';
import { importFixture } from './helpers';

const NOVEL = ['novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf'] as const;

async function openNovel(page: Page) {
  await page.goto('/');
  await importFixture(page, ...NOVEL);
  await page.getByTestId('book-open').click();
  // Sayfa çevirme motoru kurulunca kitap hazırdır (kıvrılan sayfada kütüphane sonradan kurulur)
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
}

const bookIndex = async (page: Page) =>
  Number(await page.getByTestId('flipbook').getAttribute('data-index'));

/**
 * Kitapta şu an açık olan sayfa(lar) (çift sayfada ikisi). Yandaki sayfalar da DOM'da durur ve kesilen kutuda
 * olsalar bile Playwright onları "görünür" sayar: bu yüzden açık sayfa numarasıyla seçilir (data-page 1'den başlar).
 */
async function shownPages(page: Page) {
  const book = page.getByTestId('flipbook');
  const index = await bookIndex(page);
  const spread = (await book.getAttribute('data-spread')) !== null;
  const numbers = spread ? [index + 1, index + 2] : [index + 1];
  return book.locator(numbers.map((n) => `.book-page[data-page="${n}"]`).join(', '));
}

/** Karşılaştırma için metin: yumuşak tire atılır, boşluklar teke iner */
const plain = (s: string | null) => (s ?? '').replace(/­/g, '').replace(/\s+/g, ' ');

/** Metin açık sayfa(lar)da ve kitap alanının içinde mi */
async function isShown(page: Page, text: string): Promise<boolean> {
  const book = await page.getByTestId('flipbook').boundingBox();
  if (!book) return false;
  const pages = await (await shownPages(page)).all();
  let joined = '';
  for (const el of pages) {
    const box = await el.boundingBox();
    if (
      !box ||
      !(await el.isVisible()) ||
      box.x < book.x - 1 ||
      box.y < book.y - 1 ||
      box.x + box.width > book.x + book.width + 1 ||
      box.y + box.height > book.y + book.height + 1
    )
      return false;
    joined += plain(await el.locator('.book-page-content').textContent());
  }
  return joined.includes(text);
}

/** Görünen kitap alanında x oranında (0 sol … 1 sağ) dokunur */
async function tapAt(page: Page, x: number) {
  const box = await page.getByTestId('flipbook').boundingBox();
  if (!box) throw new Error('kitap görünmüyor');
  await page.mouse.click(box.x + box.width * x, box.y + box.height * 0.5);
}

test('kitap açılır, içindekilerden bölüme gidilir, orijinal sayfa görülür, tema kalıcıdır', async ({
  page,
}) => {
  await openNovel(page);
  await expect(page.getByRole('heading', { name: 'KAYIP ŞEHRİN IŞIKLARI' })).toBeVisible();

  await page.getByTestId('reader-toc').click();
  await page.getByRole('button', { name: /BİRİNCİ BÖLÜM/ }).click();
  await expect(page.getByRole('heading', { name: 'BİRİNCİ BÖLÜM' })).toBeVisible();
  await expect(
    page.getByText('— Nereye gidiyorsun? dedi annesi mutfaktan seslenerek.'),
  ).toBeVisible();

  await tapAt(page, 0.5); // menü (ortaya dokunma)
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

test('ok tuşu, dokunma ve kaydırma sayfa çevirir; yenileyince aynı sayfada açılır', async ({
  page,
}) => {
  await openNovel(page);
  const count = Number(await page.getByTestId('flipbook').getAttribute('data-count'));
  expect(count).toBeGreaterThan(2);
  const start = await bookIndex(page);
  expect(start).toBe(0);

  await page.keyboard.press('ArrowRight');
  await expect.poll(() => bookIndex(page)).toBeGreaterThan(start);
  const afterKey = await bookIndex(page);
  const step = afterKey - start;

  await tapAt(page, 0.1); // sol üçte bir: önceki
  await expect.poll(() => bookIndex(page)).toBe(start);
  await tapAt(page, 0.9); // sağ üçte bir: sonraki
  await expect.poll(() => bookIndex(page)).toBe(afterKey);

  // Sağdan sola kaydırma: sonraki sayfa
  if (afterKey + step < count) {
    const box = (await page.getByTestId('flipbook').boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.8, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, y, { steps: 8 });
    await page.mouse.move(box.x + box.width * 0.2, y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => bookIndex(page)).toBe(afterKey + step);
  }

  const reached = await bookIndex(page);
  await page.waitForTimeout(800); // ilerleme 400 ms sonra kaydedilir
  await page.reload();
  await expect.poll(() => bookIndex(page)).toBe(reached);
});

test('punto değişince aynı yer açık kalır; alt düğmeler sayfa çevirir', async ({ page }) => {
  await openNovel(page);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => bookIndex(page)).toBeGreaterThan(0);
  // Açık (soldaki) sayfanın ilk satırının başı
  const firstPage = (await shownPages(page)).first();
  const marker = plain(await firstPage.locator('.book-page-content > *').first().textContent())
    .trim()
    .slice(0, 12);
  expect(marker.length).toBeGreaterThan(3);
  expect(await isShown(page, marker)).toBe(true);

  await tapAt(page, 0.5);
  await page.getByTestId('reader-settings').click();
  await page.getByRole('button', { name: 'Punto artır' }).click();
  await page.getByRole('button', { name: 'Punto artır' }).click();
  await page.getByTestId('pref-buttons').check();
  await page.getByTestId('reader-settings').click(); // paneli kapat
  // Aynı metin hâlâ açık sayfada (yandaki, ekranda olmayan sayfada değil)
  await expect.poll(() => isShown(page, marker)).toBe(true);

  await tapAt(page, 0.5); // menüyü kapat: alt düğmeler menü kapalıyken görünür
  const before = await bookIndex(page);
  const total = Number(await page.getByTestId('flipbook').getAttribute('data-count'));
  // Kısa kitapta son sayfalardaysak geri düğmesi denenir
  if (before + 2 < total) {
    await page.getByRole('button', { name: 'Sonraki sayfa' }).click();
    await expect.poll(() => bookIndex(page)).toBeGreaterThan(before);
  } else {
    await page.getByRole('button', { name: 'Önceki sayfa' }).click();
    await expect.poll(() => bookIndex(page)).toBeLessThan(before);
  }
});

test('orijinal sayfa penceresi açıkken ok tuşları sayfa çevirmez', async ({ page }) => {
  await openNovel(page);
  expect(await bookIndex(page)).toBe(0);
  await page.getByTestId('original-page').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(800); // kıvrılan sayfa animasyonu 650 ms
  await page.getByRole('button', { name: 'Kapat' }).click();
  await expect(dialog).toBeHidden();
  expect(await bookIndex(page)).toBe(0);
  // Pencere kapanınca tuşlar yine çalışır
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => bookIndex(page)).toBeGreaterThan(0);
});

test('Esc ve M menüyü açıp kapatır; Esc paneli kapatıp odağı düğmesine verir; panel açıkken dokunma yalnızca paneli kapatır', async ({
  page,
}) => {
  await openNovel(page);
  const header = page.getByTestId('reader-header');
  await expect(header).toHaveAttribute('data-shown', 'true');
  await page.keyboard.press('Escape');
  await expect(header).toHaveAttribute('data-shown', 'false');
  await page.keyboard.press('m');
  await expect(header).toHaveAttribute('data-shown', 'true');

  // Panel açılınca odak panelin içinde; Esc paneli kapatır, odak düğmesine döner, menü açık kalır
  await page.getByTestId('reader-settings').click();
  const panel = page.getByTestId('reader-panel');
  await expect(panel).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => !!document.activeElement?.closest('[data-testid="reader-panel"]')),
    )
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('reader-settings')).toBeFocused();
  await expect(header).toHaveAttribute('data-shown', 'true');

  // Panel açıkken sağ kenara dokunma sayfa çevirmez, paneli kapatır
  await page.getByTestId('reader-toc').click();
  await expect(panel).toBeVisible();
  await tapAt(page, 0.9);
  await expect(panel).toHaveCount(0);
  await page.waitForTimeout(800);
  expect(await bookIndex(page)).toBe(0);
});

test('slayt: hızlı basılan tuşlar kaybolmaz, çevirme takılmaz', async ({ page }) => {
  await openNovel(page);
  await page.getByTestId('reader-settings').click();
  await page.getByTestId('effect-slide').click();
  // Kısa örnek kitapta yeterince sayfa olsun: tek sayfa, büyük punto
  await page.getByLabel('Genişse çift sayfa').uncheck();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Punto artır' }).click();
  await page.keyboard.press('Escape'); // paneli kapat
  await expect(page.getByTestId('reader-panel')).toHaveCount(0);
  const book = page.getByTestId('flipbook');
  await expect(book).not.toHaveAttribute('data-effect', 'curl');
  await expect(book).not.toHaveAttribute('data-spread');
  await expect
    .poll(async () => Number(await book.getAttribute('data-count')))
    .toBeGreaterThanOrEqual(4);
  expect(await bookIndex(page)).toBe(0);

  // Kayma sürerken basılan tuş bir öncekini hemen bitirip yeni kaymayı başlatır
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => bookIndex(page)).toBe(3);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => bookIndex(page)).toBe(2);
  // Açık sayfa kitap alanında görünür (şerit ortada kaldı)
  const shown = (await shownPages(page)).first();
  await expect(shown).toBeInViewport();
  const text = plain(await shown.locator('.book-page-content').textContent())
    .trim()
    .slice(0, 12);
  await expect.poll(() => isShown(page, text)).toBe(true);

  // Sürükleyerek: sağdan sola kaydırma sonraki sayfayı açar
  const box = (await book.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.8, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => bookIndex(page)).toBe(3);
  const after = plain(
    await (await shownPages(page)).first().locator('.book-page-content').textContent(),
  )
    .trim()
    .slice(0, 12);
  await expect.poll(() => isShown(page, after)).toBe(true);
});

test('ekran boyutu ya da punto değişince kitap kaybolmaz (yenisi hazır olana dek önceki sayfalar görünür)', async ({
  page,
}) => {
  await openNovel(page);
  // Kitap bir an bile kaldırılırsa (yerine "Sayfalar hazırlanıyor…") işaretlenir
  await page.evaluate(() => {
    const w = window as unknown as { bookLost?: boolean };
    w.bookLost = false;
    new MutationObserver(() => {
      if (!document.querySelector('[data-testid="flipbook"]')) w.bookLost = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.width - 40, height: size.height - 30 });
  await page.setViewportSize({ width: size.width - 80, height: size.height });
  await page.setViewportSize(size);
  await page.getByTestId('reader-settings').click();
  await page.getByRole('button', { name: 'Punto artır' }).click();
  await page.getByRole('button', { name: 'Punto azalt' }).click();
  await page.waitForTimeout(600);
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { bookLost?: boolean }).bookLost)).toBe(
    false,
  );
});

test('taranmış PDF sayfaları görsel olarak gösterilir', async ({ page }) => {
  await page.goto('/');
  await importFixture(page, 'scanned.pdf');
  await page.getByTestId('book-open').click();
  await expect(page.getByRole('img', { name: 'Sayfa 1' })).toBeVisible({ timeout: 30_000 });
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
