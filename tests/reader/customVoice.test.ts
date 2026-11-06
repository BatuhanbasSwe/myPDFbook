import { zipSync, type Zippable } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  addVoiceFiles,
  checkPiperConfig,
  cleanVoiceName,
  crc32Update,
  defaultVoiceName,
  prepareVoice,
  voiceFileKind,
  voiceLang,
} from '../../src/reader/modes/piper/customVoice';
import { crc32 } from '../../src/backup/zip';

/** tr_TR-dfki-medium.onnx.json'un kısaltılmışı (Piper'ın ayar biçimi) */
function piperConfig(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dataset: 'batuhan',
    audio: { sample_rate: 22050, quality: 'medium' },
    espeak: { voice: 'tr' },
    language: { code: 'tr_TR', family: 'tr', region: 'TR', name_native: 'Türkçe' },
    inference: { noise_scale: 0.667, length_scale: 1, noise_w: 0.8 },
    phoneme_type: 'espeak',
    phoneme_map: {},
    phoneme_id_map: { _: [0], '^': [1], $: [2], a: [14], b: [15] },
    num_symbols: 256,
    num_speakers: 1,
    speaker_id_map: {},
    piper_version: '1.0.0',
    ...patch,
  };
}

/** ONNX gibi başlayan (0x08) sahte model */
const modelBytes = (size = 1000) => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) & 0xff;
  bytes[0] = 0x08;
  return bytes;
};
const json = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
const file = (bytes: Uint8Array | string, name: string) => new File([bytes as BlobPart], name);
const zipFile = (entries: Zippable, name = 'ses.zip', level: 0 | 6 = 6) =>
  file(zipSync(entries, { level }), name);
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

describe('checkPiperConfig', () => {
  it('Piper ayarı: bilgiler okunur, Türkçe seste uyarı yok', () => {
    const r = checkPiperConfig(piperConfig());
    expect(r).toEqual({
      ok: true,
      warnings: [],
      info: {
        sampleRate: 22050,
        espeakVoice: 'tr',
        lang: 'tr',
        numSpeakers: 1,
        quality: 'medium',
        dataset: 'batuhan',
        name: undefined,
        languageName: 'Türkçe',
      },
    });
  });

  it('Türkçe olmayan ses uyarıyla kabul edilir; çok konuşmacılı ses de', () => {
    const en = checkPiperConfig(
      piperConfig({ espeak: { voice: 'en-us' }, language: { name_english: 'English' } }),
    );
    expect(en.ok && en.info.lang).toBe('en');
    expect(en.ok && en.warnings).toEqual([
      'Bu ses Türkçe değil (English, en-us). Türkçe kitaplarda listelenmez; İngilizce kitaplarda seçilebilir.',
    ]);
    const de = checkPiperConfig(piperConfig({ espeak: { voice: 'de' }, language: undefined }));
    expect(de.ok && de.warnings[0]).toContain('dili Türkçe ya da İngilizce olmayan kitaplarda');
    const multi = checkPiperConfig(piperConfig({ num_speakers: 3 }));
    expect(multi.ok && multi.warnings).toEqual([
      'Bu seste 3 konuşmacı var: ilk konuşmacının sesi kullanılır.',
    ]);
  });

  it('eksik alanların hepsi yazılır', () => {
    expect(checkPiperConfig({ dataset: 'x' })).toEqual({
      ok: false,
      errors: [
        'audio.sample_rate eksik.',
        'espeak.voice eksik.',
        'phoneme_id_map eksik.',
        'num_speakers eksik.',
        'inference eksik.',
      ],
    });
    const r = checkPiperConfig(piperConfig({ audio: {}, espeak: {}, inference: { noise_w: 1 } }));
    expect(r).toEqual({
      ok: false,
      errors: [
        'audio.sample_rate eksik.',
        'espeak.voice eksik.',
        'inference.noise_scale eksik.',
        'inference.length_scale eksik.',
      ],
    });
  });

  it('yanlış türler', () => {
    const r = checkPiperConfig(
      piperConfig({
        audio: { sample_rate: '22050' },
        espeak: { voice: 7 },
        phoneme_id_map: { a: [1], b: 'x' },
        num_speakers: 0,
        inference: { noise_scale: '0.6', length_scale: 0, noise_w: -1 },
      }),
    );
    expect(r).toEqual({
      ok: false,
      errors: [
        'audio.sample_rate bir örnekleme hızı (ör. 22050) olmalı.',
        'espeak.voice bir espeak dil kodu (ör. "tr") olmalı.',
        'phoneme_id_map["b"] bir kimlik listesi (ör. [3]) olmalı.',
        'num_speakers 1 ya da daha büyük bir tam sayı olmalı.',
        'inference.noise_scale bir sayı olmalı.',
        'inference.length_scale sıfırdan büyük bir sayı olmalı.',
        'inference.noise_w bir sayı olmalı.',
      ],
    });
    expect(checkPiperConfig(piperConfig({ phoneme_id_map: {} }))).toEqual({
      ok: false,
      errors: ['phoneme_id_map boş.'],
    });
    expect(checkPiperConfig(piperConfig({ phoneme_id_map: [[1]] }))).toEqual({
      ok: false,
      errors: ['phoneme_id_map bir nesne (ses birimi → kimlikler) olmalı.'],
    });
    expect(checkPiperConfig([])).toMatchObject({ ok: false });
    expect(checkPiperConfig('ses')).toMatchObject({ ok: false });
  });

  it('espeak dışı ses birimleri desteklenmez', () => {
    expect(checkPiperConfig(piperConfig({ phoneme_type: 'text' }))).toEqual({
      ok: false,
      errors: ['Bu ses espeak ses birimleri kullanmıyor (phoneme_type: "text"): desteklenmiyor.'],
    });
  });

  it('dil: espeak sesinden', () => {
    expect(voiceLang('tr')).toBe('tr');
    expect(voiceLang('en-us')).toBe('en');
    expect(voiceLang('pt-BR')).toBe('pt');
    expect(voiceLang('cmn')).toBe('cmn');
  });
});

describe('defaultVoiceName', () => {
  it('ayardaki ad, sonra dataset, sonra dosya adı', () => {
    expect(defaultVoiceName({ name: 'Batuhan (ev)', dataset: 'x' }, 'y.onnx')).toBe('Batuhan (ev)');
    expect(defaultVoiceName({ dataset: 'batuhan' }, 'model.onnx')).toBe('Batuhan');
    expect(defaultVoiceName({}, 'tr_TR-batuhan-medium.onnx')).toBe('Batuhan');
    expect(defaultVoiceName({}, 'sesim.onnx')).toBe('Sesim');
    expect(defaultVoiceName({})).toBe('Kendi sesim');
  });

  it('dataset katalog sesininse (ince ayarda kopyalanmış ayar) dosya adı önce gelir', () => {
    expect(defaultVoiceName({ dataset: 'dfki' }, 'tr_TR-batuhan-medium.onnx')).toBe('Batuhan');
    expect(defaultVoiceName({ dataset: 'dfki' })).toBe('Dfki');
  });

  it('Türkçe büyük harf, alt çizgi ve tire boşluk olur, uzunluk sınırlı', () => {
    expect(defaultVoiceName({ dataset: 'ışıl' })).toBe('Işıl');
    expect(defaultVoiceName({ dataset: 'batuhan_v2' })).toBe('Batuhan v2');
    expect(defaultVoiceName({ dataset: 'tr_TR-batuhan-high' })).toBe('Batuhan');
    expect(defaultVoiceName({ dataset: 'a'.repeat(60) })).toHaveLength(40);
  });

  it('kullanıcının yazdığı ad', () => {
    expect(cleanVoiceName('  Batuhan   iki ')).toBe('Batuhan iki');
    expect(cleanVoiceName('   ')).toBeNull();
    expect(cleanVoiceName('x'.repeat(50))).toHaveLength(40);
  });
});

describe('dosyalar', () => {
  it('tür adından', () => {
    expect(voiceFileKind('tr_TR-batuhan-medium.onnx')).toBe('model');
    expect(voiceFileKind('tr_TR-batuhan-medium.onnx.json')).toBe('config');
    expect(voiceFileKind('config.JSON')).toBe('config');
    expect(voiceFileKind('ses.zip')).toBe('zip');
    expect(voiceFileKind('ses.wav')).toBe('other');
  });

  it('model ve ayar ayrı ayrı seçilir: seçimler birleşir', async () => {
    const a = await addVoiceFiles({}, [file(modelBytes(), 'b.onnx')]);
    expect(a.errors).toEqual([]);
    expect(a.selection.model?.name).toBe('b.onnx');
    const b = await addVoiceFiles(a.selection, [file(json(piperConfig()), 'b.onnx.json')]);
    expect(b.selection.model?.name).toBe('b.onnx');
    expect(b.selection.config?.name).toBe('b.onnx.json');
  });

  it('tanınmayan dosya ve birden çok model hata verir', async () => {
    const r = await addVoiceFiles({}, [
      file(modelBytes(), 'a.onnx'),
      file(modelBytes(), 'b.onnx'),
      file('x', 'not.txt'),
    ]);
    expect(r.errors).toEqual([
      'Birden çok model seçildi: tek bir ses seçin.',
      'Tanınmayan dosya: not.txt. .onnx, .onnx.json ya da .zip seçin.',
    ]);
  });

  it('ZIP (sıkıştırılmış): model ve ayar çıkarılır, baytlar aynı', async () => {
    const model = modelBytes(300_000);
    const zip = zipFile({
      'tr_TR-batuhan-medium.onnx': model,
      'tr_TR-batuhan-medium.onnx.json': json(piperConfig()),
    });
    const r = await addVoiceFiles({}, [zip]);
    expect(r.errors).toEqual([]);
    expect(r.selection.model).toMatchObject({ name: 'tr_TR-batuhan-medium.onnx', zip: 'ses.zip' });
    expect(await bytesOf(r.selection.model!.blob)).toEqual(model);
    expect(JSON.parse(await r.selection.config!.blob.text())).toEqual(piperConfig());
  });

  it('ZIP (sıkıştırmasız, alt klasör, macOS artıkları): model dosyanın kendi aralığı', async () => {
    const model = modelBytes(50_000);
    const zip = zipFile(
      {
        batuhan: {
          'model.onnx': model,
          'model.onnx.json': json(piperConfig()),
          'notlar.txt': new TextEncoder().encode('x'),
        },
        __MACOSX: { batuhan: { '._model.onnx': new Uint8Array([1, 2]) } },
      },
      'Batuhan.zip',
      0,
    );
    const r = await addVoiceFiles({}, [zip]);
    expect(r.errors).toEqual([]);
    expect(r.selection.model?.name).toBe('model.onnx');
    expect(r.selection.config?.name).toBe('model.onnx.json');
    expect(await bytesOf(r.selection.model!.blob)).toEqual(model);
  });

  it('ZIP: ayar yoksa model alınır, ayar ayrıca istenir; iki model ya da model yoksa hata', async () => {
    const noConfig = await addVoiceFiles({}, [zipFile({ 'm.onnx': modelBytes() })]);
    expect(noConfig.selection.model?.name).toBe('m.onnx');
    expect(noConfig.errors).toEqual([
      'ses.zip içinde ayar dosyası (.onnx.json) yok: onu ayrıca seçin.',
    ]);
    const two = await addVoiceFiles({}, [
      zipFile({ 'a.onnx': modelBytes(), 'b.onnx': modelBytes() }),
    ]);
    expect(two.errors).toEqual([
      'ses.zip içinde birden çok model var: tek ses içeren bir ZIP seçin.',
    ]);
    expect(two.selection.model).toBeUndefined();
    const none = await addVoiceFiles({}, [zipFile({ 'a.txt': modelBytes() })]);
    expect(none.errors).toEqual(['ses.zip içinde .onnx model dosyası yok.']);
  });

  it('ZIP değil ya da bozuk (CRC uyuşmuyor)', async () => {
    const notZip = await addVoiceFiles({}, [file(modelBytes(), 'ses.zip')]);
    expect(notZip.errors).toEqual(['ses.zip bir ZIP dosyası değil.']);
    for (const level of [0, 6] as const) {
      const bytes = zipSync(
        { 'm.onnx': modelBytes(5000), 'm.onnx.json': json(piperConfig()) },
        { level },
      );
      // Modelin verisinden bir bayt değişir (yerel başlık 30 + ad 6 bayt)
      bytes[30 + 6 + 100] ^= 0xff;
      const r = await addVoiceFiles({}, [file(bytes, 'bozuk.zip')]);
      expect(r.errors).toEqual(['bozuk.zip bozuk ya da desteklenmeyen bir ZIP.']);
    }
    const empty = await addVoiceFiles({}, [file(new Uint8Array(0), 'bos.zip')]);
    expect(empty.errors[0]).toMatch(/^bos\.zip okunamadı\. Dosya iCloud'da kalmış olabilir/);
  });

  it('CRC-32 parça parça hesaplanır', () => {
    const bytes = modelBytes(10_000);
    expect(crc32Update(crc32Update(0, bytes.subarray(0, 3333)), bytes.subarray(3333))).toBe(
      crc32(bytes),
    );
  });
});

describe('prepareVoice', () => {
  const selection = async (
    model: Uint8Array | string,
    config: unknown,
    modelName = 'tr_TR-batuhan-medium.onnx',
  ) =>
    (
      await addVoiceFiles({}, [
        file(model as Uint8Array, modelName),
        file(typeof config === 'string' ? config : json(config), `${modelName}.json`),
      ])
    ).selection;

  it('hazır ses: ayar metni olduğu gibi, model Blob olarak, varsayılan ad', async () => {
    const r = await prepareVoice(await selection(modelBytes(), piperConfig({ dataset: 'dfki' })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.voice.defaultName).toBe('Batuhan');
    expect(r.voice.modelName).toBe('tr_TR-batuhan-medium.onnx');
    expect(JSON.parse(r.voice.configText)).toEqual(piperConfig({ dataset: 'dfki' }));
    expect(r.voice.model.size).toBe(1000);
    expect(r.voice.info.lang).toBe('tr');
  });

  it('eksik dosya', async () => {
    expect(await prepareVoice({})).toEqual({
      ok: false,
      errors: ['Model dosyası (.onnx) seçilmedi.', 'Ayar dosyası (.onnx.json) seçilmedi.'],
    });
  });

  it('ONNX olmayan model, boş dosya, bozuk JSON ve ayar hataları birlikte', async () => {
    const r = await prepareVoice(await selection('PK\u0003\u0004 bir zip', '{ bozuk'));
    expect(r).toEqual({
      ok: false,
      errors: [
        'tr_TR-batuhan-medium.onnx bir ONNX modeli değil ya da bozuk.',
        'tr_TR-batuhan-medium.onnx.json okunamadı: geçerli bir JSON değil.',
      ],
    });
    const empty = await prepareVoice(
      await selection(new Uint8Array(0), piperConfig({ espeak: {} })),
    );
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.errors[0]).toMatch(/^tr_TR-batuhan-medium\.onnx boş\. Dosya iCloud'da/);
    expect(empty.errors[1]).toBe('espeak.voice eksik.');
  });
});
