import { expect, test, type Locator, type Page } from '@playwright/test';
import { unzipSync, zipSync } from 'fflate';
import { readFile } from 'node:fs/promises';
import { headerAction, importFixture } from './helpers';
import { PIPER_FILES, piperLog, servePiper, stubVoices } from './piperStubs';

/**
 * Kendi sesini ekle (plan 12): kullanıcının Piper sesinin dosyaları seçilir, cihazda saklanır, sesli okumada
 * seçilir. Sentezleyici ve denemesi sahtedir (piperStubs.ts): model dosyası "bozuk" içeriyorsa deneme olmaz. Gerçek
 * worker ve ONNX Runtime tests/browser/piperCheck.test.ts'te.
 */

const NOVEL = ['novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf'] as const;
const MODEL_NAME = 'tr_TR-batuhan-medium.onnx';
const CUSTOM = /\/piper-custom\//;

/** ONNX gibi başlayan (0x08) ~3 MB'lık sahte model; `marker` içeriğinde geçer */
function modelBytes(marker = 'sahte-model-baytlari') {
  const bytes = Buffer.alloc(3_000_000, 0x41);
  bytes[0] = 0x08;
  bytes.write(marker, 1);
  return bytes;
}

function piperConfig(patch: Record<string, unknown> = {}) {
  return {
    dataset: 'batuhan',
    audio: { sample_rate: 22050, quality: 'medium' },
    espeak: { voice: 'tr' },
    language: { code: 'tr_TR', name_native: 'Türkçe' },
    inference: { noise_scale: 0.667, length_scale: 1, noise_w: 0.8 },
    phoneme_type: 'espeak',
    phoneme_id_map: { _: [0], '^': [1], $: [2], a: [14] },
    num_speakers: 1,
    piper_version: '1.0.0',
    ...patch,
  };
}

const modelFile = (marker?: string) => ({
  name: MODEL_NAME,
  mimeType: 'application/octet-stream',
  buffer: modelBytes(marker),
});
const configFile = (patch?: Record<string, unknown>) => ({
  name: `${MODEL_NAME}.json`,
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(piperConfig(patch))),
});

async function openNovel(page: Page) {
  await page.goto('/');
  await importFixture(page, ...NOVEL);
  await page.getByTestId('book-open').click();
  await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
}

/** Sesli okumayı açar ve ses menüsünü gösterir */
async function openVoiceMenu(page: Page): Promise<Locator> {
  if (!(await page.getByTestId('read-aloud-bar').isVisible()))
    await headerAction(page, 'read-aloud');
  const options = page.getByTestId('read-aloud-options');
  if ((await options.isVisible()) && (await options.getAttribute('aria-expanded')) !== 'true')
    await options.click();
  const menu = page.getByTestId('voice-menu');
  if (!(await menu.isVisible())) await page.getByTestId('read-aloud-voice').click();
  await expect(menu).toBeVisible();
  return menu;
}

/** "Kendi sesini ekle…" penceresini açar */
async function openImport(page: Page): Promise<Locator> {
  await (await openVoiceMenu(page)).getByTestId('voice-add').click();
  const sheet = page.getByTestId('voice-import');
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Dosyaları seçip sesi ekler; menü yeniden açılır */
async function importVoice(
  page: Page,
  files: Parameters<Locator['setInputFiles']>[0],
): Promise<void> {
  const sheet = await openImport(page);
  await sheet.getByTestId('voice-file-input').setInputFiles(files);
  await expect(sheet.getByTestId('voice-import-add')).toBeEnabled();
  await sheet.getByTestId('voice-import-add').click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('voice-menu')).toBeVisible();
}

const cacheUrls = (page: Page) =>
  page.evaluate(async () =>
    (await (await caches.open('mypdfbook-piper-v1')).keys()).map((r) => r.url),
  );

const checks = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __piperChecks: { voice: string; text: string }[] }).__piperChecks,
  );

test('kendi sesi: dosyalarla eklenir, seçilir ve okur; çevrimdışı yenilemeden sonra durur; adı değişir; kaldırılır', async ({
  page,
  browserName,
}) => {
  test.setTimeout(120_000);
  await stubVoices(page);
  await servePiper(page);
  await openNovel(page);
  await headerAction(page, 'read-aloud');

  // Pencere: gizlilik notu baştan görünür; önce model, sonra ayar dosyası seçilir
  const sheet = await openImport(page);
  await expect(page.getByTestId('voice-menu')).toHaveCount(0);
  await expect(sheet.getByTestId('voice-privacy')).toHaveText(
    'Bu ses yalnızca bu cihazda durur; yedeğe eklenmez.',
  );
  await expect(sheet.getByTestId('voice-import-add')).toBeDisabled();
  await sheet.getByTestId('voice-file-input').setInputFiles(modelFile());
  await expect(sheet.getByTestId('voice-file-model')).toContainText(MODEL_NAME);
  await expect(sheet.getByTestId('voice-hint-missing')).toHaveText(
    'Ayar dosyasını (.onnx.json) da seç.',
  );
  await sheet.getByTestId('voice-file-input').setInputFiles(configFile());
  await expect(sheet.getByTestId('voice-name')).toHaveValue('Batuhan');
  await expect(sheet.getByTestId('voice-size')).toHaveText('3 MB');
  await expect(sheet.getByTestId('voice-warning')).toHaveCount(0);
  // İlk yapay zekâ sesi: ses motoru da iner
  await expect(sheet.getByTestId('voice-runtime')).toContainText('33 MB');
  await sheet.getByTestId('voice-import-add').click();
  await expect(sheet).toHaveCount(0);

  // Menü yeniden açılır: ses listede ve seçili; denendi, örnek cümleyle tanıtıldı
  const menu = page.getByTestId('voice-menu');
  const row = menu.getByTestId('voice-custom');
  await expect(row).toHaveText(/^Batuhan\s*Kendi sesin · 3 MB$/);
  await expect(row).toHaveAttribute('aria-checked', 'true');
  const [check] = await checks(page);
  expect(check).toMatchObject({
    voice: expect.stringMatching(/^piper:custom-/),
    text: 'Merhaba, bu benim sesim.',
  });
  const voiceId = check.voice;
  await expect.poll(async () => (await piperLog(page)).length).toBeGreaterThan(0);
  expect((await piperLog(page))[0]).toMatchObject({
    voice: voiceId,
    text: 'Merhaba! Kitabınızı bu sesle okuyacağım.',
  });
  // Dosyalar uygulamanın adresinde, Cache Storage'da (ağdan istenmez)
  const urls = await cacheUrls(page);
  expect(
    urls
      .filter((u) => CUSTOM.test(u))
      .map((u) => u.split('/').pop())
      .sort(),
  ).toEqual(['model.onnx', 'model.onnx.json', 'voice.json']);

  // Okuma kendi sesiyle sürer
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('read-aloud-voice')).toHaveText('Batuhan');
  await page.getByTestId('read-aloud-play').click();
  await expect
    .poll(async () => (await piperLog(page)).filter((l) => !l.text.startsWith('Merhaba!')).length)
    .toBeGreaterThan(1);
  expect(new Set((await piperLog(page)).map((l) => l.voice))).toEqual(new Set([voiceId]));
  await page.getByTestId('read-aloud-close').click();

  // Çevrimdışı yeniden açılış: ses cihazda, seçim kalıcı. Playwright'ın Windows'taki WebKit'i Cache Storage'ı
  // sayfa yenilenince boşaltır (gerçek Safari saklar): orada okuma kapatılıp açılır.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const offline: string[] = [];
  await page.route(PIPER_FILES, (route) => {
    offline.push(route.request().url());
    return route.abort('internetdisconnected');
  });
  if (browserName !== 'webkit') {
    await page.reload();
    await expect(page.locator('[data-testid="flipbook"][data-ready]')).toBeVisible();
  } else
    await page.evaluate(
      () => ((window as unknown as { __piperLog: unknown[] }).__piperLog.length = 0),
    );
  await headerAction(page, 'read-aloud');
  await expect.poll(async () => (await piperLog(page)).length).toBeGreaterThan(1);
  expect(new Set((await piperLog(page)).map((l) => l.voice))).toEqual(new Set([voiceId]));
  expect(offline).toEqual([]);

  // Ad değişir (kalıcı): düzenleme penceresi
  let m = await openVoiceMenu(page);
  await expect(m.getByTestId('voice-custom')).toHaveText(/^Batuhan/);
  await m.getByTestId('voice-edit').click();
  const edit = page.getByTestId('voice-edit-sheet');
  await expect(edit).toBeVisible();
  await expect(edit.getByTestId('voice-privacy')).toBeVisible();
  await expect(edit.getByTestId('voice-save')).toBeDisabled();
  await edit.getByTestId('voice-name').fill('Batuhan (yavaş)');
  await edit.getByTestId('voice-save').click();
  await expect(edit).toHaveCount(0);
  m = page.getByTestId('voice-menu');
  await expect(m.getByTestId('voice-custom')).toHaveText(/^Batuhan \(yavaş\)/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('read-aloud-voice')).toHaveText('Batuhan (yavaş)');

  // Kaldırma onaylıdır; okuma sistem sesine geçer, kayıtlar ve (başka ses yok) ses motoru silinir
  m = await openVoiceMenu(page);
  await m.getByTestId('voice-edit').click();
  await edit.getByTestId('voice-remove-custom').click();
  await expect(edit.getByTestId('voice-remove-confirm')).toContainText(
    '“Batuhan (yavaş)” bu cihazdan silinsin mi?',
  );
  await edit.getByTestId('voice-remove-yes').click();
  await expect(edit).toHaveCount(0);
  await expect(page.getByTestId('voice-menu').getByTestId('voice-custom')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('read-aloud-voice')).toHaveText(/Emel|Yelda/);
  await expect.poll(() => cacheUrls(page)).toEqual([]);
});

test('ZIP ile eklenir (alt klasör, macOS artıkları); aynı adla ikinci ses ayrı bir ses olur', async ({
  page,
}) => {
  await stubVoices(page);
  await servePiper(page);
  await openNovel(page);
  const zip = Buffer.from(
    zipSync({
      Batuhan: {
        [MODEL_NAME]: modelBytes(),
        [`${MODEL_NAME}.json`]: Buffer.from(JSON.stringify(piperConfig())),
      },
      __MACOSX: { Batuhan: { [`._${MODEL_NAME}`]: new Uint8Array([0, 5, 22]) } },
    }),
  );
  const zipFile = { name: 'Batuhan.zip', mimeType: 'application/zip', buffer: zip };
  await importVoice(page, zipFile);
  const sheet = await openImport(page);
  await sheet.getByTestId('voice-file-input').setInputFiles(zipFile);
  await expect(sheet.getByTestId('voice-file-model')).toContainText('Batuhan.zip');
  await expect(sheet.getByTestId('voice-name')).toHaveValue('Batuhan');
  // Ses motoru ilk seste indi
  await expect(sheet.getByTestId('voice-runtime')).toHaveCount(0);
  await sheet.getByTestId('voice-import-add').click();
  await expect(sheet).toHaveCount(0);
  const rows = page.getByTestId('voice-menu').getByTestId('voice-custom');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveText(/^Batuhan/);
  await expect(rows.nth(1)).toHaveText(/^Batuhan/);
  // Son eklenen seçili; kimlikleri ayrı
  await expect(rows.nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(rows.nth(0)).toHaveAttribute('aria-checked', 'false');
  const ids = (await checks(page)).map((c) => c.voice);
  expect(new Set(ids).size).toBe(2);
});

test('bozuk dosyalar reddedilir, yarım ses kalmaz: eksik alanlı ayar, tanınmayan dosya, açılamayan model, yer kalmadı; Türkçe olmayan ses uyarılır', async ({
  page,
}) => {
  await stubVoices(page);
  await servePiper(page);
  await openNovel(page);
  const sheet = await openImport(page);
  const input = sheet.getByTestId('voice-file-input');
  const add = sheet.getByTestId('voice-import-add');

  // Eksik ve yanlış türdeki alanlar birlikte yazılır
  await input.setInputFiles([
    modelFile(),
    configFile({ audio: {}, num_speakers: 'bir', inference: undefined }),
  ]);
  await expect(sheet.getByTestId('voice-problems')).toHaveText(
    [
      'audio.sample_rate eksik.',
      'num_speakers 1 ya da daha büyük bir tam sayı olmalı.',
      'inference eksik.',
    ].join(''),
  );
  await expect(add).toBeDisabled();
  await input.setInputFiles({
    name: 'ses.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from('RIFF'),
  });
  await expect(sheet.getByTestId('voice-problems')).toContainText(
    'Tanınmayan dosya: ses.wav. .onnx, .onnx.json ya da .zip seçin.',
  );

  // Türkçe olmayan ses: uyarıyla eklenebilir
  await input.setInputFiles(
    configFile({ espeak: { voice: 'en-us' }, language: { name_native: 'English' } }),
  );
  await expect(sheet.getByTestId('voice-warning')).toHaveText(
    'Bu ses Türkçe değil (English, en-us). Türkçe kitaplarda listelenmez; İngilizce kitaplarda seçilebilir.',
  );
  await expect(add).toBeEnabled();

  // Model açılamaz (deneme olmaz): ses eklenmez, kaydedilenler silinir
  await input.setInputFiles([modelFile('bozuk-model'), configFile()]);
  await expect(sheet.getByTestId('voice-warning')).toHaveCount(0);
  await add.click();
  await expect(sheet.getByTestId('voice-import-error')).toHaveText(
    'Model açılamadı: dosya bozuk ya da bir ONNX modeli değil.',
  );
  expect((await cacheUrls(page)).filter((u) => CUSTOM.test(u))).toEqual([]);

  // Yer kalmadı: anlaşılır ileti, yarım ses yok
  await input.setInputFiles(modelFile());
  await page.evaluate(() => {
    const put = Cache.prototype.put;
    Cache.prototype.put = function (req: RequestInfo | URL, res: Response) {
      const url = typeof req === 'string' ? req : req instanceof URL ? req.href : req.url;
      if (url.endsWith('/model.onnx'))
        return Promise.reject(
          new DOMException('The quota has been exceeded.', 'QuotaExceededError'),
        );
      return put.call(this, req, res);
    };
  });
  await add.click();
  await expect(sheet.getByTestId('voice-import-error')).toHaveText(
    'Cihazda yer kalmadı: ses kaydedilemedi (3 MB gerekiyor). Kullanmadığın sesleri ya da kitapları kaldırıp yeniden dene.',
  );
  expect((await cacheUrls(page)).filter((u) => CUSTOM.test(u))).toEqual([]);

  // Pencere kapanınca menüde kendi sesi yok
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('voice-menu')).toBeVisible();
  await expect(page.getByTestId('voice-menu').getByTestId('voice-custom')).toHaveCount(0);
});

test('kendi sesi yedeğe girmez', async ({ page }, testInfo) => {
  await stubVoices(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false }),
  );
  await servePiper(page);
  await openNovel(page);
  await importVoice(page, [modelFile('gizli-ses-modeli'), configFile()]);
  await expect(page.getByTestId('voice-menu').getByTestId('voice-custom')).toHaveText(/^Batuhan/);

  await page.goto('/');
  await headerAction(page, 'backup-open');
  const d = page.getByTestId('backup-dialog');
  await d.getByTestId('backup-create').click();
  const link = d.getByTestId('backup-download');
  await expect(link).toBeVisible();
  const downloading = page.waitForEvent('download');
  await link.click();
  const path = testInfo.outputPath('yedek.mypdfbook');
  await (await downloading).saveAs(path);

  const files = unzipSync(new Uint8Array(await readFile(path)));
  const names = Object.keys(files);
  expect(names.some((n) => /onnx|piper|voice/i.test(n))).toBe(false);
  for (const bytes of Object.values(files)) {
    // Sesin modeli, ayarı ve adı hiçbir girdide yok (ikili girdiler de tarandı)
    const text = Buffer.from(bytes).toString('latin1');
    expect(text).not.toContain('gizli-ses-modeli');
    expect(text).not.toContain('Batuhan');
    expect(text).not.toContain('phoneme_id_map');
  }
});
