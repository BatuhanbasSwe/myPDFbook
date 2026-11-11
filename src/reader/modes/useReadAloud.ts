import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Block, Lang } from '../../convert/types';
import type { PdfDocument } from '../../pdf/pdfjs';
import { sentenceText } from '../../text/sentencePages';
import type { Sentence } from '../../text/sentences';
import type { BookSource } from '../FlipBook';
import type { ReadingPosition } from '../progress';
import type { ReaderView } from '../readerPrefs';
import type { PageOverlays } from './pageHighlight';
import {
  createReadAloud,
  hasEnhancedVoice,
  pickVoice,
  speakable,
  speechLang,
  voicesFor,
  type ReadAloud,
  type ReadAloudState,
  type VoiceInfo,
} from './readAloud';
import { getReadAloudPrefs, setReadAloudPrefs } from './readAloudPrefs';
import { returnFocus, usePlayerKeys, useSentencePlayer } from './useSentencePlayer';
import { useWakeLock } from './wakeLock';
import { createWebSpeech } from './webSpeech';
import { createWebAudioOut } from './piper/audio';
import { combineSpeech, type ReaderSpeech } from './piper/combined';
import type { PreparedVoice } from './piper/customVoice';
import {
  piperManager,
  piperSupported,
  piperTestHooks,
  usePiperStates,
  type ImportPhase,
  type InstallState,
} from './piper/manager';
import { createPiperEngine } from './piper/piperEngine';
import { createWorkerSynth } from './piper/synth';
import {
  isPiperVoice,
  PIPER_PREFIX,
  piperVoice,
  piperVoicesFor,
  voiceFitsLang,
  type CustomVoiceInfo,
} from './piper/voices';

/** Ses menüsündeki yapay zekâ sesi ve kurulum durumu */
export interface NeuralVoiceUi {
  id: string;
  name: string;
  /** eğitim verisinin lisansı */
  license: string;
  install: InstallState;
  /** kendi sesin (kullanıcı ekledi, yalnızca bu cihazda): boyutu ve dili de */
  custom?: CustomVoiceInfo & { bytes: number; lang: string };
}

/** Kendi sesinin penceresi: yeni ses ekleme ya da eklenmiş sesi düzenleme (ad, kaldırma) */
export type VoiceSheet = { kind: 'add' } | { kind: 'edit'; id: string };

/** Okuyucunun konuşma motoru: tarayıcının sesleri ve (tarayıcı çalıştırabiliyorsa) yapay zekâ sesleri */
function createReaderSpeech(): ReaderSpeech | null {
  const hooks = piperTestHooks();
  const piper =
    piperSupported() || hooks?.synth
      ? createPiperEngine({
          synth: hooks?.synth ?? createWorkerSynth(),
          audio: createWebAudioOut(),
        })
      : null;
  return combineSpeech(createWebSpeech(), piper);
}

/** Kayıtlı ses bu kitabın dilindeki kurulu bir yapay zekâ sesi mi */
function savedNeural(saved: string | undefined, lang: string): string | null {
  const v = piperVoice(saved);
  if (!v || !voiceFitsLang(v, lang)) return null;
  const status = piperManager.get()[v.id]?.status;
  // Durum henüz okunmadıysa kayıtlı sese güvenilir (okunamazsa aşağıdaki etki sistem sesine geçer)
  return status === 'ready' || status === 'unknown' ? v.id : null;
}

/** "Dinle": seçili sesin örnek cümlesi (kitabın diline göre) */
const SAMPLE_TEXT: Record<string, string> = {
  tr: 'Merhaba! Kitabınızı bu sesle okuyacağım.',
  en: 'Hello! I will read your book in this voice.',
};

interface Options {
  blocks: Block[];
  lang: Lang;
  view: ReaderView;
  pdf: PdfDocument | null;
  /** okuma yeri: okuma açık sayfanın ilk cümlesinden başlar */
  pos: ReadingPosition;
  /** açık görünümün sayfa kaynağı (sayfa çevirmek için; çizimden sonra güncellenir) */
  sourceRef: RefObject<BookSource | null>;
  /** sonraki sayfaya çevir (efektle) */
  turnNext(): void;
  /** metin görünümünde vurgunun arandığı kök */
  rootRef: RefObject<HTMLElement | null>;
  /** Boşluk ve Esc bizim mi (üstte panel ya da pencere açıkken değil) */
  keys: boolean;
  /** başlıktaki "Sesli oku" düğmesi: çubuk kapanınca odak ona döner */
  buttonRef: RefObject<HTMLButtonElement | null>;
  /** kalem kipi açık: Esc kalem kipinden çıkar, okumayı kapatmaz */
  penOn: boolean;
  /**
   * Kitabın üstünde okurun işi var (not yazılıyor, panel açık, kalem kipi): okuma sayfayı kendiliğinden çevirmez,
   * iş bitince okunan cümlenin sayfasına geçilir
   */
  hold: boolean;
}

export interface ReadAloudUi {
  /** tarayıcıda konuşma var ve kitapta okunacak metin var */
  available: boolean;
  open: boolean;
  state: ReadAloudState | null;
  /** kitabın dili */
  lang: Lang;
  /** kitabın diline uyan sesler */
  voices: VoiceInfo[];
  /** bu dilde cihazda gelişmiş ses var (yoksa ses menüsünde indirme yolu gösterilir) */
  hasEnhanced: boolean;
  /** ses menüsü açık */
  voiceMenu: boolean;
  setVoiceMenu(open: boolean): void;
  /** seçili sesle kısa bir örnek cümle okur (okuma sürüyorsa duraklar) */
  preview(): void;
  /** kitabın dilindeki yapay zekâ sesleri (tarayıcı çalıştıramıyorsa boş) */
  neural: NeuralVoiceUi[];
  /** yapay zekâ sesini indirir (dokunuşta); bitince seçilir */
  installVoice(id: string): void;
  cancelInstall(id: string): void;
  /** "Sesi kaldır": dosyaları siler (seçiliyse sistem sesine geçilir) */
  removeVoice(id: string): void;
  /** yapay zekâ sesi bu tarayıcıda çalışıyor: menüde "Kendi sesini ekle…" görünür */
  neuralAvailable: boolean;
  /** kendi sesinin penceresi (açıkken okuma duraklar, tuşlar pencerenin) */
  voiceSheet: VoiceSheet | null;
  openVoiceSheet(sheet: VoiceSheet): void;
  /** pencere kapanır, ses menüsü yeniden açılır */
  closeVoiceSheet(): void;
  /**
   * Kendi sesini ekler ("Ekle" dokunuşunda çağrılır): bitince ses seçilir ve örnek cümleyle tanıtılır. Olmazsa
   * `CustomVoiceError` ile reddeder (vazgeçildiyse `cancelled`).
   */
  importVoice(
    voice: PreparedVoice,
    name: string,
    opts: { signal: AbortSignal; onPhase(phase: ImportPhase): void },
  ): Promise<void>;
  renameVoice(id: string, name: string): Promise<void>;
  /** yapay zekâ sesi okunacak sesi hazırlıyor (ilk cümlede model yüklenir; oynat düğmesinde gösterilir) */
  preparing: boolean;
  /** yapay zekâ sesi bir kez önerilir (hiç ses seçilmediyse) */
  suggest: boolean;
  dismissSuggest(): void;
  /** "Sesli oku" düğmesi: kapalıysa açar ve okumaya başlar (dokunuşun içinde), açıksa kapatır */
  toggleOpen(): void;
  /**
   * Ekrandaki noktadaki cümleden okur (sesli okuma açıkken kitaba dokunuş, Plan 13): oynuyorsa da duraklatılmışsa da
   * o cümleden oynar. Dokunuşun içinde çağrılır (iOS). Noktada cümle yoksa `miss` (dokunuşun eski işi).
   */
  readAt(x: number, y: number, miss: () => void): void;
  /** "Bir cümleye dokun, oradan okusun" ipucu: ilk açılışta bir kez, kısa süre */
  tapHint: boolean;
  dismissTapHint(): void;
  close(): void;
  toggle(): void;
  next(): void;
  prev(): void;
  setRate(rate: number): void;
  setVoice(voice: string): void;
  setSleep(minutes: number | null): void;
  /** sayfa görünümünde okunan cümlenin vurgusu (usePdfBook → overlays) */
  overlays: PageOverlays | undefined;
}

/**
 * Sesli okuma: denetleyici (readAloud.ts) ile okuyucu arasındaki bağ. Vurgu, sayfa çevirme ve başlangıç yeri cümle
 * oynatıcısının işidir (useSentencePlayer.ts). Okurken ekran açık kalır.
 */
export function useReadAloud({
  blocks,
  lang,
  view,
  pdf,
  pos,
  sourceRef,
  turnNext,
  rootRef,
  keys,
  penOn,
  hold,
  buttonRef,
}: Options): ReadAloudUi {
  const [engine] = useState<ReaderSpeech | null>(createReaderSpeech);
  const piperStates = usePiperStates();
  const neuralAvailable = !!engine && (piperSupported() || !!piperTestHooks()?.synth);
  const neural = useMemo<NeuralVoiceUi[]>(
    () =>
      neuralAvailable
        ? piperVoicesFor(lang)
            .filter((v) => piperStates[v.id])
            .map((v) => ({
              id: v.id,
              name: v.name,
              license: v.license,
              install: piperStates[v.id],
              ...(v.custom
                ? { custom: { ...v.custom, bytes: v.model.bytes + v.config.bytes, lang: v.lang } }
                : {}),
            }))
        : [],
    [neuralAvailable, lang, piperStates],
  );
  const prefs = getReadAloudPrefs();
  const [suggestDismissed, setSuggestDismissed] = useState(prefs.suggested);
  const hasText = useMemo(() => blocks.some((b) => 'text' in b && b.text.trim() !== ''), [blocks]);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ReadAloudState | null>(null);
  const [allVoices, setAllVoices] = useState<VoiceInfo[]>([]);
  const [voiceMenu, setVoiceMenu] = useState(false);
  const [voiceSheet, setVoiceSheet] = useState<VoiceSheet | null>(null);
  const ctrl = useRef<ReadAloud | null>(null);
  /** örnek cümle okunuyor: okuma başlarken susturulur */
  const previewing = useRef(false);

  const player = useSentencePlayer({
    blocks,
    lang,
    view,
    pdf,
    pos,
    sourceRef,
    turnNext,
    rootRef,
    hold,
    open,
    current: () => ctrl.current?.getState().current ?? -1,
    playing: () => ctrl.current?.getState().status === 'playing',
  });
  const { index, show, start: startAt, startAtPoint, cancelStart, follow, reset } = player;

  const voices = useMemo(() => voicesFor(allVoices, lang), [allVoices, lang]);

  // Yapay zekâ seslerinin durumu ve kendi sesleri (Cache Storage) okuyucu açılır açılmaz okunur
  useEffect(() => {
    if (neuralAvailable) void piperManager.ensure();
  }, [neuralAvailable]);

  const [preparing, setPreparing] = useState(false);
  useEffect(() => {
    engine?.onPreparing(setPreparing);
    return () => engine?.onPreparing(null);
  }, [engine]);

  // Ses kaldırılınca model bellekten atılır
  useEffect(() => piperManager.onRemoved(() => engine?.release()), [engine]);

  // Seçili yapay zekâ sesi cihazda değilse (kaldırıldı, silindi) kayıtlı ya da en iyi sistem sesine geçilir
  useEffect(() => {
    const c = ctrl.current;
    const voice = c?.getState().voice;
    if (!c || !isPiperVoice(voice)) return;
    const status = piperStates[voice]?.status;
    // Kendi sesi kaldırılınca tanımı da gider (seçildiyse vardı)
    if (status === 'absent' || status === 'error' || !piperVoice(voice)) {
      const saved = getReadAloudPrefs().voices[lang];
      c.setVoice(pickVoice(voices, lang, isPiperVoice(saved) ? null : saved));
    }
  }, [piperStates, voices, lang, state?.voice]);

  // Kayıtlı ses kendi sesiyse ve okuma açılırken henüz okunmamışsa (Cache Storage'dan biraz sonra gelir), okununca
  // ona geçilir; okuma sürüyorsa geçilmez
  useEffect(() => {
    const c = ctrl.current;
    if (!c || c.getState().status === 'playing') return;
    const want = savedNeural(getReadAloudPrefs().voices[lang], lang);
    if (want && c.getState().voice !== want) c.setVoice(want, false);
  }, [piperStates, lang]);

  // Ses listesi (Chrome sesleri sonradan yükler)
  useEffect(() => {
    if (!engine || !open) return;
    const update = () => setAllVoices(engine.voices());
    update();
    return engine.onVoices(update);
  }, [engine, open]);

  // Ses seçilmemişse (liste yeni geldi) kayıtlı ya da dilin varsayılan sesi: okunan cümle baştan okunmaz, ses
  // sonraki cümleden geçerli olur
  useEffect(() => {
    const c = ctrl.current;
    if (!c || !open || c.getState().voice !== null || voices.length === 0) return;
    const saved = getReadAloudPrefs().voices[lang];
    c.setVoice(savedNeural(saved, lang) ?? pickVoice(voices, lang, saved), false);
  }, [voices, lang, open]);

  /** Denetleyici (ilk açılışta kurulur) */
  const ensure = useCallback((): ReadAloud | null => {
    if (!engine) return null;
    const list: Sentence[] = index();
    if (!ctrl.current) {
      const prefs = getReadAloudPrefs();
      ctrl.current = createReadAloud({
        engine,
        count: list.length,
        textOf: (i) => speakable(sentenceText(blocks, list[i])),
        lang: speechLang(lang),
        rate: prefs.rate,
        voice:
          savedNeural(prefs.voices[lang], lang) ??
          pickVoice(voicesFor(engine.voices(), lang), lang, prefs.voices[lang]),
        onChange: setState,
        onSentence: (i) => show(list, i),
      });
      setState(ctrl.current.getState());
    }
    return ctrl.current;
  }, [engine, index, blocks, lang, show]);

  /** Örnek cümle okunuyorsa susturur (okuma başlamadan önce) */
  const stopPreview = useCallback(() => {
    if (!previewing.current) return;
    previewing.current = false;
    engine?.cancel();
  }, [engine]);

  /**
   * Okumaya başlar: kaldığı cümle açık sayfadaysa oradan, değilse açık sayfanın ilk cümlesinden. Kullanıcının
   * dokunuşunda çağrılır: metin görünümünde konuşma dokunuşun içinde başlar; sayfa görünümünde ilk cümle sayfa
   * metninden arandığı için motor dokunuşta sessizce açılır (iOS).
   */
  const start = useCallback(() => {
    const c = ensure();
    if (!c || !engine) return;
    stopPreview();
    startAt(
      c.getState().current,
      (from) => c.play(from),
      () => engine.prime(c.getState().voice),
    );
  }, [ensure, engine, startAt, stopPreview]);

  const close = useCallback(() => {
    cancelStart();
    stopPreview();
    ctrl.current?.stop();
    reset();
    returnFocus('read-aloud-bar', buttonRef);
    setVoiceMenu(false);
    // Kendi sesinin penceresi de kapanır (süren ekleme durur)
    setVoiceSheet(null);
    setOpen(false);
  }, [cancelStart, reset, buttonRef, stopPreview]);

  /** Seçili sesle örnek cümle: okuma sürüyorsa duraklar (kullanıcının dokunuşunda: iOS) */
  const preview = useCallback(() => {
    const c = ctrl.current;
    if (!c || !engine) return;
    if (c.getState().status === 'playing') c.pause();
    engine.cancel();
    const { rate, voice } = c.getState();
    previewing.current = true;
    const done = () => {
      previewing.current = false;
    };
    engine.speak(
      { text: SAMPLE_TEXT[lang] ?? SAMPLE_TEXT.tr, lang: speechLang(lang), rate, voice },
      { start: () => undefined, end: done, error: done },
    );
  }, [engine, lang]);

  /** "Bir cümleye dokun" ipucu görünüyor */
  const [tapHint, setTapHint] = useState(false);

  /** Dokunulan cümleden okur (bkz. ReadAloudUi.readAt) */
  const readAt = useCallback(
    (x: number, y: number, miss: () => void) => {
      const c = ensure();
      if (!c || !engine) return miss();
      startAtPoint(
        x,
        y,
        (from) => {
          stopPreview();
          // Yapay zekâ sesi Web Audio ile çalar: bağlam dokunuşta açılır (iOS)
          const voice = c.getState().voice;
          if (isPiperVoice(voice)) engine.prime(voice);
          c.play(from);
          setTapHint(false);
        },
        // Cümle sayfa metninden aranacak (eşzamansız): ses dokunuşta açılır
        { prime: () => engine.prime(c.getState().voice), miss },
      );
    },
    [ensure, engine, startAtPoint, stopPreview],
  );

  const dismissTapHint = useCallback(() => setTapHint(false), []);

  const toggleOpen = useCallback(() => {
    if (open) return close();
    setOpen(true);
    // "Bir cümleye dokun" ipucu: okuma ilk açılınca bir kez (çubuk gösterir, kısa süre sonra ya da ilk dokunuşta
    // söner; yapay zekâ sesi önerisi açıksa o kapanınca)
    if (!getReadAloudPrefs().tapHint) {
      setReadAloudPrefs({ tapHint: true });
      setTapHint(true);
    }
    start();
  }, [open, close, start]);

  const toggle = useCallback(() => {
    const c = ctrl.current;
    if (!c) return;
    // Durmuşsa (kitap bitti ya da hata) yeniden başlarken yer görünen sayfaya göre seçilir
    if (c.getState().status === 'playing') c.pause();
    else if (c.getState().status === 'paused') {
      stopPreview();
      follow();
      c.resume();
    } else start();
  }, [start, follow, stopPreview]);

  // Okuyucudan çıkınca konuşma susar
  useEffect(
    () => () => {
      ctrl.current?.dispose();
      // Yapay zekâ sesinin modeli ve worker'ı bellekten atılır
      engine?.release();
    },
    [engine],
  );

  useWakeLock(open && state?.status === 'playing');

  // Sayfa yeniden görünür olunca okunan parça yeniden okunur: iOS arka planda ve kilitliyken konuşmayı keser, bitiş
  // olayı da gelmez
  const playing = open && state?.status === 'playing';
  useEffect(() => {
    if (!playing) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') ctrl.current?.restart();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [playing]);

  /** Ses seçimi (kalıcı): okuma sürmüyorsa ses örnek cümleyle tanıtılır, sürüyorsa okunan cümle yeni sesle baştan */
  const selectVoice = useCallback(
    (voice: string) => {
      const c = ctrl.current;
      // Yapay zekâ sesi Web Audio ile çalar: bağlam dokunuşta açılır (iOS)
      if (isPiperVoice(voice)) engine?.prime(voice);
      c?.setVoice(voice);
      setReadAloudPrefs({ voices: { ...getReadAloudPrefs().voices, [lang]: voice } });
      if (c && c.getState().status !== 'playing') preview();
    },
    [engine, lang, preview],
  );

  const dismissSuggest = useCallback(() => {
    setSuggestDismissed(true);
    setReadAloudPrefs({ suggested: true });
  }, []);

  // Kurulum bitince ses yalnızca okuyucu hâlâ açıksa seçilir
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Esc önce ses menüsünü kapatır; kendi sesinin penceresi açıkken tuşlar onun
  const closeMenu = useCallback(() => setVoiceMenu(false), []);
  usePlayerKeys({
    open,
    keys: keys && !voiceSheet,
    penOn,
    toggle,
    close: voiceMenu ? closeMenu : close,
  });

  return {
    available: !!engine && hasText,
    open,
    state,
    lang,
    voices,
    hasEnhanced: hasEnhancedVoice(voices),
    voiceMenu,
    setVoiceMenu: (show) => {
      // Menüyü kendisi açan okura öneri gösterilmez
      if (show && neural.length > 0 && !suggestDismissed) dismissSuggest();
      setVoiceMenu(show);
    },
    preview,
    toggleOpen,
    readAt,
    tapHint: open && tapHint,
    dismissTapHint,
    close,
    toggle,
    next: () => {
      follow();
      ctrl.current?.next();
    },
    prev: () => {
      follow();
      ctrl.current?.prev();
    },
    setRate: (rate) => {
      ctrl.current?.setRate(rate);
      setReadAloudPrefs({ rate: ctrl.current?.getState().rate ?? rate });
    },
    setVoice: (voice) => selectVoice(voice),
    neural,
    installVoice: (id) => {
      // Dokunuşta: ses bağlamı açılır (iOS), indirme bitince ses çalabilsin
      engine?.prime(id);
      dismissSuggest();
      void piperManager.install(id).then((ok) => {
        if (ok && ctrl.current && openRef.current) selectVoice(id);
      });
    },
    cancelInstall: (id) => piperManager.cancel(id),
    removeVoice: (id) => {
      // Kaldırılan ses kayıtlı seçim olarak kalmasın (her dilde)
      const saved = getReadAloudPrefs().voices;
      if (Object.values(saved).includes(id))
        setReadAloudPrefs({
          voices: Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== id)),
        });
      void piperManager.remove(id);
    },
    neuralAvailable,
    voiceSheet: open ? voiceSheet : null,
    openVoiceSheet: (sheet) => {
      // Okuma duraklar: ekleme sesi worker'da dener (okunan sesin modeli bırakılır)
      if (ctrl.current?.getState().status === 'playing') ctrl.current.pause();
      setVoiceMenu(false);
      setVoiceSheet(sheet);
    },
    closeVoiceSheet: () => {
      setVoiceSheet(null);
      setVoiceMenu(true);
    },
    importVoice: async (voice, name, { signal, onPhase }) => {
      if (!engine) throw new Error('Sesli okuma yok');
      // Dokunuşta: bellekte iki model olmasın (iPad), okunan sesin modeli ve worker'ı bırakılır. Ses bağlamı hemen
      // yeniden açılır (iOS yalnızca dokunuşta açar): eklenen ses örnek cümlesini çalabilsin.
      engine.release();
      engine.prime(PIPER_PREFIX);
      // Vazgeçilince worker bırakılır: süren deneme hemen "canceled" ile biter, model bellekten atılır
      const onAbort = () => engine.release();
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        const added = await piperManager.importCustom(voice, name, {
          signal,
          onPhase,
          check: (v, text) => engine.checkVoice(v, text),
        });
        // Bu kitabın dilinde değilse seçilmez (Türkçe kitapta İngilizce ses): yalnızca eklenir
        if (ctrl.current && openRef.current && voiceFitsLang(added, lang)) selectVoice(added.id);
      } catch (e) {
        // Denenen (silinen) sesin modeli bellekte kalmasın
        engine.release();
        throw e;
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    },
    renameVoice: (id, name) => piperManager.rename(id, name),
    preparing,
    suggest:
      open &&
      !suggestDismissed &&
      !voiceMenu &&
      neural.length > 0 &&
      neural.every((n) => n.install.status === 'absent') &&
      getReadAloudPrefs().voices[lang] === undefined,
    dismissSuggest,
    setSleep: (minutes) => ctrl.current?.setSleep(minutes),
    overlays: player.overlays,
  };
}
