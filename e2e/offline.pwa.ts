import { expect, test, type Page } from '@playwright/test';
import { headerAction, importFixture } from './helpers';

// playwright.pwa.config.ts ile koşar (derleme + önizleme, /myPDFbook/ alt yolu).

const NOVEL = ['novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf'] as const;

/** Sesli okuma için en küçük sahte konuşma motoru: okunan cümleler kaydedilir, konuşma kendiliğinden bitmez */
async function stubSpeech(page: Page) {
  await page.addInitScript(() => {
    const log: string[] = [];
    let speaking = false;
    const synth = Object.assign(new EventTarget(), {
      pending: false,
      paused: false,
      getVoices: () => [
        { voiceURI: 'tr', name: 'Yelda', lang: 'tr-TR', default: true, localService: true },
      ],
      speak(u: { text: string; onstart: (() => void) | null; onend: (() => void) | null }) {
        if (!u.text) {
          setTimeout(() => u.onend?.(), 0);
          return;
        }
        log.push(u.text);
        speaking = true;
        setTimeout(() => u.onstart?.(), 0);
      },
      cancel() {
        speaking = false;
      },
      pause() {},
      resume() {},
    });
    Object.defineProperty(synth, 'speaking', { get: () => speaking });
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: class {
        text: string;
        lang = '';
        rate = 1;
        volume = 1;
        voice = null;
        onstart = null;
        onend = null;
        onerror = null;
        constructor(text = '') {
          this.text = text;
        }
      },
      configurable: true,
      writable: true,
    });
    (window as unknown as { __spoken: string[] }).__spoken = log;
  });
}

/** Service worker kurulunca (önbellek dolunca) ve etkinleşince kapsamını döndürür */
const activeWorker = (page: Page) =>
  page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active!;
    if (worker.state !== 'activated')
      await new Promise((resolve) =>
        worker.addEventListener('statechange', () => worker.state === 'activated' && resolve(0)),
      );
    return { state: worker.state, scope: registration.scope };
  });

test('manifest ve simgeler yayında; kurulum için gerekli alanlar dolu', async ({
  page,
  request,
}) => {
  await page.goto('./');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/myPDFbook/manifest.webmanifest');
  const manifestUrl = new URL(href!, page.url());
  const res = await request.get(manifestUrl.href);
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest).toMatchObject({
    name: 'mypdfbook',
    short_name: 'mypdfbook',
    lang: 'tr',
    display: 'standalone',
    orientation: 'any',
    theme_color: '#f7f3ea',
    background_color: '#f7f3ea',
    start_url: '/myPDFbook/',
    scope: '/myPDFbook/',
  });
  const icons = manifest.icons as { src: string; sizes: string; purpose: string }[];
  expect(icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual([
    '192x192 any',
    '512x512 any',
    '512x512 maskable',
  ]);
  const links = await page
    .locator('link[rel="apple-touch-icon"], link[rel="icon"]')
    .evaluateAll((els) => els.map((el) => (el as HTMLLinkElement).href));
  for (const src of [...icons.map((i) => new URL(i.src, manifestUrl).href), ...links]) {
    const icon = await request.get(src);
    expect(icon.ok(), src).toBe(true);
    expect(icon.headers()['content-type']).toMatch(/^image\//);
  }
  await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute(
    'content',
    'black-translucent',
  );
});

test('bir kez çevrimiçi açıldıktan sonra kütüphane, sayfa ve metin görünümü, sesli okuma çevrimdışı çalışır', async ({
  page,
  context,
  browserName,
}) => {
  // Playwright'ın WebKit'i (Windows) çevrimdışı öykünmede yenilemeyi "internal error" ile keser; service worker
  // orada da kurulur ve sayfaları denetler. Çevrimdışı açılış gerçek iPad'de denenir.
  test.fixme(browserName === 'webkit', 'WebKit çevrimdışı öykünmesinde sayfa yenilenemiyor');
  await stubSpeech(page);
  await page.goto('./');
  expect(await activeWorker(page)).toEqual({
    state: 'activated',
    scope: new URL('/myPDFbook/', page.url()).href,
  });
  await importFixture(page, ...NOVEL);
  await expect(page.getByTestId('book-open')).toBeVisible();

  // Çevrimdışı: bundan sonra hiçbir istek ağa çıkamaz; aynı kökenden başarısız istek olmamalı
  const failed: string[] = [];
  page.on('requestfailed', (r) => {
    if (new URL(r.url()).origin === new URL(page.url()).origin) failed.push(r.url());
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('book-open')).toBeVisible();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  // Sayfa görünümü: PDF sayfası pdf.js worker'ıyla çizilir (worker önbellekten)
  await page.getByTestId('book-open').click();
  await expect(page).toHaveURL(/\/myPDFbook\/read\//);
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await expect(page.locator('[data-testid="flipbook"] [data-pdf-page="1"] img')).toBeVisible();

  // Sesli okuma (tarayıcının kendi sesi; ağ gerekmez)
  await page.getByTestId('read-aloud').click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.length))
    .toBeGreaterThan(0);
  await page.getByTestId('read-aloud-close').click();

  // Metin görünümü: kitap fontu önbellekten
  await headerAction(page, 'view-toggle');
  await expect(page.locator('.book-page-content').first()).not.toBeEmpty();
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family);
  });
  expect(fonts.map((f) => f.replace(/["']/g, ''))).toContain('Literata Variable');

  // Okuma adresi çevrimdışı yenilenince de açılır (index.html'e yönlendirme)
  await page.reload();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  expect(failed).toEqual([]);
});
