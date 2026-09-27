import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Block, Lang } from '../../convert/types';
import type { PdfDocument } from '../../pdf/pdfjs';
import { sentenceText } from '../../text/sentencePages';
import type { BookSource } from '../FlipBook';
import type { ReadingPosition } from '../progress';
import type { ReaderView } from '../readerPrefs';
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
  state: SpeedState | null;
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
    focus,
  });
  const { index, show, showTail, splitOf, start: startAt, cancelStart, follow } = player;

  /** Denetleyici (ilk açılışta kurulur) */
  const ensure = useCallback((): SpeedReader => {
    const list = index();
    if (!ctrl.current) {
      const { mode, seconds, wpm } = getSpeedPrefs();
      ctrl.current = createSpeedReader({
        count: list.length,
        textOf: (i) => sentenceText(blocks, list[i]),
        wordsOf: (i) => list[i].words,
        settings: { mode, seconds, wpm },
        onChange: setState,
        onSentence: (i) => show(list, i),
        splitOf: (i) => splitOf(list, i),
        onSplit: (i) => showTail(list, i),
      });
      setState(ctrl.current.getState());
    }
    return ctrl.current;
  }, [index, blocks, show, showTail, splitOf]);

  /** Kaldığı cümle açık sayfadaysa oradan, değilse açık sayfanın ilk cümlesinden başlar */
  const start = useCallback(() => {
    const c = ensure();
    startAt(c.getState().current, (from) => c.play(from));
  }, [ensure, startAt]);

  const close = useCallback(() => {
    cancelStart();
    ctrl.current?.stop();
    returnFocus('speed-bar', buttonRef);
    setOpen(false);
  }, [cancelStart, buttonRef]);

  const toggleOpen = useCallback(() => {
    if (open) return close();
    setOpen(true);
    start();
  }, [open, close, start]);

  const toggle = useCallback(() => {
    const c = ctrl.current;
    if (!c) return;
    // Durmuşsa (kitap bitti) yeniden başlarken yer görünen sayfaya göre seçilir
    if (c.getState().status === 'playing') c.pause();
    else if (c.getState().status === 'paused') {
      follow();
      c.resume();
    } else start();
  }, [start, follow]);

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

  usePlayerKeys({ open, keys, penOn, toggle, close });

  return {
    available: hasText,
    open,
    state,
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
    setFocus: (on) => setSpeedPrefs({ focus: on }),
    overlays: player.overlays,
  };
}
