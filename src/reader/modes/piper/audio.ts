import type { Clip } from './synth';

/** Sentezlenen sesin çalındığı yer (tarayıcıda Web Audio; testlerde sahte) */
export interface AudioOut {
  /** kullanıcının dokunuşunda: ses bağlamını açar (iOS dokunuş dışında açmaz) */
  prime(): void;
  /** sesi çalar: sesli başlayınca `onStart`, bitince `onEnd`; durdurma işlevi döner (durdurulunca olay gelmez) */
  play(clip: Clip, onStart: () => void, onEnd: () => void): () => void;
  /** ses bağlamı çalışıyor (sistem askıya almadıysa: iOS arka plan, telefon) */
  running(): boolean;
  dispose(): void;
}

type AudioContextClass = typeof AudioContext;

export function audioSupported(): boolean {
  return (
    typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window)
  );
}

/**
 * Web Audio ile çalma. Bağlam ilk dokunuşta kurulur ve açılır (`prime`); iOS'ta sessiz, kısa bir sesle kilidi
 * açılır. Safari 16.4+'ta ses oturumu "playback" yapılır: sessiz düğmesi açıkken de ses çıkar.
 */
export function createWebAudioOut(): AudioOut {
  let ctx: AudioContext | null = null;

  const context = (): AudioContext => {
    if (ctx) return ctx;
    const w = window as unknown as {
      AudioContext?: AudioContextClass;
      webkitAudioContext?: AudioContextClass;
    };
    const Ctor = (w.AudioContext ?? w.webkitAudioContext)!;
    ctx = new Ctor();
    try {
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = 'playback';
    } catch {
      // desteklenmiyor
    }
    return ctx;
  };

  const resume = (c: AudioContext) => {
    if (c.state !== 'running') void c.resume().catch(() => undefined);
  };

  return {
    prime() {
      try {
        const c = context();
        resume(c);
        // iOS: dokunuşta çalınan sessiz ses bağlamın kilidini açar
        const src = c.createBufferSource();
        src.buffer = c.createBuffer(1, 1, 22_050);
        src.connect(c.destination);
        src.start(0);
      } catch {
        // Web Audio yok: çalarken hata bildirilir
      }
    },

    play(clip, onStart, onEnd) {
      const c = context();
      resume(c);
      const buffer = c.createBuffer(1, Math.max(1, clip.pcm.length), clip.sampleRate);
      buffer.getChannelData(0).set(clip.pcm);
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.connect(c.destination);
      let stopped = false;
      let started = false;
      const begin = () => {
        if (stopped || started || c.state !== 'running') return;
        started = true;
        c.removeEventListener('statechange', begin);
        onStart();
      };
      src.onended = () => {
        c.removeEventListener('statechange', begin);
        if (!stopped) onEnd();
      };
      src.start();
      // Bağlam askıdaysa ses açılınca başlar (başlangıç o zaman bildirilir)
      if (c.state === 'running') queueMicrotask(begin);
      else c.addEventListener('statechange', begin);
      return () => {
        stopped = true;
        c.removeEventListener('statechange', begin);
        src.onended = null;
        try {
          src.stop();
        } catch {
          // zaten bitti
        }
        src.disconnect();
      };
    },

    running: () => ctx?.state === 'running',

    dispose() {
      void ctx?.close().catch(() => undefined);
      ctx = null;
    },
  };
}
