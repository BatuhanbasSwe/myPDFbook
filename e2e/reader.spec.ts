import { expect, test, type Page } from '@playwright/test';
import { flipSettled, importFixture, turnNextPage } from './helpers';

const NOVEL = ['novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf'] as const;

// Bu dosya metin görünümünü sınar (varsayılan sayfa görünümü: page-view.spec.ts). Ayar yalnızca ilk açılışta
// yazılır: test içinde değiştirilen ayarlar yenilemeden sonra da kalır.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('mypdfbook:reader'))
      localStorage.setItem('mypdfbook:reader', JSON.stringify({ view: 'text' }));
  });
});

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

test('kitap açılır, içindekilerden bölüme gidilir, tema kalıcıdır; orijinal sayfa seçeneği yok', async ({
  page,
}) => {
  await openNovel(page);
  await expect(page.getByRole('heading', { name: 'KAYIP ŞEHRİN IŞIKLARI' })).toBeVisible();

  const since = await pageNow(page);
  await page.getByTestId('reader-toc').click();
  await page.getByRole('button', { name: /BİRİNCİ BÖLÜM/ }).click();
  await expect(page.getByRole('heading', { name: 'BİRİNCİ BÖLÜM' })).toBeVisible();
  await expect(
    page.getByText('— Nereye gidiyorsun? dedi annesi mutfaktan seslenerek.'),
  ).toBeVisible();

  await tapAt(page, 0.5); // menü (ortaya dokunma)
  // Gerçek sayfa için sayfa görünümü var: ayrıca "Orijinal sayfa" penceresi yok
  await expect(page.getByTestId('original-page')).toHaveCount(0);

  await page.getByTestId('reader-settings').click();
  await page.getByTestId('theme-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // Bölüme gidilen yer 400 ms sonra kaydedilir: yenilemeden önce yazılmış olsun
  await waitProgressSaved(page, since, true);
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

  // Her çevirmeden sonra okuma yeri kaydı beklenir: son kayıt son sayfanındır (bkz. waitProgressSaved)
  let since = await pageNow(page);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => bookIndex(page)).toBeGreaterThan(start);
  await waitProgressSaved(page, since, true);
  const afterKey = await bookIndex(page);
  const step = afterKey - start;

  since = await pageNow(page);
  await tapAt(page, 0.1); // sol üçte bir: önceki
  await expect.poll(() => bookIndex(page)).toBe(start);
  await waitProgressSaved(page, since);
  since = await pageNow(page);
  await tapAt(page, 0.9); // sağ üçte bir: sonraki
  await expect.poll(() => bookIndex(page)).toBe(afterKey);
  await waitProgressSaved(page, since, true);

  // Sağdan sola kaydırma: sonraki sayfa
  if (afterKey + step < count) {
    since = await pageNow(page);
    const box = (await page.getByTestId('flipbook').boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.8, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, y, { steps: 8 });
    await page.mouse.move(box.x + box.width * 0.2, y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => bookIndex(page)).toBe(afterKey + step);
    await waitProgressSaved(page, since, true);
  }

  const reached = await bookIndex(page);
  await page.reload();
  await expect.poll(() => bookIndex(page)).toBe(reached);
});

/** Sayfanın saati (Date.now: okuma yeri kaydının `updatedAt`ı bununla yazılır) */
const pageNow = (page: Page) => page.evaluate(() => Date.now());

/**
 * Sayfa çevirmeden önce (`since`, sayfanın saati) alınan andan sonra okuma yeri IndexedDB'ye yazılana dek bekler
 * (`moved`: yer kitabın başı değil). Yer, sayfa değiştikten 400 ms sonra kaydedilir; sabit bir bekleme yük altında
 * yetmeyebilir, yenilemede yazılmamış kayıt kaybolur. Her çevirmeden sonra beklenirse `since`ten sonraki kayıt bu
 * çevirmenindir: açılıştaki yer kaydedilmez, önceki yerin kaydı bir önceki adımda beklenmiştir.
 */
async function waitProgressSaved(page: Page, since: number, moved = false) {
  await expect
    .poll(() =>
      page.evaluate(
        ({ since, moved }) =>
          new Promise<boolean>((resolve, reject) => {
            const req = indexedDB.open('mypdfbook');
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
              const idb = req.result;
              if (!idb.objectStoreNames.contains('progress')) {
                idb.close();
                return resolve(false);
              }
              const all = idb.transaction('progress').objectStore('progress').getAll();
              all.onsuccess = () => {
                idb.close();
                resolve(
                  (all.result as { updatedAt: number; percent: number }[]).some(
                    (r) => r.updatedAt > since && (!moved || r.percent > 0),
                  ),
                );
              };
              all.onerror = () => {
                idb.close();
                reject(all.error);
              };
            };
          }),
        { since, moved },
      ),
    )
    .toBe(true);
}

/** Uygulamanın IndexedDB veritabanındaki (mypdfbook) sayfalama kayıtlarının sayısı */
const storedLayouts = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const req = indexedDB.open('mypdfbook');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const idb = req.result;
          if (!idb.objectStoreNames.contains('layouts')) {
            idb.close();
            return resolve(0);
          }
          const count = idb.transaction('layouts').objectStore('layouts').count();
          count.onsuccess = () => {
            idb.close();
            resolve(count.result);
          };
          count.onerror = () => {
            idb.close();
            reject(count.error);
          };
        };
      }),
  );

test('sayfalama IndexedDB’de saklanır; yenileyince aynı sayfa sayısıyla ve aynı sayfada, saklanan sayfalamayla açılır', async ({
  page,
}) => {
  await openNovel(page);
  const book = page.getByTestId('flipbook');
  // Ölçülen sayfalama saklanınca (yazı tipi yüklendikten sonra ölçülür) kitap onunla çizilmiştir
  await expect.poll(() => storedLayouts(page)).toBeGreaterThan(0);
  const count = Number(await book.getAttribute('data-count'));
  expect(count).toBeGreaterThan(2);
  const since = await pageNow(page);
  await turnNextPage(page);
  const reached = await bookIndex(page);
  expect(reached).toBeGreaterThan(0);
  await waitProgressSaved(page, since, true);

  await page.reload();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await expect(book).toHaveAttribute('data-count', String(count));
  await expect.poll(() => bookIndex(page)).toBe(reached);

  // Açılışta gerçekten saklanan sayfalama kullanılıyor mu: son sayfa sınırı atılır, sayfa sayısı bir azalmalı
  await page.evaluate(async () => {
    const url = '/src/db/db.ts';
    const { db } = await import(/* @vite-ignore */ url);
    const all = (await db.layouts.toArray()) as { starts: unknown[] }[];
    await db.layouts.bulkPut(all.map((r) => ({ ...r, starts: r.starts.slice(0, -1) })));
  });
  await page.reload();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await expect(book).toHaveAttribute('data-count', String(count - 1));
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

test('menü gizlenince odak görünmez düğmede kalmaz: Boşluk sayfa çevirir, paneli açmaz', async ({
  page,
}) => {
  await openNovel(page);
  const settings = page.getByTestId('reader-settings');
  await settings.click();
  await settings.click(); // panel kapandı, odak düğmede
  await expect(page.getByTestId('reader-panel')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => bookIndex(page)).toBeGreaterThan(0);
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'false');
  // Kısa örnek kitapta çift sayfada ikinci açılış sonuncusu olabilir: başa dönülür
  await flipSettled(page);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => bookIndex(page)).toBe(0);
  await flipSettled(page);
  await page.keyboard.press(' ');
  await expect.poll(() => bookIndex(page)).toBeGreaterThan(0);
  await expect(page.getByTestId('reader-panel')).toHaveCount(0);
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
  // Yeni punto arka planda sayfalanır; o sırada önceki sayfalama gösterilir. Tuşlara son sayfalama gelmeden basılırsa
  // sayfa sayısı kayma sürerken değişir: süren kayma bırakılır, sayfa yeniden hesaplanır (yük altında takılıyordu).
  // Açık sayfanın yazısı son puntoyla çizilene dek beklenir (dar ekranda eski sayfalama da tek sayfa ve 4+ sayfadır)
  const size = await page.evaluate(
    () => (JSON.parse(localStorage.getItem('mypdfbook:typography')!) as { size: number }).size,
  );
  await expect
    .poll(() =>
      book
        .locator('.book-page-content')
        .first()
        .evaluate((el) => (el as HTMLElement).style.getPropertyValue('--book-size')),
    )
    .toBe(`${size}px`);
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

  // Geçiş bitti olayı hiç gelmese de (geçiş kapalı) bekçi kaymayı bitirir; şerit ortaya döner
  await page.addStyleTag({
    content: '[data-testid="flipbook"] > div { transition: none !important; }',
  });
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => bookIndex(page)).toBe(2);
  await expect
    .poll(() => book.locator(':scope > div').evaluate((el) => (el as HTMLElement).style.transform))
    .toBe('translateX(0px)');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => bookIndex(page)).toBe(3);
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
  // Son boyut farklı: bekleme süresi dolunca gerçekten yeniden sayfalanır
  await page.setViewportSize({ width: size.width - 60, height: size.height - 20 });
  await page.waitForTimeout(800);
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
