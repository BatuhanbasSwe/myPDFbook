import { expect, test, type Locator, type Page } from '@playwright/test';
import { bookIndex, flipSettled, headerAction, importFixture, turnNextPage } from './helpers';

const NOVEL = ['novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf'] as const;

/** Kitabı varsayılan sayfa görünümünde (PDF sayfaları) açar */
async function openNovel(page: Page) {
  await page.goto('/');
  await importFixture(page, ...NOVEL);
  await page.getByTestId('book-open').click();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await expect(page.locator('[data-testid="flipbook"] [data-pdf-page="1"] img')).toBeVisible();
}

/** Menü gizliyse açar */
async function showHeader(page: Page) {
  if ((await page.getByTestId('reader-header').getAttribute('data-shown')) !== 'true')
    await page.keyboard.press('m');
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'true');
}

/** Menü gizliyse açar, "Kilitle" eylemine basar (telefonda ⋯ menüsünde) */
async function lockFromHeader(page: Page) {
  await showHeader(page);
  await headerAction(page, 'page-lock');
  await expectLocked(page, true);
}

async function expectLocked(page: Page, locked: boolean) {
  await expect(page.getByTestId('page-lock')).toHaveAttribute('aria-pressed', String(locked));
  await expect(page.getByTestId('lock-status')).toHaveText(
    locked ? 'Sayfa kilitlendi' : 'Kilit açıldı',
  );
  await expect(page.getByTestId('zoom-bar')).toHaveCount(locked ? 1 : 0);
}

/** Kitabın kutusuna yazılan yakınlaştırma (dönüşüm yoksa 1×) */
async function zoomOf(page: Page) {
  const t = await page.getByTestId('zoom-surface').evaluate((el) => el.style.transform);
  // WebKit "translate(0px)" diye kısaltabilir
  const tr = /translate\((-?[\d.e-]+)px(?:, (-?[\d.e-]+)px)?\)/.exec(t);
  const sc = /scale\(([\d.]+)\)/.exec(t);
  return {
    x: tr ? Number(tr[1]) : 0,
    y: tr?.[2] ? Number(tr[2]) : 0,
    scale: sc ? Number(sc[1]) : 1,
  };
}
const scaleOf = async (page: Page) => (await zoomOf(page)).scale;

/** Yakınlaştırmanın geçişi bitti (düğme ve çift dokunma kısa bir geçişle büyütür): ekrandaki kutular yerinde */
async function zoomSettled(page: Page) {
  await page
    .getByTestId('zoom-surface')
    .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

/** Kitap alanında (0–1) noktanın ekrandaki yeri */
async function bookPoint(page: Page, x: number, y: number) {
  const box = await page.getByTestId('flipbook').boundingBox();
  if (!box) throw new Error('kitap görünmüyor');
  return { x: box.x + box.width * x, y: box.y + box.height * y };
}

/** Okuma alanının ortası (ekranda) */
async function viewCenter(page: Page) {
  const box = await page.locator('[data-testid="zoom-surface"]').evaluate((el) => {
    const r = el.parentElement!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  return box;
}

/**
 * Noktada tekerlek olayı (Ctrl ile: dokunmatik yüzeyde kıstırma). Mobil WebKit'te Playwright'ın tekerleği yok:
 * olay noktadaki öğeye gönderilir.
 */
async function wheelAt(page: Page, p: { x: number; y: number }, deltaY: number, ctrlKey = false) {
  await page.evaluate(
    ({ p, deltaY, ctrlKey }) => {
      document.elementFromPoint(p.x, p.y)?.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY,
          ctrlKey,
          clientX: p.x,
          clientY: p.y,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    },
    { p, deltaY, ctrlKey },
  );
}

/** Öğenin okuma alanında görünen bölümünün ortası (ekranda) */
async function visibleCenter(page: Page, el: Locator) {
  const box = (await el.boundingBox())!;
  const view = await page.getByTestId('zoom-surface').evaluate((s) => {
    const r = s.parentElement!.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });
  const left = Math.max(box.x, view.left);
  const right = Math.min(box.x + box.width, view.right);
  const top = Math.max(box.y, view.top);
  const bottom = Math.min(box.y + box.height, view.bottom);
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}

/** Fareyle sürükler */
async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await page.mouse.up();
}

/**
 * İki parmakla kıstırma: öğede pointerType 'touch' olaylarıyla (Playwright'ın çoklu dokunması yok). Parmaklar
 * `center` çevresinde `from` uzaklığından `to` uzaklığına açılır.
 */
async function pinch(target: Locator, center: { x: number; y: number }, from: number, to: number) {
  await target.evaluate(
    (el, { c, from, to }) => {
      const send = (type: string, id: number, x: number, y: number) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: 'touch',
            isPrimary: id === 11,
            bubbles: true,
            cancelable: true,
            composed: true,
            button: type === 'pointermove' ? -1 : 0,
            buttons: type === 'pointerup' ? 0 : 1,
            clientX: x,
            clientY: y,
          }),
        );
      send('pointerdown', 11, c.x - from / 2, c.y);
      send('pointerdown', 12, c.x + from / 2, c.y);
      for (let k = 1; k <= 8; k++) {
        const d = from + ((to - from) * k) / 8;
        send('pointermove', 11, c.x - d / 2, c.y);
        send('pointermove', 12, c.x + d / 2, c.y);
      }
      send('pointerup', 11, c.x - to / 2, c.y);
      send('pointerup', 12, c.x + to / 2, c.y);
    },
    { c: center, from, to },
  );
}

/** Tek parmakla (pointerType 'touch') sürükleme */
async function fingerDrag(target: Locator, from: { x: number; y: number }, dx: number, dy: number) {
  await target.evaluate(
    (el, { from, dx, dy }) => {
      const send = (type: string, x: number, y: number) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 21,
            pointerType: 'touch',
            isPrimary: true,
            bubbles: true,
            cancelable: true,
            composed: true,
            button: type === 'pointermove' ? -1 : 0,
            buttons: type === 'pointerup' ? 0 : 1,
            clientX: x,
            clientY: y,
          }),
        );
      send('pointerdown', from.x, from.y);
      for (let k = 1; k <= 8; k++)
        send('pointermove', from.x + (dx * k) / 8, from.y + (dy * k) / 8);
      send('pointerup', from.x + dx, from.y + dy);
    },
    { from, dx, dy },
  );
}

test('kilitli sayfa çevrilmez: dokunma, kaydırma, ok tuşu, alt düğme ve kaydırıcı yerinde; kilidi açınca çevrilir', async ({
  page,
}) => {
  await openNovel(page);
  await flipSettled(page);
  const start = await bookIndex(page);
  await lockFromHeader(page);
  // Kilitleyince menü gizlenir (kitap açıkta)
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'false');

  // → tuşu ve alt düğme: "Sayfa kilitli" işareti görünür
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('lock-notice')).toBeVisible();
  await page.getByRole('button', { name: 'Sonraki sayfa' }).click();
  // Sola kaydırma (kıvrılan sayfada köşeden çekme de)
  await drag(page, await bookPoint(page, 0.9, 0.5), -300, 0);
  await drag(page, await bookPoint(page, 0.98, 0.95), -400, -60);
  // Sağ üçte bire dokunma: sayfa çevirmez, kilitliyken dokunma yalnızca menüyü açıp kapar
  const right = await bookPoint(page, 0.85, 0.5);
  await page.mouse.click(right.x, right.y);
  await expect(page.getByTestId('reader-header')).toHaveAttribute('data-shown', 'true');
  await page.waitForTimeout(800);
  await flipSettled(page);
  expect(await bookIndex(page)).toBe(start);
  await expect(page.getByTestId('lock-notice')).toHaveCount(0, { timeout: 5000 });

  // Kaydırıcı da yerinde kalır
  await page.getByTestId('page-slider').focus();
  await page.keyboard.press('End');
  await page.waitForTimeout(300);
  expect(await bookIndex(page)).toBe(start);
  await expect(page.getByTestId('page-slider')).toHaveValue(String(start));

  // Kilidi aç: sayfa yine çevrilir
  await page.getByTestId('zoom-unlock').click();
  await expectLocked(page, false);
  await page.locator('body').focus();
  await turnNextPage(page);
  expect(await bookIndex(page)).toBeGreaterThan(start);
});

test('L tuşu kilitler ve açar; kilitliyken +/−, çift dokunma, Ctrl + tekerlek yakınlaştırır; yakınken sürükleme kaydırır; kilidi açınca 1×', async ({
  page,
}) => {
  await openNovel(page);
  await flipSettled(page);
  const start = await bookIndex(page);
  await page.keyboard.press('l');
  await expectLocked(page, true);
  await expect(page.getByTestId('zoom-level')).toHaveText('%100');
  await expect(page.getByTestId('zoom-out')).toBeDisabled();

  // + / −
  await page.getByTestId('zoom-in').click();
  await expect(page.getByTestId('zoom-level')).toHaveText('%150');
  expect(await scaleOf(page)).toBe(1.5);
  await page.getByTestId('zoom-in').click();
  expect(await scaleOf(page)).toBe(2);
  await page.getByTestId('zoom-out').click();
  expect(await scaleOf(page)).toBe(1.5);
  await page.getByTestId('zoom-reset').click();
  expect(await scaleOf(page)).toBe(1);
  await expect(page.getByTestId('zoom-level')).toHaveText('%100');

  // Çift dokunma: dokunulan yer 2×'e büyür, yeniden çift dokunma 1×'e döndürür
  const c = await viewCenter(page);
  await page.mouse.dblclick(c.x + 40, c.y - 30);
  await expect.poll(() => scaleOf(page)).toBe(2);
  const z = await zoomOf(page);
  // Dokunulan yer yerinde kaldı: kaydırma −(odak) kadar (sınırda kısılmadıysa)
  expect(Math.abs(z.x)).toBeLessThanOrEqual(40.5);
  expect(Math.abs(z.y)).toBeLessThanOrEqual(30.5);

  // Yakınken sürükleme kaydırır
  const before = await zoomOf(page);
  await drag(page, c, -60, -50);
  const after = await zoomOf(page);
  expect(after.scale).toBe(2);
  expect(after.x !== before.x || after.y !== before.y).toBe(true);
  // Tekerlek de kaydırır
  await wheelAt(page, c, 120);
  await expect.poll(async () => (await zoomOf(page)).y).not.toBe(after.y);

  await page.mouse.dblclick(c.x, c.y);
  await expect.poll(() => scaleOf(page)).toBe(1);

  // Ctrl + tekerlek (dokunmatik yüzeyde kıstırma)
  await wheelAt(page, c, -150, true);
  await expect.poll(() => scaleOf(page)).toBeGreaterThan(1.5);

  // İki parmakla kıstırma
  await page.getByTestId('zoom-reset').click();
  await pinch(page.getByTestId('flipbook'), c, 80, 240);
  await expect.poll(() => scaleOf(page)).toBeGreaterThan(2.5);
  // Tek parmakla kaydırma
  const pinched = await zoomOf(page);
  await fingerDrag(page.getByTestId('flipbook'), c, 70, 60);
  const moved = await zoomOf(page);
  expect(moved.x !== pinched.x || moved.y !== pinched.y).toBe(true);

  // Klavyeyle: + yakınlaştırır, 0 sıfırlar
  await page.keyboard.press('0');
  expect(await scaleOf(page)).toBe(1);
  await page.keyboard.press('+');
  expect(await scaleOf(page)).toBe(1.5);

  // Hiçbiri sayfa çevirmedi
  expect(await bookIndex(page)).toBe(start);

  // L kilidi açar: 1×'e döner, sayfa yine çevrilir
  await page.keyboard.press('l');
  await expectLocked(page, false);
  expect(await scaleOf(page)).toBe(1);
  await turnNextPage(page);
  expect(await bookIndex(page)).toBeGreaterThan(start);
});

test('kilit açıkken yakınlaşmaz: kıstırma, çift dokunma ve Ctrl + tekerlek 1×’te bırakır; sayfa eskisi gibi çevrilir', async ({
  page,
}) => {
  await openNovel(page);
  await flipSettled(page);
  const c = await viewCenter(page);
  await pinch(page.getByTestId('flipbook'), c, 80, 260);
  await page.mouse.dblclick(c.x, c.y);
  await wheelAt(page, c, -200, true);
  await page.waitForTimeout(400);
  expect(await scaleOf(page)).toBe(1);
  await expect(page.getByTestId('zoom-bar')).toHaveCount(0);
  await flipSettled(page);
  // Sayfa çevirme eskisi gibi
  const before = await bookIndex(page);
  await page.locator('body').focus();
  await turnNextPage(page);
  expect(await bookIndex(page)).toBeGreaterThan(before);
});

test('kalem kipi + kilit + yakınlaştırma: çizgi sayfada doğru yere düşer; parmak çizmez, kaydırır', async ({
  page,
}) => {
  await openNovel(page);
  await showHeader(page);
  await headerAction(page, 'pen-mode');
  await expect(page.getByTestId('pen-toolbar')).toBeVisible();
  await page.keyboard.press('l');
  await expectLocked(page, true);
  await page.getByTestId('zoom-in').click();
  await page.getByTestId('zoom-in').click();
  expect(await scaleOf(page)).toBe(2);
  await zoomSettled(page);

  const layer = page.locator(
    '[data-testid="flipbook"] [data-pdf-page="1"] [data-testid="annotation-layer"]',
  );
  // Büyümüş sayfanın ekrandaki kutusu; sayfanın ekranda görünen bölümünün ortası (çift sayfada sağ sayfa)
  const box = (await layer.boundingBox())!;
  const c = await visibleCenter(page, layer);
  const fx = (c.x - box.x) / box.width;
  const fy = (c.y - box.y) / box.height;
  const at = (x: number, y: number) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
  const a = at(fx - 0.05, fy);
  const b = at(fx + 0.05, fy);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  const path = layer.locator('path[data-kind="highlight"]');
  await expect(path).toHaveCount(1);
  const d = (await path.getAttribute('d'))!;
  const m = /^M([\d.]+) ([\d.]+)/.exec(d)!;
  const yScale = box.height / box.width;
  // İlk nokta sayfada (0–1) sürüklemenin başladığı yer
  expect(Math.abs(Number(m[1]) - (fx - 0.05))).toBeLessThan(0.01);
  expect(Math.abs(Number(m[2]) / yScale - fy)).toBeLessThan(0.01);

  // Parmak çizmez, kaydırır
  const z = await zoomOf(page);
  await fingerDrag(layer, c, 50, 40);
  const z2 = await zoomOf(page);
  expect(z2.x !== z.x || z2.y !== z.y).toBe(true);
  await expect(layer.locator('path[d]:not([d=""])')).toHaveCount(1);

  // Kalem (Apple Pencil) yakınlaşmış sayfada çizer
  const box2 = (await layer.boundingBox())!;
  const c2 = await visibleCenter(page, layer);
  const fx2 = (c2.x - box2.x) / box2.width;
  const fy2 = (c2.y - box2.y) / box2.height;
  await layer.evaluate(
    (el, { pts }) => {
      const r = el.getBoundingClientRect();
      const send = (type: string, [x, y]: number[]) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 71,
            pointerType: 'pen',
            isPrimary: true,
            bubbles: true,
            cancelable: true,
            composed: true,
            button: type === 'pointermove' ? -1 : 0,
            buttons: type === 'pointerup' ? 0 : 1,
            clientX: r.left + r.width * x,
            clientY: r.top + r.height * y,
          }),
        );
      send('pointerdown', pts[0]);
      send('pointermove', pts[1]);
      send('pointerup', pts[1]);
    },
    {
      pts: [
        [fx2, fy2 + 0.03],
        [fx2 + 0.04, fy2 + 0.03],
      ],
    },
  );
  await expect(path).toHaveCount(2);
  const d2 = (await path.nth(1).getAttribute('d'))!;
  const m2 = /^M([\d.]+) ([\d.]+)/.exec(d2)!;
  expect(Math.abs(Number(m2[1]) - fx2)).toBeLessThan(0.01);
  expect(Math.abs(Number(m2[2]) / yScale - (fy2 + 0.03))).toBeLessThan(0.01);
});

test('sayfa görünümünde yakınlaştırınca sayfa keskin yeniden çizilir; kilidi açınca bırakılır', async ({
  page,
}) => {
  await openNovel(page);
  const base = page.locator('[data-testid="flipbook"] [data-pdf-page="1"] img:not([data-sharp])');
  const sharp = page.locator('[data-testid="flipbook"] [data-pdf-page="1"] img[data-sharp]');
  await page.keyboard.press('l');
  await expectLocked(page, true);
  await page.getByTestId('zoom-in').click();
  await page.getByTestId('zoom-in').click();
  await page.getByTestId('zoom-in').click();
  expect(await scaleOf(page)).toBe(2.5);
  await expect(sharp).toHaveCount(1);
  await expect
    .poll(() => sharp.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);
  const baseWidth = await base.evaluate((img: HTMLImageElement) => img.naturalWidth);
  const sharpWidth = await sharp.evaluate((img: HTMLImageElement) => img.naturalWidth);
  expect(sharpWidth).toBeGreaterThan(baseWidth * 1.5);

  await page.getByTestId('zoom-unlock').click();
  await expectLocked(page, false);
  await expect(sharp).toHaveCount(0);
});

test('metin görünümünde de yakınlaşır; yeniden sayfalanmaz. Aramadan sonuca gitmek kilidi açar', async ({
  page,
}) => {
  await openNovel(page);
  await showHeader(page);
  await headerAction(page, 'view-toggle');
  await expect(
    page.locator('[data-testid="flipbook"][data-ready] .book-page').first(),
  ).toBeVisible();
  const count = await page.getByTestId('flipbook').getAttribute('data-count');
  await page.keyboard.press('l');
  await expectLocked(page, true);
  await page.getByTestId('zoom-in').click();
  await page.getByTestId('zoom-in').click();
  expect(await scaleOf(page)).toBe(2);
  await page.waitForTimeout(400);
  await expect(page.getByTestId('flipbook')).toHaveAttribute('data-count', count!);

  // Arama sonucuna gitmek önce kilidi açar
  await showHeader(page);
  await headerAction(page, 'reader-search');
  await page.getByTestId('search-input').fill('KİTAPÇININ sahibi');
  await page.getByTestId('search-result').first().click();
  await expectLocked(page, false);
  expect(await scaleOf(page)).toBe(1);
});
