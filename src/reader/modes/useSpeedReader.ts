import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import type { Block, Lang } from '../../convert/types';
import type { PdfDocument } from '../../pdf/pdfjs';
import { sentenceText } from '../../text/sentencePages';
import type { BookSource } from '../FlipBook';
import type { ReadingPosition } from '../progress';
import type { ReaderView } from '../readerPrefs';
import { realClock } from './clock';
import type { PageOverlays } from './pageHighlight';
import { getSpeedPrefs, setSpeedPrefs, useSpeedPrefs } from './speedPrefs';
import {
  createSpeedReader,
  type SpeedMode,
  type SpeedReader,
  type SpeedState,
} from './speedReader';
import { returnFocus, usePlayerKeys, useSentencePlayer } from './useSentencePlayer';
import { useWakeLock } from './wakeLock';

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
  /** başlıktaki "Hızlı oku" düğmesi: çubuk kapanınca odak ona döner */
  buttonRef: RefObject<HTMLButtonElement | null>;
  /** kalem kipi açık: Esc kalem kipinden çıkar, okumayı kapatmaz */
  penOn: boolean;
  /** kitabın üstünde okurun işi var (not, panel, kalem kipi): sayfa kendiliğinden çevrilmez */
  hold: boolean;
}

export interface SpeedReaderUi {
  /** kitapta okunacak metin var */
  available: boolean;
  open: boolean;
  /**
   * Denetleyicinin durumu; kelime kelime değişen alanlar (RSVP'de kelime, süre sayacı) burada güncel olmayabilir:
   * onlar için `useLive` (okuyucu her kelimede yeniden çizilmesin)
   */
  state: SpeedState | null;
  /** denetleyicinin anlık durumu (kelime, süre sayacı): yalnızca onu gösteren bileşen yeniden çizilir */
  useLive(): SpeedState | null;
  /** denetleyicinin saati (`since` bununla ölçülür; Date.now ile karşılaştırılmaz) */
  now(): number;
  /** odak: etkin cümle dışındakiler kararır */
  focus: boolean;
  /** "Hızlı oku" düğmesi: kapalıysa açar ve başlatır, açıksa kapatır */
  toggleOpen(): void;
  close(): void;
  toggle(): void;
  next(): void;
  prev(): void;
  setMode(mode: SpeedMode): void;
  setSeconds(seconds: number): void;
  setWpm(wpm: number): void;
  setRsvpWpm(wpm: number): void;
  setRamp(ramp: boolean): void;
  setFocus(focus: boolean): void;
  /** sayfa görünümünde etkin cümlenin vurgusu ve odağı (usePdfBook → overlays) */
  overlays: PageOverlays | undefined;
}

/**
 * Hızlı okuma: denetleyici (speedReader.ts) ile okuyucu arasındaki bağ. Vurgu, odak, sayfa çevirme ve başlangıç
 * yeri cümle oynatıcısının işidir (useSentencePlayer.ts); sayfa sınırından taşan cümlede sayfa, cümlenin sayfadaki
 * payı dolunca çevrilir. Oynarken ekran açık kalır; sekme gizlenince okuma duraklar. Ayarlar cihazda saklanır.
 */
export function useSpeedReader({
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
}: Options): SpeedReaderUi {
  const hasText = useMemo(() => blocks.some((b) => 'text' in b && b.text.trim() !== ''), [blocks]);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SpeedState | null>(null);
  const [live] = useState(createLive);
  const { focus } = useSpeedPrefs();
  const ctrl = useRef<SpeedReader | null>(null);

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
    // RSVP'de kitap kartın arkasında zaten karanlık: odak karartması yok
    focus: focus && state?.mode !== 'rsvp',
  });
  const {
    index,
    show,
    showTail,
    splitOf,
    splitLater,
    reset,
    start: startAt,
    cancelStart,
    follow,
  } = player;

  /** Denetleyici (ilk açılışta kurulur) */
  const ensure = useCallback((): SpeedReader => {
    const list = index();
    if (!ctrl.current) {
      const { mode, seconds, wpm, rsvpWpm, ramp } = getSpeedPrefs();
      /** okuyucuya son verilen durum */
      let coarse: SpeedState | null = null;
      ctrl.current = createSpeedReader({
        count: list.length,
        textOf: (i) => sentenceText(blocks, list[i]),
        wordsOf: (i) => list[i].words,
        settings: { mode, seconds, wpm, rsvpWpm, ramp },
        clock: realClock,
        onChange: (s) => {
          live.set(s);
          // Kelime ve sayaç değişince okuyucuya güncelleme bile gönderilmez (React yine de bir kez çizebilirdi)
          if (coarse && sameCoarse(coarse, s)) return;
          coarse = s;
          setState(s);
        },
        onSentence: (i) => {
          show(list, i);
          // Sayfa görünümünde cümlenin yeri henüz bilinmiyorsa sayfa sınırından taşıp taşmadığı yeri bulununca
          // bildirilir (payın zamanı geçtiyse sayfa hemen çevrilir)
          if (splitOf(list, i) === null)
            void splitLater(list, i).then((f) => {
              if (f !== null) ctrl.current?.setSplit(i, f);
            });
        },
        splitOf: (i) => splitOf(list, i),
        onSplit: (i) => showTail(list, i),
      });
      live.set(ctrl.current.getState());
      setState(ctrl.current.getState());
    }
    return ctrl.current;
  }, [index, blocks, show, showTail, splitOf, splitLater, live]);

  /** Kaldığı cümle açık sayfadaysa oradan, değilse açık sayfanın ilk cümlesinden başlar */
  const start = useCallback(() => {
    const c = ensure();
    startAt(c.getState().current, (from) => c.play(from));
  }, [ensure, startAt]);

  /** Okuma, okurun işi (not, panel, kalem kipi) başlayınca duraklatıldı: iş bitince kendiliğinden sürer */
  const heldPause = useRef(false);

  const close = useCallback(() => {
    cancelStart();
    ctrl.current?.stop();
    heldPause.current = false;
    reset();
    returnFocus('speed-bar', buttonRef);
    setOpen(false);
  }, [cancelStart, reset, buttonRef]);

  const toggleOpen = useCallback(() => {
    if (open) return close();
    setOpen(true);
    start();
  }, [open, close, start]);

  /** Duraklamış okumayı sürdürür; okur ileriye göz attıysa etkin cümlenin sayfası yeniden açılır */
  const resume = useCallback(() => {
    const c = ctrl.current;
    if (!c) return;
    follow();
    c.resume();
    const i = c.getState().current;
    if (i >= 0) show(index(), i);
  }, [follow, show, index]);

  const toggle = useCallback(() => {
    const c = ctrl.current;
    if (!c) return;
    heldPause.current = false;
    // Durmuşsa (kitap bitti) yeniden başlarken yer görünen sayfaya göre seçilir
    if (c.getState().status === 'playing') c.pause();
    else if (c.getState().status === 'paused') resume();
    else start();
  }, [start, resume]);

  // Okuyucudan çıkınca zamanlayıcı kalmaz
  useEffect(() => () => ctrl.current?.dispose(), []);

  const playing = open && state?.status === 'playing';
  useWakeLock(playing);

  // Sekme gizlenince (iPad kilitlendi, başka uygulama) okuma duraklar: kitap okunmadan ilerlemesin
  useEffect(() => {
    if (!playing) return;
    const onHidden = () => {
      if (document.visibilityState === 'hidden') ctrl.current?.pause();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, [playing]);

  // Okurun işi (not yazılıyor, panel açık, kalem kipi) başlayınca okuma duraklar: okur kitaba bakmıyor, cümleler
  // okunmadan geçmesin. İş bitince, duraklatan buysa (okur bu arada kendisi oynatıp duraklatmadıysa) kendiliğinden
  // sürer; etkin cümlenin sayfası açılır. (Sesli okuma sürer: kulakla dinlenir.)
  const wasHeld = useRef(hold);
  useEffect(() => {
    const was = wasHeld.current;
    wasHeld.current = hold;
    const c = ctrl.current;
    if (hold === was || !open || !c) return;
    if (hold) {
      if (c.getState().status !== 'playing') return;
      c.pause();
      heldPause.current = true;
    } else if (heldPause.current) {
      heldPause.current = false;
      if (c.getState().status === 'paused') resume();
    }
  }, [hold, open, resume]);

  // RSVP'de duraklamışken ← → bir kelime geri ya da ileri
  const onArrow = useCallback(
    (dir: 1 | -1) => {
      const c = ctrl.current;
      if (!c || c.getState().mode !== 'rsvp' || c.getState().status === 'playing') return false;
      follow();
      c.stepWord(dir);
      return true;
    },
    [follow],
  );
  usePlayerKeys({ open, keys, penOn, toggle, close, onArrow });

  return {
    available: hasText,
    open,
    state,
    useLive: () => useSyncExternalStore(live.subscribe, live.get),
    now: realClock.now,
    focus,
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
    setMode: (mode) => {
      ctrl.current?.setMode(mode);
      setSpeedPrefs({ mode });
    },
    setSeconds: (seconds) => {
      ctrl.current?.setSeconds(seconds);
      setSpeedPrefs({ seconds: ctrl.current?.getState().seconds ?? seconds });
    },
    setWpm: (wpm) => {
      ctrl.current?.setWpm(wpm);
      setSpeedPrefs({ wpm: ctrl.current?.getState().wpm ?? wpm });
    },
    setRsvpWpm: (wpm) => {
      ctrl.current?.setRsvpWpm(wpm);
      setSpeedPrefs({ rsvpWpm: ctrl.current?.getState().rsvpWpm ?? wpm });
    },
    setRamp: (ramp) => {
      ctrl.current?.setRamp(ramp);
      setSpeedPrefs({ ramp });
    },
    setFocus: (on) => setSpeedPrefs({ focus: on }),
    overlays: player.overlays,
  };
}

/** Okuyucunun yeniden çizilmesini gerektiren alanlar aynı mı (kelime ve süre sayacı dışındakiler) */
function sameCoarse(a: SpeedState, b: SpeedState): boolean {
  return (
    a.status === b.status &&
    a.current === b.current &&
    a.mode === b.mode &&
    a.seconds === b.seconds &&
    a.wpm === b.wpm &&
    a.rsvpWpm === b.rsvpWpm &&
    a.ramp === b.ramp
  );
}

/** Denetleyicinin anlık durumu (useSyncExternalStore için) */
function createLive() {
  let value: SpeedState | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: SpeedState) {
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
