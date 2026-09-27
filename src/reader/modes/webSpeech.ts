import type { SpeechEngine, VoiceInfo } from './readAloud';

/** Tarayıcının konuşma motoru (Web Speech API) ve sesleri */
export interface WebSpeech extends SpeechEngine {
  voices(): VoiceInfo[];
  /** ses listesi değişince (Chrome sesleri sonradan yükler); aboneliği bırakan işlev döner */
  onVoices(listener: () => void): () => void;
  /**
   * iOS konuşmayı yalnızca kullanıcının dokunuşunda başlatır: okuma eşzamansız başlayacaksa (sayfanın ilk cümlesi
   * aranıyor) dokunuşta sessiz, boş bir konuşmayla motor açılır.
   */
  prime(): void;
}

export function speechSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance === 'function'
  );
}

/** Tarayıcıda konuşma yoksa null */
export function createWebSpeech(): WebSpeech | null {
  if (!speechSupported()) return null;
  const synth = window.speechSynthesis;
  // Süren konuşma: Chrome olayları gelmeden konuşma nesnesini bırakırsa `end` hiç gelmez
  let current: SpeechSynthesisUtterance | null = null;
  const rawVoices = () => synth.getVoices();

  return {
    speak(req, handlers) {
      const u = new SpeechSynthesisUtterance(req.text);
      u.lang = req.lang;
      u.rate = req.rate;
      const voice = req.voice ? rawVoices().find((v) => v.voiceURI === req.voice) : undefined;
      if (voice) u.voice = voice;
      u.onstart = () => handlers.start();
      u.onend = () => {
        if (current === u) current = null;
        handlers.end();
      };
      u.onerror = (e) => {
        if (current === u) current = null;
        handlers.error(e.error);
      };
      current = u;
      // Başka bir yerde duraklatılmış motor sıradaki konuşmayı da bekletir
      if (synth.paused) synth.resume();
      synth.speak(u);
    },

    cancel() {
      current = null;
      synth.cancel();
    },

    busy() {
      const busy = synth.speaking || synth.pending;
      // Sistem duraklattıysa (iOS, kesintiden sonra) konuşma bitmedi, beklemede: sürdürülür
      if (busy && synth.paused) synth.resume();
      return busy;
    },

    voices() {
      return rawVoices().map((v) => ({
        id: v.voiceURI,
        name: v.name,
        lang: v.lang,
        isDefault: v.default,
        local: v.localService,
      }));
    },

    onVoices(listener) {
      synth.addEventListener('voiceschanged', listener);
      return () => synth.removeEventListener('voiceschanged', listener);
    },

    prime() {
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0;
      synth.speak(u);
    },
  };
}
