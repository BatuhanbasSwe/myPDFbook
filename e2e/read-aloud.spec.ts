import { expect, test, type Page } from '@playwright/test';
import {
  flipSettled,
  headerAction,
  headerActionTarget,
  importFixture,
  statusPages,
  turnNextPage,
} from './helpers';

const NOVEL = ['novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf'] as const;

/** Sahte konuşma motorunun kaydı: okunan her cümle */
interface Spoken {
  text: string;
  lang: string;
  rate: number;
  voice: string | null;
}

/** Sahte ses listesindeki bir ses (SpeechSynthesisVoice alanları) */
interface FakeVoice {
  voiceURI: string;
  name: string;
  lang: string;
  default: boolean;
  localService: boolean;
}

/** Varsayılan sahte sesler: iki Türkçe (gelişmiş değil), bir İngilizce (varsayılan) */
const VOICES: FakeVoice[] = [
  { voiceURI: 'tr-yelda', name: 'Yelda', lang: 'tr-TR', default: false, localService: true },
  { voiceURI: 'tr-emel', name: 'Emel', lang: 'tr-TR', default: false, localService: true },
  { voiceURI: 'en-sam', name: 'Samantha', lang: 'en-US', default: true, localService: true },
];

/**
 * Tarayıcının sesi yerine sahte konuşma motoru (`window.speechSynthesis`): konuşmalar kaydedilir ve kendiliğinden
 * bitmez; `__speech.end()` süren konuşmayı bitirir (okuma bir cümle ilerler). Kesilen konuşma, tarayıcılardaki gibi
 * sonradan "interrupted" hatası verir.
 */
async function stubSpeech(page: Page, voiceList: FakeVoice[] = VOICES) {
  await page.addInitScript((voices: FakeVoice[]) => {
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
  }, voiceList);
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
const shownPdfPages = statusPages;

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

  await headerAction(page, 'read-aloud');
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
  await page.getByTestId('read-aloud-voice').click();
  const menu = page.getByTestId('voice-menu');
  // Sistem sesleri (yapay zekâ sesleri ayrı grupta, tarayıcı çalıştırabiliyorsa)
  await expect(menu.getByTestId('voice-group-standard').getByRole('radio')).toHaveText([
    'Emel',
    'Yelda',
  ]);
  await menu.getByRole('radio', { name: 'Yelda' }).click();
  await expect(menu.getByRole('radio', { name: 'Yelda' })).toHaveAttribute('aria-checked', 'true');
  await expect
    .poll(async () => (await spoken(page)).at(-1))
    .toMatchObject({
      text: first.text,
      voice: 'tr-yelda',
      rate: 1.5,
    });
  // Esc önce ses menüsünü kapatır, okuma sürer
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('read-aloud-bar')).toBeVisible();
  await expect(page.getByTestId('read-aloud-voice')).toHaveText('Yelda');

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
  await headerAction(page, 'read-aloud');
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
  await flipSettled(page);
  const start = await bookIndex(page);
  await page.keyboard.press('m'); // menü

  await headerAction(page, 'read-aloud');
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
  await headerAction(page, 'read-aloud');
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

/** Son okunan cümle `part`ı içeriyor mu */
const lastSpokenHas = async (page: Page, part: string) =>
  ((await spoken(page)).at(-1)?.text ?? '').includes(part);

/**
 * Okuma sayfada oturdu: kıvrılan sayfa çevrilmiyor ve okunan cümlenin vurgusu açık sayfalardan birinde (okuma sayfayı
 * bir daha kendiliğinden çevirmez)
 */
async function readingSettled(page: Page) {
  await expect
    .poll(async () => {
      if ((await page.locator('[data-testid="flipbook"][data-flipping]').count()) > 0) return false;
      for (const p of await shownPdfPages(page)) {
        const overlay = page.locator(
          `[data-testid="flipbook"] [data-pdf-page="${p}"] [data-testid="sentence-overlay"]`,
        );
        if ((await overlay.count()) > 0) return true;
      }
      return false;
    })
    .toBe(true);
  await flipSettled(page);
}

/** Menü gizliyse açar */
async function showMenu(page: Page) {
  if ((await page.getByTestId('reader-header').getAttribute('data-shown')) !== 'true')
    await page.keyboard.press('m');
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'true');
}

test('sesli okuma: otomatik sayfa çevirme menüyü kapatmaz; not yazılırken ve kalem kipinde sayfa çevrilmez, sonra okunan sayfaya geçilir', async ({
  page,
}) => {
  await stubSpeech(page);
  await openNovel(page);
  await headerAction(page, 'read-aloud');
  await expect.poll(async () => (await spoken(page)).length).toBe(1);
  await showMenu(page);

  // Okuma sayfayı çevirir; açık menü açık kalır
  await readUntil(page, async () => (await bookIndex(page)) > 0);
  // Yük altında birkaç cümle birden ilerlemiş olabilir: süren çevirmenin bitmesi ve okunan cümlenin açık sayfada
  // olması beklenir (yoksa sayfa not açıldıktan sonra da bir kez daha çevrilebilirdi)
  await readingSettled(page);
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'true');
  const index = await bookIndex(page);

  // Not yazılırken okuma sürer ama sayfa çevrilmez, yazılan not kaybolmaz
  await headerAction(page, 'pen-mode');
  await page.getByTestId('pen-tool-note').click();
  const shown = await shownPdfPages(page);
  const l = page.locator(
    `[data-testid="flipbook"] [data-pdf-page="${shown.at(-1)}"] [data-testid="annotation-layer"]`,
  );
  // Kalem kipinde alttaki sayfa düğmeleri çıkar, çubuk yükselir, kitap küçülür: yerleşim oturana dek beklenir
  let box = (await l.boundingBox())!;
  await expect
    .poll(async () => {
      const last = box;
      await page.waitForTimeout(250);
      box = (await l.boundingBox())!;
      return JSON.stringify(box) === JSON.stringify(last);
    })
    .toBe(true);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
  await expect(page.getByTestId('note-editor')).toBeVisible();
  await page.getByTestId('note-text').fill('Yazılan not');
  const before = (await spoken(page)).length;
  for (let k = 0; k < 25; k++) await endSentence(page);
  await expect.poll(async () => (await spoken(page)).length).toBeGreaterThan(before + 20);
  await page.waitForTimeout(800);
  expect(await bookIndex(page)).toBe(index);
  await expect(page.getByTestId('note-text')).toHaveValue('Yazılan not');

  // Not kapanır; kalem kipinde de çevrilmez. Esc kalem kipinden çıkar, okumayı kapatmaz; okunan sayfaya geçilir
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('note-editor')).toHaveCount(0);
  await page.waitForTimeout(800);
  expect(await bookIndex(page)).toBe(index);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pen-toolbar')).toHaveCount(0);
  await expect(page.getByTestId('read-aloud-bar')).toBeVisible();
  await expect.poll(() => bookIndex(page)).toBeGreaterThan(index);
});

test('sesli okuma: sayfa sınırından taşan cümle okunurken sayfa erken çevrilmez', async ({
  page,
}) => {
  await stubSpeech(page);
  await openNovel(page);
  await headerAction(page, 'read-aloud');
  await expect.poll(async () => (await spoken(page)).length).toBe(1);
  // Cümlenin başı 3. sayfanın sonunda, sonu 4. sayfanın başında
  await readUntil(page, () => lastSpokenHas(page, 'söylemiyormuş gibiydi'));
  await page.waitForTimeout(1_000);
  expect(await shownPdfPages(page)).toContain(3);
  // vurgu cümlenin baş parçasında (3. sayfa)
  await expect(
    page
      .locator('[data-testid="flipbook"] [data-pdf-page="3"] [data-testid="sentence-overlay"] rect')
      .first(),
  ).toBeVisible();
  // Sonraki cümle 4. sayfada: sayfa çevrilir
  await endSentence(page);
  await expect.poll(async () => await shownPdfPages(page)).toContain(4);
});

test('sesli okuma: okur ileriye göz atınca okuma onu geri çekmez; sonraki cümle düğmesiyle yeniden izler', async ({
  page,
}) => {
  await stubSpeech(page);
  await openNovel(page);
  await headerAction(page, 'read-aloud');
  await expect.poll(async () => (await spoken(page)).length).toBe(1);
  const start = await bookIndex(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // İki sayfa ileri (her çevirmenin bitmesi beklenir: süren çevirmede basılan tuş kaybolabilir)
  await turnNextPage(page);
  await turnNextPage(page);
  const peek = await bookIndex(page);
  expect(peek).toBeGreaterThan(start);

  await endSentence(page);
  await expect.poll(async () => (await spoken(page)).length).toBe(2);
  await page.waitForTimeout(800);
  expect(await bookIndex(page)).toBe(peek);

  // Okur düğmeye basınca okuma yeniden izler: okunan cümlenin sayfası açılır
  await showMenu(page);
  await page.getByRole('button', { name: 'Önceki cümle' }).click();
  await expect.poll(() => bookIndex(page)).toBe(start);
});

test('sesli okuma çubuğu: okunan satırları örtmez; kapanınca odak "Sesli oku" düğmesine döner; dokunma hedefleri 44 px', async ({
  page,
}) => {
  await stubSpeech(page);
  await openNovel(page);
  await headerAction(page, 'read-aloud');
  await expect.poll(async () => (await spoken(page)).length).toBe(1);
  const bar = page.getByTestId('read-aloud-bar').locator('> div').last();

  // Menü gizliyken çubuk kitabın altında, kitapla üst üste binmez (sayfa ve metin görünümü)
  for (const view of ['page', 'text'] as const) {
    if (view === 'text') {
      await showMenu(page);
      await headerAction(page, 'view-toggle');
      await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
    }
    if ((await page.getByTestId('reader-header').getAttribute('data-shown')) === 'true')
      await page.keyboard.press('m');
    await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'false');
    await expect
      .poll(async () => {
        const book = (await page.getByTestId('flipbook').boundingBox())!;
        const b = (await bar.boundingBox())!;
        return b.y - (book.y + book.height);
      })
      .toBeGreaterThanOrEqual(0);
  }

  for (const button of await page.getByTestId('read-aloud-bar').locator('button:visible').all()) {
    const b = (await button.boundingBox())!;
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
  }

  // Kapat düğmesi klavyeyle: odak "Okuma modları" düğmesine döner
  await page.getByTestId('read-aloud-close').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('read-aloud-bar')).toHaveCount(0);
  await expect(await headerActionTarget(page, 'read-aloud')).toBeFocused();
});

test('sesli okuma açıkken ⋯ menüsü: Esc önce menüyü kapatır, okuma sürer; menü kapanınca Esc okumayı kapatır', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'pixel', 'dar ekran düzeni');
  await stubSpeech(page);
  await openNovel(page);
  await headerAction(page, 'read-aloud');
  await expect.poll(async () => (await spoken(page)).length).toBe(1);
  await showMenu(page);

  const more = page.getByRole('button', { name: 'Diğer' });
  await more.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect(page.getByTestId('read-aloud-bar')).toBeVisible();
  await expect(page.getByTestId('reading-modes')).toHaveAttribute('data-active', 'read-aloud');

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('read-aloud-bar')).toHaveCount(0);
});

test('ses menüsü: gelişmiş ses kendiliğinden seçilir, sesler kaliteye göre gruplanır; Dinle örnek cümleyi okur', async ({
  page,
}) => {
  const enhanced = 'com.apple.voice.enhanced.tr-TR.Yelda';
  const compact = 'com.apple.voice.compact.tr-TR.Yelda';
  await stubSpeech(page, [
    { voiceURI: compact, name: 'Yelda', lang: 'tr-TR', default: false, localService: true },
    {
      voiceURI: enhanced,
      name: 'Yelda (Gelişmiş)',
      lang: 'tr-TR',
      default: false,
      localService: true,
    },
    {
      voiceURI: 'Google Türkçe',
      name: 'Google Türkçe',
      lang: 'tr-TR',
      default: false,
      localService: false,
    },
    { voiceURI: 'en-sam', name: 'Samantha', lang: 'en-US', default: true, localService: true },
  ]);
  await openNovel(page);
  await headerAction(page, 'read-aloud');
  await expect.poll(async () => (await spoken(page)).length).toBe(1);
  const [first] = await spoken(page);
  expect(first.voice).toBe(enhanced);

  await showOptions(page);
  await expect(page.getByTestId('read-aloud-voice')).toHaveText('Yelda (Gelişmiş)');
  await page.getByTestId('read-aloud-voice').click();
  const menu = page.getByTestId('voice-menu');
  await expect(menu.getByTestId('voice-group-enhanced').getByRole('radio')).toHaveText([
    /^Yelda \(Gelişmiş\)/,
  ]);
  await expect(menu.getByTestId('voice-group-standard').getByRole('radio')).toHaveText([
    /^Google Türkçe.*internet gerekir/,
    'Yelda',
  ]);
  await expect(menu.getByTestId('voice-hint')).toHaveCount(0);

  // Dinle: okuma duraklar, seçili sesle örnek cümle okunur
  const sample = 'Merhaba! Kitabınızı bu sesle okuyacağım.';
  await menu.getByTestId('voice-preview').click();
  await expect(page.getByTestId('read-aloud-play')).toHaveAttribute('aria-label', 'Oynat');
  await expect
    .poll(async () => (await spoken(page)).at(-1))
    .toMatchObject({
      text: sample,
      voice: enhanced,
    });
  // Duraklamışken seçilen ses örnek cümleyle tanıtılır
  await menu.getByRole('radio', { name: 'Yelda', exact: true }).click();
  await expect
    .poll(async () => (await spoken(page)).at(-1))
    .toMatchObject({
      text: sample,
      voice: compact,
    });
  // Oynat: okuma kaldığı cümleden yeni sesle sürer
  await page.getByTestId('read-aloud-play').click();
  await expect
    .poll(async () => (await spoken(page)).at(-1))
    .toMatchObject({
      text: first.text,
      voice: compact,
    });
  // Seçim kalıcıdır
  await page.reload();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await headerAction(page, 'read-aloud');
  await expect.poll(async () => (await spoken(page)).at(-1)?.voice).toBe(compact);
});

test('gelişmiş ses yoksa ses menüsü indirme yolunu gösterir; dışarı dokununca kapanır', async ({
  page,
}, testInfo) => {
  await stubSpeech(page);
  await openNovel(page);
  await headerAction(page, 'read-aloud');
  await expect.poll(async () => (await spoken(page)).length).toBe(1);
  await showOptions(page);
  await page.getByTestId('read-aloud-voice').click();
  const hint = page.getByTestId('voice-menu').getByTestId('voice-hint');
  await expect(hint).toBeVisible();
  const path =
    'Erişilebilirlik → Seslendirilen İçerik → Sesler → Türkçe → Yelda (Gelişmiş) → indir';
  await expect(hint).toContainText(path);
  if (testInfo.project.name === 'ipad') await expect(hint).toContainText(`Ayarlar → ${path}`);
  // Menü çubuğun yüksekliğini değiştirmez; menü açıkken dokunma hedefleri 44 px
  for (const button of await page.getByTestId('voice-menu').locator('button:visible').all()) {
    const b = (await button.boundingBox())!;
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
  }
  // Dışarı dokununca kapanır
  const book = (await page.getByTestId('flipbook').boundingBox())!;
  await page.mouse.click(book.x + 10, book.y + 10);
  await expect(page.getByTestId('voice-menu')).toHaveCount(0);
});
