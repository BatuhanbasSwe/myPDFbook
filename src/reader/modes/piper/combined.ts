import type { SpeechEngine, VoiceInfo } from '../readAloud';
import type { WebSpeech } from '../webSpeech';
import type { PiperEngine } from './piperEngine';
import { isPiperVoice } from './voices';

/** Okuyucunun konuşma motoru: tarayıcının sesleri ve yapay zekâ sesleri birlikte */
export interface ReaderSpeech extends SpeechEngine {
  /** tarayıcının sesleri */
  voices(): VoiceInfo[];
  onVoices(listener: () => void): () => void;
  /** kullanıcının dokunuşunda: seçili sesin motorunu açar (iOS) */
  prime(voice: string | null): void;
  /** yapay zekâ sesinin belleğini bırakır (model, worker, ses bağlamı); gerekince yeniden kurulur */
  release(): void;
  /** yapay zekâ sesi okunacak sesi hazırlıyor (ilk cümlede model yüklenir) */
  onPreparing(listener: ((preparing: boolean) => void) | null): void;
  dispose(): void;
}

/**
 * İki motoru tek motor gibi gösterir: konuşma, sesine göre ("piper:" ile başlıyorsa) Piper'a, değilse tarayıcıya
 * gider. İptal ikisine de gider; `busy` ve önceden hazırlama son konuşan motorundur.
 */
export function combineSpeech(
  web: WebSpeech | null,
  piper: PiperEngine | null,
): ReaderSpeech | null {
  if (!web && !piper) return null;
  let active: SpeechEngine | null = null;
  const route = (voice: string | null): SpeechEngine | null =>
    isPiperVoice(voice) ? piper : (web ?? null);

  return {
    speak(req, handlers) {
      const engine = route(req.voice);
      if (active && active !== engine) active.cancel();
      active = engine;
      if (!engine) {
        queueMicrotask(() => handlers.error('synthesis-failed'));
        return;
      }
      engine.speak(req, handlers);
    },
    cancel() {
      web?.cancel();
      piper?.cancel();
    },
    busy() {
      return active?.busy?.() ?? false;
    },
    get lookahead() {
      return active === piper ? (piper?.lookahead ?? 0) : 0;
    },
    prefetch(next) {
      piper?.prefetch?.(next.filter((r) => isPiperVoice(r.voice)));
    },
    voices: () => web?.voices() ?? [],
    onVoices: (listener) => web?.onVoices(listener) ?? (() => undefined),
    prime(voice) {
      if (isPiperVoice(voice)) piper?.prime();
      else web?.prime();
    },
    release() {
      piper?.dispose();
    },
    onPreparing(listener) {
      piper?.onPreparing(listener);
    },
    dispose() {
      web?.cancel();
      piper?.dispose();
    },
  };
}
