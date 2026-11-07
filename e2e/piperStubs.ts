import type { Page, Route } from '@playwright/test';

/**
 * Yapay zekâ sesinin (Piper) e2e ortamı: piper.spec.ts ve custom-voice.spec.ts. Sentezleyici ve dosyalar sahtedir;
 * gerçek worker ve ONNX Runtime tests/browser/piperCheck.test.ts'te denenir.
 */

/** Yapay zekâ sesinin dosyaları: Hugging Face (model), jsDelivr (fonemleyici), uygulamanın ONNX Runtime WASM'ı */
export const PIPER_FILES = /huggingface\.co|cdn\.jsdelivr\.net|ort-wasm-simd-threaded[^/?]*\.wasm$/;
export const MODEL = /tr_TR-dfki-medium\.onnx$/;

export interface SynthLog {
  text: string;
  lengthScale: number;
  voice: string;
}

/**
 * Sahte ortam: tarayıcının iki Türkçe sesi (sahte speechSynthesis, konuşmalar kendiliğinden bitmez) ve Piper'ın
 * sentezleyicisi yerine sahte sentezleyici (uygulamanın test kancası `__mypdfbookPiper`): her konuşma 30 ms'de
 * 0,5 sn'lik sessizlik olur, gerçek Web Audio ile çalınır. İndirilen dosyalar sahte olduğu için SHA-256 denetimi
 * kapalı.
 */
export async function stubVoices(page: Page) {
  await page.addInitScript(() => {
    // Playwright'ın Windows'taki WebKit'inde Web Audio yok (gerçek Safari'de var): süreyi zamanlayıcıyla sayan
    // en küçük sahte AudioContext
    if (!('AudioContext' in window)) {
      class FakeAudioContext extends EventTarget {
        state = 'suspended';
        destination = {};
        resume() {
          this.state = 'running';
          this.dispatchEvent(new Event('statechange'));
          return Promise.resolve();
        }
        close() {
          return Promise.resolve();
        }
        createBuffer(_channels: number, length: number, rate: number) {
          const data = new Float32Array(length);
          return { duration: length / rate, getChannelData: () => data };
        }
        createBufferSource() {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const src = {
            buffer: null as { duration: number } | null,
            onended: null as (() => void) | null,
            connect() {},
            disconnect() {},
            start() {
              timer = setTimeout(() => src.onended?.(), (src.buffer?.duration ?? 0) * 1000);
            },
            stop() {
              clearTimeout(timer);
            },
          };
          return src;
        }
      }
      Object.defineProperty(window, 'AudioContext', {
        value: FakeAudioContext,
        configurable: true,
      });
    }
    const voices = [
      { voiceURI: 'tr-yelda', name: 'Yelda', lang: 'tr-TR', default: false, localService: true },
      { voiceURI: 'tr-emel', name: 'Emel', lang: 'tr-TR', default: false, localService: true },
    ];
    const system: string[] = [];
    const synth = Object.assign(new EventTarget(), {
      speaking: false,
      pending: false,
      paused: false,
      getVoices: () => voices,
      speak(u: { text: string; onstart: (() => void) | null }) {
        if (!u.text) return;
        system.push(u.text);
        setTimeout(() => u.onstart?.(), 0);
      },
      cancel() {},
      pause() {},
      resume() {},
    });
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: class {
        text: string;
        lang = '';
        rate = 1;
        volume = 1;
        voice = null;
        onstart = null;
        onend = null;
        onerror = null;
        constructor(text = '') {
          this.text = text;
        }
      },
      configurable: true,
      writable: true,
    });
    const log: SynthLog[] = [];
    const checks: { voice: string; text: string; model: string }[] = [];
    (window as unknown as Record<string, unknown>).__piperLog = log;
    (window as unknown as Record<string, unknown>).__piperChecks = checks;
    (window as unknown as Record<string, unknown>).__systemLog = system;
    (window as unknown as Record<string, unknown>).__mypdfbookPiper = {
      verify: false,
      synth: {
        /**
         * Kendi sesinin denenmesi: model önbellekten okunur; "bozuk" diye başlıyorsa model açılamamış gibi
         * reddedilir (gerçek denemenin kodu: 'model'). 50 ms sürer.
         */
        async check(voice: { id: string; model: { url: string } }, text: string) {
          const res = await (await caches.open('mypdfbook-piper-v1')).match(voice.model.url);
          const model = res ? await res.text() : '';
          checks.push({ voice: voice.id, text, model: model.slice(0, 40) });
          await new Promise((r) => setTimeout(r, 50));
          if (!res || model.includes('bozuk'))
            throw Object.assign(new Error('protobuf parsing failed'), { code: 'model' });
        },
        synthesize(req: { voice: { id: string }; text: string; lengthScale: number }) {
          log.push({ text: req.text, lengthScale: req.lengthScale, voice: req.voice.id });
          return new Promise((resolve) =>
            setTimeout(
              () => resolve({ pcm: new Float32Array(22_050 / 2), sampleRate: 22_050 }),
              30,
            ),
          );
        },
        dispose() {},
      },
    };
  });
}

/** Piper dosyalarını küçük sahte içerikle sunar; model isteği `hold` çözülene dek bekletilebilir */
export async function servePiper(page: Page, hold?: Promise<void>) {
  const requests: string[] = [];
  await page.route(PIPER_FILES, async (route: Route) => {
    const url = route.request().url();
    requests.push(url);
    if (hold && MODEL.test(url)) await hold;
    await route
      .fulfill({
        body: 'sahte',
        headers: { 'access-control-allow-origin': '*', 'content-type': 'application/octet-stream' },
      })
      .catch(() => undefined); // indirme iptal edildi
  });
  return requests;
}

export const piperLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __piperLog: SynthLog[] }).__piperLog);
