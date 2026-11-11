import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  customPiperVoice,
  removeCustomFiles,
  saveCustomFiles,
  type CustomVoiceMeta,
} from '../../src/reader/modes/piper/customStore';
import { PIPER_CACHE } from '../../src/reader/modes/piper/store';
import { createWorkerSynth, type CheckError } from '../../src/reader/modes/piper/synth';
import { PIPER_RUNTIME } from '../../src/reader/modes/piper/voices';
import { tinyPiperOnnx } from '../helpers/tinyOnnx';

/**
 * Kendi sesinin denenmesi gerçek worker'da ve gerçek ONNX Runtime'la (Chromium ve iPad Safari'nin motoru WebKit):
 * dosyalar Cache Storage'dan okunur, model açılır, girdileri denetlenir, kısa bir sentez yapılır. Model testte
 * üretilen küçük bir Piper benzeri modeldir. Fonemleyici (jsDelivr) ağ ister: metinsiz denenir.
 */

const config = {
  audio: { sample_rate: 22050 },
  espeak: { voice: 'tr' },
  inference: { noise_scale: 0.667, length_scale: 1, noise_w: 0.8 },
  num_speakers: 1,
  phoneme_id_map: { _: [0], '^': [1], $: [2] },
};

const meta = (id: string): CustomVoiceMeta => ({
  v: 1,
  id,
  name: 'Deneme',
  lang: 'tr',
  espeakVoice: 'tr',
  sampleRate: 22050,
  modelBytes: 0,
  configBytes: 0,
  addedAt: 0,
});

const ids: string[] = [];
async function voiceWith(model: Uint8Array, cfg: object = config) {
  const id = `piper:custom-test${ids.length}`;
  ids.push(id);
  await saveCustomFiles(id, new Blob([model as BlobPart]), JSON.stringify(cfg));
  return customPiperVoice(meta(id));
}

const ortWasm = new URL(PIPER_RUNTIME.ortWasm.url, location.href).href;

beforeAll(async () => {
  const res = await fetch(ortWasm);
  await (await caches.open(PIPER_CACHE)).put(ortWasm, res);
}, 60_000);

afterAll(async () => {
  for (const id of ids) await removeCustomFiles(id);
  await (await caches.open(PIPER_CACHE)).delete(ortWasm);
});

describe('worker: kendi sesinin denenmesi', () => {
  it('Piper benzeri model açılır ve ses üretir; ONNX olmayan ve girdisi eksik model koduyla reddedilir', async () => {
    const synth = createWorkerSynth();
    try {
      await expect(synth.check(await voiceWith(tinyPiperOnnx()), '')).resolves.toBeUndefined();

      const notOnnx = await synth
        .check(await voiceWith(new TextEncoder().encode('bir ONNX değil')), '')
        .catch((e: CheckError) => e);
      expect(notOnnx).toMatchObject({ code: 'model' });

      const noScales = await synth
        .check(await voiceWith(tinyPiperOnnx({ withoutScales: true })), '')
        .catch((e: CheckError) => e);
      expect(noScales).toMatchObject({ code: 'inputs' });
      expect((noScales as Error).message).toContain('scales');

      // Çok konuşmacılı ayar, konuşmacı girdisi olmayan model
      const noSid = await synth
        .check(await voiceWith(tinyPiperOnnx(), { ...config, num_speakers: 2 }), '')
        .catch((e: CheckError) => e);
      expect(noSid).toMatchObject({ code: 'inputs' });

      // Hatalardan sonra worker çalışmayı sürdürür
      await expect(
        synth.check(
          await voiceWith(tinyPiperOnnx({ withSid: true }), { ...config, num_speakers: 2 }),
          '',
        ),
      ).resolves.toBeUndefined();
    } finally {
      synth.dispose();
    }
  }, 60_000);
});
