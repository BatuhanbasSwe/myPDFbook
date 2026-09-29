import type { Block, Lang, Locator } from '../convert/types';

/**
 * Kitap içinde arama. Kitabın metni bir kez aranabilir biçime getirilir (kitap ve dil başına önbellekte):
 * - Türkçe büyük/küçük harf: kitap Türkçeyse I → ı, İ → i (öteki dillerde I → i).
 * - Aksanlar atılır (â → a, é → e); Türkçe harfler (ç ğ ı ö ş ü) korunur.
 * - Harf ve rakam dışındaki her şey (boşluk, noktalama, tire) tek bir boşluk sayılır; yumuşak tire, görünmez
 *   karakterler ve kesme işareti ("Türkiye'nin") yok sayılır.
 * Aynı metnin bir de "yalın" biçimi tutulur (ç → c, ğ → g, ı → i, ö → o, ş → s, ü → u). Aramadaki yalın harf iki
 * biçimi de bulur ("isik" → "ışık"), Türkçe harf yalnızca kendisini ("ışık" "isik"i bulmaz); aramadaki büyük "I" ise
 * "ı"yı da "i"yi de bulur ("Istanbul" → "İstanbul"). Her biçim karakterinin
 * blok metnindeki yeri tutulur: sonuç blok metnindeki aralık olarak döner.
 */

/** Aramanın bir sonucu: blok metnindeki [start, end) aralığı ve çevresinden bir parça */
export interface SearchResult {
  /** eşleşmenin başı (okuyucu buraya gider) */
  locator: Locator;
  block: number;
  start: number;
  end: number;
  snippet: Snippet;
}

/** Sonucun çevresi: eşleşme kalın gösterilir; kesilen yerlerde üç nokta */
export interface Snippet {
  before: string;
  match: string;
  after: string;
}

export interface SearchOutcome {
  /** kitap sırasıyla, en çok `limit` sonuç */
  results: SearchResult[];
  /** sınırdan fazla sonuç var */
  more: boolean;
}

/** Varsayılan sonuç sınırı */
export const SEARCH_LIMIT = 500;

/** Parçada eşleşmenin önünde ve ardında kalan en çok karakter */
const SNIPPET_BEFORE = 48;
const SNIPPET_AFTER = 90;

/** Bloklar arası ayraç: aramada hiç olmaz, eşleşme bloktan taşmaz */
const BLOCK_SEP = '\n';

/** yumuşak tire, sıfır genişlikli karakterler, kelime birleştirici, BOM */
const IGNORED = /[\u00AD\u200B-\u200D\u2060\uFEFF]/;
/** kesme işaretleri: kelimenin içinde sayılır ("Türkiye'nin" → "türkiyenin") */
const APOSTROPHE = /['’ʼ‘`´]/;
const MARK = /\p{M}/u;
const ALNUM = /[\p{L}\p{N}]/u;

/** Türkçe harflerin yalın karşılığı (aramadaki yalın harf ikisini de bulur) */
const PLAIN: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
/** Birleşik biçimde korunan (Türkçe harf olan) harf + işaret çiftleri */
const KEPT = new Set(['ç', 'ğ', 'ö', 'ş', 'ü']);

type Locale = 'tr' | 'default';

function localeOf(lang: Lang): Locale {
  return lang === 'tr' ? 'tr' : 'default';
}

/** Karakter biriminin (harf + ardındaki birleşen işaretler) arama biçimi, önbellekli */
const unitCache: Record<Locale, Map<string, string>> = { tr: new Map(), default: new Map() };

/**
 * Tek bir karakter biriminin arama biçimi: küçük harf, aksansız (Türkçe harfler korunur); harf ya da rakam değilse
 * ' ' (ayraç) ya da '' (yok sayılan).
 */
function foldUnit(unit: string, locale: Locale): string {
  const cache = unitCache[locale];
  const hit = cache.get(unit);
  if (hit !== undefined) return hit;
  let out = '';
  // Yumuşak tire, görünmez karakter, kesme işareti ve yalnız kalmış birleşen işaret yok sayılır
  if (!IGNORED.test(unit) && !APOSTROPHE.test(unit) && !MARK.test(unit[0])) {
    const lower =
      locale === 'tr' ? unit.normalize('NFC').toLocaleLowerCase('tr') : unit.toLowerCase();
    // NFKC: bağlı harfler ("ﬁ" → "fi"), tam genişlikli rakamlar; NFD: harf ve aksanı ayrılır
    for (const ch of lower.normalize('NFKC').normalize('NFD')) {
      if (MARK.test(ch)) {
        // Türkçe harfin işareti önceki harfle yeniden birleşir; öteki aksanlar atılır
        const joined = (out.slice(-1) + ch).normalize('NFC');
        if (KEPT.has(joined)) out = out.slice(0, -1) + joined;
      } else if (ALNUM.test(ch)) out += ch;
      else if (!out.endsWith(' ')) out += ' ';
    }
    // Harf ya da rakam yoksa ayraç (boşluk, noktalama)
    if (out === '') out = ' ';
  }
  cache.set(unit, out);
  return out;
}

/** Hızlı yol: tek UTF-16 birimli karakterin arama biçimi, dizide (dile göre; ilk görülüşte hesaplanır) */
const singleCache: Record<Locale, (string | undefined)[]> = { tr: [], default: [] };

function singleFold(code: number, locale: Locale): string {
  const table = singleCache[locale];
  return (table[code] ??= foldUnit(String.fromCharCode(code), locale));
}

/** Sonraki karakter birleşen bir işaret mi (hızlı ön denetim: işaretler U+0300'den başlar) */
function markAt(text: string, i: number): boolean {
  return i < text.length && text.charCodeAt(i) >= 0x300 && MARK.test(text[i]);
}

/** Türkçe harflerin yalın karşılığı, karakter koduyla */
const PLAIN_CODE = new Map(
  Object.entries(PLAIN).map(([k, v]) => [k.charCodeAt(0), v.charCodeAt(0)] as const),
);

const UTF16 = new TextDecoder('utf-16le');

/**
 * Biçimlerin yazıldığı tampon: karakter kodları ve kaynaktaki yerleri (1 MB kitapta dizgi eklemekten ve sayı
 * dizisinden birkaç kat hızlı). Baştan metnin boyunda açılır (biçim metinden pek uzun olmaz); taşarsa büyür.
 */
class Folder {
  exact: Uint16Array;
  plain: Uint16Array;
  src: Int32Array;
  length = 0;

  readonly locale: Locale;

  constructor(locale: Locale, capacity = 64) {
    this.locale = locale;
    const n = Math.max(16, capacity);
    this.exact = new Uint16Array(n);
    this.plain = new Uint16Array(n);
    this.src = new Int32Array(n);
  }

  push(code: number, src: number) {
    if (this.length === this.exact.length) {
      const grow = <T extends Uint16Array | Int32Array>(a: T): T => {
        const b = new (a.constructor as new (n: number) => T)(a.length * 2);
        b.set(a);
        return b;
      };
      this.exact = grow(this.exact);
      this.plain = grow(this.plain);
      this.src = grow(this.src);
    }
    const k = this.length++;
    this.exact[k] = code;
    // Türkçe harflerin en küçüğü ç (U+00E7): altı olduğu gibi
    this.plain[k] = code < 0xe7 ? code : (PLAIN_CODE.get(code) ?? code);
    this.src[k] = src;
  }

  /**
   * Metni arama biçimine getirip ekler. Birim (harf ve ardındaki birleşen işaretler) başına çevrilir; ayraçlar tek
   * boşluğa iner, baştaki ve sondaki ayraç atılır.
   */
  fold(text: string) {
    const { locale } = this;
    const n = text.length;
    const first = this.length;
    let lastSpace = true; // baştaki ayraç atılır
    let i = 0;
    while (i < n) {
      const start = i;
      const code = text.charCodeAt(i);
      let f: string;
      const surrogate = code >= 0xd800 && code <= 0xdbff && i + 1 < n;
      if (!surrogate && !markAt(text, i + 1)) {
        i++;
        f = singleFold(code, locale);
        // En sık yol: tek harf
        if (f.length === 1 && f !== ' ') {
          lastSpace = false;
          this.push(f.charCodeAt(0), start);
          continue;
        }
      } else {
        // Birim: kod noktası (vekil çifti dahil) ve ardındaki birleşen işaretler
        i += surrogate ? 2 : 1;
        while (markAt(text, i)) i++;
        f = foldUnit(text.slice(start, i), locale);
      }
      for (let k = 0; k < f.length; k++) {
        const c = f.charCodeAt(k);
        if (c === 32) {
          if (lastSpace) continue;
          lastSpace = true;
        } else lastSpace = false;
        this.push(c, start);
      }
    }
    if (lastSpace && this.length > first) this.length--;
  }

  /** Tampondaki biçimin dizgisi (vekil çiftleri hep bütün yazılır: uzunluk değişmez) */
  text(which: 'exact' | 'plain'): string {
    return UTF16.decode(this[which].subarray(0, this.length));
  }
}

/** Aranan metnin biçimleri */
interface FoldedQuery {
  exact: string;
  plain: string;
  /** Türkçe harfli yerler: metinde de aynı harf olmalı */
  strict: number[];
}

/** Büyük "I": Türkçede "ı"nın büyüğü, ama İngilizce klavyede "i"nin de büyüğü yazılır */
const CAPITAL_I = 0x49;

/**
 * Aranan metnin biçimleri. Aramadaki Türkçe harf yalnızca kendisini bulur; yalnızca büyük "I" gevşektir: kesin
 * biçimde "ı", yalın biçimde "i" olur ve ikisini de bulur ("Istanbul" "İstanbul"u da bulur).
 */
function foldQuery(query: string, locale: Locale): FoldedQuery {
  const f = new Folder(locale, query.length);
  f.fold(query);
  const exact = f.text('exact');
  const plain = f.text('plain');
  const strict: number[] = [];
  for (let k = 0; k < exact.length; k++)
    if (exact[k] !== plain[k] && query.charCodeAt(f.src[k]) !== CAPITAL_I) strict.push(k);
  return { exact, plain, strict };
}

/** Karşılaştırma için dışa açık: metnin arama biçimi (testler ve arayüz) */
export function normalizeQuery(query: string, lang: Lang = 'tr'): string {
  return foldQuery(query, localeOf(lang)).exact;
}

/** Kitabın aranabilir metni: bütün bloklar art arda, aralarında ayraç */
export interface SearchIndex {
  locale: Locale;
  exact: string;
  plain: string;
  /** biçimdeki karakterin blok metnindeki yeri */
  src: Int32Array;
  /** blokların biçimdeki başları, artan sırada (bloğu karakter başına tutmaktan çok küçük) */
  blockStarts: Int32Array;
  /** `blockStarts` ile aynı sırada blokların indeksi */
  blockIds: Int32Array;
}

/** Arama dizinini kurar (bkz. searchIndex: önbellekli) */
export function buildSearchIndex(blocks: Block[], lang: Lang): SearchIndex {
  let size = 0;
  let textBlocks = 0;
  for (const b of blocks)
    if ('text' in b && b.text) {
      size += b.text.length + 1;
      textBlocks++;
    }
  const f = new Folder(localeOf(lang), size);
  const blockStarts = new Int32Array(textBlocks);
  const blockIds = new Int32Array(textBlocks);
  let k = 0;
  blocks.forEach((b, bi) => {
    if (!('text' in b) || !b.text) return;
    blockStarts[k] = f.length;
    blockIds[k++] = bi;
    f.fold(b.text);
    // Blok ayracı: eşleşme bir bloktan ötekine geçmez
    f.push(BLOCK_SEP.charCodeAt(0), -1);
  });
  return {
    locale: f.locale,
    exact: f.text('exact'),
    plain: f.text('plain'),
    src: f.src.slice(0, f.length),
    blockStarts,
    blockIds,
  };
}

/** Biçimdeki `at` karakterinin bloğu: başı `at`tan sonra olmayan son blok (ikili arama) */
function blockAt(index: SearchIndex, at: number): number {
  const starts = index.blockStarts;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= at) lo = mid;
    else hi = mid - 1;
  }
  return index.blockIds[lo] ?? -1;
}

const indexCache = new WeakMap<Block[], Map<Lang, SearchIndex>>();

/** Kitabın arama dizini: kitap (blok dizisi) ve dil başına bir kez kurulur */
export function searchIndex(blocks: Block[], lang: Lang): SearchIndex {
  let byLang = indexCache.get(blocks);
  if (!byLang) indexCache.set(blocks, (byLang = new Map()));
  let index = byLang.get(lang);
  if (!index) byLang.set(lang, (index = buildSearchIndex(blocks, lang)));
  return index;
}

/** Birimin (kod noktası ve ardındaki birleşen işaretler) sonu */
function unitEnd(text: string, at: number): number {
  const code = text.charCodeAt(at);
  let i = at + (code >= 0xd800 && code <= 0xdbff && at + 1 < text.length ? 2 : 1);
  while (i < text.length && MARK.test(text[i])) i++;
  return i;
}

/** Parçanın metni: yumuşak tire ve görünmez karakterler atılır, boşluklar teke iner */
function clean(s: string): string {
  return s.replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\s+/g, ' ');
}

/** Eşleşmenin çevresinden parça: kelime ortasından kesilmez, kesilen yerde üç nokta */
export function makeSnippet(text: string, start: number, end: number): Snippet {
  let from = Math.max(0, start - SNIPPET_BEFORE);
  if (from > 0) {
    const space = text.indexOf(' ', from);
    from = space >= 0 && space < start ? space + 1 : from;
  }
  let to = Math.min(text.length, end + SNIPPET_AFTER);
  if (to < text.length) {
    const space = text.lastIndexOf(' ', to);
    to = space > end ? space : to;
  }
  const before = clean(text.slice(from, start)).trimStart();
  const after = clean(text.slice(end, to)).trimEnd();
  return {
    before: (from > 0 ? '…' : '') + before,
    match: clean(text.slice(start, end)),
    after: after + (to < text.length ? '…' : ''),
  };
}

/**
 * Kitapta arar: eşleşmeler kitap sırasıyla, en çok `limit` tane (fazlası `more` ile bildirilir). Birden çok kelime
 * art arda gelmelidir (aralarındaki boşluk ve noktalama ne olursa olsun). Harf ya da rakamı olmayan arama sonuç
 * vermez.
 */
export function searchBook(
  blocks: Block[],
  query: string,
  { limit = SEARCH_LIMIT, lang = 'tr' }: { limit?: number; lang?: Lang } = {},
): SearchOutcome {
  const index = searchIndex(blocks, lang);
  const q = foldQuery(query, index.locale);
  const results: SearchResult[] = [];
  if (!q.exact.replace(/ /g, '')) return { results, more: false };
  const { strict } = q;
  const len = q.plain.length;
  // Eşleşmeler üst üste binmez ("aaa"da "aa" bir kez): bulunan eşleşmenin sonundan sürer
  for (let at = index.plain.indexOf(q.plain); at >= 0;) {
    if (strict.some((k) => index.exact[at + k] !== q.exact[k])) {
      at = index.plain.indexOf(q.plain, at + 1);
      continue;
    }
    if (results.length === limit) return { results, more: true };
    const block = blockAt(index, at);
    const b = blocks[block];
    const text = b && 'text' in b ? b.text : '';
    const start = index.src[at];
    const end = unitEnd(text, index.src[at + len - 1]);
    results.push({
      locator: { block, offset: start },
      block,
      start,
      end,
      snippet: makeSnippet(text, start, end),
    });
    at = index.plain.indexOf(q.plain, at + len);
  }
  return { results, more: false };
}
