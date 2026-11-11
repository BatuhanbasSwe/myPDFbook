import * as ort from 'onnxruntime-web/wasm';

/**
 * Piper modelinin (VITS, ONNX) kullanımı: worker'ın (piper.worker.ts) sentezde ve kendi sesinin denenmesinde
 * kullandığı işler. Ayrı dosyada: Node'da gerçek ONNX Runtime ve testte üretilen küçük bir modelle test edilir.
 */

/** Ayar dosyasının (`.onnx.json`) sentezde kullanılan alanları */
export interface VoiceConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  num_speakers: number;
  phoneme_id_map: Record<string, number[]>;
}

/** Metnin ses birimleri → modelin kimlikleri: ^ _ (birim _)* $ (Piper'ın `phonemes_to_ids`'i) */
export function phonemeIds(phonemes: string[], map: Record<string, number[]>): number[] {
  const pad = map._?.[0] ?? 0;
  const ids = [...(map['^'] ?? [1]), pad];
  for (const p of phonemes) {
    const id = map[p];
    if (!id) continue; // modelde olmayan birim atlanır
    ids.push(...id, pad);
  }
  ids.push(...(map.$ ?? [2]));
  return ids;
}

/** Piper modelinin girdileri: çok konuşmacılı seste konuşmacı (`sid`) da */
export function requiredInputs(config: Pick<VoiceConfig, 'num_speakers'>): string[] {
  return ['input', 'input_lengths', 'scales', ...(config.num_speakers > 1 ? ['sid'] : [])];
}

/** Modelde olmayan girdiler (Piper sesi değilse ya da ayar dosyası başka modelinse) */
export function missingInputs(
  inputNames: readonly string[],
  config: Pick<VoiceConfig, 'num_speakers'>,
): string[] {
  return requiredInputs(config).filter((name) => !inputNames.includes(name));
}

/**
 * Kimliklerden ses: `length_scale` sesin kendi değeriyle çarpılır (hız). Çok konuşmacılı seste ilk konuşmacı.
 * Çıktı tek kanal, [-1, 1] örnekler.
 */
export async function runVoice(
  session: ort.InferenceSession,
  config: VoiceConfig,
  ids: number[],
  lengthScale: number,
): Promise<Float32Array> {
  const { noise_scale, length_scale, noise_w } = config.inference;
  const feeds: Record<string, ort.Tensor> = {
    input: new ort.Tensor(
      'int64',
      BigInt64Array.from(ids, (x) => BigInt(x)),
      [1, ids.length],
    ),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor(
      'float32',
      Float32Array.from([noise_scale, length_scale * lengthScale, noise_w]),
      [3],
    ),
  };
  if (config.num_speakers > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
  const result = await session.run(feeds);
  const output = result[session.outputNames[0]];
  const pcm = new Float32Array(output.data as Float32Array);
  output.dispose?.();
  return pcm;
}

/** Denemenin sonucu: ses var ve sayılardan oluşuyor (NaN ya da sonsuz değil) */
export function soundOk(pcm: Float32Array): boolean {
  if (pcm.length === 0) return false;
  for (let i = 0; i < pcm.length; i++) if (!Number.isFinite(pcm[i])) return false;
  return true;
}
