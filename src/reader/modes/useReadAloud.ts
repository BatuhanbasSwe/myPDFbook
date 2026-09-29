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
import { createWebSpeech, type WebSpeech } from './webSpeech';

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
  /** "Sesli oku" düğmesi: kapalıysa açar ve okumaya başlar (dokunuşun içinde), açıksa kapatır */
  toggleOpen(): void;
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
  const [engine] = useState<WebSpeech | null>(() => createWebSpeech());
  const hasText = useMemo(() => blocks.some((b) => 'text' in b && b.text.trim() !== ''), [blocks]);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ReadAloudState | null>(null);
  const [allVoices, setAllVoices] = useState<VoiceInfo[]>([]);
  const [voiceMenu, setVoiceMenu] = useState(false);
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
  const { index, show, start: startAt, cancelStart, follow, reset } = player;

  const voices = useMemo(() => voicesFor(allVoices, lang), [allVoices, lang]);

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
    c.setVoice(pickVoice(voices, lang, getReadAloudPrefs().voices[lang]), false);
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
        voice: pickVoice(voicesFor(engine.voices(), lang), lang, prefs.voices[lang]),
        onChange: setState,
        onSentence: (i) => show(list, i),
      });
      setState(ctrl.current.getState());
    }
    return ctrl.current;
  }, [engine, index, blocks, lang, show]);

  /**
   * Okumaya başlar: kaldığı cümle açık sayfadaysa oradan, değilse açık sayfanın ilk cümlesinden. Kullanıcının
   * dokunuşunda çağrılır: metin görünümünde konuşma dokunuşun içinde başlar; sayfa görünümünde ilk cümle sayfa
   * metninden arandığı için motor dokunuşta sessizce açılır (iOS).
   */
  /** Örnek cümle okunuyorsa susturur (okuma başlamadan önce) */
  const stopPreview = useCallback(() => {
    if (!previewing.current) return;
    previewing.current = false;
    engine?.cancel();
  }, [engine]);

  const start = useCallback(() => {
    const c = ensure();
    if (!c || !engine) return;
    stopPreview();
    startAt(
      c.getState().current,
      (from) => c.play(from),
      () => engine.prime(),
    );
  }, [ensure, engine, startAt, stopPreview]);

  const close = useCallback(() => {
    cancelStart();
    stopPreview();
    ctrl.current?.stop();
    reset();
    returnFocus('read-aloud-bar', buttonRef);
    setVoiceMenu(false);
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

  const toggleOpen = useCallback(() => {
    if (open) return close();
    setOpen(true);
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
  useEffect(() => () => ctrl.current?.dispose(), []);

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

  // Esc önce ses menüsünü kapatır
  const closeMenu = useCallback(() => setVoiceMenu(false), []);
  usePlayerKeys({ open, keys, penOn, toggle, close: voiceMenu ? closeMenu : close });

  return {
    available: !!engine && hasText,
    open,
    state,
    lang,
    voices,
    hasEnhanced: hasEnhancedVoice(voices),
    voiceMenu,
    setVoiceMenu,
    preview,
    toggleOpen,
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
    setVoice: (voice) => {
      const c = ctrl.current;
      c?.setVoice(voice);
      setReadAloudPrefs({ voices: { ...getReadAloudPrefs().voices, [lang]: voice } });
      // Okuma sürmüyorsa ses örnek cümleyle tanıtılır (sürüyorsa okunan cümle yeni sesle baştan okunur)
      if (c && c.getState().status !== 'playing') preview();
    },
    setSleep: (minutes) => ctrl.current?.setSleep(minutes),
    overlays: player.overlays,
  };
}
