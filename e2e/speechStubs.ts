import type { Page } from '@playwright/test';

/**
 * Sistem sesinin (Web Speech) e2e sahtesi: read-aloud.spec.ts ve tap-read.spec.ts. Konuşmalar kaydedilir ve
 * kendiliğinden bitmez; okunan cümlenin metin görünümündeki vurgusu okunur.
 */

/** Sahte konuşma motorunun kaydı: okunan her cümle */
export interface Spoken {
  text: string;
  lang: string;
  rate: number;
  voice: string | null;
}

/** Sahte ses listesindeki bir ses (SpeechSynthesisVoice alanları) */
export interface FakeVoice {
  voiceURI: string;
  name: string;
  lang: string;
  default: boolean;
  localService: boolean;
}

/** Varsayılan sahte sesler: iki Türkçe (gelişmiş değil), bir İngilizce (varsayılan) */
export const VOICES: FakeVoice[] = [
  { voiceURI: 'tr-yelda', name: 'Yelda', lang: 'tr-TR', default: false, localService: true },
  { voiceURI: 'tr-emel', name: 'Emel', lang: 'tr-TR', default: false, localService: true },
  { voiceURI: 'en-sam', name: 'Samantha', lang: 'en-US', default: true, localService: true },
];

/**
 * Tarayıcının sesi yerine sahte konuşma motoru (`window.speechSynthesis`): konuşmalar kaydedilir ve kendiliğinden
 * bitmez; `__speech.end()` süren konuşmayı bitirir (okuma bir cümle ilerler). Kesilen konuşma, tarayıcılardaki gibi
 * sonradan "interrupted" hatası verir.
 */
export async function stubSpeech(page: Page, voiceList: FakeVoice[] = VOICES) {
  await page.addInitScript((voices: FakeVoice[]) => {
    interface FakeUtterance {
      text: string;
      lang: string;
      rate: number;
      volume: number;
      voice: { voiceURI: string } | null;
      onstart: (() => void) | null;
      onend: (() => void) | null;
      onerror: ((e: { error: string }) => void) | null;
    }
    let current: FakeUtterance | null = null;
    const speech = {
      log: [] as { text: string; lang: string; rate: number; voice: string | null }[],
      end() {
        const cur = current;
        current = null;
        cur?.onend?.();
      },
    };
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
    const synth = Object.assign(new EventTarget(), {
      speaking: false,
      pending: false,
      paused: false,
      getVoices: () => voices,
      speak(u: FakeUtterance) {
        // iOS için motoru açan boş konuşma kaydedilmez
        if (!u.text) {
          setTimeout(() => u.onend?.(), 0);
          return;
        }
        speech.log.push({
          text: u.text,
          lang: u.lang,
          rate: u.rate,
          voice: u.voice?.voiceURI ?? null,
        });
        current = u;
        setTimeout(() => {
          if (current === u) u.onstart?.();
        }, 0);
      },
      cancel() {
        const cur = current;
        current = null;
        if (cur) setTimeout(() => cur.onerror?.({ error: 'interrupted' }), 0);
      },
      pause() {},
      resume() {},
    });
    // Konuşma bitene dek konuşuyor (bekçi motoru bununla yoklar)
    Object.defineProperty(synth, 'speaking', { get: () => current !== null });
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: Utterance,
      configurable: true,
      writable: true,
    });
    (window as unknown as { __speech: typeof speech }).__speech = speech;
  }, voiceList);
}

export const spoken = (page: Page) =>
  page.evaluate(() => (window as unknown as { __speech: { log: Spoken[] } }).__speech.log);

/** Süren konuşmayı bitirir: okuma bir cümle ilerler */
export const endSentence = (page: Page) =>
  page.evaluate(() => (window as unknown as { __speech: { end(): void } }).__speech.end());

/** Okunan cümlenin metin görünümündeki vurgusu (CSS Custom Highlight API) */
export const highlighted = (page: Page) =>
  page.evaluate(() => {
    const h = CSS.highlights.get('mypdfbook-active');
    return h ? [...h].map((r) => r.toString()).join(' ') : null;
  });

/** Karşılaştırma için metin: yumuşak tire atılır, boşluklar teke iner */
export const plain = (s: string) => s.replace(/­/g, '').replace(/\s+/g, ' ').trim();
