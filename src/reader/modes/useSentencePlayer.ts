import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { Block, Lang } from '../../convert/types';
import type { PdfDocument } from '../../pdf/pdfjs';
import { createPdfSource } from '../../pdf/pdfSource';
import { createSentencePages, type SentencePages } from '../../text/sentencePages';
import { buildSentenceIndex, sentenceAt, type Sentence } from '../../text/sentences';
import type { BookSource } from '../FlipBook';
import type { ReadingPosition } from '../progress';
import type { ReaderView } from '../readerPrefs';
import { useSentenceOverlays, type PageOverlays } from './pageHighlight';
import { useTextHighlight } from './textHighlight';

/**
 * Cümle oynatıcısı: okuma modlarının (sesli okuma, hızlı okuma) ortak parçası. Denetleyici cümleden cümleye geçer;
 * bu kanca etkin cümleyi iki görünümde vurgular, sayfa dışına çıkınca sayfayı çevirir (bir sonraki sayfaysa
 * efektle, değilse doğrudan), okumanın açık sayfadan başlayacağı cümleyi bulur. Okur sayfayı elle çevirince
 * (ileriye göz atmak) okuma onu geri çekmez; okurun işi (not, panel, kalem kipi) sürerken sayfa çevrilmez.
 */

export interface SentencePlayerOptions {
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
  /**
   * Kitabın üstünde okurun işi var (not yazılıyor, panel açık, kalem kipi): okuma sayfayı kendiliğinden çevirmez,
   * iş bitince etkin cümlenin sayfasına geçilir
   */
  hold: boolean;
  /** oynatıcı açık: vurgu yalnızca açıkken */
  open: boolean;
  /** denetleyicinin etkin cümlesi (-1: yok) ve oynayıp oynamadığı (anlık) */
  current(): number;
  playing(): boolean;
  /** odak: etkin cümle dışındakiler karartılır */
  focus?: boolean;
  /**
   * Vurguyu oynatıcı çizer (varsayılan). Kalemle odakta vurgu okuyucuyu yeniden çizmeden kendi katmanında çizilir:
   * oynatıcı yalnızca cümle dizini, başlangıç ve sayfa izleme için kullanılır.
   */
  paint?: boolean;
}

export interface SentencePlayer {
  /** cümle dizini (ilk çağrıda kurulur; büyük kitapta birkaç yüz ms) */
  index(): Sentence[];
  /** denetleyicinin `onSentence`ı: cümleyi vurgular, gerekirse sayfayı çevirir */
  show(list: Sentence[], index: number): void;
  /** sayfa sınırından taşan cümlenin son parçasına geçildi (hızlı okuma): parça açık değilse sayfa çevrilir */
  showTail(list: Sentence[], index: number): void;
  /**
   * Okumayı başlatır: `last` (kaldığı cümle) açık sayfadaysa oradan, değilse açık sayfanın ilk cümlesinden. Metin
   * görünümünde `play` hemen (dokunuşun içinde) çağrılır; sayfa görünümünde cümle sayfa metninden arandığı için
   * önce `prime` (dokunuşta yapılması gereken iş), sonra eşzamansız `play`.
   */
  start(last: number, play: (from: number) => void, prime?: () => void): void;
  /** süren başlatmayı geçersiz kılar (kapatıldı) */
  cancelStart(): void;
  /** okuma yeniden sayfayı izler (okur oynat, önceki, sonraki düğmesine bastı) */
  follow(): void;
  /**
   * Etkin cümlenin sayfa sınırından taşıyorsa ilk sayfadaki payı (0–1); taşmıyorsa ya da henüz bilinmiyorsa null.
   * Sayfa görünümünde cümlenin sayfa metnindeki harfleri, metin görünümünde bloktaki harfleri sayılır.
   */
  splitOf(list: Sentence[], index: number): number | null;
  /**
   * `splitOf`, cümlenin yeri bulunduktan sonra: sayfa görünümünde cümlenin sayfa metnindeki yeri önce aranır
   * (önbellekteyse hemen). Pay henüz bilinmeyen cümlede sayfa bu yolla yine cümlenin ortasında çevrilir.
   */
  splitLater(list: Sentence[], index: number): Promise<number | null>;
  /** oynatıcı kapandı: etkin cümle unutulur (yeniden açılınca eski cümle bir an vurgulanmasın) */
  reset(): void;
  /** sayfa görünümünde etkin cümlenin vurgusu (usePdfBook → overlays) */
  overlays: PageOverlays | undefined;
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

/** Aynı kitabın cümle dizini (dile göre): okuma modları aynı diziyi ve sayfa yeri önbelleğini paylaşır */
const indexCache = new WeakMap<Block[], Map<Lang, Sentence[]>>();

function sentenceIndex(blocks: Block[], lang: Lang): Sentence[] {
  let byLang = indexCache.get(blocks);
  if (!byLang) indexCache.set(blocks, (byLang = new Map()));
  let list = byLang.get(lang);
  if (!list) byLang.set(lang, (list = buildSentenceIndex(blocks, lang)));
  return list;
}

/** Aynı kitap ve belge için tek bir sayfa yeri önbelleği (başlangıçta ve vurguda aynısı kullanılır) */
const pagesCache = new WeakMap<Sentence[], WeakMap<PdfDocument, SentencePages>>();

export function pagesFor(pdf: PdfDocument, blocks: Block[], sentences: Sentence[]): SentencePages {
  let byPdf = pagesCache.get(sentences);
  if (!byPdf) pagesCache.set(sentences, (byPdf = new WeakMap()));
  let pages = byPdf.get(pdf);
  if (!pages) {
    const source = createPdfSource(pdf, { glyphAdvances: true });
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

export function useSentencePlayer({
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
  current,
  playing,
  focus = false,
  paint = true,
}: SentencePlayerOptions): SentencePlayer {
  const [sentences, setSentences] = useState<Sentence[] | null>(null);
  const [active, setActive] = useState<number>(-1);
  /** sayfa görünümünde başlatma eşzamansız: kapatılınca ya da yeniden başlatılınca eskisi oynatmaz */
  const starting = useRef(0);
  /**
   * Okuma sayfayı izliyor mu: okur sayfayı elle çevirince (ileriye göz atmak) okuma onu geri çekmez; etkin cümle
   * açık sayfaya gelince ya da okur oynat, önceki, sonraki düğmesine basınca yeniden izler
   */
  const follow = useRef(true);
  /** okumanın çevirdiği (çevirmekte olduğu) yuva: bu yuvaya geçiş okurun değil */
  const expected = useRef<number | null>(null);

  // Olay işleyicileri ve eşzamansız işler en güncel değerleri görsün
  const latest = useRef({ view, pdf, pos, turnNext, hold, current, playing });
  useLayoutEffect(() => {
    latest.current = { view, pdf, pos, turnNext, hold, current, playing };
  });

  const index = useCallback((): Sentence[] => {
    const list = sentenceIndex(blocks, lang);
    if (sentences !== list) setSentences(list);
    return list;
  }, [blocks, lang, sentences]);

  /**
   * Cümlenin açık görünümdeki yuvaları, okuma sırasında: başladığı ve bittiği yuva (aynıysa bir). Sayfa görünümünde
   * cümlenin yeri sayfa metninden bulunur (eşzamansız); bulunamazsa boş.
   */
  const slotsOf = useCallback(
    async (list: Sentence[], i: number): Promise<number[]> => {
      const s = list[i];
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
   * değilse doğrudan. Sayfa sınırından taşan cümlenin bir parçası açık sayfadaysa çevrilmez; `tail` ise (cümlenin
   * sayfadaki payı bitti) son parçası açık değilse çevrilir.
   */
  const reveal = useCallback(
    async (list: Sentence[], i: number, tail = false) => {
      const s = list[i];
      if (!s) return;
      const v = latest.current.view;
      let slots = await slotsOf(list, i);
      // Bu arada başka cümleye geçildiyse ya da görünüm değiştiyse bu çevirme geçersiz
      if (latest.current.current() !== i || latest.current.view !== v) return;
      const src = sourceRef.current;
      // Okurun işi bitince (not, panel, kalem kipi) etkin cümleye geçilir
      if (!src?.slotOf || latest.current.hold) return;
      const t = turning.current;
      const busy = t && t.from === src.index && performance.now() - t.at < TURN_MS;
      if (!busy) turning.current = null;
      const shown = busy ? t.slot : src.index;
      if (tail) {
        if (slots.length < 2) return;
        slots = slots.slice(-1);
      }
      // Sayfa görünümünde cümle sayfa metninde bulunamadı: bloğun sayfası ileride ise oraya (geri dönülmez)
      if (slots.length === 0 && v === 'page') {
        const slot = src.slotOf({
          locator: { block: s.block, offset: s.start },
          pdfPage: blocks[s.block]?.srcPage ?? 0,
        });
        if (slot !== null && slot > shown) slots = [slot];
      }
      if (slots.includes(shown)) follow.current = true;
      if (slots.length === 0 || slots.includes(shown) || !follow.current) return;
      const slot = slots[0];
      expected.current = slot;
      if (!busy && slot === src.index + (src.spread ? 2 : 1)) {
        turning.current = { slot, from: src.index, at: performance.now() };
        latest.current.turnNext();
      } else src.go(slot);
    },
    [blocks, sourceRef, slotsOf],
  );

  const show = useCallback(
    (list: Sentence[], i: number) => {
      setActive(i);
      void reveal(list, i);
    },
    [reveal],
  );

  const showTail = useCallback(
    (list: Sentence[], i: number) => void reveal(list, i, true),
    [reveal],
  );

  const start = useCallback(
    (last: number, play: (from: number) => void, prime?: () => void) => {
      const list = index();
      if (list.length === 0) return;
      follow.current = true;
      const { view: v, pdf: doc, pos: p } = latest.current;
      if (v === 'text' || !doc) {
        const src = sourceRef.current;
        const shown = (i: number) => !!src && textSlots(src, list[i]).includes(src.index);
        if (last >= 0 && shown(last)) return play(last);
        // Açık sayfanın ilk cümlesi: okuma yerindeki cümleden, sayfaya taşan ilk cümleye dek geri
        let from = sentenceAt(list, p.locator)?.id ?? list.length - 1;
        for (let k = 0; k < MAX_BACK && from > 0 && shown(from - 1); k++) from--;
        play(from);
        return;
      }
      prime?.();
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
        const shownSlot = sourceRef.current?.index;
        const from =
          last >= 0 && shownSlot !== undefined && (await slotsOf(list, last)).includes(shownSlot)
            ? last
            : ((await pages.firstOnPage(first).catch(() => undefined))?.id ?? 0);
        // Bu arada kapatıldıysa ya da yeniden başlatıldıysa oynatılmaz
        if (starting.current === id) play(from);
      })();
    },
    [index, blocks, sourceRef, slotsOf],
  );

  const splitOf = useCallback(
    (list: Sentence[], i: number): number | null => {
      const s = list[i];
      const src = sourceRef.current;
      if (!s || !src?.slotOf) return null;
      const { view: v, pdf: doc } = latest.current;
      if (v === 'page' && doc) {
        const parts = pagesFor(doc, blocks, list).known(s);
        if (!parts || parts.length < 2) return null;
        const len = (k: number) => Math.max(0, parts[k].end - parts[k].start);
        const total = len(0) + len(parts.length - 1);
        return total > 0 ? len(0) / total : null;
      }
      // Metin görünümünde cümlenin sayfa değiştirdiği yer (ikili arama)
      const slot = (offset: number) =>
        src.slotOf?.({ locator: { block: s.block, offset }, pdfPage: null }) ?? null;
      const head = slot(s.start);
      if (head === null || slot(Math.max(s.start, s.end - 1)) === head) return null;
      let lo = s.start;
      let hi = s.end - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (slot(mid) === head) lo = mid;
        else hi = mid;
      }
      return (hi - s.start) / Math.max(1, s.end - s.start);
    },
    [blocks, sourceRef],
  );

  const splitLater = useCallback(
    async (list: Sentence[], i: number): Promise<number | null> => {
      const s = list[i];
      const { view: v, pdf: doc } = latest.current;
      if (s && v === 'page' && doc)
        await pagesFor(doc, blocks, list)
          .locate(s)
          .catch(() => undefined);
      return splitOf(list, i);
    },
    [blocks, splitOf],
  );

  const reset = useCallback(() => setActive(-1), []);

  // Sayfa okurca (dokunma, tuş, kaydırıcı, içindekiler) çevrildi: okuma onu geri çekmez. Görünüm değişince
  // (sayfalar yeniden kurulur) okuma yine izler. Açık yuva her çizimden sonra denetlenir (sourceRef çizimde güncellenir).
  const seen = useRef<{ index: number | null; view: ReaderView }>({ index: null, view });
  useEffect(() => {
    const idx = sourceRef.current?.index ?? null;
    const prev = seen.current;
    if (idx === prev.index && view === prev.view) return;
    seen.current = { index: idx, view };
    if (view !== prev.view) {
      follow.current = true;
      expected.current = null;
    } else if (idx !== null && idx !== prev.index) {
      if (idx === expected.current) expected.current = null;
      else if (latest.current.playing()) follow.current = false;
    }
  });

  // Okurun işi bitti (not, panel, kalem kipi): okuma sayfayı çevirmediyse etkin cümlenin sayfasına geçilir
  const held = useRef(hold);
  useEffect(() => {
    const was = held.current;
    held.current = hold;
    if (!was || hold || !open || !sentences || !latest.current.playing()) return;
    void reveal(sentences, latest.current.current());
  }, [hold, open, sentences, reveal]);

  const sentence = paint && open && sentences && active >= 0 ? (sentences[active] ?? null) : null;
  useTextHighlight(rootRef, blocks, view === 'text' ? sentence : null, focus);
  const pages = useMemo(
    () => (pdf && sentences ? pagesFor(pdf, blocks, sentences) : null),
    [pdf, blocks, sentences],
  );
  const overlays = useSentenceOverlays(view === 'page' ? pages : null, sentence, focus);

  // Sonraki cümlenin yeri önceden bulunsun (sayfanın metni hazır olsun)
  useEffect(() => {
    if (pages && sentences && active >= 0 && sentences[active + 1])
      void pages.locate(sentences[active + 1]).catch(() => undefined);
  }, [pages, sentences, active]);

  const cancelStart = useCallback(() => {
    starting.current++;
  }, []);
  const followAgain = useCallback(() => {
    follow.current = true;
  }, []);

  return {
    index,
    show,
    showTail,
    start,
    cancelStart,
    follow: followAgain,
    splitOf,
    splitLater,
    reset,
    overlays,
  };
}

/**
 * Oynatıcının tuşları: Boşluk oynatır/duraklatır, Esc kapatır (menüden ve sayfa çevirmeden önce: yakalama aşaması).
 * Kalem kipinde Esc kalem kipinden çıkar (okuyucunun işi). ← → oynatıcı isterse onundur (RSVP'de kelime adımı).
 */
export function usePlayerKeys({
  open,
  keys,
  penOn,
  toggle,
  close,
  onArrow,
}: {
  open: boolean;
  /** Boşluk ve Esc bizim mi (üstte panel ya da pencere açıkken değil) */
  keys: boolean;
  penOn: boolean;
  toggle(): void;
  close(): void;
  /** ← (-1) ve → (1): işlendiyse true (sayfa çevrilmez) */
  onArrow?(dir: 1 | -1): boolean;
}): void {
  useEffect(() => {
    if (!open || !keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && t.closest('input, select, textarea, [contenteditable]'))
        return;
      if (e.key === ' ' && !(t instanceof HTMLElement && t.closest('button, a[href]'))) toggle();
      else if (e.key === 'Escape' && !penOn) close();
      else if (
        !(e.key === 'ArrowLeft' || e.key === 'ArrowRight') ||
        !onArrow?.(e.key === 'ArrowRight' ? 1 : -1)
      )
        return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, keys, penOn, toggle, close, onArrow]);
}

/**
 * Çubuk kapanırken odak çubuktaysa (kapat düğmesi, Esc) kaybolmasın: başlıktaki düğmesine döner. Çubuk
 * kaldırılmadan önce çağrılır.
 */
export function returnFocus(barTestId: string, buttonRef: RefObject<HTMLElement | null>): void {
  if (document.activeElement?.closest(`[data-testid="${barTestId}"]`))
    requestAnimationFrame(() => buttonRef.current?.focus());
}
