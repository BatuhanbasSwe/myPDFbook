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
  /** Sayfada okunacak ilk cümle: önceki sayfadan süren paragrafın sayfaya taşan cümlesi dahil. */
  firstOnPage(page: number): Promise<Sentence | undefined>;
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

  return {
    locate(s) {
      const cached = places.get(s.id);
      if (cached) return cached;
      const p = find(s);
      p.catch(() => places.delete(s.id));
      return remember(places, s.id, p, PLACE_CACHE);
    },

    async firstOnPage(page) {
      if (sentences.length === 0) return undefined;
      // Sayfada başlayan ilk blok (yoksa sonraki) ve onun ilk cümlesi
      const i = blocks.findIndex((b) => b.srcPage >= page);
      const next = i >= 0 ? sentenceAt(sentences, { block: i, offset: 0 }) : undefined;
      const firstNew = next?.id ?? sentences.length;
      // Önceki sayfalardan süren paragraf: sayfada (tamamen ya da sonu) bulunan en geriye kadar gidilir
      let map: PageCharMap;
      try {
        map = await mapOf(page);
      } catch {
        return next ?? sentences[sentences.length - 1];
      }
      let found: { id: number; start: number } | null = null;
      for (let j = firstNew - 1; j >= 0 && firstNew - j <= MAX_BACK; j--) {
        const s = sentences[j];
        if ((blocks[s.block]?.srcPage ?? 0) > page) continue;
        const m = findTextRects(map, sentenceText(blocks, s));
        if (m?.part === 'whole' || m?.part === 'tail') found = { id: j, start: m.start };
        if (m?.part !== 'whole') break;
      }
      if (!found) return next ?? sentences[sentences.length - 1];
      seeds.set(found.id, { page, hint: found.start });
      places.delete(found.id);
      return sentences[found.id];
    },
  };
}
