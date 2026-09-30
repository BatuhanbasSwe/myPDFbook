import { useSyncExternalStore } from 'react';
import { audioSupported } from './audio';
import { cacheSupported, download, hasAll, missing, prune, removeAssets } from './store';
import type { PiperSynth } from './synth';
import { PIPER_VOICES, piperVoice, runtimeAssets, voiceAssets, type PiperAsset } from './voices';

/**
 * Yapay zekâ seslerinin kurulum durumu (uygulama genelinde tek): cihazda mı, indiriliyor mu, ne kadar indirilecek.
 * İndirme okuyucu kapansa da sürer; sonraki açılışta durum yeniden okunur.
 */

export type InstallStatus = 'unknown' | 'absent' | 'downloading' | 'ready' | 'error';

export interface InstallState {
  status: InstallStatus;
  /** indirilen ve indirilecek bayt (indirme sürerken) */
  loaded: number;
  total: number;
  /** cihazda olmayan dosyaların toplam boyutu (ilk seste çalışma zamanı dosyaları da) */
  need: number;
}

/**
 * Testler için kanca (yalnızca testler tanımlar): sahte sentezleyici ve sahte dosyalar için SHA-256 denetimini
 * kapatma. Üretimde tanımsızdır.
 */
export interface PiperTestHooks {
  synth?: PiperSynth;
  verify?: boolean;
}

export function piperTestHooks(): PiperTestHooks | undefined {
  return typeof window === 'undefined'
    ? undefined
    : (window as unknown as { __mypdfbookPiper?: PiperTestHooks }).__mypdfbookPiper;
}

/** WebAssembly SIMD (Safari 16.4+): ONNX Runtime Web'in WASM'ı bunu ister */
function simdSupported(): boolean {
  try {
    return WebAssembly.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0,
        253, 15, 253, 98, 11,
      ]),
    );
  } catch {
    return false;
  }
}

/** Tarayıcı yapay zekâ sesini çalıştırabilir mi: WASM SIMD, Worker, Web Audio, Cache Storage, BigInt64Array */
export function piperSupported(): boolean {
  return (
    typeof WebAssembly === 'object' &&
    typeof Worker === 'function' &&
    typeof BigInt64Array === 'function' &&
    audioSupported() &&
    cacheSupported() &&
    simdSupported()
  );
}

const sum = (assets: PiperAsset[]) => assets.reduce((s, a) => s + a.bytes, 0);
const allAssets = (id: string) => {
  const v = piperVoice(id);
  return v ? [...runtimeAssets(), ...voiceAssets(v)] : [];
};

type Listener = () => void;

function createManager() {
  let states: Record<string, InstallState> = Object.fromEntries(
    PIPER_VOICES.map((v) => [
      v.id,
      { status: 'unknown', loaded: 0, total: 0, need: sum(allAssets(v.id)) } as InstallState,
    ]),
  );
  const listeners = new Set<Listener>();
  const removedListeners = new Set<(id: string) => void>();
  const aborts = new Map<string, AbortController>();
  let refreshed: Promise<void> | null = null;

  const set = (id: string, patch: Partial<InstallState>) => {
    states = { ...states, [id]: { ...states[id], ...patch } };
    listeners.forEach((l) => l());
  };

  /** Cihazdaki dosyalara göre durumlar (indirme sürenler dışında) */
  const refresh = async () => {
    if (!cacheSupported()) return;
    for (const v of PIPER_VOICES) {
      if (states[v.id].status === 'downloading') continue;
      const need = sum(await missing(allAssets(v.id)));
      set(v.id, { status: need === 0 ? 'ready' : 'absent', need, loaded: 0, total: 0 });
    }
  };

  return {
    get: () => states,
    subscribe(l: Listener) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    /** bir ses kaldırılınca (okuyucu modeli bellekten atar, başka sese geçer) */
    onRemoved(l: (id: string) => void) {
      removedListeners.add(l);
      return () => {
        removedListeners.delete(l);
      };
    },
    /** ilk çağrıda durumları okur ve eski sürümlerin dosyalarını siler */
    ensure(): Promise<void> {
      refreshed ??= (async () => {
        if (!cacheSupported()) return;
        await prune(PIPER_VOICES.flatMap((v) => allAssets(v.id)).map((a) => a.url)).catch(
          () => undefined,
        );
        await refresh();
      })().catch(() => undefined);
      return refreshed;
    },
    /** sesi indirir; bitince true (iptal ya da hata: false) */
    async install(id: string): Promise<boolean> {
      if (states[id]?.status === 'downloading') return false;
      const controller = new AbortController();
      aborts.set(id, controller);
      set(id, { status: 'downloading', loaded: 0, total: states[id].need });
      try {
        await download(allAssets(id), {
          signal: controller.signal,
          verify: piperTestHooks()?.verify ?? true,
          onProgress: (loaded, total) => set(id, { loaded, total }),
        });
        set(id, { status: 'ready', need: 0 });
        // Aynı çalışma zamanını kullanan öbür seslerin indirilecek boyutu küçüldü
        aborts.delete(id);
        await refresh();
        return true;
      } catch (err) {
        aborts.delete(id);
        const aborted = controller.signal.aborted;
        set(id, { status: aborted ? 'absent' : 'error', loaded: 0, total: 0 });
        if (!aborted) console.warn('Yapay zekâ sesi indirilemedi', err);
        await refresh().catch(() => undefined);
        if (!aborted) set(id, { status: 'error' });
        return false;
      }
    },
    cancel(id: string) {
      aborts.get(id)?.abort();
    },
    /** sesin modelini siler; başka kurulu ses kalmadıysa çalışma zamanı dosyalarını da */
    async remove(id: string) {
      const v = piperVoice(id);
      if (!v) return;
      removedListeners.forEach((l) => l(id));
      await removeAssets(voiceAssets(v).map((a) => a.url));
      const others = PIPER_VOICES.filter((o) => o.id !== id);
      let othersReady = false;
      for (const o of others) if (await hasAll(allAssets(o.id))) othersReady = true;
      if (!othersReady) await removeAssets(runtimeAssets().map((a) => a.url));
      await refresh();
    },
  };
}

export const piperManager = createManager();

export function usePiperStates(): Record<string, InstallState> {
  return useSyncExternalStore(piperManager.subscribe, piperManager.get, piperManager.get);
}
