import type { Block, Locator } from '../../convert/types';
import type { PageCharMap, TextRect } from '../../text/pageGeometry';
import type { BlockRange } from './textHighlight';

/**
 * Kalemle odağın kelime penceresi (useFocusMode.tsx) için DOM'suz yardımcılar: kalemin altındaki kelime ve onun
 * önünden, arkasından N kelime. Sayfa görünümünde PDF sayfasının harf haritası (pageCharMap), metin görünümünde
 * blok metinleri. Pencere satır ve cümle sınırını aşabilir; sayfa görünümünde sayfada (gövde metninde) kalır. Node'da
 * test edilir.
 */

// ---------------------------------------------------------------------------------------------------------------
// Sayfa görünümü: PDF sayfasının harf haritası

/**
 * Haritanın kelimelerinin ilk harfleri (`text` içindeki konum), okuma sırasında. Kelimeler metin görünümündeki gibi
 * boşlukla ayrılır (bkz. PageCharMap.wordStart); gövde metninin başı ve sonu da kelimeyi böler (tireyle biten son
 * satırdan sonraki sayfa numarası kelimeye katılmasın).
 */
const startsCache = new WeakMap<PageCharMap, Int32Array>();

function wordStarts(map: PageCharMap): Int32Array {
  let starts = startsCache.get(map);
  if (!starts) {
    const out: number[] = [];
    for (let i = 0; i < map.text.length; i++)
      if (map.wordStart[i] || i === 0 || i === map.bodyStart || i === map.bodyEnd) out.push(i);
    starts = Int32Array.from(out);
    startsCache.set(map, starts);
  }
  return starts;
}

/** Harfin kelimesi (kelime dizisindeki sıra): harften önce başlayan son kelime */
function wordOfChar(starts: Int32Array, i: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= i) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Noktaya (PDF birimi) en yakın harf: kutusunun içindeyse o, değilse `tolerance` içindeki en yakını (satır arası,
 * kelime arası, satırın hemen yanı). Hiçbiri yakın değilse null.
 */
export function charAtPoint(
  map: PageCharMap,
  x: number,
  y: number,
  tolerance: number,
): number | null {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < map.boxes.length; i++) {
    const b = map.boxes[i];
    const dx = Math.max(b.x0 - x, 0, x - b.x1);
    const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
    const d = Math.hypot(dx, dy);
    if (d < bestDist) {
      bestDist = d;
      best = i;
      if (d === 0) break;
    }
  }
  return best >= 0 && bestDist <= tolerance ? best : null;
}

/**
 * İki satır arasındaki boşluk satırın yüksekliğinin bu katından büyükse yazı orada bölünür (bölüm başlığı, sahne
 * arası): pencere başlığa ya da ötesine taşmaz. Paragraf arası bundan küçüktür.
 */
const SECTION_GAP = 1;

const sectionsCache = new WeakMap<PageCharMap, Int32Array>();

/** Sayfa yazısının büyük boşluklarla ayrılan kısımlarının başları (`text` içindeki konum), 0 dahil */
function sectionStarts(map: PageCharMap): Int32Array {
  let starts = sectionsCache.get(map);
  if (!starts) {
    const out = [0];
    for (let i = 1; i < map.boxes.length; i++) {
      const a = map.boxes[i - 1];
      const b = map.boxes[i];
      if (a.line === b.line) continue;
      const gap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
      if (gap > SECTION_GAP * Math.max(a.h, b.h)) out.push(i);
    }
    starts = Int32Array.from(out);
    sectionsCache.set(map, starts);
  }
  return starts;
}

/**
 * Harfin bölgesi (`text` içindeki [start, end)): gövde metni ya da onun önündeki (sayfa başlığı) veya arkasındaki
 * (sayfa numarası, dipnot) yazı; bunun da büyük boşluklarla ayrılan kısmı. Pencere bölgesinden taşmaz: gövdedeki
 * kalem sayfa numarasını ya da bölüm başlığını açmaz. `bySection` kapalıyken (↑/↓) yalnızca gövde sınırı.
 */
function regionOf(map: PageCharMap, i: number, bySection = true): [number, number] {
  const { bodyStart, bodyEnd } = map;
  let rs = 0;
  let re = map.text.length;
  if (bodyEnd > bodyStart) {
    if (i < bodyStart) re = bodyStart;
    else if (i >= bodyEnd) rs = bodyEnd;
    else [rs, re] = [bodyStart, bodyEnd];
  }
  if (!bySection) return [rs, re];
  const sections = sectionStarts(map);
  const k = wordOfChar(sections, i);
  return [Math.max(rs, sections[k]), Math.min(re, sections[k + 1] ?? re)];
}

/** [start, end) harflerini satır satır dikdörtgenlere toplar (okuma sırasında) */
export function charRects(map: PageCharMap, start: number, end: number): TextRect[] {
  const rects: TextRect[] = [];
  let line = -1;
  let x0 = 0;
  let x1 = 0;
  let top = 0;
  let bottom = 0;
  const flush = () => {
    if (line >= 0) rects.push({ x: x0, y: top, width: x1 - x0, height: bottom - top });
  };
  for (let i = start; i < end; i++) {
    const b = map.boxes[i];
    if (b.line !== line) {
      flush();
      line = b.line;
      x0 = b.x0;
      x1 = b.x1;
      top = b.y;
      bottom = b.y + b.h;
    } else {
      x0 = Math.min(x0, b.x0);
      x1 = Math.max(x1, b.x1);
      top = Math.min(top, b.y);
      bottom = Math.max(bottom, b.y + b.h);
    }
  }
  flush();
  return rects;
}

/** Sayfadaki kelime penceresi */
export interface PageWindow {
  /** ortadaki (kalemin altındaki) kelimenin ilk harfi (`text` içinde) */
  center: number;
  /** pencerenin `text` içindeki [start, end) aralığı */
  start: number;
  end: number;
  /** satır başına bir dikdörtgen (PDF birimi) */
  rects: TextRect[];
  /** penceredeki kelime sayısı */
  count: number;
}

/**
 * `i` harfinin kelimesi ve onun önünden, arkasından `n` kelime. Pencere harfin bölgesinde (gövde metni) kalır:
 * sayfanın başında ve sonunda kısalır. Harita boşsa null.
 */
export function pageWindow(map: PageCharMap, i: number, n: number): PageWindow | null {
  const starts = wordStarts(map);
  if (starts.length === 0 || i < 0 || i >= map.text.length) return null;
  const [rs, re] = regionOf(map, i);
  const w = wordOfChar(starts, i);
  // bölgenin kelimeleri [first, last]
  const first = rs <= starts[0] ? 0 : wordOfChar(starts, rs - 1) + 1;
  const last = wordOfChar(starts, re - 1);
  const a = Math.max(first, w - n);
  const b = Math.min(last, w + n);
  const start = starts[a];
  const end = b + 1 < starts.length ? Math.min(starts[b + 1], re) : Math.min(map.text.length, re);
  return { center: starts[w], start, end, rects: charRects(map, start, end), count: b - a + 1 };
}

/**
 * Pencereyi `delta` kelime kaydırır (↑/↓): yeni ortadaki kelimenin ilk harfi. Başlığı ve sahne arasını geçer, gövdenin
 * sınırına dayanan pencere orada durur; zaten sınırdaysa (sayfa bitti) null.
 */
export function movePageCenter(map: PageCharMap, center: number, delta: number): number | null {
  const starts = wordStarts(map);
  if (starts.length === 0) return null;
  const [rs, re] = regionOf(map, center, false);
  const w = wordOfChar(starts, center);
  const first = rs <= starts[0] ? 0 : wordOfChar(starts, rs - 1) + 1;
  const last = wordOfChar(starts, re - 1);
  const to = Math.max(first, Math.min(last, w + delta));
  return to === w ? null : starts[to];
}

/** Sayfanın ilk (`atEnd`: son) gövde kelimesinin ilk harfi; boş sayfada null */
export function pageEdge(map: PageCharMap, atEnd: boolean): number | null {
  const starts = wordStarts(map);
  if (starts.length === 0) return null;
  const [rs, re] =
    map.bodyEnd > map.bodyStart ? [map.bodyStart, map.bodyEnd] : [0, map.text.length];
  return starts[atEnd ? wordOfChar(starts, re - 1) : wordOfChar(starts, rs)];
}

/** `i` harfinden `n` kelime ileri (bölgede kalarak): pencere cümlenin başından başlasın diye */
export function charAfterWords(map: PageCharMap, i: number, n: number): number {
  const starts = wordStarts(map);
  if (starts.length === 0) return i;
  const [, re] = regionOf(map, i);
  const last = wordOfChar(starts, re - 1);
  return starts[Math.min(last, wordOfChar(starts, i) + n)];
}

// ---------------------------------------------------------------------------------------------------------------
// Metin görünümü: blok metinleri

/** Metindeki kelime: [start, end) */
export interface WordSpan {
  start: number;
  end: number;
}

const LETTER = /[\p{L}\p{N}]/u;

/**
 * Metnin kelimeleri: boşlukla ayrılan, en az bir harf ya da rakam içeren parçalar. Kelimeye bitişik noktalama
 * ("dedi," "“Işıklar") kelimenin parçasıdır; tek başına duran tire ("—") kelime sayılmaz (pencerenin içinde kalırsa
 * yine açık görünür).
 */
export function textWords(text: string): WordSpan[] {
  const out: WordSpan[] = [];
  for (const m of text.matchAll(/\S+/gu))
    if (LETTER.test(m[0])) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

const wordsCache = new WeakMap<Block, WordSpan[]>();

function blockWords(blocks: Block[], i: number): WordSpan[] {
  const b = blocks[i];
  if (!b || !('text' in b)) return [];
  let words = wordsCache.get(b);
  if (!words) wordsCache.set(b, (words = textWords(b.text)));
  return words;
}

/**
 * Konumdaki kelime (kelime dizisindeki sıra): konumu içeren (kelimenin hemen sonu da sayılır); boşluktaysa en
 * yakını (eşitse önceki). Kelime yoksa -1.
 */
export function wordAtOffset(words: readonly WordSpan[], offset: number): number {
  if (words.length === 0) return -1;
  let lo = 0;
  let hi = words.length - 1;
  // sonu konumdan önce olmayan ilk kelime
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].end < offset) lo = mid + 1;
    else hi = mid;
  }
  const w = words[lo];
  if (w.end < offset) return lo; // son kelimeden sonra
  if (w.start <= offset || lo === 0) return lo;
  const prev = words[lo - 1];
  return offset - prev.end <= w.start - offset ? lo - 1 : lo;
}

/** Kitaptaki kelimenin yeri: blok ve bloktaki sıra */
interface WordPos {
  block: number;
  word: number;
}

/** Kelimeden `delta` kelime ötesi (bloklar arasında, kelimesi olmayan bloklar atlanır); kitabın ucunda durur */
function stepWords(blocks: Block[], from: WordPos, delta: number): WordPos {
  let { block, word } = from;
  let left = Math.abs(delta);
  const dir = delta < 0 ? -1 : 1;
  while (left > 0) {
    const words = blockWords(blocks, block);
    const room = dir > 0 ? words.length - 1 - word : word;
    if (left <= room) return { block, word: word + dir * left };
    // bu bloğun ucuna kadar, sonra kelimesi olan sonraki (önceki) blok
    let next = block + dir;
    while (next >= 0 && next < blocks.length && blockWords(blocks, next).length === 0) next += dir;
    if (next < 0 || next >= blocks.length) return { block, word: dir > 0 ? words.length - 1 : 0 };
    left -= room + 1;
    block = next;
    word = dir > 0 ? 0 : blockWords(blocks, next).length - 1;
  }
  return { block, word };
}

/** Metin görünümündeki kelime penceresi */
export interface TextWindow {
  /** ortadaki kelimenin başı */
  center: Locator;
  /** bloklara bölünmüş aralıklar, okuma sırasında */
  ranges: BlockRange[];
  count: number;
}

/**
 * Konumdaki kelime ve onun önünden, arkasından `n` kelime; pencere paragraf (blok) sınırını aşabilir. Konumun
 * bloğunda kelime yoksa null.
 */
export function textWindow(blocks: Block[], at: Locator, n: number): TextWindow | null {
  const words = blockWords(blocks, at.block);
  const w = wordAtOffset(words, at.offset);
  if (w < 0) return null;
  const a = stepWords(blocks, { block: at.block, word: w }, -n);
  const b = stepWords(blocks, { block: at.block, word: w }, n);
  const ranges: BlockRange[] = [];
  let count = 0;
  for (let k = a.block; k <= b.block; k++) {
    const ws = blockWords(blocks, k);
    if (ws.length === 0) continue;
    const i0 = k === a.block ? a.word : 0;
    const i1 = k === b.block ? b.word : ws.length - 1;
    ranges.push({ block: k, start: ws[i0].start, end: ws[i1].end });
    count += i1 - i0 + 1;
  }
  return { center: { block: at.block, offset: words[w].start }, ranges, count };
}

/** Pencerenin ortasını `delta` kelime kaydırır (↑/↓); kitabın ucundaysa null */
export function moveTextCenter(blocks: Block[], at: Locator, delta: number): Locator | null {
  const w = wordAtOffset(blockWords(blocks, at.block), at.offset);
  if (w < 0) return null;
  const to = stepWords(blocks, { block: at.block, word: w }, delta);
  if (to.block === at.block && to.word === w) return null;
  return { block: to.block, offset: blockWords(blocks, to.block)[to.word].start };
}

/** Konumdan `n` kelime ileri (pencere cümlenin başından başlasın diye) */
export function locatorAfterWords(blocks: Block[], at: Locator, n: number): Locator {
  return moveTextCenter(blocks, at, n) ?? at;
}
