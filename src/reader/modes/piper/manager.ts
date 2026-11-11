import { useSyncExternalStore } from 'react';
import { audioSupported } from './audio';
import {
  customPiperVoice,
  isCustomUrl,
  listCustomVoices,
  migrateCustom,
  newCustomId,
  pruneCustom,
  removeCustomFiles,
  saveCustomFiles,
  writeCustomMeta,
  type CustomVoiceMeta,
} from './customStore';
import { checkSentence, CustomVoiceError, isQuotaError, type PreparedVoice } from './customVoice';
import {
  adoptRenamed,
  cacheSupported,
  download,
  hasAll,
  missing,
  prune,
  removeAssets,
} from './store';
import type { CheckError, PiperSynth } from './synth';
import {
  allPiperVoices,
  formatMb,
  LEGACY_ORT_WASM,
  PIPER_RUNTIME,
  PIPER_VOICES,
  piperVoice,
  runtimeAssets,
  setCustomVoices,
  voiceAssets,
  type PiperAsset,
  type PiperVoice,
} from './voices';

/**
 * Yapay zekâ seslerinin kurulum durumu (uygulama genelinde tek): cihazda mı, indiriliyor mu, ne kadar indirilecek.
 * İndirme okuyucu kapansa da sürer; sonraki açılışta durum yeniden okunur.
 *
 * Kendi sesleri (plan 12) de burada: cihazdaki kayıtlarından okunur, katalog sesleriyle aynı durumu taşır (ses
 * motoru yoksa "absent": motor indirilince hazır olur). Ekleme, ad değiştirme ve kaldırma buradan yapılır.
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

/** Vazgeçildiyse durur (AbortSignal.throwIfAborted eski Safari'de yok) */
function stopIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Vazgeçildi', 'AbortError');
}
/**
 * Sesin indirilecek dosyaları (katalog önbelleğinde): ses motoru ve sesin dosyaları. Kendi sesinin dosyaları kendi
 * önbelleğindedir ve indirilmez: yalnızca ses motoru.
 */
const allAssets = (id: string) => {
  const v = piperVoice(id);
  if (!v) return [];
  return v.custom ? runtimeAssets() : [...runtimeAssets(), ...voiceAssets(v)];
};

/** Kendi sesinin eklenmesinde süren adım */
export type ImportPhase =
  /** ses motoru (ONNX Runtime, fonemleyici) indiriliyor: ilk yapay zekâ sesinde bir kez */
  | { kind: 'runtime'; loaded: number; total: number }
  /** dosyalar cihaza yazılıyor */
  | { kind: 'save' }
  /** ses deneniyor (model yüklenir, kısa bir cümle sentezlenir) */
  | { kind: 'check' };

export interface ImportOptions {
  signal: AbortSignal;
  onPhase(phase: ImportPhase): void;
  /** sesi worker'da dener (okuyucunun sentezleyicisi: model bellekte kalır, seçilince hemen okur) */
  check(voice: PiperVoice, text: string): Promise<void>;
}

/** Denemenin olmayan adımı → Türkçe ileti */
function checkMessage(e: CheckError, voice: PreparedVoice): string {
  switch (e.code) {
    case 'runtime':
      return 'Ses motoru açılamadı. Uygulamayı yenileyip yeniden dene.';
    case 'model':
      return 'Model açılamadı: dosya bozuk ya da bir ONNX modeli değil.';
    case 'inputs':
      return 'Bu model bir Piper sesi değil: girdileri uymuyor.';
    case 'language':
      return `Fonemleyici bu sesin dilini tanımıyor (espeak: ${voice.info.espeakVoice}).`;
    case 'inference':
      return 'Model denenirken ses üretmedi: ayar dosyası bu modelin olmayabilir.';
    default:
      return `Ses denenemedi: ${e.message}`;
  }
}

/** Eklemenin hatası → kullanıcıya gösterilecek hata */
function importError(
  e: unknown,
  phase: ImportPhase['kind'],
  signal: AbortSignal,
  voice: PreparedVoice,
  runtimeBytes: number,
): CustomVoiceError {
  // Okuyucu kapandı (worker bırakıldı) ya da kullanıcı vazgeçti
  const canceled = e instanceof Error && e.message === 'canceled' && !(e as CheckError).code;
  if (signal.aborted || canceled)
    return new CustomVoiceError('Vazgeçildi: ses eklenmedi.', { cause: e, cancelled: true });
  if (isQuotaError(e)) {
    const need = voice.modelBytes + (phase === 'runtime' ? runtimeBytes : 0);
    return new CustomVoiceError(
      `Cihazda yer kalmadı: ses kaydedilemedi (${formatMb(need)} gerekiyor). Kullanmadığın sesleri ya da kitapları kaldırıp yeniden dene.`,
      { cause: e },
    );
  }
  if (phase === 'runtime')
    return new CustomVoiceError(
      `Ses motoru indirilemedi. İnternete bağlanıp yeniden dene: ilk yapay zekâ sesinde bir kez ${formatMb(runtimeBytes)} indirilir.`,
      { cause: e },
    );
  if (phase === 'check')
    return new CustomVoiceError(checkMessage(e as CheckError, voice), { cause: e });
  return new CustomVoiceError(`Ses kaydedilemedi: ${e instanceof Error ? e.message : String(e)}`, {
    cause: e,
  });
}

/** Tarayıcıdan verileri silmemesini ister (kendi sesi yeniden indirilemez) */
function askPersist() {
  if (typeof navigator === 'undefined') return;
  void navigator.storage
    ?.persisted?.()
    .then((granted) => granted || navigator.storage.persist())
    .catch(() => undefined);
}

type Listener = () => void;

function createManager() {
  let states: Record<string, InstallState> = Object.fromEntries(
    PIPER_VOICES.map((v) => [
      v.id,
      { status: 'unknown', loaded: 0, total: 0, need: sum(allAssets(v.id)) } as InstallState,
    ]),
  );
  /** cihazdaki kendi seslerinin kayıtları (eklenme sırasıyla) */
  let metas: CustomVoiceMeta[] = [];
  const listeners = new Set<Listener>();
  const removedListeners = new Set<(id: string) => void>();
  const aborts = new Map<string, AbortController>();
  /** eklenmekte olan kendi sesleri: artık temizliği dokunmaz */
  const importing = new Set<string>();
  let refreshed: Promise<void> | null = null;
  /** kendi seslerinin listesi okundu (okunamadıysa ses motoru silinmez) */
  let customKnown = false;

  const notify = () => listeners.forEach((l) => l());

  const set = (id: string, patch: Partial<InstallState>) => {
    const prev = states[id] ?? { status: 'unknown', loaded: 0, total: 0, need: 0 };
    states = { ...states, [id]: { ...prev, ...patch } };
    notify();
  };

  /** Kendi seslerinin listesi değişti: sesler ve durumlar güncellenir (menü yeniden çizilir) */
  const setMetas = (next: CustomVoiceMeta[]) => {
    metas = next;
    setCustomVoices(metas.map(customPiperVoice));
    const ids = new Set(metas.map((m) => m.id));
    const nextStates: Record<string, InstallState> = {};
    for (const [id, s] of Object.entries(states))
      if (PIPER_VOICES.some((v) => v.id === id) || ids.has(id)) nextStates[id] = s;
    for (const m of metas) nextStates[m.id] ??= { status: 'unknown', loaded: 0, total: 0, need: 0 };
    states = nextStates;
    notify();
  };

  /** Cihazdaki dosyalara göre durumlar (indirme sürenler dışında). Bir sesin okunamaması ötekileri bekletmez. */
  const refresh = async () => {
    if (!cacheSupported()) return;
    for (const v of allPiperVoices()) {
      if (states[v.id]?.status === 'downloading') continue;
      let need: number;
      try {
        need = sum(await missing(allAssets(v.id)));
      } catch {
        // Okunamadı: "Denetleniyor…"da kalmasın, indirilebilir görünsün (indirme eksik olanı yine kendi bulur)
        if (states[v.id]?.status === 'unknown') set(v.id, { status: 'absent' });
        continue;
      }
      if (!piperVoice(v.id)) continue; // bu arada kaldırıldı
      set(v.id, { status: need === 0 ? 'ready' : 'absent', need, loaded: 0, total: 0 });
    }
  };

  /** Ses motorunu (çalışma zamanı dosyaları) kullanan başka ses kalmadıysa siler */
  const pruneRuntime = async (except: string) => {
    // Kendi sesleri okunamadıysa (bilinmiyor) ses motoru silinmez
    if (!customKnown || metas.some((m) => m.id !== except)) return;
    for (const o of PIPER_VOICES) if (o.id !== except && (await hasAll(allAssets(o.id)))) return;
    await removeAssets(runtimeAssets().map((a) => a.url));
  };

  /**
   * İlk çağrıda durumları ve kendi seslerini okur; eski sürümlerin dosyalarını ve yarım kalmış eklemelerin
   * artıklarını siler
   */
  const ensure = (): Promise<void> => {
    refreshed ??= (async () => {
      if (!cacheSupported()) return;
      // İlk sürümde kendi sesleri katalog önbelleğindeydi: önce taşınır
      await migrateCustom().catch(() => undefined);
      // Plan 13'ten önce ses motoru Vite'ın hash'li adresindeydi: yeni (sürümlü) anahtara taşınır, eskisini temizlik
      // siler. Böylece uygulama güncellenince motor yeniden inmez.
      await adoptRenamed(PIPER_RUNTIME.ortWasm, LEGACY_ORT_WASM).catch(() => undefined);
      await prune(
        PIPER_VOICES.flatMap((v) => allAssets(v.id)).map((a) => a.url),
        isCustomUrl,
      ).catch(() => undefined);
      await pruneCustom(importing).catch(() => undefined);
      // Bu sırada eklenen ses kaybolmasın: okunan listeye eklenir
      const listed = await listCustomVoices().then(
        (list) => {
          customKnown = true;
          return list;
        },
        () => [],
      );
      setMetas([...listed, ...metas.filter((m) => !listed.some((l) => l.id === m.id))]);
      await refresh();
    })()
      .catch(() => undefined)
      // Durumu okunamayan ses "Denetleniyor…"da kalmaz
      .then(() => {
        for (const [id, s] of Object.entries(states))
          if (s.status === 'unknown') set(id, { status: 'absent' });
      });
    return refreshed;
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
    ensure,
    /** sesi indirir; bitince true (iptal ya da hata: false). Kendi sesinde yalnızca ses motoru iner. */
    async install(id: string): Promise<boolean> {
      // Durum henüz okunmadıysa önce okunur: ses cihazdaysa yeniden inmez
      if (states[id]?.status === 'unknown') await ensure();
      if (states[id]?.status === 'ready') return true;
      if (states[id]?.status === 'downloading') return false;
      const controller = new AbortController();
      aborts.set(id, controller);
      set(id, { status: 'downloading', loaded: 0, total: states[id]?.need ?? 0 });
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
    /** sesin dosyalarını siler; başka kurulu ses (kendi sesi dahil) kalmadıysa ses motorunu da */
    async remove(id: string) {
      const v = piperVoice(id);
      if (!v) return;
      removedListeners.forEach((l) => l(id));
      if (v.custom) {
        await removeCustomFiles(id);
        setMetas(metas.filter((m) => m.id !== id));
      } else await removeAssets(voiceAssets(v).map((a) => a.url));
      await pruneRuntime(id);
      await refresh();
    },
    /** cihazda olmayan ses motorunun boyutu (kendi sesi eklenirken indirilecek) */
    async runtimeNeed(): Promise<number> {
      return cacheSupported() ? sum(await missing(runtimeAssets())) : 0;
    },
    /**
     * Kendi sesini ekler: ses motoru (yoksa) → dosyaları kaydet → worker'da dene → `voice.json`. Olmazsa ya da
     * vazgeçilirse yazılanlar silinir (yarım ses kalmaz) ve `CustomVoiceError` fırlar. Bitince sesin tanımı döner.
     */
    async importCustom(
      voice: PreparedVoice,
      name: string,
      { signal, onPhase, check }: ImportOptions,
    ): Promise<PiperVoice> {
      const id = newCustomId();
      importing.add(id);
      let phase: ImportPhase['kind'] = 'runtime';
      const runtimeBytes = sum(runtimeAssets());
      try {
        const runtime = await missing(runtimeAssets());
        if (runtime.length > 0) {
          onPhase({ kind: 'runtime', loaded: 0, total: sum(runtime) });
          await download(runtimeAssets(), {
            signal,
            verify: piperTestHooks()?.verify ?? true,
            onProgress: (loaded, total) => onPhase({ kind: 'runtime', loaded, total }),
          });
          // Öbür seslerin indirilecek boyutu küçüldü
          void refresh().catch(() => undefined);
        }
        stopIfAborted(signal);

        phase = 'save';
        onPhase({ kind: 'save' });
        await saveCustomFiles(id, voice.model, voice.configText);
        // ZIP'ten açılan model bellekteydi: saklandı, deneme (model bir kez daha belleğe okunur) başlamadan bırakılır
        if (voice.fromZip) voice.model = new Blob();
        stopIfAborted(signal);

        const meta: CustomVoiceMeta = {
          v: 1,
          id,
          name,
          lang: voice.info.lang,
          espeakVoice: voice.info.espeakVoice,
          sampleRate: voice.info.sampleRate,
          modelBytes: voice.modelBytes,
          configBytes: new TextEncoder().encode(voice.configText).length,
          addedAt: Date.now(),
          quality: voice.info.quality,
          languageName: voice.info.languageName,
          fileName: voice.modelName,
        };
        const piper = customPiperVoice(meta);
        phase = 'check';
        onPhase({ kind: 'check' });
        await check(piper, checkSentence(meta.lang));
        stopIfAborted(signal);

        await writeCustomMeta(meta);
        setMetas([...metas, meta]);
        set(id, { status: 'ready', need: 0, loaded: 0, total: 0 });
        askPersist();
        return piper;
      } catch (e) {
        await removeCustomFiles(id).catch(() => undefined);
        throw importError(e, phase, signal, voice, runtimeBytes);
      } finally {
        importing.delete(id);
      }
    },
    /** Kendi sesinin adını değiştirir (yalnızca `voice.json` yeniden yazılır) */
    async rename(id: string, name: string): Promise<void> {
      const meta = metas.find((m) => m.id === id);
      if (!meta || meta.name === name) return;
      const next = { ...meta, name };
      await writeCustomMeta(next);
      setMetas(metas.map((m) => (m.id === id ? next : m)));
    },
  };
}

export const piperManager = createManager();

export function usePiperStates(): Record<string, InstallState> {
  return useSyncExternalStore(piperManager.subscribe, piperManager.get, piperManager.get);
}
