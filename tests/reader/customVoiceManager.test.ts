import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreparedVoice } from '../../src/reader/modes/piper/customVoice';
import type { ImportPhase } from '../../src/reader/modes/piper/manager';
import type { PiperVoice } from '../../src/reader/modes/piper/voices';
import { createFakeCaches, type FakeCaches } from '../helpers/fakeCaches';

/**
 * Kendi sesinin eklenmesi, ad değiştirme ve kaldırma (manager.ts + customStore.ts): bellek içi Cache Storage ve
 * sahte deneme. Her test yeni bir yönetici (modüller yeniden yüklenir); "yeniden açılış" aynı önbellekle yeni
 * yöneticidir.
 */

const CACHE = 'mypdfbook-piper-v1';
const CUSTOM = /\/piper-custom\//;

let fake: FakeCaches;

async function load() {
  vi.resetModules();
  const manager = await import('../../src/reader/modes/piper/manager');
  const voices = await import('../../src/reader/modes/piper/voices');
  const store = await import('../../src/reader/modes/piper/customStore');
  return { ...manager, ...voices, ...store };
}
type Mods = Awaited<ReturnType<typeof load>>;

function prepared(patch: Partial<PreparedVoice> = {}): PreparedVoice {
  return {
    model: new Blob([new Uint8Array([8, 1, 2, 3, 4, 5])]),
    modelName: 'tr_TR-batuhan-medium.onnx',
    configText: JSON.stringify({ audio: { sample_rate: 22050 }, espeak: { voice: 'tr' } }),
    info: { sampleRate: 22050, espeakVoice: 'tr', lang: 'tr', numSpeakers: 1, quality: 'medium' },
    warnings: [],
    defaultName: 'Batuhan',
    ...patch,
  };
}

/** Ses motorunun dosyaları cihazda (DFKI'den kalmış gibi) */
async function putRuntime(m: Mods) {
  const cache = await fake.caches.open(CACHE);
  for (const a of m.runtimeAssets()) await cache.put(a.url, new Response('x'));
}

const customUrls = () => fake.urls(CACHE).filter((u) => CUSTOM.test(u));

function options(check: (voice: PiperVoice, text: string) => Promise<void> = async () => {}) {
  const phases: ImportPhase['kind'][] = [];
  const checks: { voice: PiperVoice; text: string }[] = [];
  return {
    phases,
    checks,
    signal: new AbortController().signal,
    onPhase: (p: ImportPhase) => {
      if (phases.at(-1) !== p.kind) phases.push(p.kind);
    },
    check: (voice: PiperVoice, text: string) => {
      checks.push({ voice, text });
      return check(voice, text);
    },
  };
}

beforeEach(() => {
  fake = createFakeCaches();
  vi.stubGlobal('caches', fake.caches);
  vi.stubGlobal('location', new URL('http://localhost:5174/read/1'));
  vi.stubGlobal('window', { __mypdfbookPiper: { verify: false } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('x')),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('kendi sesini ekle', () => {
  it('eklenir: dosyalar kaydedilir, denenir, sonra voice.json; listede ve yeniden açılışta durur', async () => {
    let m = await load();
    await putRuntime(m);
    await m.piperManager.ensure();
    const opts = options();
    const voice = await m.piperManager.importCustom(prepared(), 'Batuhan', opts);
    expect(voice.id).toMatch(/^piper:custom-/);
    expect(opts.phases).toEqual(['save', 'check']);
    expect(opts.checks).toEqual([{ voice, text: 'Merhaba, bu benim sesim.' }]);
    // Denemede ses henüz listede yok: voice.json en son yazılır
    expect(
      customUrls()
        .map((u) => u.split('/').pop())
        .sort(),
    ).toEqual(['model.onnx', 'model.onnx.json', 'voice.json']);
    expect(m.piperVoicesFor('tr').map((v) => v.name)).toEqual(['DFKI', 'Batuhan']);
    expect(m.piperVoicesFor('en').map((v) => v.name)).toEqual(['LJSpeech']);
    expect(m.piperVoicesFor('other').map((v) => v.name)).toEqual(['Batuhan']);
    expect(m.piperManager.get()[voice.id]).toMatchObject({ status: 'ready', need: 0 });
    expect(voice).toMatchObject({
      name: 'Batuhan',
      lang: 'tr',
      model: { bytes: 6 },
      license: 'Kendi sesin',
      custom: { espeakVoice: 'tr', quality: 'medium', fileName: 'tr_TR-batuhan-medium.onnx' },
    });
    const stored = await (await fake.caches.open(CACHE)).match(voice.model.url);
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(new Uint8Array([8, 1, 2, 3, 4, 5]));

    // Yeniden açılış: ses kayıtlarından okunur
    m = await load();
    expect(m.piperVoice(voice.id)).toBeUndefined();
    await m.piperManager.ensure();
    expect(m.piperVoice(voice.id)?.name).toBe('Batuhan');
    expect(m.piperManager.get()[voice.id].status).toBe('ready');
  });

  it('aynı adla iki ses olur (ayrı kimlik)', async () => {
    const m = await load();
    await putRuntime(m);
    const a = await m.piperManager.importCustom(prepared(), 'Batuhan', options());
    const b = await m.piperManager.importCustom(prepared(), 'Batuhan', options());
    expect(a.id).not.toBe(b.id);
    expect(
      m
        .piperVoicesFor('tr')
        .filter((v) => v.custom)
        .map((v) => v.name),
    ).toEqual(['Batuhan', 'Batuhan']);
  });

  it('ses motoru yoksa önce o iner; inemezse hiçbir şey kaydedilmez', async () => {
    let m = await load();
    const opts = options();
    await m.piperManager.importCustom(prepared(), 'Batuhan', opts);
    expect(opts.phases).toEqual(['runtime', 'save', 'check']);
    expect(await m.piperManager.runtimeNeed()).toBe(0);

    fake = createFakeCaches();
    vi.stubGlobal('caches', fake.caches);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    m = await load();
    const err = await m.piperManager.importCustom(prepared(), 'Batuhan', options()).catch((e) => e);
    expect(err.message).toBe(
      'Ses motoru indirilemedi. İnternete bağlanıp yeniden dene: ilk yapay zekâ sesinde bir kez 33 MB indirilir.',
    );
    expect(err.cancelled).toBe(false);
    expect(fake.urls()).toEqual([]);
  });

  it('deneme olmazsa ses eklenmez, dosyaları silinir; hata Türkçe', async () => {
    const m = await load();
    await putRuntime(m);
    const cases: [string | undefined, string][] = [
      ['model', 'Model açılamadı: dosya bozuk ya da bir ONNX modeli değil.'],
      ['inputs', 'Bu model bir Piper sesi değil: girdileri uymuyor.'],
      ['language', 'Fonemleyici bu sesin dilini tanımıyor (espeak: tr).'],
      ['inference', 'Model denenirken ses üretmedi: ayar dosyası bu modelin olmayabilir.'],
      ['runtime', 'Ses motoru açılamadı. Uygulamayı yenileyip yeniden dene.'],
      [undefined, 'Ses denenemedi: beklenmedik'],
    ];
    for (const [code, message] of cases) {
      const err = await m.piperManager
        .importCustom(
          prepared(),
          'Batuhan',
          options(() =>
            Promise.reject(Object.assign(new Error(code ? 'x' : 'beklenmedik'), { code })),
          ),
        )
        .catch((e) => e);
      expect(err.message).toBe(message);
      expect(customUrls()).toEqual([]);
    }
    expect(m.piperVoicesFor('tr').map((v) => v.name)).toEqual(['DFKI']);
  });

  it('yer kalmadı: anlaşılır ileti, yarım ses kalmaz', async () => {
    const m = await load();
    await putRuntime(m);
    fake.failPut = (url) =>
      url.endsWith('/model.onnx.json') ? new DOMException('quota', 'QuotaExceededError') : null;
    const err = await m.piperManager.importCustom(prepared(), 'Batuhan', options()).catch((e) => e);
    expect(err.message).toBe(
      'Cihazda yer kalmadı: ses kaydedilemedi (1 MB gerekiyor). Kullanmadığın sesleri ya da kitapları kaldırıp yeniden dene.',
    );
    expect(customUrls()).toEqual([]);
  });

  it('vazgeçilirse (deneme sürerken ya da okuyucu kapanınca) ses eklenmez', async () => {
    const m = await load();
    await putRuntime(m);
    const controller = new AbortController();
    const opts = options(async () => controller.abort());
    const err = await m.piperManager
      .importCustom(prepared(), 'Batuhan', { ...opts, signal: controller.signal })
      .catch((e) => e);
    expect(err).toMatchObject({ message: 'Vazgeçildi: ses eklenmedi.', cancelled: true });
    expect(customUrls()).toEqual([]);
    // Okuyucu kapandı: worker bırakıldı ("canceled")
    const closed = await m.piperManager
      .importCustom(
        prepared(),
        'Batuhan',
        options(() => Promise.reject(new Error('canceled'))),
      )
      .catch((e) => e);
    expect(closed.cancelled).toBe(true);
  });

  it('yarıda kalan ekleme (voice.json yok) sonraki açılışta silinir; eski sürüm temizliği kendi seslerine dokunmaz', async () => {
    let m = await load();
    await putRuntime(m);
    const kept = await m.piperManager.importCustom(prepared(), 'Batuhan', options());
    const half = m.customFiles('piper:custom-yarim');
    await m.saveCustomFiles('piper:custom-yarim', new Blob(['x']), '{}');
    const cache = await fake.caches.open(CACHE);
    await cache.put(new URL('/assets/eski-ort.wasm', location.href).href, new Response('x'));
    m = await load();
    await m.piperManager.ensure();
    const urls = fake.urls(CACHE);
    expect(urls).not.toContain(half.model);
    expect(urls).not.toContain(half.config);
    expect(urls.some((u) => u.endsWith('eski-ort.wasm'))).toBe(false);
    expect(urls).toContain(kept.model.url);
    expect(m.piperVoicesFor('tr').map((v) => v.name)).toEqual(['DFKI', 'Batuhan']);
  });

  it('ad değişir (kalıcı); kaldırılınca kayıtlar silinir, son ses gidince ses motoru da', async () => {
    let m = await load();
    await putRuntime(m);
    const a = await m.piperManager.importCustom(prepared(), 'Batuhan', options());
    const b = await m.piperManager.importCustom(prepared(), 'Batuhan', options());
    const before = m.piperManager.get();
    await m.piperManager.rename(a.id, 'Batuhan (yavaş)');
    expect(m.piperManager.get()).not.toBe(before); // menü yeniden çizilir
    expect(m.piperVoice(a.id)?.name).toBe('Batuhan (yavaş)');
    m = await load();
    await m.piperManager.ensure();
    expect(m.piperVoice(a.id)?.name).toBe('Batuhan (yavaş)');

    const removed: string[] = [];
    m.piperManager.onRemoved((id) => removed.push(id));
    await m.piperManager.remove(a.id);
    expect(removed).toEqual([a.id]);
    expect(m.piperVoice(a.id)).toBeUndefined();
    expect(m.piperManager.get()[a.id]).toBeUndefined();
    // Başka kendi sesi var: ses motoru kalır
    expect(await m.piperManager.runtimeNeed()).toBe(0);
    await m.piperManager.remove(b.id);
    expect(customUrls()).toEqual([]);
    expect(fake.urls(CACHE)).toEqual([]);
  });

  it('kendi sesi varken katalog sesi kaldırılırsa ses motoru kalır; ses motoru silinmişse kendi sesi "indir" der', async () => {
    let m = await load();
    await putRuntime(m);
    const dfki = m.PIPER_VOICES[0];
    const cache = await fake.caches.open(CACHE);
    for (const a of m.voiceAssets(dfki)) await cache.put(a.url, new Response('x'));
    const mine = await m.piperManager.importCustom(prepared(), 'Batuhan', options());
    await m.piperManager.remove(dfki.id);
    expect(await m.piperManager.runtimeNeed()).toBe(0);
    expect(m.piperManager.get()[mine.id].status).toBe('ready');

    // Uygulama güncellendi, ONNX Runtime'ın adresi değişti (eski dosya temizlendi): ses motoru yeniden iner
    for (const a of m.runtimeAssets()) await cache.delete(a.url);
    m = await load();
    await m.piperManager.ensure();
    expect(m.piperManager.get()[mine.id]).toMatchObject({ status: 'absent' });
    expect(m.piperManager.get()[mine.id].need).toBe(
      m.runtimeAssets().reduce((s, a) => s + a.bytes, 0),
    );
    expect(await m.piperManager.install(mine.id)).toBe(true);
    expect(m.piperManager.get()[mine.id]).toMatchObject({ status: 'ready', need: 0 });
  });
});
