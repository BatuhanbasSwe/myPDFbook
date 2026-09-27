import { expect, test, type Page } from '@playwright/test';
import { importFixture } from './helpers';

const NOVEL = ['novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf'] as const;

/** Sahte konuşma motorunun kaydı: okunan her cümle */
interface Spoken {
  text: string;
  lang: string;
  rate: number;
  voice: string | null;
}

/**
 * Tarayıcının sesi yerine sahte konuşma motoru (`window.speechSynthesis`): konuşmalar kaydedilir ve kendiliğinden
 * bitmez; `__speech.end()` süren konuşmayı bitirir (okuma bir cümle ilerler). Kesilen konuşma, tarayıcılardaki gibi
 * sonradan "interrupted" hatası verir. Sesler: iki Türkçe, bir İngilizce (varsayılan).
 */
async function stubSpeech(page: Page) {
  await page.addInitScript(() => {
    interface FakeUtterance {
      text: string;
      lang: string;
      rate: number;
      volume: number;
      voice: { voiceURI: string } | null;
      onstart: (() => void) | null;
      onend: (() => void) | null;
      onerror: ((e: { error: string }) => void) | null;
    }
    const voices = [
      { voiceURI: 'tr-yelda', name: 'Yelda', lang: 'tr-TR', default: false, localService: true },
      { voiceURI: 'tr-emel', name: 'Emel', lang: 'tr-TR', default: false, localService: true },
      { voiceURI: 'en-sam', name: 'Samantha', lang: 'en-US', default: true, localService: true },
    ];
    let current: FakeUtterance | null = null;
    const speech = {
      log: [] as { text: string; lang: string; rate: number; voice: string | null }[],
      end() {
        const cur = current;
        current = null;
        cur?.onend?.();
      },
    };
    class Utterance {
      text: string;
      lang = '';
      rate = 1;
      volume = 1;
      voice: { voiceURI: string } | null = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      constructor(text = '') {
        this.text = text;
      }
    }
    const synth = Object.assign(new EventTarget(), {
      speaking: false,
      pending: false,
      paused: false,
      getVoices: () => voices,
      speak(u: FakeUtterance) {
        // iOS için motoru açan boş konuşma kaydedilmez
        if (!u.text) {
          setTimeout(() => u.onend?.(), 0);
          return;
        }
        speech.log.push({
          text: u.text,
          lang: u.lang,
          rate: u.rate,
          voice: u.voice?.voiceURI ?? null,
        });
        current = u;
        setTimeout(() => {
          if (current === u) u.onstart?.();
        }, 0);
      },
      cancel() {
        const cur = current;
        current = null;
        if (cur) setTimeout(() => cur.onerror?.({ error: 'interrupted' }), 0);
      },
      pause() {},
      resume() {},
    });
    // Konuşma bitene dek konuşuyor (bekçi motoru bununla yoklar)
    Object.defineProperty(synth, 'speaking', { get: () => current !== null });
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: Utterance,
      configurable: true,
      writable: true,
    });
    (window as unknown as { __speech: typeof speech }).__speech = speech;
  });
}

const spoken = (page: Page) =>
  page.evaluate(() => (window as unknown as { __speech: { log: Spoken[] } }).__speech.log);

/** Süren konuşmayı bitirir: okuma bir cümle ilerler */
const endSentence = (page: Page) =>
  page.evaluate(() => (window as unknown as { __speech: { end(): void } }).__speech.end());

/** Okuma, `done` doğru olana dek cümle cümle ilerletilir */
async function readUntil(page: Page, done: () => Promise<boolean>) {
  await expect
    .poll(
      async () => {
        if (await done()) return true;
        await endSentence(page);
        return false;
      },
      { intervals: [150], timeout: 30_000 },
    )
    .toBe(true);
}

async function openNovel(page: Page) {
  await page.goto('/');
  await importFixture(page, ...NOVEL);
  await page.getByTestId('book-open').click();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
}

const bookIndex = async (page: Page) =>
  Number(await page.getByTestId('flipbook').getAttribute('data-index'));

/** Durum satırındaki açık PDF sayfaları ("3" ya da "2–3") */
async function shownPdfPages(page: Page): Promise<number[]> {
  const text = (await page.getByTestId('page-status').textContent()) ?? '';
  return text.split('/')[0].trim().split('–').map(Number);
}

/** Dar ekranda ses ve uyku zamanlayıcısı ayrı satırdadır: açılır */
async function showOptions(page: Page) {
  const button = page.getByTestId('read-aloud-options');
  if (await button.isVisible()) await button.click();
}

/** Okunan cümlenin metin görünümündeki vurgusu (CSS Custom Highlight API) */
const highlighted = (page: Page) =>
  page.evaluate(() => {
    const h = CSS.highlights.get('mypdfbook-active');
    return h ? [...h].map((r) => r.toString()).join(' ') : null;
  });

/** Karşılaştırma için metin: yumuşak tire atılır, boşluklar teke iner */
const plain = (s: string) => s.replace(/­/g, '').replace(/\s+/g, ' ').trim();

test('sesli okuma, sayfa görünümü: cümle vurgulanır, okuma ilerleyince sayfa çevrilir, hız hemen uygulanır ve kalır', async ({
  page,
}) => {
  await stubSpeech(page);
  await openNovel(page);
  expect(await shownPdfPages(page)).toEqual([1]);

  await page.getByTestId('read-aloud').click();
  await expect(page.getByTestId('read-aloud-bar')).toBeVisible();
  await expect.poll(async () => (await spoken(page)).length).toBe(1);
  const [first] = await spoken(page);
  expect(first.text.length).toBeGreaterThan(0);
  expect(first).toMatchObject({ lang: 'tr-TR', rate: 1, voice: 'tr-emel' });
  await expect(page.getByTestId('read-aloud-play')).toHaveAttribute('aria-label', 'Duraklat');
  // Okunan cümle açık sayfada vurgulanır (SVG dikdörtgenleri)
  await expect(
    page
      .locator('[data-testid="flipbook"] [data-pdf-page="1"] [data-testid="sentence-overlay"] rect')
      .first(),
  ).toBeVisible();

  // Hız: okunan cümle yeni hızla baştan okunur
  await page.locator('[data-testid="read-aloud-rates"] [data-rate="1.5"]').click();
  await expect(page.locator('[data-rate="1.5"]')).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(async () => (await spoken(page)).at(-1))
    .toMatchObject({ text: first.text, rate: 1.5 });

  // Ses: yalnızca kitabın dilindeki sesler; seçilen ses hemen kullanılır
  await showOptions(page);
  const voice = page.getByTestId('read-aloud-voice');
  await expect(voice.locator('option')).toHaveText(['Emel', 'Yelda']);
  await voice.selectOption('tr-yelda');
  await expect
    .poll(async () => (await spoken(page)).at(-1))
    .toMatchObject({
      text: first.text,
      voice: 'tr-yelda',
      rate: 1.5,
    });

  // Okuma ilerler; etkin cümle sayfadan çıkınca sayfa çevrilir
  await readUntil(page, async () => Math.max(...(await shownPdfPages(page))) > 1);
  const texts = (await spoken(page)).map((s) => s.text);
  expect(new Set(texts).size).toBeGreaterThan(1);
  // Vurgu açık sayfada
  const shown = await shownPdfPages(page);
  await expect(
    page
      .locator(
        shown
          .map(
            (p) =>
              `[data-testid="flipbook"] [data-pdf-page="${p}"] [data-testid="sentence-overlay"] rect`,
          )
          .join(', '),
      )
      .first(),
  ).toBeVisible();

  // Kapatınca susar, vurgu kalkar
  await page.getByTestId('read-aloud-close').click();
  await expect(page.getByTestId('read-aloud-bar')).toHaveCount(0);
  await expect(page.locator('[data-testid="sentence-overlay"]')).toHaveCount(0);

  // Hız ve ses kalıcıdır
  await page.reload();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await page.getByTestId('read-aloud').click();
  await expect
    .poll(async () => (await spoken(page)).at(0))
    .toMatchObject({ rate: 1.5, voice: 'tr-yelda' });
});

test('sesli okuma, metin görünümü: açık sayfanın ilk cümlesinden başlar, vurgulanır, sayfa çevrilir; Boşluk ve Esc', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('mypdfbook:reader'))
      localStorage.setItem('mypdfbook:reader', JSON.stringify({ view: 'text' }));
  });
  await stubSpeech(page);
  await openNovel(page);

  // Bir sonraki sayfada başlanır
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => bookIndex(page)).toBeGreaterThan(0);
  await page.waitForTimeout(800); // kıvrılan sayfa animasyonu 650 ms
  const start = await bookIndex(page);
  await page.keyboard.press('m'); // menü

  await page.getByTestId('read-aloud').click();
  await expect.poll(async () => (await spoken(page)).length).toBe(1);
  const [first] = await spoken(page);
  expect(first.rate).toBe(1);
  // Vurgu okunan cümlede ve açık sayfada; sayfa geri çevrilmez
  await expect
    .poll(async () => plain((await highlighted(page)) ?? ''))
    .toContain(plain(first.text).slice(0, 20));
  expect(await bookIndex(page)).toBe(start);
  const inShownPage = await page.evaluate((start) => {
    const h = CSS.highlights.get('mypdfbook-active');
    const range = h ? [...h][0] : null;
    const node = range?.startContainer.parentElement?.closest('.book-page');
    const n = Number(node?.getAttribute('data-page'));
    return n === start + 1 || n === start + 2;
  }, start);
  expect(inShownPage).toBe(true);

  // Hız hemen uygulanır
  await page.locator('[data-rate="2"]').click();
  await expect
    .poll(async () => (await spoken(page)).at(-1))
    .toMatchObject({ text: first.text, rate: 2 });
  await page.getByTestId('read-aloud-close').click();
  await expect(page.getByTestId('read-aloud-bar')).toHaveCount(0);

  // Başa dönülünce okuma kaldığı cümleden değil, açık sayfadan başlar; hız kalıcı
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => bookIndex(page)).toBe(0);
  await page.waitForTimeout(800);
  if ((await page.getByTestId('reader-header').getAttribute('data-shown')) !== 'true')
    await page.keyboard.press('m');
  await page.getByTestId('read-aloud').click();
  await expect.poll(async () => (await spoken(page)).length).toBe(3);
  expect((await spoken(page))[2]).toMatchObject({ rate: 2 });
  expect((await spoken(page))[2].text).not.toBe(first.text);
  expect(await bookIndex(page)).toBe(0);

  // Okuma ilerler, sayfa çevrilir, vurgu yeni sayfada
  await readUntil(page, async () => (await bookIndex(page)) > 0);
  const last = (await spoken(page)).at(-1)!;
  await expect
    .poll(async () => plain((await highlighted(page)) ?? ''))
    .toContain(plain(last.text).slice(0, 20));

  // Boşluk duraklatır ve sürdürür (odak kitapta), Esc kapatır
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const index = await bookIndex(page);
  await page.keyboard.press(' ');
  await expect(page.getByTestId('read-aloud-play')).toHaveAttribute('aria-label', 'Oynat');
  const count = (await spoken(page)).length;
  await page.keyboard.press(' ');
  await expect(page.getByTestId('read-aloud-play')).toHaveAttribute('aria-label', 'Duraklat');
  await expect.poll(async () => (await spoken(page)).length).toBe(count + 1);
  expect(await bookIndex(page)).toBe(index); // Boşluk sayfa çevirmedi
  const menu = await page.getByTestId('reader-header').getAttribute('data-shown');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('read-aloud-bar')).toHaveCount(0);
  await expect.poll(() => highlighted(page)).toBeNull();
  // Esc yalnızca okumayı kapattı, menüyü açıp kapatmadı
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', menu!);
});
