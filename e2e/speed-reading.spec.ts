import { expect, test, type Page } from '@playwright/test';
import {
  headerAction,
  headerActionTarget,
  importFixture,
  statusPages,
  turnNextPage,
} from './helpers';

const NOVEL = ['novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf'] as const;

/**
 * Hızlı okuma ayarları sayfa açılmadan (yalnızca ilk açılışta: yeniden yüklemede kalıcılık denenir). Kip verilmezse
 * cümle cümle (süre) kipi: varsayılan RSVP olsa da bu testler cümle kiplerini sınar.
 */
async function speedPrefs(page: Page, prefs: Record<string, unknown>) {
  await page.addInitScript(
    (prefs) => {
      if (!sessionStorage.getItem('speed-prefs-set')) {
        sessionStorage.setItem('speed-prefs-set', '1');
        localStorage.setItem('mypdfbook:speed-reading', JSON.stringify(prefs));
      }
    },
    { mode: 'fixed', ...prefs },
  );
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
const shownPdfPages = statusPages;

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

/** 3. sayfaya (bölüm başı) → tuşuyla gelinir; her çevirmenin bitmesi beklenir */
async function toChapterStart(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  while (!(await shownPdfPages(page)).includes(3)) await turnNextPage(page);
}

/** Etkin cümle (dizideki indeks), çubuğun ilerleme çizgisinden */
const activeSentence = async (page: Page) =>
  Number(await page.getByTestId('speed-progress').getAttribute('data-sentence'));

/**
 * Sayfa her çevrildiğinde (kitabın yuvası değişince) o anki etkin cümle ve RSVP kelimesi kaydedilir: sayfanın
 * cümlenin ortasında çevrildiği, sonradan zamanlamaya bakmadan sınanır
 */
async function recordTurns(page: Page) {
  await page.addInitScript(() => {
    const turns: { index: string; sentence: string; word: string }[] = [];
    (window as unknown as { __turns: typeof turns }).__turns = turns;
    let last: string | null = null;
    new MutationObserver(() => {
      const index = document.querySelector('[data-testid="flipbook"]')?.getAttribute('data-index');
      if (index == null || index === last) return;
      last = index;
      turns.push({
        index,
        sentence:
          document.querySelector('[data-testid="speed-progress"]')?.getAttribute('data-sentence') ??
          '',
        word: document.querySelector('[data-testid="rsvp-word"]')?.textContent ?? '',
      });
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
}
const lastTurn = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { __turns: { index: string; sentence: string; word: string }[] }
    ).__turns.at(-1)!,
  );

/** Sonraki cümle düğmesiyle `target` cümlesine gidilir (okuma kendisi de ilerleyebilir) */
async function nextUntil(page: Page, target: number) {
  const next = page.getByRole('button', { name: 'Sonraki cümle' });
  while ((await activeSentence(page)) < target) await next.click();
  expect(await activeSentence(page)).toBe(target);
}

test('hızlı okuma: sayfa sınırından taşan cümlede sayfa cümlenin ortasında çevrilir', async ({
  page,
}) => {
  await speedPrefs(page, { seconds: 10, focus: false });
  await recordTurns(page);
  await openNovel(page);
  await toChapterStart(page);
  await showMenu(page);
  await headerAction(page, 'speed-read');
  await expect(overlayRects(page, 3).first()).toBeVisible();

  // "Yol boyunca …" cümlesinin başı 3., sonu 4. sayfada. Hemen gidilir: cümlenin yeri önceden bulunmamış olsa da
  // bulununca sayfa sınırı denetleyiciye bildirilir
  const start = await activeSentence(page);
  await nextUntil(page, start + 8);
  // Cümlenin baş parçası 3. sayfada vurgulu; süresinin sayfadaki payı dolunca 4. sayfa açılır
  await expect(overlayRects(page, 3).first()).toBeVisible();
  await expect.poll(() => shownPdfPages(page), { timeout: 15_000 }).toContain(4);
  // Sayfa aynı cümle okunurken çevrildi; son parçası 4. sayfada vurgulu
  expect((await lastTurn(page)).sentence).toBe(String(start + 8));
  await expect(overlayRects(page, 4).first()).toBeVisible();
});

test('RSVP: sayfa sınırından taşan cümlede sayfa son parçanın ilk kelimesinde çevrilir', async ({
  page,
}) => {
  await speedPrefs(page, { mode: 'rsvp', rsvpWpm: 100, ramp: false });
  await recordTurns(page);
  await openNovel(page);
  await toChapterStart(page);
  await showMenu(page);
  await headerAction(page, 'speed-read');
  await expect(page.getByTestId('rsvp-card')).toBeVisible();
  await expect(overlayRects(page, 3).first()).toBeVisible();

  // Duraklatılır, "Yol boyunca …" cümlesine gidilir, sürdürülür
  await page.getByTestId('rsvp-toggle').click();
  await expect(page.getByTestId('speed-play')).toHaveAttribute('aria-label', 'Oynat');
  // (okuma duraklatılana dek bir iki cümle ilerlemiş olabilir: cümle ilk kelimesinden bulunur)
  const word = page.getByTestId('rsvp-word');
  const next = page.getByRole('button', { name: 'Sonraki cümle' });
  for (let k = 0; k < 12 && (await word.textContent()) !== 'Yol'; k++) {
    const before = await activeSentence(page);
    await next.click();
    await expect.poll(() => activeSentence(page)).toBe(before + 1);
  }
  await expect(word).toHaveText('Yol');
  const target = await activeSentence(page);
  expect(await shownPdfPages(page)).toContain(3);
  await page.getByTestId('rsvp-toggle').click();
  await expect(page.getByTestId('speed-play')).toHaveAttribute('aria-label', 'Duraklat');

  await expect.poll(() => shownPdfPages(page), { timeout: 20_000 }).toContain(4);
  // Sayfa aynı cümlenin ortasında çevrildi (ilk kelimesinde değil)
  const turn = await lastTurn(page);
  expect(turn.sentence).toBe(String(target));
  expect(turn.word).not.toBe('Yol');
  await expect(overlayRects(page, 4).first()).toBeVisible();
});

test('hızlı okuma, odak: sayfa görünümünde cümle dışı karartılır (delikli karartma), metin görünümünde yazı soluklaşır', async ({
  page,
}) => {
  await speedPrefs(page, { seconds: 30 });
  await openNovel(page);
  await headerAction(page, 'speed-read');
  await expect(overlayRects(page, 1).first()).toBeVisible();

  // Odak varsayılan açık: sayfada karartma
  const focusButton = page.getByTestId('speed-focus');
  await expect(focusButton).toHaveAttribute('aria-pressed', 'true');
  const overlay = page.locator(
    '[data-testid="flipbook"] [data-pdf-page="1"] [data-testid="sentence-overlay"]',
  );
  const dim = overlay.locator('[data-testid="sentence-dim"]');
  await expect(dim).toHaveCount(1);
  // Karartma tek bir yol (maske yok), çarpma karışımının dışında; cümle dikdörtgenleri delik (çift-tek kuralı)
  await expect(overlay.locator('mask')).toHaveCount(0);
  await expect(dim).toHaveAttribute('fill-rule', 'evenodd');
  expect(await dim.evaluate((el) => el.closest('.sentence-marks'))).toBeNull();
  await expect
    .poll(async () => {
      const holes = ((await dim.getAttribute('data-holes')) ?? '').split(';').filter(Boolean);
      return holes.length > 0 && holes.length === (await overlayRects(page, 1).count());
    })
    .toBe(true);
  // Yolda sayfanın tamamı ve her delik ayrı bir parça
  expect(((await dim.getAttribute('d')) ?? '').match(/M/g)?.length).toBe(
    1 + (await overlayRects(page, 1).count()),
  );

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
  await headerAction(page, 'read-aloud');
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

test('RSVP: panel açıkken durur, kapanınca sürer; sekme gizlenince durur; okuyucu her kelimede yeniden çizilmez', async ({
  page,
}) => {
  await speedPrefs(page, { mode: 'rsvp', rsvpWpm: 400, ramp: false });
  // Okuyucunun çizim sayısı (yalnızca geliştirmede sayılır: renderCount.ts)
  await page.addInitScript(() => {
    (window as unknown as { __renders: Record<string, number> }).__renders = {};
  });
  // Karttaki her kelime kaydedilir
  await page.addInitScript(() => {
    const log: string[] = [];
    (window as unknown as { __words: string[] }).__words = log;
    new MutationObserver(() => {
      const word = document.querySelector('[data-testid="rsvp-word"]')?.textContent ?? '';
      if (word && log.at(-1) !== word) log.push(word);
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  const shown = () =>
    page.evaluate(() => (window as unknown as { __words: string[] }).__words.length);
  const renders = () =>
    page.evaluate(
      () => (window as unknown as { __renders: Record<string, number> }).__renders.BookReader ?? 0,
    );
  const play = page.getByTestId('speed-play');
  await openNovel(page);
  await toChapterStart(page);
  await showMenu(page);
  await headerAction(page, 'speed-read');
  await expect(page.getByTestId('rsvp-card')).toBeVisible();
  await expect(play).toHaveAttribute('aria-label', 'Duraklat');

  // Kelimeler akarken okuyucu kelime başına çizilmez, yalnızca cümle değişince ve sayfa çevrilince çizilir
  // (geliştirmede StrictMode her çizimi iki kez sayar: kelime başına çizilseydi en az kelimenin iki katı olurdu)
  const w0 = await shown();
  const r0 = await renders();
  await expect.poll(shown, { timeout: 20_000 }).toBeGreaterThanOrEqual(w0 + 40);
  const words = (await shown()) - w0;
  expect((await renders()) - r0).toBeLessThan(words);
  // Aynı cümlede kelime kelime ilerlerken hiç çizilmez (duraklamışken → bir kelime ileri)
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Oynat');
  const sentence = await activeSentence(page);
  const r1 = await renders();
  const w1 = await shown();
  // Cümlenin son kelimesindeyse önce geri (cümle sınırı geçilmesin), sonra ters yöne
  const last = /[.!?…][”’»"')]*$/.test((await page.getByTestId('rsvp-word').textContent()) ?? '');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(last ? 'ArrowLeft' : 'ArrowRight');
  await page.keyboard.press(last ? 'ArrowRight' : 'ArrowLeft');
  await expect.poll(shown).toBeGreaterThanOrEqual(w1 + 2);
  expect(await activeSentence(page)).toBe(sentence);
  expect(await renders()).toBe(r1);
  await page.getByTestId('rsvp-toggle').click();
  await expect(play).toHaveAttribute('aria-label', 'Duraklat');

  // İçindekiler açılınca durur: kelime değişmez
  await showMenu(page);
  await page.getByTestId('reader-toc').click();
  await expect(page.getByTestId('reader-panel')).toBeVisible();
  await expect(play).toHaveAttribute('aria-label', 'Oynat');
  const paused = await shown();
  await page.waitForTimeout(1_000);
  expect(await shown()).toBe(paused);
  // Kapanınca kendiliğinden sürer
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('reader-panel')).toHaveCount(0);
  await expect(play).toHaveAttribute('aria-label', 'Duraklat');
  await expect.poll(shown).toBeGreaterThan(paused);

  // Elle duraklatılmışsa panel kapanınca da duraklamış kalır
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Oynat');
  await showMenu(page);
  await page.getByTestId('reader-toc').click();
  await expect(page.getByTestId('reader-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('reader-panel')).toHaveCount(0);
  const still = await shown();
  await page.waitForTimeout(1_000);
  expect(await shown()).toBe(still);
  await expect(play).toHaveAttribute('aria-label', 'Oynat');

  // Duraklamışken cümlenin tamamı ekran okuyucuya açık; kelime kelime değil
  await expect(page.getByTestId('rsvp-sentence')).toBeAttached();
  await expect(
    page.getByTestId('rsvp-word').locator('xpath=ancestor::*[@aria-hidden="true"]'),
  ).toHaveCount(1);
  // Kartın dokunma hedefi gerçek bir düğme: klavyeyle de oynatır
  await page.getByTestId('rsvp-toggle').focus();
  await page.keyboard.press('Enter');
  await expect(play).toHaveAttribute('aria-label', 'Duraklat');
  await expect(page.getByTestId('rsvp-sentence')).toHaveCount(0);

  // Sekme gizlenince (iPad kilitlendi, başka uygulama) durur
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(play).toHaveAttribute('aria-label', 'Oynat');
  const hidden = await shown();
  await page.waitForTimeout(1_000);
  expect(await shown()).toBe(hidden);
});

test('hızlı okuma: süre seçeneğine dokunduktan sonra Boşluk oynatır/duraklatır (seçeneğe yeniden basmaz)', async ({
  page,
}) => {
  await speedPrefs(page, { seconds: 30 });
  await openNovel(page);
  await headerAction(page, 'speed-read');
  const play = page.getByTestId('speed-play');
  await expect(play).toHaveAttribute('aria-label', 'Duraklat');
  await page.locator('[data-testid="speed-choices"] [data-value="20"]').click();
  await expect(page.locator('[data-testid="speed-choices"] [data-value="20"]')).not.toBeFocused();
  await page.keyboard.press(' ');
  await expect(play).toHaveAttribute('aria-label', 'Oynat');
  await expect(page.locator('[data-testid="speed-choices"] [data-value="20"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Klavyeyle seçilen seçenekte odak kalır
  await page.locator('[data-testid="speed-choices"] [data-value="15"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="speed-choices"] [data-value="15"]')).toBeFocused();
});

test('ilk açılışta hızlı okuma RSVP kipinde, dakikada 300 kelime ve yavaş başla açık', async ({
  page,
}) => {
  await openNovel(page);
  await headerAction(page, 'speed-read');
  await expect(page.getByRole('button', { name: 'RSVP' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Dakikada 300 kelime' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: /Yavaş başla/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('rsvp-card')).toBeVisible();
});
