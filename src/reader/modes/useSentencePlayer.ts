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
import { pdfPageMaps } from '../../text/pdfPageMaps';
import { createSentencePages, sentenceText, type SentencePages } from '../../text/sentencePages';
import { buildSentenceIndex, sentenceAt, type Sentence } from '../../text/sentences';
import type { BookSource } from '../FlipBook';
import type { ReadingPosition } from '../progress';
import type { ReaderView } from '../readerPrefs';
import { useSentenceOverlays, type PageOverlays } from './pageHighlight';
import { createPageInfoCache, pageSentenceAt, pdfPageAt, textSentenceAt } from './pointHit';
import { paintDecor, useTextHighlight } from './textHighlight';
import type { WordStore } from './wordTrack';
import { modalOpen } from '../../ui/modalStack';

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
  /**
   * Dokunulan cümleden okunur (sesli okuma, Plan 13): açık sayfaların cümleleri önceden okunur, dokunuş çoğunlukla
   * eşzamanlı bulunur
   */
  tapToRead?: boolean;
  /**
   * Okunan yeri belirginleştir (sesli okuma, Plan 14): cümlenin ilk satırının solunda kenar çizgisi, okuma sayfayı
   * çevirince cümle bir kez parlar
   */
  emphasis?: boolean;
  /** okunan kelimenin deposu (sayfa görünümünde cümlenin katmanının yanında çizilir); null: kelime takibi yok */
  word?: WordStore | null;
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
  /**
   * Ekrandaki noktadaki cümleden başlatır (dokunduğun cümleden oku, Plan 13). Metin görünümünde ve sayfanın cümleleri
   * önbellekteyse `play` hemen (dokunuşun içinde); değilse önce `prime`, sayfanın cümleleri gelince `play`. Noktada
   * cümle yoksa `play` yerine `miss` (aynı yoldan: hemen ya da sonra). Süren başlatmayı geçersiz kılar.
   */
  startAtPoint(
    x: number,
    y: number,
    play: (from: number) => void,
    opts: { prime(): void; miss(): void },
  ): void;
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
  /**
   * Okunan cümle açık sayfada değil: okur kendisi başka sayfaya gitti (oynarken ya da duraklatılmışken). Okur okunan
   * sayfaya dönünce, okuma okurun sayfasına gelince ya da `returnToReading` ile söner.
   */
  away: boolean;
  /** "Okunan yere dön": okuma yeniden sayfayı izler, okunan cümlenin sayfası açılır, cümle parlar */
  returnToReading(): void;
}

/**
 * Okuma sayfayı çevirince parlama sınıfının durduğu süre (ms): çevirme (~650 ms), cümlenin yerinin bulunması ve CSS
 * animasyonu (gecikme + 600 ms) bitene dek
 */
const PULSE_MS = 1_800;

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
    // Sayfa haritaları belgenin ortak önbelleğinden (arama sonucunun yeri de aynı haritaları kullanır)
    pages = createSentencePages({
      blocks,
      sentences,
      pageCount: pdf.numPages,
      getPageMap: pdfPageMaps(pdf),
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
  tapToRead = false,
  emphasis = false,
  word = null,
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
  /** okunan cümle açık sayfada değil, okur başka sayfada (bkz. SentencePlayer.away) */
  const [away, setAway] = useState(false);
  /** okuma sayfayı çevirdi: okunan cümle bir kez parlar (sayaç: art arda çevirmede süre yeniden başlar) */
  const [pulse, setPulse] = useState<number | null>(null);
  const pulses = useRef(0);
  /** Okuma yeniden sayfayı izler (okur döndü ya da düğmeye bastı): "Okunan yere dön" söner */
  const followAgain = useCallback(() => {
    follow.current = true;
    setAway(false);
  }, []);
  const markAway = useCallback(() => setAway(true), []);

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

  /** sayfa değişince süren "okunan cümle bu sayfada mı" denetimi: yenisi gelince eskisi geçersiz */
  const checking = useRef(0);

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
      if (slots.includes(shown)) followAgain();
      // Okur başka sayfada göz atıyor: okuma onu geri çekmez, "Okunan yere dön" görünür
      if (slots.length > 0 && !slots.includes(shown) && !follow.current) markAway();
      if (slots.length === 0 || slots.includes(shown) || !follow.current) return;
      const slot = slots[0];
      expected.current = slot;
      setAway(false);
      // Göz yeni sayfada cümlenin başını bulsun: cümle bir kez parlar
      setPulse(++pulses.current);
      if (!busy && slot === src.index + (src.spread ? 2 : 1)) {
        turning.current = { slot, from: src.index, at: performance.now() };
        latest.current.turnNext();
      } else src.go(slot);
    },
    [blocks, sourceRef, slotsOf, followAgain, markAway],
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
      followAgain();
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
    [index, blocks, sourceRef, slotsOf, followAgain],
  );

  /** Sayfa görünümünde sayfaların cümleleri (noktadaki cümle için; kitap ya da dil değişince unutulur) */
  const pageHits = useMemo(() => createPageInfoCache(), []);

  /** dokunuşla süren (eşzamansız) cümle araması: yenisi gelince eskisi geçersiz */
  const tapping = useRef(0);

  const startAtPoint = useCallback(
    (x: number, y: number, play: (from: number) => void, opts: { prime(): void; miss(): void }) => {
      const root = rootRef.current;
      const list = index();
      const tap = ++tapping.current;
      // Cümle bulununca: süren başlatma geçersiz kılınır, okuma yeniden sayfayı izler. Bulunmazsa (yazı olmayan yer)
      // hiçbiri değişmez: okur ileriye göz atıyorsa okuma onu geri çekmez, açılmakta olan okuma başlar.
      const playNow = (from: number) => {
        starting.current++;
        followAgain();
        play(from);
      };
      if (!root || list.length === 0) return opts.miss();
      const { view: v, pdf: doc } = latest.current;
      if (v === 'text' || !doc) {
        const s = textSentenceAt(root, blocks, list, x, y)?.sentence;
        return s ? playNow(s.id) : opts.miss();
      }
      const hit = pdfPageAt(root, x, y);
      if (!hit) return opts.miss();
      const sp = pagesFor(doc, blocks, list);
      const known = pageHits.get(sp, hit.page);
      if (known) {
        const s = pageSentenceAt(hit.el, known, x, y);
        return s === null ? opts.miss() : playNow(s);
      }
      // Sayfanın metni henüz okunmadı: ses dokunuşta açılır, cümle bulununca okunur. Bu arada başka bir başlatma,
      // yeni bir dokunuş ya da sayfa değişimi olduysa (öğe kalktı) sonuç yok sayılır.
      opts.prime();
      const started = starting.current;
      const slot = sourceRef.current?.index;
      const stale = () =>
        tapping.current !== tap ||
        starting.current !== started ||
        !hit.el.isConnected ||
        sourceRef.current?.index !== slot;
      pageHits.load(sp, hit.page).then(
        (info) => {
          if (stale()) return;
          const s = pageSentenceAt(hit.el, info, x, y);
          if (s === null) opts.miss();
          else playNow(s);
        },
        () => {
          if (!stale()) opts.miss();
        },
      );
    },
    [index, blocks, rootRef, sourceRef, pageHits, followAgain],
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

  const reset = useCallback(() => {
    setActive(-1);
    setAway(false);
    setPulse(null);
  }, []);

  // Sayfa okurca (dokunma, tuş, kaydırıcı, içindekiler) çevrildi: okuma onu geri çekmez. Görünüm değişince
  // (sayfalar yeniden kurulur) okuma yine izler. Açık yuva her çizimden sonra denetlenir (sourceRef çizimde güncellenir).
  const seen = useRef<{ index: number | null; view: ReaderView }>({ index: null, view });
  useEffect(() => {
    const idx = sourceRef.current?.index ?? null;
    const prev = seen.current;
    if (idx === prev.index && view === prev.view) return;
    seen.current = { index: idx, view };
    if (view !== prev.view) {
      followAgain();
      expected.current = null;
    } else if (idx !== null && idx !== prev.index) {
      if (idx === expected.current) {
        // Okumanın kendi çevirmesi: izliyordu
        expected.current = null;
        followAgain();
        return;
      }
      if (latest.current.playing()) follow.current = false;
      if (!emphasis || !open || prev.index === null) return;
      // Okunan cümle bu sayfada mı: okur kendisi döndüyse okuma yeniden izler, değilse "Okunan yere dön"
      const i = latest.current.current();
      const list = sentences;
      if (!list || i < 0) return;
      const check = ++checking.current;
      void slotsOf(list, i).then((slots) => {
        if (check !== checking.current || slots.length === 0) return;
        if (slots.includes(sourceRef.current?.index ?? -1)) followAgain();
        else markAway();
      });
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
  // Çevirme sürerken okuma sonraki cümleye geçmiş olabilir: yeni sayfada vurgulanan cümle parlar
  const pulsing = emphasis && !!sentence && pulse !== null;
  // Metin görünümünde cümlenin süsü (kenar çizgisi, parlama) sayfanın içindeki katmanda
  const decorate = useMemo(
    () =>
      emphasis ? (ranges: Range[]) => paintDecor(ranges, { bar: true, pulse: pulsing }) : undefined,
    [emphasis, pulsing],
  );
  useTextHighlight(rootRef, blocks, view === 'text' ? sentence : null, focus, { decorate });
  const pages = useMemo(
    () => (pdf && sentences ? pagesFor(pdf, blocks, sentences) : null),
    [pdf, blocks, sentences],
  );
  const wordText = word && sentence ? sentenceText(blocks, sentence) : '';
  const overlays = useSentenceOverlays(view === 'page' ? pages : null, sentence, focus, {
    bar: emphasis,
    pulse: pulsing,
    word: word && sentence ? { store: word, text: wordText } : null,
  });

  // Açık sayfaların cümleleri önceden okunsun: dokunulan cümle çoğunlukla hemen (dokunuşun içinde) bulunur
  const shownPdfPage = pos.pdfPage;
  useEffect(() => {
    if (!tapToRead || !open || view !== 'page' || !pages || !pdf) return;
    const load = (p: number) => {
      if (p >= 0 && p < pdf.numPages) void pageHits.load(pages, p).catch(() => undefined);
    };
    load(shownPdfPage);
    // Komşular biraz sonra: sayfa çevirme animasyonuyla çakışmasın (requestIdleCallback iOS ≤ 18'de yok)
    const timer = setTimeout(() => {
      load(shownPdfPage - 1);
      load(shownPdfPage + 1);
    }, 300);
    return () => clearTimeout(timer);
  }, [tapToRead, open, view, pages, pdf, shownPdfPage, pageHits]);

  // Sonraki cümlenin yeri önceden bulunsun (sayfanın metni hazır olsun)
  useEffect(() => {
    if (pages && sentences && active >= 0 && sentences[active + 1])
      void pages.locate(sentences[active + 1]).catch(() => undefined);
  }, [pages, sentences, active]);

  const cancelStart = useCallback(() => {
    starting.current++;
  }, []);
  const returnToReading = useCallback(() => {
    followAgain();
    const i = latest.current.current();
    if (sentences && i >= 0) void reveal(sentences, i);
  }, [followAgain, sentences, reveal]);

  // Parlama kısa sürer: sınıf kalkar (aynı cümleye yeniden dönülünce yeniden parlar)
  useEffect(() => {
    if (!pulse) return;
    const timer = setTimeout(() => setPulse(null), PULSE_MS);
    return () => clearTimeout(timer);
  }, [pulse]);

  return {
    away: emphasis && open && away,
    returnToReading,
    index,
    show,
    showTail,
    start,
    startAtPoint,
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
      // Kipli pencere açıkken (şifre, kendi sesin) tuşlar pencerenin
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || modalOpen()) return;
      const t = e.target;
      // Yazı alanında tuşlar alanın; açma/kapama düğmesinde (ses menüsündeki ayarlar) Esc yine menüyü kapatır
      if (
        t instanceof HTMLElement &&
        t.closest(
          'input:not([type="checkbox"]):not([type="radio"]), select, textarea, [contenteditable]',
        )
      )
        return;
      if (e.key === ' ' && !(t instanceof HTMLElement && t.closest('button, a[href], input')))
        toggle();
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
