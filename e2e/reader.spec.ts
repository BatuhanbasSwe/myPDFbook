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
  // Görünen ilk sayfanın ilk satırının başı
  const firstPage = page.locator('[data-page]').filter({ visible: true }).first();
  const marker = ((await firstPage.locator('.book-page-content > *').first().textContent()) ?? '')
    .trim()
    .slice(0, 12);
  expect(marker.length).toBeGreaterThan(3);

  await tapAt(page, 0.5);
  await page.getByTestId('reader-settings').click();
  await page.getByRole('button', { name: 'Punto artır' }).click();
  await page.getByRole('button', { name: 'Punto artır' }).click();
  await page.getByTestId('pref-buttons').check();
  await page.getByTestId('reader-settings').click(); // paneli kapat
  // Aynı metin hâlâ görünen sayfalardan birinde
  await expect(page.getByText(marker).first()).toBeVisible();

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
