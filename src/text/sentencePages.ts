import type { Block, PageText } from '../convert/types';
import {
  findTextRects,
  pageCharMap,
  type MatchPart,
  type PageCharMap,
  type TextMatch,
  type TextRect,
} from './pageGeometry';
import { sentenceAt, type Sentence } from './sentences';

/** Cümlenin bir PDF sayfasındaki parçası (dikdörtgenler PDF biriminde, sayfanın sol üstünden). */
export interface SentencePart {
  /** PDF sayfası (0'dan) */
  page: number;
  part: MatchPart;
  rects: TextRect[];
  /** eşleşmenin sayfa metnindeki [start, end) aralığı; `end` sonraki cümlenin aramasına ipucu olur */
  start: number;
  end: number;
  pageWidth: number;
  pageHeight: number;
}

export interface SentencePages {
  /** Cümlenin sayfalardaki parçaları, okuma sırasında: tek sayfada ya da baş ve son parça. Bulunamazsa boş. */
  locate(s: Sentence): Promise<SentencePart[]>;
  /** Cümlenin bulunmuş yeri (eşzamanlı): `locate` sonuçlandıysa parçaları, değilse undefined */
  known(s: Sentence): SentencePart[] | undefined;
  /** Sayfada okunacak ilk cümle: önceki sayfadan süren paragrafın sayfaya taşan cümlesi dahil. */
  firstOnPage(page: number): Promise<Sentence | undefined>;
  /**
   * Sayfadaki bütün cümleler, okuma sırasında, her biri sayfadaki parçasıyla (kalemle odakta noktanın altındaki
   * cümle bunlardan bulunur). Önbellekli; bulunamayan cümle atlanır.
   */
  onPage(page: number): Promise<PageSentence[]>;
}

/** Sayfadaki cümle ve onun bu sayfadaki parçası */
export interface PageSentence {
  sentence: Sentence;
  part: SentencePart;
}

interface Options {
  blocks: Block[];
  sentences: Sentence[];
  pageCount: number;
  /** sayfanın metni ve harf konumları (pdfSource.getPageText) */
  getPageText(page: number): Promise<PageText>;
}

/** Bellekte tutulan sayfa haritası ve cümle yeri sayısı (en eskisi atılır) */
const MAP_CACHE = 24;
const PLACE_CACHE = 400;
/** Bir cümle bloğun başladığı sayfadan en çok bu kadar sayfa ötede aranır (çok uzun paragraf) */
const MAX_SPAN = 30;
/** Sayfanın ilk cümlesi aranırken önceki sayfadan süren paragrafta en çok bu kadar cümle geri gidilir */
const MAX_BACK = 200;
/** Sayfanın cümleleri toplanırken en çok bu kadar cümleye bakılır; art arda bu kadarı bulunamazsa durulur */
const MAX_ON_PAGE = 300;
const MAX_MISSES = 12;

/** Cümlenin blok metnindeki hâli */
export function sentenceText(blocks: Block[], s: Sentence): string {
  const b = blocks[s.block];
  return b && 'text' in b ? b.text.slice(s.start, s.end) : '';
}

function remember<K, V>(cache: Map<K, V>, key: K, value: V, limit: number): V {
  cache.set(key, value);
  if (cache.size > limit) cache.delete(cache.keys().next().value as K);
  return value;
}

/**
 * Cümlelerin PDF sayfalarındaki yeri (sayfa görünümünde vurgu ve sayfa çevirme için). Sayfa haritası sayfa başına
 * bir kez kurulur; cümleler sırayla okunduğundan her cümle bir öncekinin bittiği yerden (sayfa ve ipucu) aranır:
 * aynı kısa cümle ("Evet.") sayfada birkaç kez geçse de doğrusu bulunur.
 */
export function createSentencePages({
  blocks,
  sentences,
  pageCount,
  getPageText,
}: Options): SentencePages {
  const maps = new Map<number, Promise<PageCharMap>>();
  const places = new Map<number, Promise<SentencePart[]>>();
  /** sonuçlanan aramaların parçaları (eşzamanlı okumak için); aramanın kendisi atılınca bu da geçersizdir */
  const settled = new WeakMap<Promise<SentencePart[]>, SentencePart[]>();
  /** sayfanın ilk cümlesi arandığında bulunan yer: o cümle bu sayfadan aranır */
  const seeds = new Map<number, { page: number; hint: number }>();

  const mapOf = (page: number): Promise<PageCharMap> => {
    const cached = maps.get(page);
    if (cached) return cached;
    const p = getPageText(page).then(pageCharMap);
    // Okunamayan sayfa sonraki denemede yeniden okunsun
    p.catch(() => maps.delete(page));
    return remember(maps, page, p, MAP_CACHE);
  };

  const toPart = (page: number, m: TextMatch): SentencePart => ({
    page,
    part: m.part,
    rects: m.rects,
    start: m.start,
    end: m.end,
    pageWidth: m.pageWidth,
    pageHeight: m.pageHeight,
  });

  /** Paragrafın bitebileceği son sayfa: sonraki bloğun başladığı sayfa */
  const lastPageOf = (block: number): number => {
    const start = blocks[block]?.srcPage ?? 0;
    const next = blocks[block + 1]?.srcPage ?? pageCount - 1;
    return Math.min(pageCount - 1, Math.max(start, next), start + MAX_SPAN);
  };

  async function search(
    text: string,
    from: number,
    to: number,
    hintPage: number,
    hint: number,
  ): Promise<SentencePart[]> {
    let partial: SentencePart[] | null = null;
    for (let p = from; p <= to; p++) {
      const m = findTextRects(await mapOf(p), text, p === hintPage ? hint : 0);
      if (!m) continue;
      if (m.part === 'whole') return [toPart(p, m)];
      if (partial) continue;
      if (m.part === 'head' && p + 1 < pageCount) {
        const tail = findTextRects(await mapOf(p + 1), text);
        if (tail?.part === 'tail') return [toPart(p, m), toPart(p + 1, tail)];
      }
      // Yalnızca bir parçası bulundu; sonraki sayfalarda tamamı çıkarsa o seçilir
      partial = [toPart(p, m)];
    }
    return partial ?? [];
  }

  async function find(s: Sentence): Promise<SentencePart[]> {
    const text = sentenceText(blocks, s);
    if (!text || pageCount === 0) return [];
    const first = Math.min(pageCount - 1, Math.max(0, blocks[s.block]?.srcPage ?? 0));
    const last = lastPageOf(s.block);
    // Önceki cümlenin bittiği yer (bellekteyse): arama oradan başlar
    let fromPage = first;
    let hintPage = -1;
    let hint = 0;
    const seed = seeds.get(s.id);
    const prev = places.get(s.id - 1);
    if (seed) {
      fromPage = seed.page;
      hintPage = seed.page;
      hint = seed.hint;
    } else if (prev) {
      const parts = await prev.catch(() => []);
      const end = parts[parts.length - 1];
      if (end && end.page >= first && end.page <= last) {
        fromPage = end.page;
        hintPage = end.page;
        hint = end.end;
      }
    }
    const found = await search(text, fromPage, last, hintPage, hint);
    // Önceki cümlenin yeri yanlışsa: bloğun başından ipucusuz
    if (found.length === 0 && fromPage > first) return search(text, first, last, -1, 0);
    return found;
  }

  const locate = (s: Sentence): Promise<SentencePart[]> => {
    const cached = places.get(s.id);
    if (cached) return cached;
    const p = find(s);
    p.then(
      (parts) => settled.set(p, parts),
      () => places.delete(s.id),
    );
    return remember(places, s.id, p, PLACE_CACHE);
  };

  const lists = new Map<number, Promise<PageSentence[]>>();

  /**
   * Sayfanın cümleleri: sayfanın ilk cümlesinden başlayıp sırayla, her biri öncekinin bittiği yerden aranır (aynı
   * kısa cümle sayfada iki kez geçse de doğrusu). Cümle yeri önbelleğinden bağımsızdır: sayfanın ilk cümlesi
   * aranınca taşan cümlenin önbellekteki yeri yalnızca son parçası olabilir, burada iki sayfada da bulunur. Sayfada
   * baş parçası (sonraki sayfaya taşan) bulunan cümle sayfanın sonudur.
   */
  async function collect(page: number): Promise<PageSentence[]> {
    const start = await first(page);
    const out: PageSentence[] = [];
    if (!start) return out;
    const map = await mapOf(page);
    let hint = start.at;
    let misses = 0;
    for (let id = start.id; id < sentences.length && id - start.id < MAX_ON_PAGE; id++) {
      const s = sentences[id];
      if ((blocks[s.block]?.srcPage ?? 0) > page) break;
      const m = findTextRects(map, sentenceText(blocks, s), hint);
      // Sayfanın ortasında yalnızca parçası bulunan cümle rastlantıdır (baş parçası sonda, son parçası başta olur)
      if (!m || (m.part === 'tail' && out.length > 0)) {
        if (++misses >= MAX_MISSES) break;
        continue;
      }
      out.push({ sentence: s, part: toPart(page, m) });
      misses = 0;
      hint = m.end;
      if (m.part === 'head') break;
    }
    return out;
  }

  /**
   * Sayfanın ilk cümlesi ve sayfa metnindeki yeri (bkz. firstOnPage); `back`: önceki sayfalardan süren paragrafın
   * cümlesi. Cümle yeri önbelleğine dokunmaz.
   */
  async function first(
    page: number,
  ): Promise<{ id: number; at: number; back: boolean } | undefined> {
    if (sentences.length === 0) return undefined;
    // Sayfada başlayan ilk blok (yoksa sonraki) ve onun ilk cümlesi
    const i = blocks.findIndex((b) => b.srcPage >= page);
    const next = i >= 0 ? sentenceAt(sentences, { block: i, offset: 0 }) : undefined;
    const fallback = { id: (next ?? sentences[sentences.length - 1]).id, at: 0, back: false };
    const firstNew = next?.id ?? sentences.length;
    // Önceki sayfalardan süren paragraf: sayfada (tamamen ya da sonu) bulunan en geriye kadar gidilir
    let map: PageCharMap;
    try {
      map = await mapOf(page);
    } catch {
      return fallback;
    }
    let found: { id: number; at: number; back: boolean } | null = null;
    for (let j = firstNew - 1; j >= 0 && firstNew - j <= MAX_BACK; j--) {
      const s = sentences[j];
      if ((blocks[s.block]?.srcPage ?? 0) > page) continue;
      const m = findTextRects(map, sentenceText(blocks, s));
      if (m?.part === 'whole' || m?.part === 'tail') found = { id: j, at: m.start, back: true };
      if (m?.part !== 'whole') break;
    }
    return found ?? fallback;
  }

  async function firstOnPage(page: number): Promise<Sentence | undefined> {
    const found = await first(page);
    if (!found) return undefined;
    // Önceki sayfalardan süren paragrafın cümlesi: o cümle bu sayfadan aranır
    if (found.back) {
      seeds.set(found.id, { page, hint: found.at });
      places.delete(found.id);
    }
    return sentences[found.id];
  }

  return {
    locate,

    known(s) {
      const p = places.get(s.id);
      return p && settled.get(p);
    },

    firstOnPage,

    onPage(page) {
      const cached = lists.get(page);
      if (cached) return cached;
      const p = collect(page);
      p.catch(() => lists.delete(page));
      return remember(lists, page, p, MAP_CACHE);
    },
  };
}
