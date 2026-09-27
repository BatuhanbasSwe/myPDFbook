import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type { Block, Lang } from '../../convert/types';
import type { PdfDocument } from '../../pdf/pdfjs';
import { createPdfSource } from '../../pdf/pdfSource';
import { createSentencePages, sentenceText, type SentencePages } from '../../text/sentencePages';
import { buildSentenceIndex, sentenceAt, type Sentence } from '../../text/sentences';
import type { BookSource } from '../FlipBook';
import type { ReadingPosition } from '../progress';
import type { ReaderView } from '../readerPrefs';
import { useSentenceOverlays } from './pageHighlight';
import {
  createReadAloud,
  pickVoice,
  speakable,
  speechLang,
  voicesFor,
  type ReadAloud,
  type ReadAloudState,
  type VoiceInfo,
} from './readAloud';
import { getReadAloudPrefs, setReadAloudPrefs } from './readAloudPrefs';
import { useTextHighlight } from './textHighlight';
import { useWakeLock } from './wakeLock';
import { createWebSpeech, type WebSpeech } from './webSpeech';

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
}

export interface ReadAloudUi {
  /** tarayıcıda konuşma var ve kitapta okunacak metin var */
  available: boolean;
  open: boolean;
  state: ReadAloudState | null;
  /** kitabın diline uyan sesler */
  voices: VoiceInfo[];
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
  overlays: ReadonlyMap<number, ReactNode> | undefined;
}

/** Efektle sayfa çevirmenin en uzun süresi (ms; kıvrılan sayfa 650 ms) */
const TURN_MS = 1200;
/** Açık sayfanın ilk cümlesi aranırken en çok bu kadar cümle geri gidilir */
const MAX_BACK = 400;

/** Metin görünümünde cümlenin başladığı ve bittiği yuva (aynıysa bir) */
function textSlots(src: BookSource, s: Sentence): number[] {
  if (!src.slotOf) return [];
  const first = src.slotOf({ locator: { block: s.block, offset: s.start }, pdfPage: null });
  const last = src.slotOf({
    locator: { block: s.block, offset: Math.max(s.start, s.end - 1) },
    pdfPage: null,
  });
  return [first, last].filter((x, i, a): x is number => x !== null && a.indexOf(x) === i);
}

/** Aynı kitap ve belge için tek bir sayfa yeri önbelleği (başlangıçta ve vurguda aynısı kullanılır) */
const pagesCache = new WeakMap<Sentence[], WeakMap<PdfDocument, SentencePages>>();

function pagesFor(pdf: PdfDocument, blocks: Block[], sentences: Sentence[]): SentencePages {
  let byPdf = pagesCache.get(sentences);
  if (!byPdf) pagesCache.set(sentences, (byPdf = new WeakMap()));
  let pages = byPdf.get(pdf);
  if (!pages) {
    const source = createPdfSource(pdf);
    pages = createSentencePages({
      blocks,
      sentences,
      pageCount: pdf.numPages,
      getPageText: (p) => source.getPageText(p),
    });
    byPdf.set(pdf, pages);
  }
  return pages;
}

/**
 * Sesli okuma: denetleyici (readAloud.ts) ile okuyucu arasındaki bağ. Okunan cümle vurgulanır (iki görünümde) ve
 * sayfa dışına çıkınca sayfa çevrilir: bir sonraki sayfaysa efektle, değilse doğrudan. Okurken ekran açık kalır.
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
}: Options): ReadAloudUi {
  const [engine] = useState<WebSpeech | null>(() => createWebSpeech());
  const hasText = useMemo(() => blocks.some((b) => 'text' in b && b.text.trim() !== ''), [blocks]);
  const [sentences, setSentences] = useState<Sentence[] | null>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ReadAloudState | null>(null);
  const [active, setActive] = useState<number>(-1);
  const [allVoices, setAllVoices] = useState<VoiceInfo[]>([]);
  const ctrl = useRef<ReadAloud | null>(null);
  const listRef = useRef<Sentence[] | null>(null);
  /** sayfa görünümünde başlatma eşzamansız: kapatılınca ya da yeniden başlatılınca eskisi okumaz */
  const starting = useRef(0);

  // Olay işleyicileri ve eşzamansız işler en güncel değerleri görsün
  const latest = useRef({ view, pdf, pos, turnNext });
  useLayoutEffect(() => {
    latest.current = { view, pdf, pos, turnNext };
  });

  const voices = useMemo(() => voicesFor(allVoices, lang), [allVoices, lang]);

  // Ses listesi (Chrome sesleri sonradan yükler)
  useEffect(() => {
    if (!engine || !open) return;
    const update = () => setAllVoices(engine.voices());
    update();
    return engine.onVoices(update);
  }, [engine, open]);

  // Ses seçilmemişse (liste yeni geldi) kayıtlı ya da dilin varsayılan sesi
  useEffect(() => {
    const c = ctrl.current;
    if (!c || !open || c.getState().voice !== null || voices.length === 0) return;
    c.setVoice(pickVoice(voices, lang, getReadAloudPrefs().voices[lang]));
  }, [voices, lang, open]);

  /**
   * Cümlenin açık görünümdeki yuvaları, okuma sırasında: başladığı ve bittiği yuva (aynıysa bir). Sayfa görünümünde
   * cümlenin yeri sayfa metninden bulunur (eşzamansız); bulunamazsa boş.
   */
  const slotsOf = useCallback(
    async (list: Sentence[], index: number): Promise<number[]> => {
      const s = list[index];
      if (!s) return [];
      const { view: v, pdf: doc } = latest.current;
      if (v === 'text' || !doc) {
        const src = sourceRef.current;
        return src ? textSlots(src, s) : [];
      }
      const parts = await pagesFor(doc, blocks, list)
        .locate(s)
        .catch(() => []);
      const src = sourceRef.current;
      if (!src?.slotOf || latest.current.view !== 'page') return [];
      const slots: number[] = [];
      for (const p of parts) {
        const slot = src.slotOf({ locator: { block: s.block, offset: s.start }, pdfPage: p.page });
        if (slot !== null && !slots.includes(slot)) slots.push(slot);
      }
      return slots;
    },
    [blocks, sourceRef],
  );

  /** Efektle çevrilen sayfa: çevirme sürerken gelen cümle ikinci kez çevirmesin */
  const turning = useRef<{ slot: number; from: number; at: number } | null>(null);

  /**
   * Cümle açık sayfada (çift sayfada iki sayfadan birinde) değilse sayfayı çevirir: bir sonraki sayfaysa efektle,
   * değilse doğrudan. Sayfa sınırından taşan cümlenin bir parçası açık sayfadaysa çevrilmez.
   */
  const reveal = useCallback(
    async (list: Sentence[], index: number) => {
      const s = list[index];
      if (!s) return;
      const v = latest.current.view;
      let slots = await slotsOf(list, index);
      // Bu arada başka cümleye geçildiyse ya da görünüm değiştiyse bu çevirme geçersiz
      if (ctrl.current?.getState().current !== index || latest.current.view !== v) return;
      const src = sourceRef.current;
      if (!src?.slotOf) return;
      const t = turning.current;
      const busy = t && t.from === src.index && performance.now() - t.at < TURN_MS;
      if (!busy) turning.current = null;
      const shown = busy ? t.slot : src.index;
      // Sayfa görünümünde cümle sayfa metninde bulunamadı: bloğun sayfası ileride ise oraya (geri dönülmez)
      if (slots.length === 0 && v === 'page') {
        const slot = src.slotOf({
          locator: { block: s.block, offset: s.start },
          pdfPage: blocks[s.block]?.srcPage ?? 0,
        });
        if (slot !== null && slot > shown) slots = [slot];
      }
      if (slots.length === 0 || slots.includes(shown)) return;
      const slot = slots[0];
      if (!busy && slot === src.index + (src.spread ? 2 : 1)) {
        turning.current = { slot, from: src.index, at: performance.now() };
        latest.current.turnNext();
      } else src.go(slot);
    },
    [blocks, sourceRef, slotsOf],
  );

  /** Denetleyici (ilk açılışta kurulur) */
  const ensure = useCallback((): { c: ReadAloud; list: Sentence[] } | null => {
    if (!engine) return null;
    // Cümle dizini ilk açılışta kurulur (büyük kitapta birkaç yüz ms)
    const list = (listRef.current ??= buildSentenceIndex(blocks, lang));
    if (!sentences) setSentences(list);
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
        onSentence: (i) => {
          setActive(i);
          void reveal(list, i);
        },
      });
      setState(ctrl.current.getState());
    }
    return { c: ctrl.current, list };
  }, [engine, sentences, blocks, lang, reveal]);

  /**
   * Okumaya başlar: kaldığı cümle açık sayfadaysa oradan, değilse açık sayfanın ilk cümlesinden. Kullanıcının
   * dokunuşunda çağrılır: metin görünümünde konuşma dokunuşun içinde başlar; sayfa görünümünde ilk cümle sayfa
   * metninden arandığı için motor dokunuşta sessizce açılır (iOS).
   */
  const start = useCallback(() => {
    const ready = ensure();
    if (!ready || !engine) return;
    const { c, list } = ready;
    if (list.length === 0) return;
    const last = c.getState().current;
    const { view: v, pdf: doc, pos: p } = latest.current;
    if (v === 'text' || !doc) {
      const src = sourceRef.current;
      const shown = (i: number) => !!src && textSlots(src, list[i]).includes(src.index);
      if (last >= 0 && shown(last)) return c.play(last);
      // Açık sayfanın ilk cümlesi: okuma yerindeki cümleden, sayfaya taşan ilk cümleye dek geri
      let from = sentenceAt(list, p.locator)?.id ?? list.length - 1;
      for (let k = 0; k < MAX_BACK && from > 0 && shown(from - 1); k++) from--;
      c.play(from);
      return;
    }
    engine.prime();
    const pages = pagesFor(doc, blocks, list);
    const src = sourceRef.current;
    // Açık (çift sayfada soldaki) PDF sayfası
    const first =
      src?.slotOf &&
      p.pdfPage > 0 &&
      src.slotOf({ locator: p.locator, pdfPage: p.pdfPage - 1 }) === src.index
        ? p.pdfPage - 1
        : p.pdfPage;
    const id = ++starting.current;
    void (async () => {
      const index = sourceRef.current?.index;
      const from =
        last >= 0 && index !== undefined && (await slotsOf(list, last)).includes(index)
          ? last
          : ((await pages.firstOnPage(first).catch(() => undefined))?.id ?? 0);
      // Bu arada kapatıldıysa ya da yeniden başlatıldıysa okunmaz
      if (starting.current === id) c.play(from);
    })();
  }, [ensure, engine, blocks, sourceRef, slotsOf]);

  const close = useCallback(() => {
    starting.current++;
    ctrl.current?.stop();
    setOpen(false);
  }, []);

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
    else if (c.getState().status === 'paused') c.resume();
    else start();
  }, [start]);

  // Okuyucudan çıkınca konuşma susar
  useEffect(() => () => ctrl.current?.dispose(), []);

  useWakeLock(open && state?.status === 'playing');

  // Boşluk oynatır/duraklatır, Esc kapatır (menüden ve sayfa çevirmeden önce: yakalama aşaması)
  useEffect(() => {
    if (!open || !keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && t.closest('input, select, textarea, [contenteditable]'))
        return;
      if (e.key === ' ' && !(t instanceof HTMLElement && t.closest('button, a[href]'))) toggle();
      else if (e.key === 'Escape') close();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, keys, toggle, close]);

  const sentence = open && sentences && active >= 0 ? (sentences[active] ?? null) : null;
  useTextHighlight(rootRef, blocks, view === 'text' ? sentence : null);
  const pages = useMemo(
    () => (pdf && sentences ? pagesFor(pdf, blocks, sentences) : null),
    [pdf, blocks, sentences],
  );
  const overlays = useSentenceOverlays(view === 'page' ? pages : null, sentence);

  // Sonraki cümlenin yeri önceden bulunsun (sayfanın metni hazır olsun)
  useEffect(() => {
    if (pages && sentences && active >= 0 && sentences[active + 1])
      void pages.locate(sentences[active + 1]).catch(() => undefined);
  }, [pages, sentences, active]);

  return {
    available: !!engine && hasText,
    open,
    state,
    voices,
    toggleOpen,
    close,
    toggle,
    next: () => ctrl.current?.next(),
    prev: () => ctrl.current?.prev(),
    setRate: (rate) => {
      ctrl.current?.setRate(rate);
      setReadAloudPrefs({ rate: ctrl.current?.getState().rate ?? rate });
    },
    setVoice: (voice) => {
      ctrl.current?.setVoice(voice);
      setReadAloudPrefs({ voices: { ...getReadAloudPrefs().voices, [lang]: voice } });
    },
    setSleep: (minutes) => ctrl.current?.setSleep(minutes),
    overlays,
  };
}
