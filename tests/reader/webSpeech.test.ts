import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpeakHandlers } from '../../src/reader/modes/readAloud';
import { createWebSpeech, speechSupported } from '../../src/reader/modes/webSpeech';

/** Sahte SpeechSynthesisUtterance: alanlar ve olay işleyicileri */
class Utterance {
  text: string;
  lang = '';
  rate = 1;
  volume = 1;
  voice: { voiceURI: string } | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  constructor(text = '') {
    this.text = text;
  }
}

/** Sahte speechSynthesis: konuşmalar kaydedilir, durum alanları elle ayarlanır */
function mockSynth() {
  const voices = [
    { voiceURI: 'tr-yelda', name: 'Yelda', lang: 'tr-TR', default: false, localService: true },
    { voiceURI: 'en-sam', name: 'Samantha', lang: 'en-US', default: true, localService: false },
  ];
  const synth = Object.assign(new EventTarget(), {
    speaking: false,
    pending: false,
    paused: false,
    spoken: [] as Utterance[],
    cancels: 0,
    resumes: 0,
    getVoices: () => voices,
    speak(u: Utterance) {
      synth.spoken.push(u);
    },
    cancel() {
      synth.cancels++;
    },
    resume() {
      synth.resumes++;
      synth.paused = false;
    },
  });
  vi.stubGlobal('window', { speechSynthesis: synth });
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  return synth;
}

const handlers = (): SpeakHandlers & { log: string[] } => {
  const log: string[] = [];
  return {
    log,
    start: () => log.push('start'),
    end: () => log.push('end'),
    error: (code) => log.push(`error:${code}`),
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createWebSpeech', () => {
  it('tarayıcıda konuşma yoksa null', () => {
    expect(speechSupported()).toBe(false);
    expect(createWebSpeech()).toBeNull();
  });

  it('konuşmayı dil, hız ve sesle başlatır; olayları iletir', () => {
    const synth = mockSynth();
    const speech = createWebSpeech()!;
    const h = handlers();
    speech.speak({ text: 'Merhaba.', lang: 'tr-TR', rate: 1.5, voice: 'tr-yelda' }, h);
    const u = synth.spoken[0];
    expect(u).toMatchObject({ text: 'Merhaba.', lang: 'tr-TR', rate: 1.5 });
    expect(u.voice?.voiceURI).toBe('tr-yelda');
    u.onstart?.();
    u.onend?.();
    u.onerror?.({ error: 'interrupted' });
    expect(h.log).toEqual(['start', 'end', 'error:interrupted']);

    // bilinmeyen ses: yalnızca dil
    speech.speak({ text: 'Bir.', lang: 'tr-TR', rate: 1, voice: 'yok' }, handlers());
    expect(synth.spoken[1].voice).toBeNull();
  });

  it('duraklatılmış motoru konuşmadan önce sürdürür; iptal eder', () => {
    const synth = mockSynth();
    const speech = createWebSpeech()!;
    synth.paused = true;
    speech.speak({ text: 'Bir.', lang: 'tr-TR', rate: 1, voice: null }, handlers());
    expect(synth.resumes).toBe(1);
    speech.cancel();
    expect(synth.cancels).toBe(1);
  });

  it('busy: konuşuyor ya da sırada konuşma var; sistem duraklattıysa sürdürür', () => {
    const synth = mockSynth();
    const speech = createWebSpeech()!;
    expect(speech.busy?.()).toBe(false);
    synth.pending = true;
    expect(speech.busy?.()).toBe(true);
    synth.pending = false;
    synth.speaking = true;
    synth.paused = true;
    expect(speech.busy?.()).toBe(true);
    expect(synth.resumes).toBe(1);
    expect(synth.paused).toBe(false);
  });

  it('sesleri özetler; ses listesi değişince haber verir', () => {
    const synth = mockSynth();
    const speech = createWebSpeech()!;
    expect(speech.voices()).toEqual([
      { id: 'tr-yelda', name: 'Yelda', lang: 'tr-TR', isDefault: false, local: true },
      { id: 'en-sam', name: 'Samantha', lang: 'en-US', isDefault: true, local: false },
    ]);
    const listener = vi.fn();
    const off = speech.onVoices(listener);
    synth.dispatchEvent(new Event('voiceschanged'));
    off();
    synth.dispatchEvent(new Event('voiceschanged'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('prime: sessiz, boş bir konuşmayla motoru açar (iOS)', () => {
    const synth = mockSynth();
    createWebSpeech()!.prime();
    expect(synth.spoken[0]).toMatchObject({ text: '', volume: 0 });
  });
});
