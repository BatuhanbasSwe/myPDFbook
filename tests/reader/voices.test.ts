import { describe, expect, it } from 'vitest';
import {
  BATUHAN_VOICE,
  PIPER_VOICES,
  publishedVoices,
  sameOriginVoice,
} from '../../src/reader/modes/piper/voices';

const sha = 'a'.repeat(64);

describe('uygulamayla yayınlanan katalog sesi', () => {
  it('dosyaları uygulamanın kendi adresinde, sürümlü klasörde', () => {
    const v = sameOriginVoice({
      ...BATUHAN_VOICE,
      model: { bytes: 63_000_000, sha256: sha },
      config: { bytes: 5000, sha256: sha },
    });
    expect(v).toMatchObject({
      id: 'piper:tr_TR-batuhan-medium',
      name: 'Batuhan',
      lang: 'tr',
      quality: 'medium',
      license: 'CC BY-NC-SA 4.0 (ticari olmayan kullanım) · DFKI Türkçe sesinden türetildi',
      model: { url: '/voices/batuhan-v1/tr_TR-batuhan-medium.onnx', bytes: 63_000_000 },
      config: { url: '/voices/batuhan-v1/tr_TR-batuhan-medium.onnx.json', sha256: sha },
    });
    expect(v.custom).toBeUndefined();
  });

  it('boyu ve SHA-256 yazılmadıkça katalogda yok', () => {
    const unpublished = {
      ...BATUHAN_VOICE,
      model: { bytes: 0, sha256: '' },
      config: { bytes: 0, sha256: '' },
    };
    expect(publishedVoices([unpublished])).toEqual([]);
    expect(
      publishedVoices([
        { ...BATUHAN_VOICE, model: { bytes: 1, sha256: sha }, config: { bytes: 1, sha256: sha } },
      ]).map((v) => v.name),
    ).toEqual(['Batuhan']);
  });

  it('Batuhan sesi katalogda: public/voices/batuhan-v1/ altındaki dosyaların boyu ve SHA-256sı', () => {
    expect(PIPER_VOICES.map((v) => v.name)).toEqual(['DFKI', 'LJSpeech', 'Batuhan']);
    expect(PIPER_VOICES.find((v) => v.name === 'Batuhan')).toMatchObject({
      id: 'piper:tr_TR-batuhan-medium',
      lang: 'tr',
      model: {
        url: '/voices/batuhan-v1/tr_TR-batuhan-medium.onnx',
        bytes: 63_516_050,
        sha256: '51078f8fce247557f036f010569c5289994af9b82fdfac3b06d252335a5931f6',
      },
      config: {
        url: '/voices/batuhan-v1/tr_TR-batuhan-medium.onnx.json',
        bytes: 5_843,
        sha256: '302fae2396eb15ff17afd069ed5bee226ecc686840b069dc80961d70f9424f7a',
      },
    });
  });
});

describe('yayınlanan ses dosyaları', () => {
  it('public/voices/ altındaki dosyaların boyu ve SHA-256sı voices.ts ile aynı', async () => {
    const { createHash } = await import('node:crypto');
    const { readFile } = await import('node:fs/promises');
    for (const asset of [BATUHAN_VOICE.model, BATUHAN_VOICE.config]) {
      const ext = asset === BATUHAN_VOICE.model ? '.onnx' : '.onnx.json';
      const file = await readFile(
        new URL(
          `../../public/voices/${BATUHAN_VOICE.dir}/${BATUHAN_VOICE.key}${ext}`,
          import.meta.url,
        ),
      );
      expect(file.byteLength).toBe(asset.bytes);
      expect(createHash('sha256').update(file).digest('hex')).toBe(asset.sha256);
    }
  });
});
