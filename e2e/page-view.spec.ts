import { expect, test, type Page } from '@playwright/test';
import { headerAction, importFixture } from './helpers';

const NOVEL = ['novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf'] as const;

/** Varsayılan görünüm: PDF'in kendi sayfaları */
async function openNovel(page: Page) {
  await page.goto('/');
  await importFixture(page, ...NOVEL);
  await page.getByTestId('book-open').click();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
}

/** Durum satırındaki açık PDF sayfaları ("3" ya da "2–3") */
async function shownPdfPages(page: Page): Promise<number[]> {
  const text = (await page.getByTestId('page-status').textContent()) ?? '';
  const label = text.split('/')[0].trim();
  return label.split('–').map(Number);
}

/** Açık sayfa(lar)ın görüntüsü çizildi mi */
async function expectPageImage(page: Page, pdfPage: number) {
  await expect(
    page.locator(`[data-testid="flipbook"] [data-pdf-page="${pdfPage}"] img`),
  ).toBeVisible();
}

async function tapAt(page: Page, x: number) {
  const box = await page.getByTestId('flipbook').boundingBox();
  if (!box) throw new Error('kitap görünmüyor');
  await page.mouse.click(box.x + box.width * x, box.y + box.height * 0.5);
}

test('kitap sayfa görünümünde (PDF sayfaları) açılır; tuş ve dokunma sayfa çevirir; yenileyince aynı sayfa', async ({
  page,
}) => {
  await openNovel(page);
  expect(await shownPdfPages(page)).toEqual([1]);
  await expectPageImage(page, 1);
  // Metin görünümüne özgü düğme yok, görünüm değiştirici var
  await expect(page.getByTestId('original-page')).toHaveCount(0);
  await expect(page.getByTestId('view-toggle')).toContainText('Metin');

  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Math.max(...(await shownPdfPages(page)))).toBeGreaterThan(1);
  const after = await shownPdfPages(page);
  await expectPageImage(page, after[0]);

  await page.waitForTimeout(800); // kıvrılan sayfa animasyonu 650 ms
  await tapAt(page, 0.05); // sol kenar: önceki
  await expect.poll(() => shownPdfPages(page)).toEqual([1]);
  await page.waitForTimeout(800);
  await tapAt(page, 0.95); // sağ kenar: sonraki
  await expect.poll(() => shownPdfPages(page)).toEqual(after);

  await page.waitForTimeout(800); // ilerleme 400 ms sonra kaydedilir
  await page.reload();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await expect.poll(() => shownPdfPages(page)).toEqual(after);
});

test('Metin görünümüne geçince aynı yer, Sayfa görünümüne dönünce aynı sayfa açılır', async ({
  page,
}) => {
  await openNovel(page);
  await page.getByTestId('page-status').click();
  await page.getByTestId('page-jump').fill('3');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await shownPdfPages(page)).includes(3)).toBe(true);
  const before = await shownPdfPages(page);

  await headerAction(page, 'view-toggle');
  await expect(page.getByTestId('view-toggle')).toContainText('Sayfa');
  // 3. PDF sayfası birinci bölümün başı: metinde bölüm başlığı görünür
  await expect(page.getByRole('heading', { name: 'BİRİNCİ BÖLÜM' })).toBeVisible();

  await headerAction(page, 'view-toggle');
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await expect.poll(() => shownPdfPages(page)).toEqual(before);
});

test('sayfaya git: sayı yazınca o sayfa açılır; aralık dışı sayı kabul edilmez; Esc vazgeçer', async ({
  page,
}) => {
  await openNovel(page);
  await page.getByTestId('page-status').click();
  const input = page.getByTestId('page-jump');
  await expect(input).toBeFocused();
  await input.fill('99');
  await expect(page.getByRole('button', { name: 'Git' })).toBeDisabled();
  await expect(page.getByText('1–6 arası')).toBeVisible();
  await input.press('Escape');
  await expect(input).toHaveCount(0);
  // Esc yalnızca giriş kutusunu kapattı: menü açık
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'true');

  await page.getByTestId('page-status').click();
  await page.getByTestId('page-jump').fill('5');
  await page.getByRole('button', { name: 'Git' }).click();
  await expect.poll(async () => (await shownPdfPages(page)).includes(5)).toBe(true);
  await expectPageImage(page, 5);
});

test('alt düğmeler ortada, sayfa numarasının iki yanında; sayfa çevirir', async ({ page }) => {
  await openNovel(page);
  await page.getByTestId('reader-settings').click();
  await page.getByTestId('pref-buttons').check();
  await page.keyboard.press('Escape'); // paneli kapat
  await page.keyboard.press('Escape'); // menüyü gizle: düğmeler görünür
  const nextButton = page.getByRole('button', { name: 'Sonraki sayfa' });
  const prevButton = page.getByRole('button', { name: 'Önceki sayfa' });
  await expect(nextButton).toBeVisible();
  const width = page.viewportSize()!.width;
  const nb = (await nextButton.boundingBox())!;
  const pb = (await prevButton.boundingBox())!;
  // İkisi de ortaya yakın: kenarlarda değil
  expect(Math.abs(nb.x + nb.width / 2 - width / 2)).toBeLessThan(120);
  expect(Math.abs(pb.x + pb.width / 2 - width / 2)).toBeLessThan(120);
  expect(pb.x).toBeLessThan(nb.x);

  await nextButton.click();
  await expect.poll(async () => Math.max(...(await shownPdfPages(page)))).toBeGreaterThan(1);
});

test('taranmış kitap da sayfa görünümünde sayfa görüntüleriyle açılır', async ({ page }) => {
  await page.goto('/');
  await importFixture(page, 'scanned.pdf');
  await page.getByTestId('book-open').click();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await expectPageImage(page, 1);
});

test('koyu temada sayfa görünümünün zemini koyu; çevirme gölgesi açık temadaki gibi (ters çevrilmez), metin görünümünde ters', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('mypdfbook:theme', 'black'));
  await openNovel(page);
  // Okuyucunun kâğıt rengi temayı izler; kıvrılan sayfanın gölgesine uygulanan süzgeç görünüme göre değişir
  const probe = () =>
    page.evaluate(() => {
      const root = document.querySelector('[data-testid="flipbook"]')!.closest('.fixed')!;
      const shadow = document.createElement('div');
      shadow.className = 'stf__outerShadow';
      root.append(shadow);
      const filter = getComputedStyle(shadow).filter;
      shadow.remove();
      return { paper: getComputedStyle(root).getPropertyValue('--paper').trim(), filter };
    });
  expect(await probe()).toEqual({ paper: '#000000', filter: 'none' });

  await headerAction(page, 'view-toggle');
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  expect(await probe()).toEqual({ paper: '#000000', filter: 'invert(1)' });
});

test('tek sayfada sayfanın köşesine dokunmak da tek sayfa çevirir (kütüphane ayrıca çevirmez)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('mypdfbook:typography'))
      localStorage.setItem('mypdfbook:typography', JSON.stringify({ spread: 'single' }));
  });
  await openNovel(page);
  await page.keyboard.press('Escape'); // menüyü gizle: alt çubuk sayfanın üstünde durmasın
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'false');
  const box = (await page.getByTestId('flipbook').boundingBox())!;
  const corner = (x: number, y: number) =>
    page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  await corner(0.96, 0.04); // sağ üst köşe
  await expect.poll(() => shownPdfPages(page)).toEqual([2]);
  await page.waitForTimeout(800);
  await corner(0.96, 0.96); // sağ alt köşe
  await expect.poll(() => shownPdfPages(page)).toEqual([3]);
  await page.waitForTimeout(800);
  await corner(0.04, 0.96); // sol alt köşe
  await expect.poll(() => shownPdfPages(page)).toEqual([2]);
  await page.waitForTimeout(800);
  expect(await shownPdfPages(page)).toEqual([2]);
});

test('parlaklık: ay kitabı karartır, güneş açar; ayar yenilemeden sonra da kalır', async ({
  page,
}) => {
  await openNovel(page);
  const filter = () =>
    page.evaluate(
      () =>
        (document.querySelector('[data-testid="flipbook"]')!.parentElement as HTMLElement).style
          .filter,
    );
  expect(await filter()).toBe('');
  await page.getByTestId('reader-settings').click();
  await expect(page.getByTestId('brightness')).toBeVisible();
  await page.getByRole('button', { name: 'Parlaklığı azalt' }).click();
  await page.getByRole('button', { name: 'Parlaklığı azalt' }).click();
  await expect.poll(filter).toBe('brightness(0.8)');
  await page.getByRole('button', { name: 'Parlaklığı artır' }).click();
  await expect.poll(filter).toBe('brightness(0.9)');
  await page.reload();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await expect.poll(filter).toBe('brightness(0.9)');
});

test('telefonda üst çubuk: başlık okunur; ikincil eylemler ⋯ menüsünde, menü klavyeyle ve dokunmayla kullanılır', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'pixel', 'dar ekran düzeni');
  await page.setViewportSize({ width: 390, height: 844 });
  await openNovel(page);
  const header = page.getByTestId('reader-header');

  // Başlık "K…" diye kısalmaz; başlıkta yalnızca geri, başlık, sesli oku, içindekiler, Aa ve ⋯
  const title = (await header.getByRole('heading').boundingBox())!;
  expect(title.width).toBeGreaterThanOrEqual(120);
  for (const id of ['speed-read', 'reader-notes', 'view-toggle', 'pen-mode'])
    await expect(page.getByTestId(id)).toBeHidden();
  const more = page.getByRole('button', { name: 'Diğer' });
  for (const control of [
    page.getByRole('link', { name: 'Kütüphaneye dön' }),
    page.getByTestId('reader-toc'),
    more,
  ]) {
    const box = (await control.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByTestId('reader-settings')).toBeVisible();
  await expect(more).toHaveAttribute('aria-haspopup', 'menu');
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  // Açılınca odak ilk öğede; oklar dolaşır (sonda başa döner), Home/End ilk ve son öğe; oklar sayfa çevirmez
  await more.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const items = menu.locator('[role^="menuitem"]');
  await expect(items).toHaveText(['Hızlı oku', 'Notlar', 'Metin görünümü', 'Kalem kipi']);
  for (const item of await items.all()) {
    const box = (await item.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    await expect(item.locator('svg').first()).toBeVisible();
  }
  await expect(items.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.nth(3)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(items.nth(3)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(items.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await expect(items.nth(0)).toBeFocused();

  // Esc menüyü kapatır, odak ⋯ düğmesine döner; üst çubuk açık kalır
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(header).toHaveAttribute('data-shown', 'true');
  expect(await shownPdfPages(page)).toEqual([1]);

  // Dışarıya (başlığa) dokunma kapatır
  await more.click();
  await expect(menu).toBeVisible();
  await header.getByRole('heading').click();
  await expect(menu).toHaveCount(0);
  // Kitaba dokunma yalnızca menüyü kapatır: sayfa çevrilmez, üst çubuk gizlenmez
  await more.click();
  await expect(menu).toBeVisible();
  await tapAt(page, 0.95);
  await expect(menu).toHaveCount(0);
  await expect(header).toHaveAttribute('data-shown', 'true');
  await page.waitForTimeout(800); // kıvrılan sayfa animasyonu 650 ms
  expect(await shownPdfPages(page)).toEqual([1]);

  // Menü açıkken panel açılmaz (panel menünün üstünde kalırdı): ⋯ açık paneli kapatır
  await page.getByTestId('reader-toc').click();
  await expect(page.getByTestId('reader-panel')).toBeVisible();
  await more.click();
  await expect(page.getByTestId('reader-panel')).toHaveCount(0);
  await expect(menu).toBeVisible();
  // Notlar: menü kapanır, panel açılır; Esc paneli kapatınca odak ⋯ düğmesine döner
  await page.getByTestId('more-reader-notes').click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('reader-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('reader-panel')).toHaveCount(0);
  await expect(more).toBeFocused();

  // Kalem kipi: açıkken menüde işaretli, basınca kapanır
  await headerAction(page, 'pen-mode');
  await expect(page.getByTestId('pen-toolbar')).toBeVisible();
  await expect(header).toHaveAttribute('data-shown', 'false');
  await page.keyboard.press('m');
  await expect(header).toHaveAttribute('data-shown', 'true');
  await more.click();
  // Araç çubuğu menünün üstünü örtmesin: menü açıkken çekilir
  await expect(page.getByTestId('pen-toolbar')).toHaveCount(0);
  const pen = menu.getByRole('menuitemcheckbox', { name: 'Kalem kipi' });
  await expect(pen).toHaveAttribute('aria-checked', 'true');
  await pen.click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('pen-toolbar')).toHaveCount(0);
  await expect(page.getByTestId('pen-mode')).toHaveAttribute('aria-pressed', 'false');

  // Görünüm menüden değişir; metin görünümünde "Orijinal sayfa" menüde
  await headerAction(page, 'view-toggle');
  await expect(page.getByTestId('original-page')).toBeHidden();
  await more.click();
  await expect(items).toHaveText(['Hızlı oku', 'Notlar', 'Sayfa görünümü', 'Orijinal sayfa']);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter'); // ikinci öğe (Notlar) klavyeyle seçilir
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('reader-panel')).toBeVisible();
});
