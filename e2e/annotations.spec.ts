import { expect, test, type Locator, type Page } from '@playwright/test';
import { headerAction, headerActionTarget, importFixture } from './helpers';

const NOVEL = ['novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf'] as const;

/** Kitabı varsayılan sayfa görünümünde (PDF sayfaları) açar */
async function openNovel(page: Page) {
  await page.goto('/');
  await importFixture(page, ...NOVEL);
  await page.getByTestId('book-open').click();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await expect(page.locator('[data-testid="flipbook"] [data-pdf-page="1"] img')).toBeVisible();
}

const bookIndex = async (page: Page) =>
  Number(await page.getByTestId('flipbook').getAttribute('data-index'));

/** PDF sayfasının işaret katmanı (1'den) */
const layer = (page: Page, pdfPage: number) =>
  page.locator(
    `[data-testid="flipbook"] [data-pdf-page="${pdfPage}"] [data-testid="annotation-layer"]`,
  );

/** Kaydedilmiş işaretler (bekleyen çizginin data-kind'ı yok) */
const marks = (l: Locator, kind: 'highlight' | 'ink') => l.locator(`path[data-kind="${kind}"]`);

/** Menü gizliyse açar, Kalem düğmesine basar: araç çubuğu çıkar */
async function enablePen(page: Page) {
  if ((await page.getByTestId('reader-header').getAttribute('data-shown')) !== 'true')
    await page.keyboard.press('m');
  await headerAction(page, 'pen-mode');
  await expect(page.getByTestId('pen-toolbar')).toBeVisible();
  await expect(page.getByTestId('pen-mode')).toHaveAttribute('aria-pressed', 'true');
}

/**
 * ← ile `index` yuvasına döner. Kıvrılan sayfa çevrilirken (650 ms) basılan tuş yok sayılabilir: dönene dek yeniden
 * basılır (ilk sayfadan geriye gidilmez: `index` ilk yuvadır)
 */
async function turnBackTo(page: Page, index: number) {
  await expect(async () => {
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => bookIndex(page), { timeout: 1500 }).toBe(index);
  }).toPass();
}

/** Katmanın üstünde fareyle (sayfaya göre 0–1) noktalardan geçerek çizer */
async function drawOn(page: Page, l: Locator, points: [number, number][]) {
  const box = await l.boundingBox();
  if (!box) throw new Error('sayfa görünmüyor');
  const at = ([x, y]: [number, number]) => [box.x + box.width * x, box.y + box.height * y] as const;
  await page.mouse.move(...at(points[0]));
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(...at(p), { steps: 8 });
  await page.mouse.up();
}

/** Katmana (sayfaya göre 0–1) tıklar */
async function clickOn(page: Page, l: Locator, x: number, y: number) {
  const box = await l.boundingBox();
  if (!box) throw new Error('sayfa görünmüyor');
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
}

/** Kitap alanında x oranında (0 sol … 1 sağ) dokunur */
async function tapAt(page: Page, x: number) {
  const box = await page.getByTestId('flipbook').boundingBox();
  if (!box) throw new Error('kitap görünmüyor');
  await page.mouse.click(box.x + box.width * x, box.y + box.height * 0.5);
}

interface PointerOptions {
  pointerType?: 'pen' | 'touch';
  pointerId?: number;
  /** gönderilecek olaylar (varsayılan: bas, sürükle, bırak) */
  phases?: ('down' | 'move' | 'up')[];
}

/**
 * Apple Pencil (ya da parmak): pointerType 'pen' / 'touch' olaylarıyla katmanda çizer (Playwright'ın kalem girdisi
 * yok). `phases` ile çizginin yalnızca bir bölümü gönderilir (süren çizim).
 */
async function penStroke(l: Locator, points: [number, number][], options: PointerOptions = {}) {
  const { pointerType = 'pen', pointerId = 71, phases = ['down', 'move', 'up'] } = options;
  await l.evaluate(
    (el, { pts, pointerType, pointerId, phases }) => {
      const r = el.getBoundingClientRect();
      const send = (type: string, [x, y]: [number, number]) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId,
            pointerType,
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
      if (phases.includes('down')) send('pointerdown', pts[0]);
      if (phases.includes('move')) for (const p of pts.slice(1)) send('pointermove', p);
      if (phases.includes('up')) send('pointerup', pts[pts.length - 1]);
    },
    { pts: points, pointerType, pointerId, phases },
  );
}

/** Katmandaki bütün çizgiler: kaydedilmiş, kaydı okunmayı bekleyen ve süren (boş canlı çizgi sayılmaz) */
const allStrokes = (l: Locator) => l.locator('path[d]:not([d=""])');

/** Kaydedilen okuma yeri (PDF sayfası, 0'dan); kayıt yoksa null */
const savedPdfPage = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number | null>((resolve, reject) => {
        const req = indexedDB.open('mypdfbook');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const idb = req.result;
          const all = idb.transaction('progress').objectStore('progress').getAll();
          all.onsuccess = () => {
            idb.close();
            resolve(all.result[0]?.pdfPage ?? null);
          };
          all.onerror = () => {
            idb.close();
            reject(all.error);
          };
        };
      }),
  );

test('kalem kipinde fosforlu kalemle çizilen çizgi sayfada kalır: sayfa çevrilmez, çevirip dönünce ve yenileyince yerinde; silgiyle silinir, geri alınır', async ({
  page,
}) => {
  await openNovel(page);
  await enablePen(page);
  await expect(page.getByTestId('pen-tool-highlight')).toHaveAttribute('aria-pressed', 'true');
  const start = await bookIndex(page);

  const l = layer(page, 1);
  await drawOn(page, l, [
    [0.2, 0.3],
    [0.5, 0.31],
    [0.8, 0.3],
  ]);
  await expect(marks(l, 'highlight')).toHaveCount(1);
  const d = await marks(l, 'highlight').getAttribute('d');
  expect(d).toMatch(/^M0\.\d+ /);
  // Varsayılan renk sarı; çizim sayfa çevirmedi
  await expect(marks(l, 'highlight')).toHaveAttribute('stroke', '#ffd400');
  expect(await bookIndex(page)).toBe(start);

  // Kalem kipinde de sayfa ok tuşlarıyla çevrilir; dönünce çizgi yerinde
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => bookIndex(page)).toBeGreaterThan(start);
  await turnBackTo(page, start);
  await expect(marks(layer(page, 1), 'highlight')).toHaveAttribute('d', d!);

  // İlerleme 400 ms sonra kaydedilir: yenileyince aynı sayfa açılsın
  await expect.poll(() => savedPdfPage(page)).toBe(0);
  await page.reload();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await expect(marks(layer(page, 1), 'highlight')).toHaveAttribute('d', d!);
  // Yenileyince kip kapalı açılır
  await expect(page.getByTestId('pen-toolbar')).toHaveCount(0);

  await enablePen(page);
  await page.getByTestId('pen-tool-eraser').click();
  await drawOn(page, layer(page, 1), [
    [0.5, 0.15],
    [0.5, 0.45],
  ]);
  await expect(marks(layer(page, 1), 'highlight')).toHaveCount(0);
  await page.getByTestId('pen-undo').click();
  await expect(marks(layer(page, 1), 'highlight')).toHaveAttribute('d', d!);

  await page.getByTestId('pen-done').click();
  await expect(page.getByTestId('pen-toolbar')).toHaveCount(0);
});

test('not eklenir, düzenlenir, silinir; iğneye dokunmak sayfa çevirmez', async ({ page }) => {
  await openNovel(page);
  await enablePen(page);
  await page.getByTestId('pen-tool-note').click();
  const start = await bookIndex(page);
  const l = layer(page, 1);

  // Sağ kenara yakın: iğneye dokunma sayfaya geçseydi sayfa çevrilirdi
  await clickOn(page, l, 0.85, 0.5);
  const editor = page.getByTestId('note-editor');
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('note-save')).toBeDisabled();
  await page.getByTestId('note-text').fill('İlk not');
  await page.getByTestId('note-save').click();
  await expect(editor).toHaveCount(0);
  const pin = l.getByTestId('note-pin');
  await expect(pin).toHaveCount(1);
  await expect(pin).toHaveAttribute('aria-label', 'Not: İlk not');
  // Yeni notun düzenleyicisi kapanınca odak kalem araç çubuğundaki Not'a döner
  await expect(page.getByTestId('pen-tool-note')).toBeFocused();

  // Kip kapalıyken de iğneye dokununca not açılır; kaydedince odak iğneye döner
  await page.getByTestId('pen-done').click();
  await pin.click();
  await expect(page.getByTestId('note-text')).toHaveValue('İlk not');
  await page.getByTestId('note-text').fill('Değişen not');
  await page.getByTestId('note-save').click();
  await expect(pin).toHaveAttribute('aria-label', 'Not: Değişen not');
  await expect(pin).toBeFocused();
  expect(await bookIndex(page)).toBe(start);

  // Esc düzenleyiciyi kapatır, değişiklik kaydedilmez; odak iğneye döner
  await pin.click();
  await page.getByTestId('note-text').fill('Kaydedilmeyen');
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(pin).toBeFocused();
  await expect(pin).toHaveAttribute('aria-label', 'Not: Değişen not');

  await pin.click();
  await page.getByTestId('note-delete').click();
  await expect(pin).toHaveCount(0);
  expect(await bookIndex(page)).toBe(start);
});

for (const effect of ['curl', 'slide', 'none'] as const) {
  test(`kalem kipinde dokunma ve kaydırma sayfa çevirmez, çizer (${effect}); ok tuşu yine çevirir`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript(
      (e) => localStorage.setItem('mypdfbook:reader', JSON.stringify({ effect: e })),
      effect,
    );
    await openNovel(page);
    await enablePen(page);
    await page.getByTestId('pen-tool-ink').click();
    await page.getByRole('button', { name: 'Kırmızı' }).click();
    const start = await bookIndex(page);

    await tapAt(page, 0.95);
    await tapAt(page, 0.05);
    const box = (await page.getByTestId('flipbook').boundingBox())!;
    // Dokunmatik ekranda parmakla dokunma da
    if (testInfo.project.use.hasTouch) {
      await page.touchscreen.tap(box.x + box.width * 0.95, box.y + box.height * 0.4);
      await page.touchscreen.tap(box.x + box.width * 0.05, box.y + box.height * 0.4);
    }
    // Sağdan sola kaydırma ve kıvrılan sayfada köşeden çekme
    for (const y of [0.5, 0.97]) {
      await page.mouse.move(box.x + box.width * 0.97, box.y + box.height * y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * y, { steps: 8 });
      await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * y, { steps: 8 });
      await page.mouse.up();
    }
    // Sayfanın çevrilmediği ancak beklenerek görülür (kıvrılma 650 ms sürer): burada yoklama olmaz
    await page.waitForTimeout(900);
    expect(await bookIndex(page)).toBe(start);
    const ink = marks(layer(page, 1), 'ink');
    await expect.poll(() => ink.count()).toBeGreaterThanOrEqual(2);
    await expect(ink.first()).toHaveAttribute('stroke', '#d32f2f');

    await page.keyboard.press('ArrowRight');
    await expect.poll(() => bookIndex(page)).toBeGreaterThan(start);
  });
}

test('kalemle her zaman çiz: kip kapalıyken kalem çizer, sayfa çevirmez; parmak çevirir; ayar kapalıyken kalem çizmez', async ({
  page,
}) => {
  await openNovel(page);
  const start = await bookIndex(page);
  const l = layer(page, 1);
  await penStroke(l, [
    [0.2, 0.6],
    [0.5, 0.6],
    [0.8, 0.6],
  ]);
  await expect(marks(l, 'highlight')).toHaveCount(1);
  expect(await bookIndex(page)).toBe(start);
  await expect(page.getByTestId('pen-toolbar')).toHaveCount(0);

  // Ayar kapatılınca kalem de parmak gibidir
  if ((await page.getByTestId('reader-header').getAttribute('data-shown')) !== 'true')
    await page.keyboard.press('m');
  await page.getByTestId('reader-settings').click();
  await page.getByTestId('pref-pen-always').uncheck();
  await page.keyboard.press('Escape');
  await penStroke(l, [
    [0.2, 0.7],
    [0.8, 0.7],
  ]);
  // Çizilseydi bırakır bırakmaz (bekleyen çizgi olarak) görünürdü: beklemeden sayılır
  await expect(allStrokes(l)).toHaveCount(1);
  await expect(marks(l, 'highlight')).toHaveCount(1);

  // Fare (parmak) kip kapalıyken sayfa çevirir
  await page.keyboard.press('Escape'); // menüyü gizle
  await tapAt(page, 0.95);
  await expect.poll(() => bookIndex(page)).toBeGreaterThan(start);
});

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
  await expect(layer(page, pdfPage)).toBeVisible();
}

/** Üst çubuktaki Notlar düğmesiyle paneli açar */
async function openNotes(page: Page) {
  await showMenu(page);
  await headerAction(page, 'reader-notes');
  await expect(page.getByTestId('reader-panel')).toBeVisible();
}

test('Notlar paneli: boyama ve not sayfa sırasıyla listelenir; nota dokununca sayfası açılır; not panelde düzenlenir ve silinir', async ({
  page,
}) => {
  await openNovel(page);

  // Boş panel; Esc kapatır, odak Notlar düğmesine (dar ekranda ⋯ düğmesine) döner
  await openNotes(page);
  await expect(page.getByTestId('notes-empty')).toContainText('Henüz not yok');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('reader-panel')).toHaveCount(0);
  await expect(await headerActionTarget(page, 'reader-notes')).toBeFocused();

  // 5. sayfaya not, 1. sayfaya fosforlu kalem
  await jumpTo(page, 5);
  await enablePen(page);
  await page.getByTestId('pen-tool-note').click();
  await clickOn(page, layer(page, 5), 0.5, 0.5);
  await page.getByTestId('note-text').fill('Beşinci sayfadaki not');
  await page.getByTestId('note-save').click();
  await expect(layer(page, 5).getByTestId('note-pin')).toHaveCount(1);
  await page.getByTestId('pen-done').click();

  await jumpTo(page, 1);
  await enablePen(page);
  await page.getByTestId('pen-tool-highlight').click();
  await drawOn(page, layer(page, 1), [
    [0.2, 0.3],
    [0.8, 0.3],
  ]);
  await expect(marks(layer(page, 1), 'highlight')).toHaveCount(1);
  await page.getByTestId('pen-done').click();
  const start = await bookIndex(page);

  // Sayfa sırasıyla: önce 1. sayfadaki boyama, sonra 5. sayfadaki not
  await openNotes(page);
  const items = page.getByTestId('notes-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveAttribute('data-kind', 'highlight');
  await expect(items.nth(0)).toHaveAttribute('data-page', '1');
  await expect(items.nth(0)).toContainText('Fosforlu kalem · sarı');
  await expect(items.nth(1)).toHaveAttribute('data-kind', 'note');
  await expect(items.nth(1)).toHaveAttribute('data-page', '5');
  await expect(items.nth(1)).toContainText('Beşinci sayfadaki not');
  // Açık sayfanın işareti seçili ve odakta
  await expect(items.nth(0).getByTestId('notes-go')).toHaveAttribute('aria-current', 'true');
  await expect(items.nth(0).getByTestId('notes-go')).toBeFocused();

  // Nota dokununca 5. sayfa açılır, panel kapanır
  await items.nth(1).getByTestId('notes-go').click();
  await expect(page.getByTestId('reader-panel')).toHaveCount(0);
  await expect.poll(() => bookIndex(page)).toBeGreaterThan(start);
  const pin = layer(page, 5).getByTestId('note-pin');
  await expect(pin).toBeVisible();

  // Panelde düzenle: Esc yalnızca düzenleyiciyi kapatır, kaydetmez
  await openNotes(page);
  const note = page.locator('[data-testid="notes-item"][data-kind="note"]');
  await note.getByTestId('notes-edit').click();
  await expect(page.getByTestId('note-text')).toHaveValue('Beşinci sayfadaki not');
  await page.getByTestId('note-text').fill('Kaydedilmeyen');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('note-text')).toHaveCount(0);
  await expect(page.getByTestId('reader-panel')).toBeVisible();
  await expect(note.getByTestId('notes-edit')).toBeFocused();
  await expect(note).toContainText('Beşinci sayfadaki not');

  await note.getByTestId('notes-edit').click();
  await page.getByTestId('note-text').fill('Değişen not');
  await page.getByTestId('note-save').click();
  await expect(note).toContainText('Değişen not');
  await expect(pin).toHaveAttribute('aria-label', 'Not: Değişen not');

  // Panelde sil: not sayfadan da kalkar, boyama kalır
  await note.getByTestId('notes-delete').click();
  await expect(items).toHaveCount(1);
  await expect(pin).toHaveCount(0);
  await expect(items.nth(0)).toHaveAttribute('data-kind', 'highlight');

  // Yenileyince de silinmiş; boyama da silinince panel boş (ilerleme kaydedilince yenilenir: 5. sayfa açılır)
  await expect.poll(async () => (await savedPdfPage(page)) ?? -1).toBeGreaterThanOrEqual(3);
  await page.reload();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  await openNotes(page);
  await expect(items).toHaveCount(1);
  await items.nth(0).getByTestId('notes-delete').click();
  await expect(page.getByTestId('notes-empty')).toContainText('Henüz not yok');
  await expect(marks(layer(page, 1), 'highlight')).toHaveCount(0);
});

test('metin görünümünde Notlar: işarete dokununca sayfa görünümüne geçilir, o sayfa açılır', async ({
  page,
}) => {
  await openNovel(page);
  await jumpTo(page, 5);
  await enablePen(page);
  await drawOn(page, layer(page, 5), [
    [0.2, 0.4],
    [0.8, 0.4],
  ]);
  await expect(marks(layer(page, 5), 'highlight')).toHaveCount(1);
  await page.getByTestId('pen-done').click();
  await jumpTo(page, 1);

  await showMenu(page);
  await headerAction(page, 'view-toggle');
  await expect(page.getByTestId('view-toggle')).toContainText('Sayfa');
  await expect(page.locator('[data-testid="flipbook"] [data-pdf-page]')).toHaveCount(0);

  await openNotes(page);
  await expect(page.getByTestId('reader-panel')).toContainText('sayfa görünümünde o sayfa açılır');
  await page.getByTestId('notes-go').click();
  await expect(page.getByTestId('reader-panel')).toHaveCount(0);
  await expect(page.getByTestId('view-toggle')).toContainText('Metin');
  await expect(marks(layer(page, 5), 'highlight')).toHaveCount(1);
  await expect(layer(page, 5)).toBeVisible();
});

test('geri alınan ve silgiyle silinen çizgi sayfada hayalet olarak kalmaz (yenilemeden); art arda basılan geri al her seferinde bir adım alır', async ({
  page,
}) => {
  await openNovel(page);
  await enablePen(page);
  const l = layer(page, 1);
  const undo = page.getByTestId('pen-undo');

  // Kaydı okunan çizgi geri alınınca hiçbir çizgi kalmaz (bekleyen kopya da)
  await drawOn(page, l, [
    [0.2, 0.3],
    [0.8, 0.3],
  ]);
  await expect(marks(l, 'highlight')).toHaveCount(1);
  await undo.click();
  await expect(allStrokes(l)).toHaveCount(0);

  // Çizip kaydı okunmadan hemen geri almak da (kalem bırakılır bırakılmaz, aynı görevde)
  await penStroke(l, [
    [0.2, 0.4],
    [0.8, 0.4],
  ]);
  await undo.evaluate(async (b: HTMLButtonElement) => {
    await new Promise((r) => setTimeout(r)); // düğme etkinleşsin (React çizsin)
    b.click();
  });
  await expect(allStrokes(l)).toHaveCount(0);
  await expect(undo).toBeDisabled();

  // Çizip hemen silgiyle silmek de
  await drawOn(page, l, [
    [0.2, 0.5],
    [0.8, 0.5],
  ]);
  await expect(marks(l, 'highlight')).toHaveCount(1);
  await page.getByTestId('pen-tool-eraser').click();
  await drawOn(page, l, [
    [0.5, 0.45],
    [0.5, 0.55],
  ]);
  await expect(allStrokes(l)).toHaveCount(0);
  // Silme geri alınır; çizginin kopyası da çıkmaz (tek çizgi)
  await undo.click();
  await expect(marks(l, 'highlight')).toHaveCount(1);
  await expect(allStrokes(l)).toHaveCount(1);

  // İki çizgi daha; iki kez art arda (arada çizim olmadan) basılan geri al ikisini de alır
  await page.getByTestId('pen-tool-ink').click();
  for (const y of [0.6, 0.7])
    await drawOn(page, l, [
      [0.2, y],
      [0.8, y],
    ]);
  await expect(marks(l, 'ink')).toHaveCount(2);
  await undo.evaluate((b: HTMLButtonElement) => {
    b.click();
    b.click();
  });
  await expect(allStrokes(l)).toHaveCount(1);
  await expect(marks(l, 'ink')).toHaveCount(0);
  await expect(marks(l, 'highlight')).toHaveCount(1);
});

test('kalem kipinde sayfa alttaki düğmelerle çevrilir (klavyesiz iPad); kip kapanınca düğmeler (ayar kapalıyken) gider', async ({
  page,
}, testInfo) => {
  await openNovel(page);
  const next = page.getByRole('button', { name: 'Sonraki sayfa' });
  const prev = page.getByRole('button', { name: 'Önceki sayfa' });
  // Varsayılan: alt düğmeler kapalı
  await expect(next).toHaveCount(0);
  await enablePen(page);
  await expect(next).toBeVisible();
  await expect(prev).toBeVisible();
  const press = (b: Locator) => (testInfo.project.use.hasTouch ? b.tap() : b.click());

  const start = await bookIndex(page);
  await press(next);
  await expect.poll(() => bookIndex(page)).toBeGreaterThan(start);
  // Kip sürer: çizim yine çizer
  await expect(page.getByTestId('pen-toolbar')).toBeVisible();
  await expect(async () => {
    await press(prev);
    await expect.poll(() => bookIndex(page), { timeout: 1500 }).toBe(start);
  }).toPass();

  await page.getByTestId('pen-done').click();
  await expect(next).toHaveCount(0);
});

test('avuç reddi: kalem parmağın süren çizimini devralır; kalemden sonra parmak çizmez, sayfa da çevirmez', async ({
  page,
}) => {
  await openNovel(page);
  await enablePen(page);
  const l = layer(page, 1);
  const start = await bookIndex(page);

  // Kalem görülmeden parmak çizer
  await penStroke(
    l,
    [
      [0.2, 0.2],
      [0.8, 0.2],
    ],
    { pointerType: 'touch', pointerId: 5 },
  );
  await expect(marks(l, 'highlight')).toHaveCount(1);

  // Avuç (parmak) çizmeye başlamışken kalem gelir: avucun çizgisi bırakılır, kalemin çizgisi kalır
  const palm: [number, number][] = [
    [0.3, 0.8],
    [0.6, 0.85],
  ];
  await penStroke(l, palm, { pointerType: 'touch', pointerId: 6, phases: ['down', 'move'] });
  await penStroke(l, [
    [0.2, 0.5],
    [0.5, 0.5],
    [0.8, 0.5],
  ]);
  await penStroke(l, palm, { pointerType: 'touch', pointerId: 6, phases: ['up'] });
  await expect(marks(l, 'highlight')).toHaveCount(2);
  await expect(allStrokes(l)).toHaveCount(2);

  // Kalemden sonra parmak çizmez (çizseydi bekleyen çizgi hemen görünürdü)
  await penStroke(
    l,
    [
      [0.2, 0.7],
      [0.8, 0.7],
    ],
    { pointerType: 'touch', pointerId: 7 },
  );
  await expect(allStrokes(l)).toHaveCount(2);
  expect(await bookIndex(page)).toBe(start);

  // Bırakılışı katmana gelmeyen kalem çizimi takılı kalmaz: sonraki kalem yine çizer
  await penStroke(
    l,
    [
      [0.2, 0.9],
      [0.8, 0.9],
    ],
    { pointerId: 8, phases: ['down', 'move'] },
  );
  await page.evaluate(() =>
    document.body.dispatchEvent(
      new PointerEvent('pointerup', { pointerId: 8, pointerType: 'pen', bubbles: true }),
    ),
  );
  await expect(allStrokes(l)).toHaveCount(2);
  await penStroke(
    l,
    [
      [0.2, 0.95],
      [0.8, 0.95],
    ],
    { pointerId: 9 },
  );
  await expect(marks(l, 'highlight')).toHaveCount(3);
});

test('kip kapalıyken kalem son seçilen çizen araçla çizer (seçili araç silgi ya da not olsa da)', async ({
  page,
}) => {
  await openNovel(page);
  const l = layer(page, 1);
  await enablePen(page);
  await page.getByTestId('pen-tool-ink').click();
  await page.getByTestId('pen-tool-eraser').click();
  await page.getByTestId('pen-done').click();
  await penStroke(l, [
    [0.2, 0.3],
    [0.8, 0.3],
  ]);
  await expect(marks(l, 'ink')).toHaveCount(1);

  await enablePen(page);
  await page.getByTestId('pen-tool-highlight').click();
  await page.getByTestId('pen-tool-note').click();
  await page.getByTestId('pen-done').click();
  await penStroke(l, [
    [0.2, 0.5],
    [0.8, 0.5],
  ]);
  await expect(marks(l, 'highlight')).toHaveCount(1);
  await expect(page.getByTestId('note-editor')).toHaveCount(0);
});

test('sayfanın sağ üst köşesine konan not iğnesi kesilmez (kenarda döner)', async ({ page }) => {
  await openNovel(page);
  await enablePen(page);
  await page.getByTestId('pen-tool-note').click();
  const l = layer(page, 1);
  for (const [x, y, text] of [
    [0.99, 0.01, 'Köşe'],
    [0.5, 0.01, 'Üst'],
    [0.99, 0.5, 'Sağ'],
  ] as const) {
    await clickOn(page, l, x, y);
    await page.getByTestId('note-text').fill(text);
    await page.getByTestId('note-save').click();
    await expect(page.getByTestId('note-editor')).toHaveCount(0);
  }
  const pins = l.getByTestId('note-pin');
  await expect(pins).toHaveCount(3);
  const box = (await l.boundingBox())!;
  for (let i = 0; i < 3; i++) {
    const body = (await pins.nth(i).locator('.note-pin').boundingBox())!;
    expect(body.x).toBeGreaterThanOrEqual(box.x - 0.5);
    expect(body.y).toBeGreaterThanOrEqual(box.y - 0.5);
    expect(body.x + body.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
    expect(body.y + body.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
  }
  // Dönen iğneye dokununca da not açılır; silgi dönen iğnenin gövdesine değince siler
  await pins.nth(0).click();
  await expect(page.getByTestId('note-text')).toHaveValue('Köşe');
  await page.keyboard.press('Escape');
  const corner = (await pins.nth(0).locator('.note-pin').boundingBox())!;
  await page.getByTestId('pen-tool-eraser').click();
  // İğnenin dokunma alanının dışından başlar: iğneye silgiyle basmak değil, gövdeye değmek sınanır
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2 + 40);
  await page.mouse.down();
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(pins).toHaveCount(2);
});

test('çarpma karışımı yalnızca sayfada boyama varken açıktır', async ({ page }) => {
  await openNovel(page);
  const l = layer(page, 1);
  const blend = () =>
    l
      .locator('svg')
      .first()
      .evaluate((svg) => getComputedStyle(svg).mixBlendMode);
  expect(await blend()).toBe('normal');
  await enablePen(page);
  await drawOn(page, l, [
    [0.2, 0.3],
    [0.8, 0.3],
  ]);
  await expect(marks(l, 'highlight')).toHaveCount(1);
  expect(await blend()).toBe('multiply');
  await page.getByTestId('pen-undo').click();
  await expect(allStrokes(l)).toHaveCount(0);
  await expect.poll(blend).toBe('normal');
});

test('Notlar paneli: sayfadaki ardışık kalem çizgileri tek satırdır; birlikte silinir, birlikte geri alınır', async ({
  page,
}) => {
  await openNovel(page);
  await enablePen(page);
  await page.getByTestId('pen-tool-ink').click();
  const l = layer(page, 1);
  for (const y of [0.3, 0.35, 0.4, 0.45, 0.5])
    await drawOn(page, l, [
      [0.2, y],
      [0.8, y],
    ]);
  await expect(marks(l, 'ink')).toHaveCount(5);
  await page.getByTestId('pen-tool-highlight').click();
  await drawOn(page, l, [
    [0.2, 0.7],
    [0.8, 0.7],
  ]);
  await expect(marks(l, 'highlight')).toHaveCount(1);
  await page.getByTestId('pen-done').click();

  await openNotes(page);
  const items = page.getByTestId('notes-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveAttribute('data-kind', 'ink');
  await expect(items.nth(0)).toHaveAttribute('data-count', '5');
  await expect(items.nth(0)).toContainText('Kalem çizgileri · 5');
  await expect(items.nth(1)).toHaveAttribute('data-kind', 'highlight');

  await items.nth(0).getByRole('button', { name: 'Çizgileri sil' }).click();
  await expect(items).toHaveCount(1);
  await expect(marks(l, 'ink')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await enablePen(page);
  await page.getByTestId('pen-undo').click();
  await expect(marks(l, 'ink')).toHaveCount(5);
  await expect(allStrokes(l)).toHaveCount(6);
});
