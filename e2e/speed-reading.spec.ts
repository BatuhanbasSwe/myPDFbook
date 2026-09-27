import { expect, test, type Page } from '@playwright/test';
import { headerAction, headerActionTarget, importFixture } from './helpers';

const NOVEL = ['novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf'] as const;

/** Hızlı okuma ayarları sayfa açılmadan (yalnızca ilk açılışta: yeniden yüklemede kalıcılık denenir) */
async function speedPrefs(page: Page, prefs: Record<string, unknown>) {
  await page.addInitScript((prefs) => {
    if (!sessionStorage.getItem('speed-prefs-set')) {
      sessionStorage.setItem('speed-prefs-set', '1');
      localStorage.setItem('mypdfbook:speed-reading', JSON.stringify(prefs));
    }
  }, prefs);
}

async function openNovel(page: Page) {
  await page.goto('/');
  await importFixture(page, ...NOVEL);
  await page.getByTestId('book-open').click();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
}

/** Menü gizliyse açar */
async function showMenu(page: Page) {
  if ((await page.getByTestId('reader-header').getAttribute('data-shown')) !== 'true')
    await page.keyboard.press('m');
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'true');
}

/** Durum satırındaki açık PDF sayfaları ("3" ya da "2–3") */
async function shownPdfPages(page: Page): Promise<number[]> {
  const text = (await page.getByTestId('page-status').textContent()) ?? '';
  return text.split('/')[0].trim().split('–').map(Number);
}

const overlayRects = (page: Page, pdfPage: number) =>
  page.locator(
    `[data-testid="flipbook"] [data-pdf-page="${pdfPage}"] [data-testid="sentence-overlay"] .sentence-mark`,
  );

test("hızlı okuma, sayfa görünümü: 1 sn'de cümle ilerler ve sayfa çevrilir; Boşluk duraklatır, Esc kapatır", async ({
  page,
}) => {
  await speedPrefs(page, { focus: false });
  await openNovel(page);
  expect(await shownPdfPages(page)).toEqual([1]);

  await headerAction(page, 'speed-read');
  await expect(page.getByTestId('speed-bar')).toBeVisible();
  await expect(page.getByTestId('speed-play')).toHaveAttribute('aria-label', 'Duraklat');
  // Varsayılan 5 sn; kitabın adı vurgulanır
  await expect(page.locator('[data-testid="speed-choices"] [data-value="5"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(overlayRects(page, 1).first()).toBeVisible();
  const firstY = await overlayRects(page, 1).first().getAttribute('y');

  // 1 sn: vurgu sonraki cümleye (yazarın adı) geçer, sonra sayfa çevrilir (bölüm başı 3. sayfada)
  await page.locator('[data-testid="speed-choices"] [data-value="1"]').click();
  await expect(page.locator('[data-value="1"]')).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(async () => {
      const rect = overlayRects(page, 1).first();
      return (await rect.count()) > 0 ? await rect.getAttribute('y') : 'moved-on';
    })
    .not.toBe(firstY);
  await expect.poll(() => shownPdfPages(page), { timeout: 10_000 }).toContain(3);
  await expect(overlayRects(page, 3).first()).toBeVisible();
  // Sayfa kendiliğinden çevrilince menü açılmaz, çubuk açık kalır
  await expect(page.getByTestId('speed-bar')).toBeVisible();

  // Boşluk duraklatır: süre dolsa da cümle değişmez
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(' ');
  await expect(page.getByTestId('speed-play')).toHaveAttribute('aria-label', 'Oynat');
  const y = await overlayRects(page, 3).first().getAttribute('y');
  await page.waitForTimeout(2_000);
  expect(await overlayRects(page, 3).first().getAttribute('y')).toBe(y);
  await page.keyboard.press(' ');
  await expect(page.getByTestId('speed-play')).toHaveAttribute('aria-label', 'Duraklat');
  await expect.poll(() => overlayRects(page, 3).first().getAttribute('y')).not.toBe(y);

  // Esc kapatır, vurgu kalkar
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('speed-bar')).toHaveCount(0);
  await expect(page.locator('[data-testid="sentence-overlay"]')).toHaveCount(0);
});

test('hızlı okuma: sayfa sınırından taşan cümlede sayfa cümlenin ortasında çevrilir', async ({
  page,
}) => {
  await speedPrefs(page, { seconds: 8, focus: false });
  await openNovel(page);
  // 3. sayfadan başlanır (bölüm başı)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  while (!(await shownPdfPages(page)).includes(3)) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(800); // kıvrılan sayfa animasyonu 650 ms
  }
  await showMenu(page);
  await headerAction(page, 'speed-read');
  await expect(overlayRects(page, 3).first()).toBeVisible();

  // "Yol boyunca …" cümlesinin başı 3., sonu 4. sayfada: ondan önceki cümleye gidilir
  const sentence = () => page.getByTestId('speed-progress').getAttribute('data-sentence');
  const start = Number(await sentence());
  const next = page.getByRole('button', { name: 'Sonraki cümle' });
  for (let k = 0; k < 7; k++) await next.click();
  await page.waitForTimeout(500); // sonraki cümlenin yeri önceden bulunsun
  await next.click();
  await expect.poll(sentence).toBe(String(start + 8));
  // Cümlenin baş parçası 3. sayfada vurgulu; süresinin sayfadaki payı dolunca 4. sayfa açılır (8 sn dolmadan)
  await expect(overlayRects(page, 3).first()).toBeVisible();
  await expect.poll(() => shownPdfPages(page), { timeout: 7_000 }).toContain(4);
  // Aynı cümle: son parçası 4. sayfada vurgulu
  expect(await sentence()).toBe(String(start + 8));
  await expect(overlayRects(page, 4).first()).toBeVisible();
});

test('hızlı okuma, odak: sayfa görünümünde cümle dışı karartılır (maske), metin görünümünde yazı soluklaşır', async ({
  page,
}) => {
  await speedPrefs(page, { seconds: 30 });
  await openNovel(page);
  await headerAction(page, 'speed-read');
  await expect(overlayRects(page, 1).first()).toBeVisible();

  // Odak varsayılan açık: sayfada maske ve karartma
  const focusButton = page.getByTestId('speed-focus');
  await expect(focusButton).toHaveAttribute('aria-pressed', 'true');
  const overlay = page.locator(
    '[data-testid="flipbook"] [data-pdf-page="1"] [data-testid="sentence-overlay"]',
  );
  await expect(overlay.locator('mask')).toHaveCount(1);
  await expect(overlay.locator('[data-testid="sentence-dim"]')).toHaveCount(1);
  // Maskede cümle dikdörtgenleri delik
  await expect
    .poll(async () => {
      const holes = await overlay.locator('mask rect[fill="black"]').count();
      return holes > 0 && holes === (await overlayRects(page, 1).count());
    })
    .toBe(true);

  // Odak kapanınca karartma kalkar, vurgu kalır
  await focusButton.click();
  await expect(focusButton).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-testid="sentence-dim"]')).toHaveCount(0);
  await expect(overlayRects(page, 1).first()).toBeVisible();
  await focusButton.click();
  await expect(overlay.locator('[data-testid="sentence-dim"]')).toHaveCount(1);

  // Metin görünümü: bütün yazı soluk, etkin cümle ::highlight ile koyu
  await showMenu(page);
  await headerAction(page, 'view-toggle');
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await expect(page.locator('.sentence-focus .book-page-content').first()).toBeAttached();
  await expect.poll(() => page.evaluate(() => CSS.highlights.has('mypdfbook-active'))).toBe(true);
  const color = () =>
    page.evaluate(() => {
      const el = document.querySelector('.book-page-content [data-block]');
      return el ? getComputedStyle(el).color : null;
    });
  const dimmed = await color();
  await focusButton.click();
  await expect(page.locator('.sentence-focus')).toHaveCount(0);
  await expect.poll(color).not.toBe(dimmed);
});

test('hızlı okuma ayarları kalıcı; sesli okuma açılınca hızlı okuma kapanır', async ({ page }) => {
  // Sesli okuma için sessiz, bitmeyen konuşma motoru
  await page.addInitScript(() => {
    const synth = Object.assign(new EventTarget(), {
      speaking: false,
      pending: false,
      paused: false,
      getVoices: () => [],
      speak() {},
      cancel() {},
      pause() {},
      resume() {},
    });
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: class {
        text: string;
        constructor(text = '') {
          this.text = text;
        }
      },
      configurable: true,
      writable: true,
    });
  });
  await openNovel(page);
  await headerAction(page, 'speed-read');
  await expect(page.getByTestId('speed-bar')).toBeVisible();

  await page.getByTestId('speed-mode-wpm').click();
  await expect(page.getByTestId('speed-mode-wpm')).toHaveAttribute('aria-pressed', 'true');
  // Dakikada kelime seçenekleri; varsayılan 250
  await expect(page.locator('[data-testid="speed-choices"] button')).toHaveText([
    '150',
    '200',
    '250',
    '300',
    '400',
    '500',
  ]);
  await expect(page.locator('[data-testid="speed-choices"] [data-value="250"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.locator('[data-testid="speed-choices"] [data-value="300"]').click();
  await page.getByTestId('speed-focus').click();
  await expect(page.getByTestId('speed-focus')).toHaveAttribute('aria-pressed', 'false');

  // Dokunma hedefleri en az 44 px
  for (const button of await page.getByTestId('speed-bar').locator('button:visible').all()) {
    const b = (await button.boundingBox())!;
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
  }

  // Sesli okuma açılınca hızlı okuma kapanır
  await showMenu(page);
  await page.getByTestId('read-aloud').click();
  await expect(page.getByTestId('read-aloud-bar')).toBeVisible();
  await expect(page.getByTestId('speed-bar')).toHaveCount(0);
  await showMenu(page);
  await headerAction(page, 'speed-read');
  await expect(page.getByTestId('speed-bar')).toBeVisible();
  await expect(page.getByTestId('read-aloud-bar')).toHaveCount(0);

  // Kapat düğmesi klavyeyle: odak "Hızlı oku" düğmesine döner
  await page.getByTestId('speed-close').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('speed-bar')).toHaveCount(0);
  await expect(await headerActionTarget(page, 'speed-read')).toBeFocused();

  // Yeniden yüklenince ayarlar yerinde
  await page.reload();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await headerAction(page, 'speed-read');
  await expect(page.getByTestId('speed-mode-wpm')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="speed-choices"] [data-value="300"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('speed-focus')).toHaveAttribute('aria-pressed', 'false');
});

test('RSVP: kelimeler kartta sırayla, odak harfi işaretli; duraklatınca durur, ← → kelime adımı; sayfa ilerler', async ({
  page,
}) => {
  await speedPrefs(page, { mode: 'rsvp', rsvpWpm: 400, ramp: false });
  // Karttaki her kelime ve odak harfi kaydedilir
  await page.addInitScript(() => {
    const log: { word: string; orp: string }[] = [];
    (window as unknown as { __rsvp: typeof log }).__rsvp = log;
    new MutationObserver(() => {
      const word = document.querySelector('[data-testid="rsvp-word"]')?.textContent ?? '';
      const orp = document.querySelector('[data-testid="rsvp-orp"]')?.textContent ?? '';
      if (word && log.at(-1)?.word !== word) log.push({ word, orp });
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  const log = () =>
    page.evaluate(() => (window as unknown as { __rsvp: { word: string; orp: string }[] }).__rsvp);
  await openNovel(page);
  await headerAction(page, 'speed-read');
  await expect(page.getByTestId('rsvp-card')).toBeVisible();
  await expect(page.getByTestId('speed-mode-rsvp')).toHaveAttribute('aria-pressed', 'true');

  // Kitabın adı ve yazarı kelime kelime; sonra bölüm başı: sayfa kendiliğinden çevrilir
  await expect.poll(() => shownPdfPages(page), { timeout: 10_000 }).toContain(3);
  const words = await log();
  expect(words.map((w) => w.word).slice(0, 5)).toEqual([
    'KAYIP',
    'ŞEHRİN',
    'IŞIKLARI',
    'Deniz',
    'Aksoy',
  ]);
  // Odak harfi: 5 harf → 2., 6 harf → 3., 8 harf → 3. harf
  expect(words.slice(0, 3).map((w) => w.orp)).toEqual(['A', 'H', 'I']);
  await expect(overlayRects(page, 3).first()).toBeVisible();

  // Karta dokununca duraklar: kelime değişmez
  await page.getByTestId('rsvp-card').click();
  await expect(page.getByTestId('speed-play')).toHaveAttribute('aria-label', 'Oynat');
  const word = page.getByTestId('rsvp-word');
  const paused = await word.textContent();
  await page.waitForTimeout(1_000);
  await expect(word).toHaveText(paused!);

  // Duraklamışken → ve ← bir kelime ileri, geri (sayfa çevrilmez)
  const index = await page.getByTestId('flipbook').getAttribute('data-index');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ArrowRight');
  await expect(word).not.toHaveText(paused!);
  await page.keyboard.press('ArrowLeft');
  await expect(word).toHaveText(paused!);
  expect(await page.getByTestId('flipbook').getAttribute('data-index')).toBe(index);

  // Boşluk sürdürür
  await page.keyboard.press(' ');
  await expect(page.getByTestId('speed-play')).toHaveAttribute('aria-label', 'Duraklat');
  await expect(word).not.toHaveText(paused!);

  // Kip değişince kart kalkar
  await page.getByTestId('speed-mode-fixed').click();
  await expect(page.getByTestId('rsvp')).toHaveCount(0);
});
