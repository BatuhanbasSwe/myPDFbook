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
      license: 'CC BY-NC-SA 4.0 · DFKI Türkçe sesinden türetildi',
      model: { url: '/voices/batuhan-v1/tr_TR-batuhan-medium.onnx', bytes: 63_000_000 },
      config: { url: '/voices/batuhan-v1/tr_TR-batuhan-medium.onnx.json', sha256: sha },
    });
    expect(v.custom).toBeUndefined();
  });

  it('boyu ve SHA-256 yazılmadıkça katalogda yok (model henüz eğitilmedi)', () => {
    expect(publishedVoices([BATUHAN_VOICE])).toEqual([]);
    expect(PIPER_VOICES.map((v) => v.name)).toEqual(['DFKI', 'LJSpeech']);
    expect(
      publishedVoices([
        { ...BATUHAN_VOICE, model: { bytes: 1, sha256: sha }, config: { bytes: 1, sha256: sha } },
      ]).map((v) => v.name),
    ).toEqual(['Batuhan']);
  });
});
