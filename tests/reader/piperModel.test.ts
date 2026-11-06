import * as ort from 'onnxruntime-web/wasm';
import { describe, expect, it } from 'vitest';
import {
  missingInputs,
  phonemeIds,
  requiredInputs,
  runVoice,
  soundOk,
  type VoiceConfig,
} from '../../src/reader/modes/piper/piperModel';
import { tinyPiperOnnx } from '../helpers/tinyOnnx';

const config: VoiceConfig = {
  audio: { sample_rate: 22050 },
  espeak: { voice: 'tr' },
  inference: { noise_scale: 0.5, length_scale: 1, noise_w: 0.5 },
  num_speakers: 1,
  phoneme_id_map: { _: [0], '^': [1], $: [2], a: [14], ʃ: [31, 32] },
};

ort.env.wasm.numThreads = 1;

describe('piperModel', () => {
  it('ses birimleri → kimlikler: ^ _ (birim _)* $; modelde olmayan birim atlanır', () => {
    expect(phonemeIds(['a', 'x', 'ʃ'], config.phoneme_id_map)).toEqual([1, 0, 14, 0, 31, 32, 0, 2]);
    expect(phonemeIds([], {})).toEqual([1, 0, 2]);
  });

  it('gerekli girdiler: çok konuşmacılı seste sid de', () => {
    expect(requiredInputs(config)).toEqual(['input', 'input_lengths', 'scales']);
    expect(missingInputs(['input', 'input_lengths', 'scales'], config)).toEqual([]);
    expect(missingInputs(['input', 'scales'], { num_speakers: 2 })).toEqual([
      'input_lengths',
      'sid',
    ]);
  });

  it('gerçek ONNX Runtime: küçük Piper benzeri model açılır, girdileri uyar, ses üretir', async () => {
    const session = await ort.InferenceSession.create(tinyPiperOnnx());
    expect(missingInputs(session.inputNames, config)).toEqual([]);
    const pcm = await runVoice(session, config, [1, 0, 14, 0, 2], 2);
    // Küçük model: kimlikler × (noise_scale + length_scale × hız çarpanı + noise_w) = kimlikler × 3
    expect(Array.from(pcm)).toEqual([3, 0, 42, 0, 6]);
    expect(soundOk(pcm)).toBe(true);
    await session.release();
  });

  it('eksik girdili model ve çok konuşmacılı ayar: eksikler bulunur; sid verilir', async () => {
    const noScales = await ort.InferenceSession.create(tinyPiperOnnx({ withoutScales: true }));
    expect(missingInputs(noScales.inputNames, config)).toEqual(['scales']);
    await noScales.release();
    const multi = { ...config, num_speakers: 2 };
    const noSid = await ort.InferenceSession.create(tinyPiperOnnx());
    expect(missingInputs(noSid.inputNames, multi)).toEqual(['sid']);
    await noSid.release();
    const withSid = await ort.InferenceSession.create(tinyPiperOnnx({ withSid: true }));
    expect(soundOk(await runVoice(withSid, multi, [1, 0, 2], 1))).toBe(true);
    await withSid.release();
  });

  it('ONNX olmayan dosya açılmaz', async () => {
    await expect(
      ort.InferenceSession.create(new TextEncoder().encode('{"audio": {}}')),
    ).rejects.toThrow();
  });

  it('ses yok ya da sayı değil: deneme olmaz', () => {
    expect(soundOk(new Float32Array(0))).toBe(false);
    expect(soundOk(Float32Array.from([0.1, Number.NaN]))).toBe(false);
    expect(soundOk(Float32Array.from([0.1, -0.2]))).toBe(true);
  });
});
