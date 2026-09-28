import { expect, test, type Locator, type Page } from '@playwright/test';
import { headerAction, headerActionTarget, importFixture } from './helpers';

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
  const box = (await l.boundingBox())!;
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

/** Havadaki kalem noktanın üstünde */
const penHover = (page: Page, p: [number, number]) =>
  pointer(page, 'pointermove', 'pen', p, { buttons: 0 });

/** Kalem ya da parmakla dokunma (basıp hemen bırakma) */
async function tap(page: Page, pointerType: 'pen' | 'touch', p: [number, number], pointerId = 41) {
  await pointer(page, 'pointerdown', pointerType, p, { pointerId });
  await pointer(page, 'pointerup', pointerType, p, { pointerId });
}

/**
 * Sayfa görünümünde noktanın odaktaki cümlenin açık kalan yerine (maskedeki deliklere) ekranda uzaklığı (px);
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
      for (const hole of svg.querySelectorAll('mask rect[fill="black"]')) {
        const n = (a: string) => Number(hole.getAttribute(a));
        const x0 = left + n('x') * scale;
        const y0 = top + n('y') * scale;
        const x1 = x0 + n('width') * scale;
        const y1 = y0 + n('height') * scale;
        best = Math.min(best, Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1)));
      }
      return best;
    },
    { pdfPage, x, y },
  );
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

/** Kalemin ayarı: "Kalemle her zaman çiz" (varsayılan açık) */
async function penAlways(page: Page, on: boolean) {
  await page.addInitScript((on) => {
    localStorage.setItem('mypdfbook:pen', JSON.stringify({ penAlways: on }));
  }, on);
}

test('odak, sayfa görünümü: havadaki kalem ve fare cümleyi seçer (maske, doğru cümle); ↑/↓ cümle cümle; kalem dokunuşu sayfa çevirmez, parmak çevirir; parmakla basılı tutup sürükleme odağı taşır', async ({
  page,
}) => {
  await penAlways(page, false);
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
  await page.waitForTimeout(600);
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

test('odak, metin görünümü: fare ve kalem cümleyi seçer (::highlight, soluk yazı); ↑/↓; kalem dokunuşu sayfa çevirmez; Esc kapatır', async ({
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
  // Bir sayfa ilerlenir (kıvrılan sayfa bitene dek beklenir)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => bookIndex(page)).toBeGreaterThan(0);
  await page.waitForTimeout(800);
  await showMenu(page);
  await headerAction(page, 'focus-mode');
  await expect(page.getByTestId('focus-bar')).toBeVisible();
  await expect.poll(() => focused(page)).toBeGreaterThanOrEqual(0);
  await expect(page.locator('.sentence-focus .book-page-content').first()).toBeAttached();
  await expect.poll(() => page.evaluate(() => CSS.highlights.has('mypdfbook-active'))).toBe(true);
  // ::highlight seçilemeyen yazıda çizilmez (iki sayfalık kıvrılan kitap): vurgu açıkken yazı seçilebilir sayılır
  await expect(page.locator('.sentence-lit')).toHaveCount(1);
  expect(
    await page
      .locator('.sentence-lit .book-page-content .b-para')
      .first()
      .evaluate((el) => getComputedStyle(el).userSelect),
  ).toBe('text');
  // seçimin kendisi engellenir
  expect(
    await page
      .locator('.sentence-lit .book-page-content .b-para')
      .first()
      .evaluate(
        (el) => !el.dispatchEvent(new Event('selectstart', { bubbles: true, cancelable: true })),
      ),
  ).toBe(true);
  // Menü gizlenir (M): üst çubuk yazının üstünü örtmesin
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('m');
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'false');

  // Fare bir paragrafın üstünde: o cümle
  const paras = page.locator('.book-page-content .b-para').filter({ visible: true });
  await expect.poll(() => paras.count()).toBeGreaterThan(1);
  const para = paras.nth(1);
  const a = await at(para, 0.5, 0.5);
  await page.mouse.move(...a, { steps: 3 });
  await frames(page);
  await expect.poll(() => highlightDistance(page, a)).toBeLessThanOrEqual(20);
  const first = await focused(page);

  // Havadaki kalem başka paragrafta
  const other = paras.first();
  const b = await at(other, 0.3, 0.1);
  await penHover(page, b);
  await frames(page);
  await expect.poll(() => highlightDistance(page, b)).toBeLessThanOrEqual(20);
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

  // Parmakla basılı tutup sürükleme odağı taşır
  const c = await at(para, 0.5, 0.5);
  await pointer(page, 'pointerdown', 'touch', b, { pointerId: 52 });
  await page.waitForTimeout(600);
  await pointer(page, 'pointermove', 'touch', c, { pointerId: 52 });
  await expect.poll(() => highlightDistance(page, c)).toBeLessThanOrEqual(20);
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

test('odak ayarları kalıcı (karartma düzeyi, "açık kalsın"); ayar kapalıyken fare çıkınca karartma söner; hızlı okuma açılınca odak kapanır', async ({
  page,
}) => {
  await openNovel(page);
  await jumpTo(page, 3);
  await headerAction(page, 'focus-mode');
  await expect(page.getByTestId('focus-bar')).toBeVisible();
  // Varsayılan: orta karartma, açık kalsın; sayfa görünümünde bulanık yok
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

  // Yeniden yüklenince ayarlar yerinde
  await page.reload();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await headerAction(page, 'focus-mode');
  await expect(page.getByTestId('focus-dim-light')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('focus-keep')).toHaveAttribute('aria-pressed', 'false');

  // Kapat düğmesi klavyeyle: odak "Odak" düğmesine (dar ekranda ⋯) döner
  await page.getByTestId('focus-close').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('focus-bar')).toHaveCount(0);
  await expect(await headerActionTarget(page, 'focus-mode')).toBeFocused();
});
