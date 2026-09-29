import { expect, test, type Locator, type Page } from '@playwright/test';
import { headerAction, headerActionTarget, importFixture, turnNextPage } from './helpers';

const NOVEL = ['novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf'] as const;

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

/** Sayfaya git ile PDF sayfasını (1'den) açar */
async function jumpTo(page: Page, pdfPage: number) {
  await showMenu(page);
  await page.getByTestId('page-status').click();
  await page.getByTestId('page-jump').fill(String(pdfPage));
  await page.keyboard.press('Enter');
  await expect(pdfPageEl(page, pdfPage).locator('img')).toBeVisible();
}

const pdfPageEl = (page: Page, pdfPage: number) =>
  page.locator(`[data-testid="flipbook"] [data-pdf-page="${pdfPage}"]`);

const bookIndex = async (page: Page) =>
  Number(await page.getByTestId('flipbook').getAttribute('data-index'));

/** Nokta her karede bir kez denetlenir: bekleyen denetim bitsin */
const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

/** Odaktaki cümle (kitabın kökünde; -1: yok) */
const focused = async (page: Page) =>
  Number(await page.locator('[data-focus-sentence]').getAttribute('data-focus-sentence'));

/**
 * Öğenin kutusunda (0–1) ekran noktası. Kutu durulana dek beklenir: çubuk açılıp kapanınca kitabın alanı değişir,
 * sayfa yeniden ölçeklenir (kıvrılan sayfada kitap yeniden kurulur).
 */
async function at(l: Locator, x: number, y: number): Promise<[number, number]> {
  let prev = '';
  await expect
    .poll(
      async () => {
        const box = JSON.stringify(await l.boundingBox());
        const same = box === prev && box !== 'null';
        prev = box;
        return same;
      },
      { intervals: [350] },
    )
    .toBe(true);
  // durulan kutu (yeniden sorulursa öğe bu arada değişmiş olabilir)
  const box = JSON.parse(prev) as { x: number; y: number; width: number; height: number };
  return [box.x + box.width * x, box.y + box.height * y];
}

type Phase = 'pointerdown' | 'pointermove' | 'pointerup';

/**
 * Yapay işaretçi olayı: noktadaki öğeye gönderilir (Playwright'ın kalem girdisi yok). `buttons` 0 olan kalem
 * `pointermove`u havadaki kalemdir.
 */
async function pointer(
  page: Page,
  type: Phase,
  pointerType: 'pen' | 'touch' | 'mouse',
  [x, y]: [number, number],
  { pointerId = 31, buttons }: { pointerId?: number; buttons?: number } = {},
) {
  await page.evaluate(
    ({ type, pointerType, x, y, pointerId, buttons }) => {
      const target = document.elementFromPoint(x, y) ?? document.body;
      target.dispatchEvent(
        new PointerEvent(type, {
          pointerId,
          pointerType,
          isPrimary: true,
          bubbles: true,
          cancelable: true,
          composed: true,
          button: type === 'pointermove' ? -1 : 0,
          buttons: buttons ?? (type === 'pointerup' ? 0 : 1),
          clientX: x,
          clientY: y,
        }),
      );
    },
    { type, pointerType, x, y, pointerId, buttons },
  );
}

/**
 * Parmağın basılı tutması doldu, odak sürükleniyor (kitabın kökünde data-focus-press). Sabit bir bekleme yerine bu
 * beklenir: yük altında zamanlayıcı geç çalışır, dolmadan kayan parmak kaydırma sayılırdı.
 */
const longPressed = (page: Page) => expect(page.locator('[data-focus-press]')).toHaveCount(1);

/** Havadaki kalem noktanın üstünde */
const penHover = (page: Page, p: [number, number]) =>
  pointer(page, 'pointermove', 'pen', p, { buttons: 0 });

/** Kalem ya da parmakla dokunma (basıp hemen bırakma) */
async function tap(page: Page, pointerType: 'pen' | 'touch', p: [number, number], pointerId = 41) {
  await pointer(page, 'pointerdown', pointerType, p, { pointerId });
  await pointer(page, 'pointerup', pointerType, p, { pointerId });
}

/**
 * Sayfa görünümünde noktanın odaktaki cümlenin açık kalan yerine (karartmadaki deliklere) ekranda uzaklığı (px);
 * sayfada odak katmanı yoksa null
 */
function holeDistance(page: Page, pdfPage: number, [x, y]: [number, number]) {
  return page.evaluate(
    ({ pdfPage, x, y }) => {
      const svg = document.querySelector<SVGSVGElement>(
        `[data-testid="flipbook"] [data-pdf-page="${pdfPage}"] [data-testid="sentence-overlay"]`,
      );
      if (!svg) return null;
      const vb = svg.viewBox.baseVal;
      const r = svg.getBoundingClientRect();
      const scale = Math.min(r.width / vb.width, r.height / vb.height);
      const left = r.left + (r.width - vb.width * scale) / 2;
      const top = r.top + (r.height - vb.height * scale) / 2;
      let best = Infinity;
      // Karartma yolunun delikleri: "x y genişlik yükseklik;…"
      const holes = svg.querySelector('.sentence-dim')?.getAttribute('data-holes') ?? '';
      for (const hole of holes.split(';').filter(Boolean)) {
        const [hx, hy, hw, hh] = hole.split(' ').map(Number);
        const x0 = left + hx * scale;
        const y0 = top + hy * scale;
        const x1 = x0 + hw * scale;
        const y1 = y0 + hh * scale;
        best = Math.min(best, Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1)));
      }
      return best;
    },
    { pdfPage, x, y },
  );
}

/**
 * Metin görünümünde öğenin kutusundaki (0–1) noktanın üstüne gelinir (`hover`) ve odaktaki cümle noktaya yakın olana
 * dek beklenir. Kitap bu arada yeniden yerleşirse (yük altında çubuk ya da menü geç oturur) nokta yeniden hesaplanıp
 * yeniden gelinir. Son nokta döner.
 */
async function hoverText(
  page: Page,
  l: Locator,
  x: number,
  y: number,
  hover: (p: [number, number]) => Promise<void>,
): Promise<[number, number]> {
  let p: [number, number] = [0, 0];
  await expect
    .poll(async () => {
      p = await at(l, x, y);
      await hover(p);
      await frames(page);
      // odağın gelmesi için kısa bir süre tanınır (nokta her karede bir kez denetlenir)
      for (let k = 0; k < 5; k++) {
        const d = await highlightDistance(page, p);
        if (d !== null && d <= 20) return d;
        await frames(page);
      }
      return highlightDistance(page, p);
    })
    .toBeLessThanOrEqual(20);
  return p;
}

/** Metin görünümünde noktanın odaktaki cümlenin (::highlight aralıkları) satırlarına uzaklığı (px); yoksa null */
function highlightDistance(page: Page, [x, y]: [number, number]) {
  return page.evaluate(
    ({ x, y }) => {
      const h = CSS.highlights.get('mypdfbook-active');
      if (!h) return null;
      let best = Infinity;
      for (const range of h as unknown as Iterable<Range>)
        for (const r of range.getClientRects())
          best = Math.min(
            best,
            Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom)),
          );
      return best;
    },
    { x, y },
  );
}

/** Odakta cümlenin tamamı açık kalsın (varsayılan kelime penceresi) */
async function sentenceUnit(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('mypdfbook:focus', JSON.stringify({ unit: 'sentence' }));
  });
}

/** Kelime penceresindeki kelime sayısı (kitabın kökünde; 0: pencere yok) */
const windowWords = async (page: Page) =>
  Number(await page.locator('[data-focus-words]').getAttribute('data-focus-words'));

/** Sayfa görünümünde karartmanın delikleri ("x y genişlik yükseklik;…"); katman yoksa '' */
const holes = (page: Page, pdfPage: number) =>
  page.evaluate(
    (pdfPage) =>
      document
        .querySelector(`[data-testid="flipbook"] [data-pdf-page="${pdfPage}"] .sentence-dim`)
        ?.getAttribute('data-holes') ?? '',
    pdfPage,
  );

/** Metin görünümünde açık kalan yazı (::highlight aralıkları) ve içindeki kelime sayısı */
const litText = (page: Page) =>
  page.evaluate(() => {
    const h = CSS.highlights.get('mypdfbook-active');
    const text = h ? [...(h as unknown as Iterable<Range>)].map(String).join(' ') : '';
    return { text, words: text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length };
  });

/** Kalemin ayarı: "Kalemle her zaman çiz" (varsayılan açık) */
async function penAlways(page: Page, on: boolean) {
  await page.addInitScript((on) => {
    localStorage.setItem('mypdfbook:pen', JSON.stringify({ penAlways: on }));
  }, on);
}

test('odak (cümle), sayfa görünümü: havadaki kalem ve fare cümleyi seçer (karartma, doğru cümle); ↑/↓ cümle cümle; kalem dokunuşu sayfa çevirmez, parmak çevirir; parmakla basılı tutup sürükleme odağı taşır', async ({
  page,
}) => {
  await penAlways(page, false);
  await sentenceUnit(page);
  await openNovel(page);
  await jumpTo(page, 3);
  await headerAction(page, 'focus-mode');
  await expect(page.getByTestId('focus-bar')).toBeVisible();
  await expect(await headerActionTarget(page, 'focus-mode')).toBeVisible();
  // Açılınca açık sayfanın ilk cümlesi odakta: cümle dışı karartılır
  await expect.poll(() => focused(page)).toBeGreaterThanOrEqual(0);
  const p3 = pdfPageEl(page, 3);
  await expect(p3.locator('[data-testid="sentence-dim"]')).toHaveCount(1);
  // Kalemle odakta cümle sarıyla vurgulanmaz, yalnızca açık kalır
  await expect(p3.locator('.sentence-mark')).toHaveCount(0);
  // Esc kapatır: karartma kalkar; yeniden açılır
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('focus-bar')).toHaveCount(0);
  await expect(page.locator('[data-testid="sentence-dim"]')).toHaveCount(0);
  await showMenu(page);
  await headerAction(page, 'focus-mode');
  await expect(page.getByTestId('focus-bar')).toBeVisible();

  // Havadaki kalem: noktanın altındaki cümle açık kalır (3. sayfada yazı sayfanın yüksekliğinin %29–52'sinde)
  const a = await at(p3, 0.5, 0.3);
  await penHover(page, a);
  await frames(page);
  await expect.poll(() => holeDistance(page, 3, a)).toBeLessThanOrEqual(20);
  const first = await focused(page);

  // Fare aşağıdaki satıra: başka cümle
  const b = await at(p3, 0.5, 0.465);
  await page.mouse.move(...b, { steps: 4 });
  await expect.poll(() => focused(page)).not.toBe(first);
  await frames(page);
  await expect.poll(() => holeDistance(page, 3, b)).toBeLessThanOrEqual(20);
  const second = await focused(page);
  expect(second).toBeGreaterThan(first);

  // ↓/↑ bir cümle ileri, geri
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => focused(page)).toBe(second + 1);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => focused(page)).toBe(second - 1);

  // Kalem sayfanın sağ kenarına dokunur: sayfa çevrilmez, menü açılıp kapanmaz; odak oraya gelir
  const index = await bookIndex(page);
  const shown = await page.getByTestId('reader-header').getAttribute('data-shown');
  const flip = page.getByTestId('flipbook');
  const edge = await at(flip, 0.93, 0.5);
  await tap(page, 'pen', edge);
  await page.waitForTimeout(700);
  expect(await bookIndex(page)).toBe(index);
  expect(await page.getByTestId('reader-header').getAttribute('data-shown')).toBe(shown);

  // Parmakla basılı tutup sürükleme odağı taşır: sayfa çevrilmez, menü açılmaz
  const c = await at(p3, 0.5, 0.3);
  const d = await at(p3, 0.5, 0.405);
  await pointer(page, 'pointerdown', 'touch', c, { pointerId: 51 });
  await longPressed(page);
  for (let k = 1; k <= 4; k++)
    await pointer(page, 'pointermove', 'touch', [c[0], c[1] + ((d[1] - c[1]) * k) / 4], {
      pointerId: 51,
    });
  await frames(page);
  await expect.poll(() => holeDistance(page, 3, d)).toBeLessThanOrEqual(20);
  const dragged = await focused(page);
  await pointer(page, 'pointerup', 'touch', d, { pointerId: 51 });
  await page.waitForTimeout(700);
  expect(await bookIndex(page)).toBe(index);
  expect(await page.getByTestId('reader-header').getAttribute('data-shown')).toBe(shown);
  expect(await focused(page)).toBe(dragged);

  // Parmakla dokunma sayfa çevirir; odak yeni sayfanın cümlesine geçer
  await tap(page, 'touch', edge);
  await expect.poll(() => bookIndex(page)).toBeGreaterThan(index);
  await expect(page.getByTestId('focus-bar')).toBeVisible();
  await expect.poll(() => focused(page)).toBeGreaterThan(dragged);
});

test('odak (cümle), metin görünümü: fare ve kalem cümleyi seçer (::highlight, soluk yazı); ↑/↓; kalem dokunuşu sayfa çevirmez; Esc kapatır', async ({
  page,
}) => {
  await sentenceUnit(page);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('view-set')) {
      sessionStorage.setItem('view-set', '1');
      localStorage.setItem('mypdfbook:reader', JSON.stringify({ view: 'text' }));
    }
  });
  await openNovel(page);
  await expect(page.locator('.book-page-content [data-block]').first()).toBeVisible();
  // Bir sayfa ilerlenir (kıvrılan sayfa bitene dek beklenir)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await turnNextPage(page);
  expect(await bookIndex(page)).toBeGreaterThan(0);
  await showMenu(page);
  await headerAction(page, 'focus-mode');
  await expect(page.getByTestId('focus-bar')).toBeVisible();
  await expect.poll(() => focused(page)).toBeGreaterThanOrEqual(0);
  await expect(page.locator('.sentence-focus .book-page-content').first()).toBeAttached();
  await expect.poll(() => page.evaluate(() => CSS.highlights.has('mypdfbook-active'))).toBe(true);
  // ::highlight seçilemeyen yazıda çizilmez (iki sayfalık kıvrılan kitap): vurgu açıkken yazı seçilebilir sayılır
  // (çubuk açılınca kitabın alanı değişir, kıvrılan kitap yeniden kurulur: sayfalar değişebilir, yoklanır)
  await expect(page.locator('.sentence-lit')).toHaveCount(1);
  const litPara = () => page.locator('.sentence-lit .book-page-content .b-para').first();
  await expect.poll(() => litPara().evaluate((el) => getComputedStyle(el).userSelect)).toBe('text');
  // seçimin kendisi engellenir
  await expect
    .poll(() =>
      litPara().evaluate(
        (el) => !el.dispatchEvent(new Event('selectstart', { bubbles: true, cancelable: true })),
      ),
    )
    .toBe(true);
  // Menü gizlenir (M): üst çubuk yazının üstünü örtmesin
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('m');
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'false');

  // Fare bir paragrafın üstünde: o cümle
  const paras = page.locator('.book-page-content .b-para').filter({ visible: true });
  await expect.poll(() => paras.count()).toBeGreaterThan(1);
  const para = paras.nth(1);
  await hoverText(page, para, 0.5, 0.5, (p) => page.mouse.move(...p, { steps: 3 }));
  const first = await focused(page);

  // Havadaki kalem başka paragrafta
  const other = paras.first();
  const b = await hoverText(page, other, 0.3, 0.1, (p) => penHover(page, p));
  const second = await focused(page);
  expect(second).not.toBe(first);

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => focused(page)).toBe(second + 1);
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => focused(page)).toBe(second);

  // Kalem sağ kenara dokunur: sayfa çevrilmez
  const index = await bookIndex(page);
  const edge = await at(page.getByTestId('flipbook'), 0.93, 0.5);
  await tap(page, 'pen', edge);
  await page.waitForTimeout(700);
  expect(await bookIndex(page)).toBe(index);

  // Parmakla basılı tutup sürükleme odağı taşır (parmak sürüklenirken kitap yeniden yerleşirse nokta yeniden
  // hesaplanır: basılı tutma sürdükçe her kayma odağı taşır)
  let c = await at(para, 0.5, 0.5);
  await pointer(page, 'pointerdown', 'touch', b, { pointerId: 52 });
  await longPressed(page);
  await expect
    .poll(async () => {
      c = await at(para, 0.5, 0.5);
      await pointer(page, 'pointermove', 'touch', c, { pointerId: 52 });
      await frames(page);
      return highlightDistance(page, c);
    })
    .toBeLessThanOrEqual(20);
  await pointer(page, 'pointerup', 'touch', c, { pointerId: 52 });
  await page.waitForTimeout(700);
  expect(await bookIndex(page)).toBe(index);

  // Parmakla dokunma sayfa çevirir (metin görünümünde kitap kısa: geriye, sol kenara dokunarak)
  await tap(page, 'touch', await at(page.getByTestId('flipbook'), 0.07, 0.5));
  await expect.poll(() => bookIndex(page)).toBeLessThan(index);

  // Esc kapatır: soluk yazı ve vurgu kalkar
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('focus-bar')).toHaveCount(0);
  await expect(page.locator('.sentence-focus')).toHaveCount(0);
  await expect(page.locator('.sentence-lit')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => CSS.highlights.has('mypdfbook-active'))).toBe(false);
});

test('odak ayarları kalıcı (birim, pencere boyu, karartma düzeyi, "açık kalsın"); ayar kapalıyken fare çıkınca karartma söner; hızlı okuma açılınca odak kapanır', async ({
  page,
}) => {
  await openNovel(page);
  await jumpTo(page, 3);
  await headerAction(page, 'focus-mode');
  await expect(page.getByTestId('focus-bar')).toBeVisible();
  // Varsayılan: kalemin iki yanında 5 kelime, orta karartma, açık kalsın; sayfa görünümünde bulanık yok
  await expect(page.getByTestId('focus-unit-word')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('focus-unit-sentence')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('focus-words-5')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('focus-dim-medium')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('focus-dim-blur')).toHaveCount(0);
  await expect(page.getByTestId('focus-keep')).toHaveAttribute('aria-pressed', 'true');
  const dim = pdfPageEl(page, 3).locator('.sentence-overlay .sentence-dim');
  await expect(dim).toHaveCount(1);
  const fill = () => dim.evaluate((el) => getComputedStyle(el).fill);
  await expect.poll(fill).toBe('rgba(0, 0, 0, 0.7)');

  await page.getByTestId('focus-dim-strong').click();
  await expect(page.getByTestId('focus-dim-strong')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(fill).toBe('rgba(0, 0, 0, 0.9)');
  await page.getByTestId('focus-dim-light').click();
  await expect.poll(fill).toBe('rgba(0, 0, 0, 0.4)');

  // "Açık kalsın" kapalı: fare kitaptan çıkınca karartma söner, odak kalkar
  await page.getByTestId('focus-keep').click();
  await expect(page.getByTestId('focus-keep')).toHaveAttribute('aria-pressed', 'false');
  const p3 = pdfPageEl(page, 3);
  await page.mouse.move(...(await at(p3, 0.5, 0.5)), { steps: 3 });
  await expect.poll(() => focused(page)).toBeGreaterThanOrEqual(0);
  const bar = await page.getByTestId('focus-close').boundingBox();
  await page.mouse.move(bar!.x + bar!.width / 2, bar!.y + bar!.height / 2, { steps: 3 });
  await expect.poll(() => focused(page)).toBe(-1);
  await expect(page.locator('[data-testid="sentence-dim"]')).toHaveCount(0);
  // Fare dönünce yine açılır
  await page.mouse.move(...(await at(p3, 0.5, 0.5)), { steps: 3 });
  await expect.poll(() => focused(page)).toBeGreaterThanOrEqual(0);

  // Dokunma hedefleri en az 44 px
  for (const button of await page.getByTestId('focus-bar').locator('button:visible').all()) {
    const box = (await button.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  }

  // Hızlı okuma açılınca odak kapanır; odak açılınca hızlı okuma kapanır
  await showMenu(page);
  await headerAction(page, 'speed-read');
  await expect(page.getByTestId('speed-bar')).toBeVisible();
  await expect(page.getByTestId('focus-bar')).toHaveCount(0);
  await showMenu(page);
  await headerAction(page, 'focus-mode');
  await expect(page.getByTestId('focus-bar')).toBeVisible();
  await expect(page.getByTestId('speed-bar')).toHaveCount(0);

  // Pencere boyu ve birim: cümlede pencere boyu gizlenir
  await page.getByTestId('focus-words-8').click();
  await expect(page.getByTestId('focus-words-8')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('focus-unit-sentence').click();
  await expect(page.getByTestId('focus-unit-sentence')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('focus-sizes')).toHaveCount(0);

  // Yeniden yüklenince ayarlar yerinde
  await page.reload();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await headerAction(page, 'focus-mode');
  await expect(page.getByTestId('focus-dim-light')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('focus-keep')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('focus-unit-sentence')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('focus-unit-word').click();
  await expect(page.getByTestId('focus-words-8')).toHaveAttribute('aria-pressed', 'true');

  // Kapat düğmesi klavyeyle: odak "Odak" düğmesine (dar ekranda ⋯) döner
  await page.getByTestId('focus-close').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('focus-bar')).toHaveCount(0);
  await expect(await headerActionTarget(page, 'focus-mode')).toBeFocused();
});

test('odak (kelime, varsayılan), sayfa görünümü: kalemin çevresinde 11 kelime açık; kalem ilerledikçe pencere kayar; ↑/↓ 5 kelime; pencere boyu', async ({
  page,
}) => {
  await penAlways(page, false);
  await openNovel(page);
  await jumpTo(page, 3);
  await headerAction(page, 'focus-mode');
  await expect(page.getByTestId('focus-bar')).toBeVisible();
  // Açılınca açık sayfanın ilk cümlesinin başında: bölüm başlığı (pencere başlıktan taşmaz: 4 kelime)
  await expect.poll(() => windowWords(page)).toBe(4);
  const p3 = pdfPageEl(page, 3);
  await expect(p3.locator('[data-testid="sentence-dim"]')).toHaveCount(1);
  await expect(p3.locator('.sentence-mark')).toHaveCount(0);

  // Havadaki kalem satırın solunda: pencere onun çevresinde (satır başına bir delik, en çok üç satır)
  const a = await at(p3, 0.3, 0.34);
  await penHover(page, a);
  await frames(page);
  await expect.poll(() => holeDistance(page, 3, a)).toBeLessThanOrEqual(12);
  expect(await windowWords(page)).toBe(11);
  const first = await holes(page, 3);
  expect(first.split(';').length).toBeLessThanOrEqual(3);

  // Kalem aynı satırda sağa ilerler: pencere de kayar
  const b = await at(p3, 0.75, 0.34);
  for (let k = 1; k <= 6; k++) await penHover(page, [a[0] + ((b[0] - a[0]) * k) / 6, a[1]]);
  await frames(page);
  await expect.poll(() => holes(page, 3)).not.toBe(first);
  await expect.poll(() => holeDistance(page, 3, b)).toBeLessThanOrEqual(12);
  expect(await windowWords(page)).toBe(11);

  // Fare aşağıdaki satırda: pencere orada, yukarıdaki kelimeler karanlıkta
  const c = await at(p3, 0.5, 0.465);
  await page.mouse.move(...c, { steps: 4 });
  await expect.poll(() => holeDistance(page, 3, c)).toBeLessThanOrEqual(12);
  expect(await holeDistance(page, 3, a)).toBeGreaterThan(12);

  // ↓ pencereyi 5 kelime ileri, ↑ geri taşır
  const here = await holes(page, 3);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => holes(page, 3)).not.toBe(here);
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => holes(page, 3)).toBe(here);

  // Pencere boyu: iki yanında 3 kelime, 12 kelime
  await page.getByTestId('focus-words-3').click();
  await expect.poll(() => windowWords(page)).toBe(7);
  await page.getByTestId('focus-words-12').click();
  await expect.poll(() => windowWords(page)).toBe(25);

  // Esc kapatır
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('focus-bar')).toHaveCount(0);
  await expect(page.locator('[data-testid="sentence-dim"]')).toHaveCount(0);
});

test('odak (kelime, varsayılan), metin görünümü: fare ve kalemin çevresinde 11 kelime açık (::highlight); pencere kalemle kayar; ↑/↓', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('view-set')) {
      sessionStorage.setItem('view-set', '1');
      localStorage.setItem('mypdfbook:reader', JSON.stringify({ view: 'text' }));
    }
  });
  await openNovel(page);
  await expect(page.locator('.book-page-content [data-block]').first()).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await turnNextPage(page);
  await showMenu(page);
  await headerAction(page, 'focus-mode');
  await expect(page.getByTestId('focus-bar')).toBeVisible();
  await expect.poll(() => windowWords(page)).toBeGreaterThan(0);
  await expect(page.locator('.sentence-focus .book-page-content').first()).toBeAttached();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('m');
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'false');

  // Fare bir paragrafın ortasında: çevresindeki 11 kelime açık
  const paras = page.locator('.book-page-content .b-para').filter({ visible: true });
  await expect.poll(() => paras.count()).toBeGreaterThan(1);
  await hoverText(page, paras.nth(1), 0.5, 0.5, (p) => page.mouse.move(...p, { steps: 3 }));
  await expect.poll(() => windowWords(page)).toBe(11);
  await expect.poll(async () => (await litText(page)).words).toBe(11);
  const first = (await litText(page)).text;

  // Havadaki kalem başka paragrafta: pencere onunla gelir
  await hoverText(page, paras.first(), 0.3, 0.1, (p) => penHover(page, p));
  await expect.poll(async () => (await litText(page)).text).not.toBe(first);
  const second = (await litText(page)).text;

  // ↓/↑ pencereyi 5 kelime kaydırır
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await litText(page)).text).not.toBe(second);
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await litText(page)).text).toBe(second);

  // Esc kapatır
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('focus-bar')).toHaveCount(0);
  await expect(page.locator('.sentence-focus')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => CSS.highlights.has('mypdfbook-active'))).toBe(false);
});
