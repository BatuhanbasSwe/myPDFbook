import { expect, test, type Page } from '@playwright/test';
import { headerAction, importFixture, statusPages } from './helpers';
import { MODEL, PIPER_FILES, piperLog, servePiper, stubVoices, type SynthLog } from './piperStubs';

const NOVEL = ['novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf'] as const;

async function openNovel(page: Page) {
  await page.goto('/');
  await importFixture(page, ...NOVEL);
  await page.getByTestId('book-open').click();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
}

async function showOptions(page: Page) {
  const button = page.getByTestId('read-aloud-options');
  if (await button.isVisible()) await button.click();
}

const shownPdfPages = statusPages;

test('yapay zekâ sesi: bir kez önerilir; indirme ilerler ve iptal edilir; inince seçilir, okuma vurguyla ilerler, sayfa çevrilir; çevrimdışı yeniden kullanılır; kaldırılır', async ({
  page,
  browserName,
}) => {
  test.setTimeout(120_000);
  await stubVoices(page);
  let release!: () => void;
  const requests = await servePiper(
    page,
    new Promise<void>((r) => {
      release = r;
    }),
  );
  await openNovel(page);

  // Hiç ses seçilmedi: yapay zekâ sesi önerilir; "Sesleri gör" menüyü açar
  await headerAction(page, 'read-aloud');
  await expect(page.getByTestId('voice-suggest')).toBeVisible();
  await page.getByTestId('voice-suggest-open').click();
  const menu = page.getByTestId('voice-menu');
  await expect(menu).toBeVisible();
  await expect(page.getByTestId('voice-suggest')).toHaveCount(0);
  // Türkçe katalog sesleri: DFKI ve uygulamayla yayınlanan Batuhan; lisans ve atıfları menüde
  await expect(menu.getByTestId('voice-neural')).toHaveText([/^DFKI/, /^Batuhan.*İndir/]);
  await expect(menu.getByTestId('voice-credits')).toContainText('DFKI: CC BY-NC-SA 4.0');
  await expect(menu.getByTestId('voice-credits')).toContainText(
    'Batuhan: CC BY-NC-SA 4.0 (ticari olmayan kullanım) · DFKI Türkçe sesinden türetildi',
  );
  const row = menu.getByTestId('voice-neural').filter({ hasText: 'DFKI' });
  await expect(row).toHaveText(/^DFKI.*İndir · 96 MB/);

  // İndirme: çalışma zamanı dosyaları iner, model beklerken ilerleme gösterilir; iptal edilir
  await row.click();
  const progress = menu.getByTestId('voice-progress');
  await expect(progress).toBeVisible();
  await expect
    .poll(async () => Number(await progress.getByRole('progressbar').getAttribute('aria-valuenow')))
    .toBeGreaterThan(20);
  expect(
    Number(await progress.getByRole('progressbar').getAttribute('aria-valuenow')),
  ).toBeLessThan(100);
  await menu.getByTestId('voice-cancel').click();
  // Çalışma zamanı dosyaları cihazda kaldı: yalnızca model indirilecek
  await expect(row).toHaveText(/İndir · 63 MB/);

  // Yeniden: model de iner, ses kendiliğinden seçilir ve okuma o sesle sürer
  release();
  await row.click();
  await expect(row).toHaveText(/^DFKI.*Cihazda/);
  await expect(row).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await piperLog(page)).length).toBeGreaterThan(0);
  expect((await piperLog(page))[0]).toMatchObject({
    voice: 'piper:tr_TR-dfki-medium',
    lengthScale: 1,
  });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await showOptions(page);
  await expect(page.getByTestId('read-aloud-voice')).toHaveText('DFKI');

  // Okuma kendiliğinden ilerler: sıradaki cümleler önceden sentezlenir, sayfa çevrilir, vurgu açık sayfada
  await expect
    .poll(async () => Math.max(...(await shownPdfPages(page))), { timeout: 60_000 })
    .toBeGreaterThan(1);
  const texts = (await piperLog(page)).map((l) => l.text);
  expect(new Set(texts).size).toBeGreaterThan(3);
  // Okuma sürüyor (sayfa çevrilebilir): okunan cümlenin vurgusu açık sayfalardan birinde görünür
  await expect
    .poll(async () => {
      for (const p of await shownPdfPages(page)) {
        const rect = page.locator(
          `[data-testid="flipbook"] [data-pdf-page="${p}"] [data-testid="sentence-overlay"] rect`,
        );
        if ((await rect.count()) > 0) return true;
      }
      return false;
    })
    .toBe(true);

  // Hız: length_scale = 1 / hız
  await page.locator('[data-testid="read-aloud-rates"] [data-rate="2"]').click();
  await expect.poll(async () => (await piperLog(page)).at(-1)?.lengthScale).toBe(0.5);
  await page.getByTestId('read-aloud-close').click();

  // Çevrimdışı yeniden kullanım: ses dosyalarına ağ yok; ses cihazdan okunur, seçim kalıcı
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const offline: string[] = [];
  await page.route(PIPER_FILES, (route) => {
    offline.push(route.request().url());
    return route.abort('internetdisconnected');
  });
  // Playwright'ın Windows'taki WebKit'i (geçici oturum) Cache Storage'ı sayfa yenilenince boşaltır; gerçek Safari
  // saklar. WebKit'te sayfa yenilenmeden okuma kapatılıp açılır (ses dosyalarına ağ gerekmemeli).
  if (browserName !== 'webkit') {
    await page.reload();
    await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
    expect(await piperLog(page)).toEqual([]); // yeni sayfa
  } else
    await page.evaluate(
      () => ((window as unknown as { __piperLog: SynthLog[] }).__piperLog.length = 0),
    );
  await headerAction(page, 'read-aloud');
  await expect(page.getByTestId('voice-suggest')).toHaveCount(0);
  await expect.poll(async () => (await piperLog(page)).length).toBeGreaterThan(2);
  expect((await piperLog(page))[0]).toMatchObject({
    voice: 'piper:tr_TR-dfki-medium',
    lengthScale: 0.5,
  });
  expect(offline).toEqual([]);

  // "Sesi kaldır": dosyalar silinir, okuma sistem sesine geçer
  await showOptions(page);
  await page.getByTestId('read-aloud-voice').click();
  await page.getByTestId('voice-menu').getByTestId('voice-remove').click();
  await expect(
    page.getByTestId('voice-menu').getByTestId('voice-neural').filter({ hasText: 'DFKI' }),
  ).toHaveText(/İndir · 96 MB/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('read-aloud-voice')).toHaveText(/Emel|Yelda/);
  const cached = await page.evaluate(async () =>
    (await (await caches.open('mypdfbook-piper-v1')).keys()).map((r) => r.url),
  );
  expect(cached).toEqual([]);
  expect(requests.filter((u) => MODEL.test(u)).length).toBe(2);
});
