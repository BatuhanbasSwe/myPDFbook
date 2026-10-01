import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import {
  bookIndex,
  fixturePayload,
  flipSettled,
  headerAction,
  importFixture,
  turnNextPage,
} from './helpers';

const NOVEL = ['novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf'] as const;
const FILE_NAME = /^mypdfbook-yedek-\d{4}-\d{2}-\d{2}\.mypdfbook$/;

/**
 * Web Share: `canShare` false → indirme yolu (iPad'deki WebKit'te paylaşım olabilir; testler dosyayı indirmeyle
 * yakalar). true → paylaşılan dosyalar `window.__shared`'a yazılır.
 */
async function stubShare(target: Page | BrowserContext, canShare: boolean) {
  await target.addInitScript((can) => {
    const w = window as unknown as { __shared: unknown[] };
    w.__shared = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => can });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        w.__shared.push(
          (data.files ?? []).map((f) => ({
            name: f.name,
            type: f.type,
            size: f.size,
            isFile: f instanceof File,
          })),
        );
      },
    });
  }, canShare);
}

/** Aynı cihaz ayarlarıyla ikinci, boş bir tarayıcı (başka cihaz) */
async function otherDevice(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const u = testInfo.project.use;
  const context = await browser.newContext({
    baseURL: u.baseURL,
    viewport: u.viewport,
    userAgent: u.userAgent,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
  });
  await stubShare(context, false);
  return context.newPage();
}

const dialog = (page: Page) => page.getByTestId('backup-dialog');

/** Yedeği alır, indirmeyi yakalar ve dosyanın yolunu döndürür */
async function takeBackup(page: Page, testInfo: TestInfo, { pdfs = true } = {}): Promise<string> {
  await headerAction(page, 'backup-open');
  const d = dialog(page);
  await expect(d).toBeVisible();
  if (!pdfs) await d.getByTestId('backup-include-pdfs').uncheck();
  await d.getByTestId('backup-create').click();
  const link = d.getByTestId('backup-download');
  await expect(link).toBeVisible();
  const downloading = page.waitForEvent('download');
  await link.click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(FILE_NAME);
  const path = testInfo.outputPath(`${pdfs ? 'pdfli' : 'pdfsiz'}-${download.suggestedFilename()}`);
  await download.saveAs(path);
  await expect(d.getByRole('status')).toContainText('Yedek indirildi');
  await d.getByRole('button', { name: 'Pencereyi kapat' }).click();
  await expect(d).toBeHidden();
  return path;
}

/** Yedek dosyasını seçer ve özetini döndürür (pencere açık kalır) */
async function openRestore(page: Page, file: string) {
  await headerAction(page, 'backup-open');
  const d = dialog(page);
  await d.getByTestId('backup-restore-input').setInputFiles(file);
  await expect(d.getByTestId('backup-summary')).toBeVisible();
  return d;
}

async function applyRestore(page: Page) {
  const d = dialog(page);
  await d.getByTestId('backup-apply').click();
  await expect(d.getByTestId('backup-result')).toBeVisible();
  const text = await d.getByTestId('backup-result').innerText();
  await d.getByTestId('backup-done').click();
  await expect(d).toBeHidden();
  return text;
}

/** IndexedDB tablosunun bütün kayıtları */
function records<T>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(
    (name) =>
      new Promise<T[]>((resolve, reject) => {
        const req = indexedDB.open('mypdfbook');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const idb = req.result;
          const all = idb.transaction(name).objectStore(name).getAll();
          all.onsuccess = () => {
            idb.close();
            resolve(all.result as T[]);
          };
          all.onerror = () => {
            idb.close();
            reject(all.error);
          };
        };
      }),
    store,
  );
}

/** Fosforlu kalem işareti (sayfa görünümünde çizilmiş gibi) doğrudan veritabanına */
function addHighlight(page: Page, bookId: string, pdfPage: number) {
  return page.evaluate(
    ({ bookId, pdfPage }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('mypdfbook');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const idb = req.result;
          const tx = idb.transaction('annotations', 'readwrite');
          tx.objectStore('annotations').add({
            bookId,
            page: pdfPage,
            kind: 'highlight',
            color: '#ffd400',
            width: 0.028,
            points: [0.15, 0.3, 0.7, 0.3],
            createdAt: 1000,
            updatedAt: 1000,
          });
          tx.oncomplete = () => {
            idb.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { bookId, pdfPage },
  );
}

const pdfPageOf = (page: Page, pdfPage: number) =>
  page.locator(`[data-testid="flipbook"] [data-pdf-page="${pdfPage + 1}"]`);

test.beforeEach(async ({ page }) => {
  await stubShare(page, false);
});

test('yedek alınır (indirme), başka tarayıcıda yüklenir: kitap, işaret, yer imi ve okuma yeri gelir; ikinci yükleme ikileştirmez', async ({
  page,
  browser,
}, testInfo) => {
  // Birinci cihaz: kitap, okuma yeri, yer imi ve işaret
  await page.goto('/');
  await importFixture(page, ...NOVEL);
  await page.getByTestId('book-open').click();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await turnNextPage(page);
  const index = await bookIndex(page);
  await page.keyboard.press('b');
  await expect.poll(async () => (await records(page, 'bookmarks')).length).toBe(1);
  const [bookmark] = await records<{ bookId: string; pdfPage: number }>(page, 'bookmarks');
  await addHighlight(page, bookmark.bookId, bookmark.pdfPage);
  // Okuma yeri kısa bir gecikmeyle yazılır
  await expect
    .poll(async () => (await records<{ pdfPage?: number }>(page, 'progress'))[0]?.pdfPage)
    .toBe(bookmark.pdfPage);
  await page.goto('/');
  await expect(page.getByTestId('book-card')).toHaveCount(1);
  const file = await takeBackup(page, testInfo);

  // İkinci cihaz: boş kütüphane, yedekten yükle
  const other = await otherDevice(browser, testInfo);
  await other.goto('/');
  await expect(other.getByText('Henüz kitap yok')).toBeVisible();
  const d = await openRestore(other, file);
  await expect(d.getByTestId('summary-books')).toHaveText('1 kitap — hepsi yeni');
  await expect(d.getByTestId('summary-annotations')).toContainText('1 işaret');
  await expect(d.getByTestId('summary-bookmarks')).toHaveText('1 yer imi — hepsi yeni');
  await expect(d.getByTestId('summary-pdfs')).toContainText('1 PDF yedekte');
  expect(await applyRestore(other)).toContain('1 kitap eklendi');

  const card = other.getByTestId('book-card').filter({ hasText: 'Kayıp Şehrin Işıkları' });
  await expect(card.locator('img')).toBeVisible(); // kapak yedekten
  await card.getByTestId('book-open').click();
  await expect(other.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  // Kaldığı yerden açılır; yer imi ve işaret o sayfada
  await expect.poll(() => bookIndex(other)).toBe(index);
  await flipSettled(other);
  await expect(pdfPageOf(other, bookmark.pdfPage).getByTestId('bookmark-corner')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    pdfPageOf(other, bookmark.pdfPage).locator(
      '[data-testid="annotation-layer"] path[data-kind="highlight"]',
    ),
  ).toHaveCount(1);

  // Aynı yedek ikinci kez: özet "hepsi bu cihazda", hiçbir şey ikileşmez
  await other.goto('/');
  const again = await openRestore(other, file);
  await expect(again.getByTestId('summary-books')).toHaveText('1 kitap — hepsi bu cihazda var');
  await expect(again.getByTestId('summary-annotations')).toContainText('hepsi bu cihazda var');
  await expect(again.getByTestId('summary-bookmarks')).toContainText('hepsi bu cihazda var');
  expect(await applyRestore(other)).toContain('Yeni bir şey yoktu');
  expect(await records(other, 'books')).toHaveLength(1);
  expect(await records(other, 'files')).toHaveLength(1);
  expect(await records(other, 'annotations')).toHaveLength(1);
  expect(await records(other, 'bookmarks')).toHaveLength(1);
  await other.context().close();
});

test('PDF\'siz yedek: kitap "PDF bekleniyor" olur ve açılmaz; başka PDF uyarı verir, aynı PDF eklenince açılır', async ({
  page,
  browser,
}, testInfo) => {
  await page.goto('/');
  await importFixture(page, ...NOVEL);
  await expect(page.getByTestId('book-open')).toBeVisible();
  const file = await takeBackup(page, testInfo, { pdfs: false });

  const other = await otherDevice(browser, testInfo);
  await other.goto('/');
  const d = await openRestore(other, file);
  await expect(d.getByTestId('summary-pdfs')).toHaveText("PDF'ler yedekte yok");
  await expect(d.getByTestId('summary-awaiting')).toContainText('PDF bekleniyor');
  expect(await applyRestore(other)).toContain('1 kitap PDF bekliyor');

  const card = other.getByTestId('book-card');
  await expect(card.getByTestId('pdf-missing')).toContainText('PDF bekleniyor');
  await expect(card.getByTestId('book-open')).toHaveCount(0);
  // Adresle açılmaya çalışılsa da okuyucu açılmaz: ne yapılacağı yazar
  const [book] = await records<{ id: string }>(other, 'books');
  await other.goto(`/read/${book.id}`);
  await expect(other.getByTestId('reader-pdf-missing')).toContainText(
    "Bu kitabın PDF'i bu cihazda yok",
  );
  await expect(other.getByTestId('flipbook')).toHaveCount(0);
  await other.getByRole('link', { name: 'Kütüphaneye dön' }).click();

  // Başka bir PDF: uyarı, hiçbir şey eklenmez
  await card.getByTestId('attach-pdf-input').setInputFiles(await fixturePayload('english.pdf'));
  await expect(card.getByTestId('attach-pdf-error')).toContainText('bu kitabın dosyası değil');
  expect(await records(other, 'files')).toHaveLength(0);

  // Aynı PDF: kitap tamamlanır (metni yedekten geldi, yeniden dönüştürülmez) ve açılır
  await card.getByTestId('attach-pdf-input').setInputFiles(await fixturePayload(...NOVEL));
  await expect(card.getByTestId('book-open')).toBeVisible();
  await expect(card.getByTestId('pdf-missing')).toHaveCount(0);
  await card.getByTestId('book-open').click();
  await expect(other.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await expect(other.locator('[data-testid="flipbook"] [data-pdf-page="1"] img')).toBeVisible();
  await other.context().close();
});

test('paylaşabilen cihazda (iPad) yedek paylaşım sayfasına dosya olarak verilir', async ({
  page,
}) => {
  await stubShare(page, true);
  await page.goto('/');
  await importFixture(page, 'english.pdf');
  await expect(page.getByTestId('book-open')).toBeVisible();
  await headerAction(page, 'backup-open');
  const d = dialog(page);
  await d.getByTestId('backup-create').click();
  await d.getByTestId('backup-share').click();
  await expect(d.getByRole('status')).toHaveText('Yedek gönderildi.');
  const shared = await page.evaluate(
    () =>
      (
        window as unknown as {
          __shared: { name: string; type: string; size: number; isFile: boolean }[][];
        }
      ).__shared,
  );
  expect(shared).toHaveLength(1);
  expect(shared[0]).toHaveLength(1);
  expect(shared[0][0]).toMatchObject({ type: 'application/zip', isFile: true });
  expect(shared[0][0].name).toMatch(FILE_NAME);
  expect(shared[0][0].size).toBeGreaterThan(1000);
  // Son yedek zamanı kaydedildi: ilk ipucu artık görünmez
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('mypdfbook:last-backup') ?? '{}').at),
  ).toBeGreaterThan(0);
  await d.getByRole('button', { name: 'Pencereyi kapat' }).click();
  await expect(page.getByTestId('backup-notice')).toHaveCount(0);
});

test('yedek olmayan dosya anlaşılır bir hatayla reddedilir', async ({ page }) => {
  await page.goto('/');
  await headerAction(page, 'backup-open');
  const d = dialog(page);
  await d.getByTestId('backup-restore-input').setInputFiles(await fixturePayload('english.pdf'));
  await expect(d.getByTestId('backup-error')).toContainText('mypdfbook yedeği değil');
  await d.getByRole('button', { name: 'Geri' }).click();
  await expect(d.getByTestId('backup-restore-pick')).toBeVisible();
});

test('ilk kitaptan sonra bir kez "Yedek almayı unutma"; kapatılınca yenilemede de görünmez', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('backup-notice')).toHaveCount(0);
  await importFixture(page, 'english.pdf');
  const notice = page.getByTestId('backup-notice');
  await expect(notice).toHaveAttribute('data-kind', 'hint');
  await expect(notice).toContainText('Yedek almayı unutma');
  await notice.getByTestId('backup-notice-close').click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('book-card')).toHaveCount(1);
  await expect(notice).toHaveCount(0);
});

test('14 günden uzun süre yedek alınmadıysa kütüphanede uyarı; "Yedekle" pencereyi açar, kapatılabilir', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('mypdfbook:last-backup')) return;
    const day = 24 * 60 * 60 * 1000;
    localStorage.setItem('mypdfbook:last-backup', JSON.stringify({ at: Date.now() - 20 * day }));
    localStorage.setItem(
      'mypdfbook:backup-reminder',
      JSON.stringify({ hintDone: true, since: Date.now() - 40 * day }),
    );
  });
  await page.goto('/');
  await expect(page.getByTestId('backup-notice')).toHaveCount(0); // kitap yok
  await importFixture(page, 'english.pdf');
  const notice = page.getByTestId('backup-notice');
  await expect(notice).toHaveAttribute('data-kind', 'reminder');
  await expect(notice).toContainText('14 günden uzun süredir yedek almadın');
  await notice.getByTestId('backup-notice-open').click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText('Son yedek: 20 gün önce');
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await notice.getByTestId('backup-notice-close').click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('book-card')).toHaveCount(1);
  await expect(notice).toHaveCount(0);
});
