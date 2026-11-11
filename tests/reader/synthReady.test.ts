import { describe, expect, it } from 'vitest';
import { afterReady, type Clip, type PiperSynth } from '../../src/reader/modes/piper/synth';
import type { PiperVoice } from '../../src/reader/modes/piper/voices';

/**
 * Güncellemeden sonraki ilk açılışta ses motoru eski anahtardan yeni anahtara taşınır (manager.ensure): taşıma
 * bitmeden sentez başlarsa worker motoru bulamazdı. Sentezleyici ilk istekte bir kez hazırlığı bekler (Plan 13).
 */

const voice = { id: 'piper:x' } as PiperVoice;
const clip: Clip = { pcm: new Float32Array(1), sampleRate: 22_050 };

function fakeSynth(log: string[]): PiperSynth {
  return {
    synthesize: async ({ text }) => {
      log.push(`sentez:${text}`);
      return clip;
    },
    check: async (_v, text) => {
      log.push(`deneme:${text}`);
    },
    dispose: () => log.push('bırak'),
  };
}

describe('afterReady', () => {
  it('ilk sentez hazırlık bitince başlar; hazırlık bir kez çağrılır', async () => {
    const log: string[] = [];
    let calls = 0;
    let done!: () => void;
    const synth = afterReady(fakeSynth(log), () => {
      calls++;
      log.push('hazırlık');
      return new Promise<void>((r) => {
        done = () => {
          log.push('hazır');
          r();
        };
      });
    });
    const a = synth.synthesize({ voice, text: 'bir', lengthScale: 1 });
    const b = synth.check(voice, 'iki');
    await Promise.resolve();
    expect(log).toEqual(['hazırlık']);
    done();
    await Promise.all([a, b]);
    await synth.synthesize({ voice, text: 'üç', lengthScale: 1 });
    expect(log).toEqual(['hazırlık', 'hazır', 'sentez:bir', 'deneme:iki', 'sentez:üç']);
    expect(calls).toBe(1);
  });

  it('hazırlık başarısız olsa da sentez sürer (motor yoksa worker kendi hatasını verir)', async () => {
    const log: string[] = [];
    const synth = afterReady(fakeSynth(log), () => Promise.reject(new Error('okunamadı')));
    await expect(synth.synthesize({ voice, text: 'bir', lengthScale: 1 })).resolves.toBe(clip);
    synth.dispose();
    expect(log).toEqual(['sentez:bir', 'bırak']);
  });
});
