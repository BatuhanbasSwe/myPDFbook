import { expect, test, type Page } from '@playwright/test';
import { bookIndex, flipSettled, headerAction, importFixture, turnNextPage } from './helpers';
import { servePiper, stubVoices } from './piperStubs';
import {
  endSentence,
  highlighted,
  highlightedWord,
  plain,
  spoken,
  stubSpeech,
  wordBoundary,
} from './speechStubs';

/**
 * Okunan yeri kaçırma (Plan 14): okunan kelime vurgulanır (sistem sesinde kelime sınırıyla ya da tahminle, yapay
 * zekâ sesinde sesin saatiyle), cümlenin solunda kenar çizgisi; okur başka sayfaya gidince okuma onu geri çekmez,
 * "Okunan yere dön" görünür; okuma sayfayı çevirince cümle parlar; "Diğer yazıları soldur".
 */

const NOVEL = ['novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf'] as const;

async function openNovel(page: Page, view: 'page' | 'text' = 'page') {
  if (view === 'text')
    await page.addInitScript(() => {
      if (!localStorage.getItem('mypdfbook:reader'))
        localStorage.setItem('mypdfbook:reader', JSON.stringify({ view: 'text' }));
    });
  await page.goto('/');
  await importFixture(page, ...NOVEL);
  await page.getByTestId('book-open').click();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
}

async function showMenu(page: Page, shown = true) {
  if ((await page.getByTestId('reader-header').getAttribute('data-shown')) !== String(shown))
    await page.keyboard.press('m');
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', String(shown));
}

/** Yazılı sayfada (kapaktan sonra) sesli okumayı açar; yapay zekâ sesi önerisi kapatılır, menü gizlenir */
async function startReading(page: Page) {
  await turnNextPage(page);
  await showMenu(page);
  await headerAction(page, 'read-aloud');
  await expect.poll(async () => (await spoken(page)).length).toBe(1);
  const suggest = page.getByTestId('voice-suggest');
  if (await suggest.isVisible())
    await suggest.getByRole('button', { name: 'Öneriyi kapat' }).click();
  await showMenu(page, false);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/** Ses menüsü (ayarlar orada): dar ekranda önce "Ses ve uyku zamanlayıcısı" */
async function openVoiceMenu(page: Page) {
  const more = page.getByTestId('read-aloud-options');
  if ((await more.isVisible()) && (await more.getAttribute('aria-expanded')) !== 'true')
    await more.click();
  await page.getByTestId('read-aloud-voice').click();
  await expect(page.getByTestId('voice-menu')).toBeVisible();
}

async function closeVoiceMenu(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('voice-menu')).toHaveCount(0);
}

const wordOverlay = (page: Page) =>
  page.locator('[data-testid="flipbook"] [data-testid="word-overlay"]');

test('sayfa görünümü: okunan kelime vurgulanır ve tahmini süreyle ilerler (kelime sınırı yok); kenar çizgisi; ayar kapatılınca kelime yok', async ({
  page,
}) => {
  await stubSpeech(page);
  await openNovel(page);
  await startReading(page);
  // Uzunca bir cümle (bölüm başlığı gibi iki kelimelik cümlede ilk bakışta son kelimede olunabilir)
  await expect
    .poll(
      async () => {
        const last = (await spoken(page)).at(-1)!.text;
        if (last.split(/s+/).length >= 8) return true;
        await endSentence(page);
        return false;
      },
      { intervals: [150], timeout: 30_000 },
    )
    .toBe(true);
  const sentence = plain((await spoken(page)).at(-1)!.text);

  // Kelime cümlenin içinde; kelime sınırı gelmese de zamanla ilerler
  await expect(wordOverlay(page).first()).toBeVisible();
  const first = (await wordOverlay(page).first().getAttribute('data-word'))!;
  expect(sentence).toContain(plain(first));
  await expect
    .poll(async () => await wordOverlay(page).first().getAttribute('data-word'), { timeout: 5000 })
    .not.toBe(first);
  const later = (await wordOverlay(page).first().getAttribute('data-word'))!;
  expect(sentence).toContain(plain(later));
  // Kelimenin kutusu cümlenin vurgusunun içinde
  const word = (await wordOverlay(page).first().locator('rect.word-mark').first().boundingBox())!;
  const marks = page.locator(
    '[data-testid="flipbook"] [data-testid="sentence-overlay"] .sentence-mark',
  );
  const inside = await (async () => {
    for (const m of await marks.all()) {
      const b = await m.boundingBox();
      if (!b) continue;
      const cx = word.x + word.width / 2;
      const cy = word.y + word.height / 2;
      if (cx >= b.x - 2 && cx <= b.x + b.width + 2 && cy >= b.y - 2 && cy <= b.y + b.height + 2)
        return true;
    }
    return false;
  })();
  expect(inside).toBe(true);

  // Cümlenin ilk satırının solunda kenar çizgisi (cümlenin solunda)
  const bar = page.locator('[data-testid="flipbook"] [data-testid="sentence-bar"]').first();
  await expect(bar).toBeVisible();
  const barBox = (await bar.boundingBox())!;
  const firstMark = (await marks.first().boundingBox())!;
  expect(barBox.x + barBox.width).toBeLessThanOrEqual(firstMark.x + 1);
  expect(Math.abs(barBox.y - firstMark.y)).toBeLessThan(firstMark.height);

  // "Kelimeyi takip et" kapatılınca kelime vurgusu kalkar (cümle vurgusu durur); kalıcı
  await openVoiceMenu(page);
  const follow = page.getByTestId('read-aloud-follow-word');
  await expect(follow).toBeChecked();
  await follow.uncheck();
  await closeVoiceMenu(page);
  await expect(wordOverlay(page)).toHaveCount(0);
  await expect(marks.first()).toBeVisible();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('mypdfbook:read-aloud') ?? '{}')),
  ).toMatchObject({ followWord: false });
});

test('metin görünümü: motor kelime sınırı bildirince o kelime vurgulanır; kenar çizgisi', async ({
  page,
}) => {
  await stubSpeech(page);
  await openNovel(page, 'text');
  await startReading(page);
  const text = (await spoken(page))[0].text;
  await expect
    .poll(async () => plain((await highlighted(page)) ?? ''))
    .toContain(plain(text).slice(0, 15));

  // Cümlenin dördüncü (yoksa son) kelimesi okunuyor
  const words = [...text.matchAll(/\S+/g)];
  const target = words[Math.min(3, words.length - 1)];
  await wordBoundary(page, target.index);
  const bare = target[0].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  await expect.poll(async () => plain((await highlightedWord(page)) ?? '')).toBe(plain(bare));
  // Kelime sınırı geldikçe kelime değişir (tahmin değil)
  await wordBoundary(page, 0);
  const firstBare = words[0][0].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  await expect.poll(async () => plain((await highlightedWord(page)) ?? '')).toBe(plain(firstBare));

  // Kenar çizgisi okunan cümlenin sayfasında, sayfanın içinde
  const bar = page.locator('.book-page [data-testid="sentence-bar"]');
  await expect(bar).toHaveCount(1);
  await expect(bar).toBeVisible();

  // Sonraki cümleye geçince kelime yeni cümlede
  await endSentence(page);
  await expect.poll(async () => (await spoken(page)).length).toBe(2);
  const next = plain((await spoken(page))[1].text);
  await expect
    .poll(async () => next.includes(plain((await highlightedWord(page)) ?? '#')))
    .toBe(true);
});

test('okur başka sayfaya gidince okuma onu geri çekmez, "Okunan yere dön" görünür; dokununca okunan sayfa açılır, cümle parlar; okur kendisi dönünce hap söner', async ({
  page,
}) => {
  await stubSpeech(page);
  await openNovel(page);
  await startReading(page);
  const start = await bookIndex(page);
  const pill = page.getByTestId('read-aloud-return');
  await expect(pill).toHaveCount(0);

  // İleriye göz atılır
  await turnNextPage(page);
  await turnNextPage(page);
  const peek = await bookIndex(page);
  await expect(pill).toBeVisible();
  await expect(pill).toHaveText('Okunan yere dön');

  // Okuma ilerler ama okuru geri çekmez; hap durur
  await endSentence(page);
  await expect.poll(async () => (await spoken(page)).length).toBe(2);
  await page.waitForTimeout(800);
  expect(await bookIndex(page)).toBe(peek);
  await expect(pill).toBeVisible();

  // Hapa dokununca okunan sayfa açılır (okuma bu arada sonraki sayfaya geçmiş olabilir: tek sayfada), cümle
  // parlar, hap söner
  await pill.click();
  await expect.poll(() => bookIndex(page)).toBeLessThan(peek);
  const reading = await bookIndex(page);
  expect(reading).toBeGreaterThanOrEqual(start);
  await expect(
    page
      .locator('[data-testid="flipbook"] [data-testid="sentence-overlay"]')
      .filter({ visible: true }),
  ).not.toHaveCount(0);
  await expect(page.locator('[data-testid="sentence-overlay"][data-pulse]').first()).toBeAttached();
  await expect(pill).toHaveCount(0);
  await flipSettled(page);

  // Yeniden göz atılır, okur kendisi döner: hap söner, okuma yine izler
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await turnNextPage(page);
  await expect(pill).toBeVisible();
  await flipSettled(page);
  const before = await bookIndex(page);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => bookIndex(page)).toBeLessThan(before);
  await expect.poll(() => bookIndex(page)).toBe(reading);
  await expect(pill).toHaveCount(0);

  // Okuma yine izler: okunan cümle sayfadan çıkınca sayfa kendiliğinden çevrilir
  await expect
    .poll(
      async () => {
        if ((await bookIndex(page)) > reading) return true;
        await endSentence(page);
        return false;
      },
      { intervals: [150], timeout: 30_000 },
    )
    .toBe(true);
  await expect(pill).toHaveCount(0);
});

test('okuma sayfayı çevirince yeni sayfadaki cümle parlar; hareket azaltılmışsa parlamaz', async ({
  page,
}) => {
  await stubSpeech(page);
  await openNovel(page);
  await startReading(page);
  const start = await bookIndex(page);
  const pulsing = page.locator(
    '[data-testid="flipbook"] [data-testid="sentence-overlay"][data-pulse]',
  );
  // Okuma ilerler; sayfa çevrilince cümle parlar
  await expect
    .poll(
      async () => {
        if ((await bookIndex(page)) !== start) return true;
        await endSentence(page);
        return false;
      },
      { intervals: [150], timeout: 30_000 },
    )
    .toBe(true);
  await expect(pulsing.first()).toBeAttached();
  const anim = await pulsing
    .first()
    .locator('.sentence-mark')
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(anim).toBe('sentence-pulse-stroke');
  // Kısa sürer
  await expect(pulsing).toHaveCount(0, { timeout: 3000 });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="sentence-overlay"] .sentence-mark');
    el?.closest('svg')?.classList.add('sentence-pulse');
  });
  expect(
    await page
      .locator('[data-testid="sentence-overlay"].sentence-pulse .sentence-mark')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');
});

test('"Diğer yazıları soldur": okunan cümle dışı karartılır (sayfa ve metin görünümü); kapalıyken karartma yok', async ({
  page,
}) => {
  await stubSpeech(page);
  await openNovel(page);
  await startReading(page);
  const dim = page.locator('[data-testid="flipbook"] [data-testid="sentence-dim"]');
  await expect(page.locator('[data-testid="sentence-overlay"]').first()).toBeVisible();
  await expect(dim).toHaveCount(0);

  await openVoiceMenu(page);
  const toggle = page.getByTestId('read-aloud-dim-others');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await closeVoiceMenu(page);
  // Okunan cümlenin sayfasında cümle dışı (SVG yolu), öteki açık sayfada sayfanın tamamı
  await expect(page.locator('[data-testid="flipbook"] path.sentence-dim').first()).toBeVisible();

  // Metin görünümünde aynı tercih: yazı soluk, okunan cümle koyu (odak sınıfı)
  await page.evaluate(() =>
    localStorage.setItem('mypdfbook:reader', JSON.stringify({ view: 'text' })),
  );
  await page.reload();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await showMenu(page);
  await headerAction(page, 'read-aloud');
  await expect(page.locator('.sentence-focus')).toHaveCount(1);
});

test('yapay zekâ sesi: okunan kelime sesin saatiyle cümle içinde ilerler', async ({ page }) => {
  test.setTimeout(120_000);
  await stubVoices(page);
  await servePiper(page);
  await openNovel(page, 'text');
  await turnNextPage(page);
  await showMenu(page);
  // Her cümle 3 sn: kelimeler cümle sürerken ilerler
  await page.evaluate(() => {
    (window as unknown as { __piperClipSeconds: number }).__piperClipSeconds = 3;
  });
  await headerAction(page, 'read-aloud');
  await page.getByTestId('voice-suggest-open').click();
  const row = page
    .getByTestId('voice-menu')
    .getByTestId('voice-neural')
    .filter({ hasText: 'DFKI' });
  await row.click();
  await expect(row).toHaveText(/^DFKI.*Cihazda/);
  await closeVoiceMenu(page);

  // Okunan cümle ve kelime her karede kaydedilir
  await page.evaluate(() => {
    const seen: { sentence: string; word: string }[] = [];
    (window as unknown as { __words: typeof seen }).__words = seen;
    const text = (name: string) => {
      const h = CSS.highlights.get(name);
      return h ? [...h].map((r) => r.toString()).join(' ') : '';
    };
    const tick = () => {
      const sentence = text('mypdfbook-active');
      const word = text('mypdfbook-word');
      const last = seen.at(-1);
      if (word && (last?.word !== word || last.sentence !== sentence))
        seen.push({ sentence, word });
      requestAnimationFrame(tick);
    };
    tick();
  });
  const words = () =>
    page.evaluate(
      () => (window as unknown as { __words: { sentence: string; word: string }[] }).__words,
    );
  // Bir cümlede en az üç ayrı kelime okunur; her kelime kendi cümlesinde
  await expect
    .poll(
      async () => {
        const counts = new Map<string, Set<string>>();
        for (const w of await words()) {
          if (!counts.has(w.sentence)) counts.set(w.sentence, new Set());
          counts.get(w.sentence)!.add(w.word);
        }
        return Math.max(0, ...[...counts.values()].map((s) => s.size));
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(3);
  for (const w of await words()) expect(plain(w.sentence)).toContain(plain(w.word));
});
