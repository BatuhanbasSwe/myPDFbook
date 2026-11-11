import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  bookIndex,
  flipSettled,
  headerAction,
  importFixture,
  statusPages,
  turnNextPage,
} from './helpers';
import { piperLog, servePiper, stubVoices } from './piperStubs';
import { endSentence, highlighted, plain, spoken, stubSpeech } from './speechStubs';

/**
 * Dokunduğun cümleden oku (Plan 13): sesli okuma açıkken yazıya dokunuş okumayı o cümleden başlatır; kitabın dış
 * kenar şeridi sayfa çevirir; sesli okuma kapalıyken dokunma eskisi gibi. Masaüstünde fare, iPad ve telefonda
 * parmak (dokunmatik ekran).
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

/** Ekrandaki noktaya dokunur: dokunmatik cihazda parmakla, masaüstünde fareyle */
async function tapAt(page: Page, testInfo: TestInfo, x: number, y: number) {
  if (testInfo.project.use.hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/** Kitabın kutusunda orandaki noktaya dokunur (0 sol/üst … 1 sağ/alt) */
async function tapBook(page: Page, testInfo: TestInfo, fx: number, fy = 0.5) {
  const box = (await page.getByTestId('flipbook').boundingBox())!;
  await tapAt(page, testInfo, box.x + box.width * fx, box.y + box.height * fy);
}

/**
 * Kitap yerleşimi oturdu: çevirme bitti ve kitabın kutusu değişmiyor (sesli okuma çubuğu, öneri ve ipucu açılınca
 * kitap küçülür, kıvrılan sayfa yeniden kurulur: dokunulacak yer bundan sonra ölçülür)
 */
async function bookSettled(page: Page) {
  await flipSettled(page);
  const book = page.getByTestId('flipbook');
  let last = JSON.stringify(await book.boundingBox());
  await expect
    .poll(async () => {
      await page.waitForTimeout(300);
      const now = JSON.stringify(await book.boundingBox());
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
  await flipSettled(page);
}

/** Menü gizliyse ya da açıksa `m` ile istenen duruma getirir */
async function setMenu(page: Page, shown: boolean) {
  if ((await page.getByTestId('reader-header').getAttribute('data-shown')) !== String(shown))
    await page.keyboard.press('m');
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', String(shown));
  await bookSettled(page);
}

/**
 * Metin görünümünde açık sayfadaki bir paragrafın ortasındaki kelime ve ekrandaki yeri (kitabın içinden, dış kenar
 * şeridinden uzak). `nth`: kaçıncı uygun paragraf.
 */
async function wordInText(page: Page, nth = 0) {
  const found = await page.evaluate((nth) => {
    const book = document.querySelector('[data-testid="flipbook"]')!.getBoundingClientRect();
    const out: { x: number; y: number; word: string }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('.book-page-content [data-block]')) {
      const node = [...el.childNodes].find(
        (n): n is Text => n instanceof Text && n.data.trim().length > 80,
      );
      if (!node) continue;
      const data = node.data;
      let at = Math.floor(data.length / 2);
      while (at > 0 && /\S/.test(data[at - 1])) at--;
      let end = at;
      while (end < data.length && /\S/.test(data[end])) end++;
      if (end - at < 4) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, end);
      const r = range.getClientRects()[0];
      if (!r || r.width === 0) continue;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      // Açık sayfada (görünür, üstünde başka bir şey yok) ve kenar şeridinden uzak
      const hit = document.elementFromPoint(x, y);
      if (!hit || !el.contains(hit)) continue;
      const fx = (x - book.left) / book.width;
      if (fx < 0.15 || fx > 0.85) continue;
      out.push({ x, y, word: data.slice(at, end).replace(/[.,;:!?«»"“”'’)(]/g, '') });
    }
    return out[nth] ?? out.at(-1) ?? null;
  }, nth);
  expect(found).not.toBeNull();
  return found!;
}

/** Sayfa görünümünde açık (son) PDF sayfasının ortasındaki nokta: romanın sayfasında yazı */
async function pointInPdfPage(page: Page, fy = 0.5) {
  const shown = await statusPages(page);
  const el = page.locator(`[data-testid="flipbook"] [data-pdf-page="${shown.at(-1)}"]`);
  const box = (await el.boundingBox())!;
  return { pdfPage: shown.at(-1)!, x: box.x + box.width * 0.5, y: box.y + box.height * fy };
}

/** Sayfa görünümünde okunan cümlenin vurgusu noktanın üstünde (ya da satır arası kadar yakınında) mı */
async function highlightNear(page: Page, pdfPage: number, x: number, y: number) {
  const rects = page.locator(
    `[data-testid="flipbook"] [data-pdf-page="${pdfPage}"] [data-testid="sentence-overlay"] rect`,
  );
  for (const r of await rects.all()) {
    const b = await r.boundingBox();
    if (!b) continue;
    const dx = Math.max(b.x - x, 0, x - (b.x + b.width));
    const dy = Math.max(b.y - y, 0, y - (b.y + b.height));
    if (Math.hypot(dx, dy) <= 20) return true;
  }
  return false;
}

test('sayfa görünümü: sesli okuma açıkken cümleye dokununca o cümleden okunur (duraklatılmışken de), vurgu dokunulan yerde; kenar şeridi sayfa çevirir; ipucu bir kez', async ({
  page,
}, testInfo) => {
  await stubSpeech(page);
  await openNovel(page);
  // İlk sayfa kapak (yalnızca başlık): yazılı sayfaya geçilir
  await turnNextPage(page);
  await setMenu(page, true);
  await headerAction(page, 'read-aloud');
  await expect.poll(async () => (await spoken(page)).length).toBe(1);
  const first = (await spoken(page))[0].text;

  // İlk açılışta ipucu: çubuğun üstünde, kitaba dokunmayı engellemez. Yapay zekâ sesi önerisi açıksa (tarayıcı
  // çalıştırabiliyorsa) ipucu o kapanınca görünür.
  const hint = page.getByTestId('read-aloud-tap-hint');
  const suggest = page.getByTestId('voice-suggest');
  if (await suggest.isVisible()) {
    await expect(hint).toHaveCount(0);
    await suggest.getByRole('button', { name: 'Öneriyi kapat' }).click();
  }
  await expect(hint).toHaveText('Bir cümleye dokun, oradan okusun');
  await setMenu(page, false);

  // Sayfanın ortasındaki cümleye dokun: o cümleden okunur, vurgu dokunulan yerde; menü açılmaz, sayfa çevrilmez
  const index = await bookIndex(page);
  const p = await pointInPdfPage(page, 0.55);
  await tapAt(page, testInfo, p.x, p.y);
  await expect.poll(async () => (await spoken(page)).length).toBe(2);
  const tapped = (await spoken(page))[1].text;
  expect(tapped).not.toBe(first);
  await expect.poll(() => highlightNear(page, p.pdfPage, p.x, p.y)).toBe(true);
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'false');
  expect(await bookIndex(page)).toBe(index);
  // İpucu ilk dokunuşta söner
  await expect(hint).toHaveCount(0);

  // Duraklatılmışken başka bir cümleye dokun: oradan oynar
  await page.getByTestId('read-aloud-play').click();
  await expect(page.getByTestId('read-aloud-play')).toHaveAttribute('aria-label', 'Oynat');
  const q = await pointInPdfPage(page, 0.3);
  await tapAt(page, testInfo, q.x, q.y);
  await expect(page.getByTestId('read-aloud-play')).toHaveAttribute('aria-label', 'Duraklat');
  await expect.poll(async () => (await spoken(page)).length).toBe(3);
  expect((await spoken(page))[2].text).not.toBe(tapped);
  await expect.poll(() => highlightNear(page, q.pdfPage, q.x, q.y)).toBe(true);

  // Sağ kenar şeridine dokun: sayfa çevrilir, okunan cümle değişmez. iPad yatayda çift sayfa: şerit her dış sayfanın
  // %12'si (kitabın %6'sı)
  if (testInfo.project.name === 'ipad')
    await expect(page.getByTestId('flipbook')).toHaveAttribute('data-spread', 'true');
  await tapBook(page, testInfo, 0.98);
  await expect.poll(() => bookIndex(page)).toBeGreaterThan(index);
  await flipSettled(page);
  expect((await spoken(page)).length).toBe(3);
  // Sol kenar şeridi geri çevirir
  await tapBook(page, testInfo, 0.02);
  await expect.poll(() => bookIndex(page)).toBe(index);
  await flipSettled(page);

  // Yazı olmayan yere (sayfanın en altı) dokununca eskisi gibi: ortada menü açılır
  await tapBook(page, testInfo, 0.5, 0.995);
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'true');
  expect((await spoken(page)).length).toBe(3);

  // İpucu bir kez: kapatıp yeniden açınca görünmez
  await page.getByTestId('read-aloud-close').click();
  await headerAction(page, 'read-aloud');
  await expect(page.getByTestId('read-aloud-bar')).toBeVisible();
  await expect(hint).toHaveCount(0);
});

test('metin görünümü: dokunulan kelimenin cümlesi okunur ve vurgulanır; kenar şeridi çevirir', async ({
  page,
}, testInfo) => {
  await stubSpeech(page);
  await openNovel(page, 'text');
  // Telefonda ilk sayfa yalnızca başlık: yazılı sayfaya geçilir
  await turnNextPage(page);
  await setMenu(page, true);
  await headerAction(page, 'read-aloud');
  await expect.poll(async () => (await spoken(page)).length).toBe(1);
  await setMenu(page, false);
  const index = await bookIndex(page);

  const w = await wordInText(page, 1);
  await tapAt(page, testInfo, w.x, w.y);
  await expect.poll(async () => (await spoken(page)).length).toBe(2);
  expect(plain((await spoken(page))[1].text)).toContain(plain(w.word));
  await expect.poll(async () => plain((await highlighted(page)) ?? '')).toContain(plain(w.word));
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'false');
  expect(await bookIndex(page)).toBe(index);

  // Sol kenar şeridi geri çevirir (iPad'de metin görünümü dört sayfa: sondayız)
  await tapBook(page, testInfo, 0.02);
  await expect.poll(() => bookIndex(page)).toBeLessThan(index);
  expect((await spoken(page)).length).toBe(2);
});

test('sesli okuma kapalıyken dokunma değişmez: orta menüyü açar, sağ üçte bir çevirir; konuşma yok', async ({
  page,
}, testInfo) => {
  await stubSpeech(page);
  await openNovel(page);
  await setMenu(page, false);
  const index = await bookIndex(page);
  // Ortadaki yazıya dokunma menüyü açar (çift sayfada orta, sayfaların arası)
  await tapBook(page, testInfo, 0.5, 0.55);
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'true');
  await setMenu(page, false);
  // Sağ üçteki yazıya dokunma sayfa çevirir
  await tapBook(page, testInfo, 0.8, 0.55);
  await expect.poll(() => bookIndex(page)).toBeGreaterThan(index);
  expect(await spoken(page)).toEqual([]);
});

test('yapay zekâ sesi: dokunulan cümle o sesle sentezlenir', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await stubVoices(page);
  await servePiper(page);
  await openNovel(page, 'text');
  // Telefonda ilk sayfa yalnızca başlık: yazılı sayfaya geçilir
  await turnNextPage(page);
  await setMenu(page, true);
  await headerAction(page, 'read-aloud');
  await page.getByTestId('voice-suggest-open').click();
  const row = page
    .getByTestId('voice-menu')
    .getByTestId('voice-neural')
    .filter({ hasText: 'DFKI' });
  await row.click();
  await expect(row).toHaveText(/^DFKI.*Cihazda/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('voice-menu')).toHaveCount(0);
  await expect.poll(async () => (await piperLog(page)).length).toBeGreaterThan(0);
  // Okuma duraklatılır: dokunuş duraklatılmış okumayı o cümleden başlatır
  await page.getByTestId('read-aloud-play').click();
  await expect(page.getByTestId('read-aloud-play')).toHaveAttribute('aria-label', 'Oynat');
  await setMenu(page, false);

  const w = await wordInText(page, 2);
  // Okunan cümlenin vurgusu her karede kaydedilir: sahte ses 0,5 sn sürer, okuma hızla ilerler
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __highlights: string[] }).__highlights = seen;
    const tick = () => {
      const h = CSS.highlights.get('mypdfbook-active');
      const text = h ? [...h].map((r) => r.toString()).join(' ') : '';
      if (text && seen.at(-1) !== text) seen.push(text);
      requestAnimationFrame(tick);
    };
    tick();
  });
  const seenBefore = await page.evaluate(
    () => (window as unknown as { __highlights: string[] }).__highlights.length,
  );
  await tapAt(page, testInfo, w.x, w.y);
  await expect(page.getByTestId('read-aloud-play')).toHaveAttribute('aria-label', 'Duraklat');
  // Dokunulan cümle yapay zekâ sesiyle sentezlendi (önceden sentezlenmiş de olabilir) ve okunan cümle o oldu
  await expect
    .poll(async () =>
      (await piperLog(page)).some(
        (l) => l.voice === 'piper:tr_TR-dfki-medium' && plain(l.text).includes(plain(w.word)),
      ),
    )
    .toBe(true);
  await expect
    .poll(async () =>
      plain(
        (await page.evaluate(() => (window as unknown as { __highlights: string[] }).__highlights))[
          seenBefore
        ] ?? '',
      ),
    )
    .toContain(plain(w.word));
});

/** Sayfa görünümünde yazılı sayfada (kapaktan sonra) sesli okumayı açar, menüyü gizler */
async function startReadingOnTextPage(page: Page) {
  await stubSpeech(page);
  await openNovel(page);
  await turnNextPage(page);
  await setMenu(page, true);
  await headerAction(page, 'read-aloud');
  await expect.poll(async () => (await spoken(page)).length).toBe(1);
  const suggest = page.getByTestId('voice-suggest');
  if (await suggest.isVisible())
    await suggest.getByRole('button', { name: 'Öneriyi kapat' }).click();
  await setMenu(page, false);
}

test('okur ileriye göz atarken yazı olmayan yere dokunuş (menü) okumayı geri çekmez', async ({
  page,
}, testInfo) => {
  await startReadingOnTextPage(page);
  const reading = await bookIndex(page);
  // İleriye göz at: okuma bu sayfayı izlemez
  await turnNextPage(page);
  const ahead = await bookIndex(page);
  expect(ahead).toBeGreaterThan(reading);
  await setMenu(page, false);
  // Alt boşluğa dokunuş menüyü açar
  await tapBook(page, testInfo, 0.5, 0.995);
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'true');
  // Sonraki cümleye geçilir (okunan sayfada): gezilen sayfa geri çevrilmez
  await endSentence(page);
  await expect.poll(async () => (await spoken(page)).length).toBe(2);
  await page.waitForTimeout(1500);
  expect(await bookIndex(page)).toBe(ahead);
});

test('uzun basma ve süren metin seçimi okumayı başlatmaz', async ({ page }) => {
  await startReadingOnTextPage(page);
  const p = await pointInPdfPage(page, 0.36);
  // Uzun basma (≥ 500 ms): dokunuş sayılmaz
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(500);
  expect((await spoken(page)).length).toBe(1);
  // Bırakılırken seçili metin var: okumaz
  await page.mouse.down();
  const selected = await page.evaluate(() => {
    // Görünür bir yazı seçilir (uzun basmayla seçim sürüyormuş gibi)
    const range = document.createRange();
    const el = document.querySelector<HTMLElement>('[data-testid="read-aloud-rates"]')!;
    el.style.userSelect = 'text';
    el.style.webkitUserSelect = 'text';
    range.selectNodeContents(el);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    return sel.toString().trim().length > 0;
  });
  await page.mouse.up();
  await page.waitForTimeout(500);
  // Chrome'un telefon öykünmesi (Pixel) programla yapılan seçimi boş döndürür: orada bu adım denenemez
  if (selected) expect((await spoken(page)).length).toBe(1);
  else test.info().annotations.push({ type: 'not', description: 'seçim öykünmede boş' });
});

test('sayfanın cümleleri henüz okunmamışken (eşzamansız yol) dokunulan cümle okunur', async ({
  page,
}, testInfo) => {
  // Anında çevirme: yeni sayfaya çevrilir çevrilmez dokunulur (sayfanın metni o sırada okunuyor)
  await page.addInitScript(() => {
    if (!localStorage.getItem('mypdfbook:reader'))
      localStorage.setItem('mypdfbook:reader', JSON.stringify({ effect: 'none' }));
  });
  await startReadingOnTextPage(page);
  const before = await bookIndex(page);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => bookIndex(page)).toBeGreaterThan(before);
  // Sayfanın üst kısmı (4. ve 5. sayfada yazı üstte)
  const p = await pointInPdfPage(page, 0.15);
  await tapAt(page, testInfo, p.x, p.y);
  await expect.poll(async () => (await spoken(page)).length).toBe(2);
  await expect.poll(() => highlightNear(page, p.pdfPage, p.x, p.y)).toBe(true);
});
