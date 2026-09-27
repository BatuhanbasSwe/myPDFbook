import type { PageText, RawTextItem } from '../convert/types';

/** Aranabilir tek karakterin sayfadaki kutusu (PDF birimi; sayfanın sol üstünden, y aşağı doğru artar). */
export interface CharBox {
  x0: number;
  x1: number;
  /** kutunun üstü */
  y: number;
  /** kutunun yüksekliği */
  h: number;
  /** okuma sırasındaki satır */
  line: number;
}

/** Sayfanın aranabilir metni ve harflerin konumları. Sayfa başına bir kez kurulur (çağıran önbelleğe alır). */
export interface PageCharMap {
  /** sayfa boyutu (PDF birimi) */
  width: number;
  height: number;
  /** okuma sırasında (üstten alta, soldan sağa) `normalizeForSearch` biçiminde sayfa metni */
  text: string;
  /** `text`'in her karakterinin kutusu */
  boxes: CharBox[];
  /** `text[i]` bir kelimenin ilk harfi mi (satır başı ya da önünde boşluk, noktalama, belirgin boşluk var) */
  wordStart: boolean[];
  /** gövde metninin `text` içindeki [start, end) aralığı: sayfa başlığı, numarası, dipnot gibi küçük yazılar dışarıda */
  bodyStart: number;
  bodyEnd: number;
}

/** Eşleşmenin bir satırdaki dikdörtgeni (PDF birimi; sayfanın sol üstünden, y aşağı doğru). */
export interface TextRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Metnin sayfada bulunan kısmı:
 * - `whole`: tamamı;
 * - `head`: yalnızca başı, sayfanın sonunda (gerisi sonraki sayfada);
 * - `tail`: yalnızca sonu, sayfanın başında (başı önceki sayfada).
 */
export type MatchPart = 'whole' | 'head' | 'tail';

export interface TextMatch {
  part: MatchPart;
  /** satır başına bir dikdörtgen, okuma sırasında */
  rects: TextRect[];
  /** eşleşmenin `PageCharMap.text` içindeki [start, end) aralığı; `end`, sonraki cümlenin aramasına ipucu olur */
  start: number;
  end: number;
  /** sayfa boyutu (PDF birimi): arayüz dikdörtgenleri buna göre ölçekler */
  pageWidth: number;
  pageHeight: number;
}

/** Harf kutusunun taban çizgisinin üstünde ve altında kalan kısmı (punto oranı): aksanlı büyük harfleri ve kuyrukları kapsar. */
const ASCENT = 0.9;
const DESCENT = 0.25;
/** Aynı satırdaki iki öğe arasındaki boşluk puntonun bu oranından büyükse kelime arasıdır (extractLines ile aynı). */
const WORD_GAP = 0.15;
/** Punto, sayfanın baskın puntosunun bu oranından küçükse satır gövde metni sayılmaz (başlık, numara, dipnot). */
const BODY_SIZE_RATIO = 0.85;
/** Kısmi eşleşme (sayfa sınırından taşan cümle) en az bu kadar harf olmalı; daha kısası rastlantı olabilir. */
const MIN_PARTIAL = 3;

const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;
const ALNUM = /[\p{L}\p{N}]/u;
/** Bozuk kodlanmış Türkçe fontlar (ý/þ/ð): dönüştürücü onarır, sayfa metni onarılmamıştır. İki taraf da aynı katlanır. */
const TR_FOLD: Record<string, string> = { ý: 'ı', þ: 'ş', ð: 'ğ', Ý: 'İ', Þ: 'Ş', Ð: 'Ğ' };

/** Tek karakterin arama biçimi (birden çok harf olabilir: "ﬁ" → "fi"; harf ya da rakam değilse ''). */
function normChar(ch: string): string {
  if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) return ch;
  if (ch >= 'A' && ch <= 'Z' && ch !== 'I') return ch.toLowerCase();
  let out = '';
  for (const c of ch.normalize('NFKC')) {
    for (const l of (TR_FOLD[c] ?? c).toLocaleLowerCase('tr')) {
      if (ALNUM.test(l)) out += l;
    }
  }
  return out;
}

/**
 * Arama biçimi: NFC + karakter başına NFKC, Türkçe küçük harf (I → ı, İ → i), yalnızca harf ve rakam.
 * Boşluk, tire, yumuşak tire ve noktalama yok sayılır: sayfadaki "kita-\nbı" ile blok metnindeki "kitabı" eşleşir.
 */
export function normalizeForSearch(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) out += normChar(ch);
  return out;
}

interface Placed {
  str: string;
  x: number;
  y: number;
  w: number;
  size: number;
}

function place(item: RawTextItem): Placed | null {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform;
  // döndürülmüş (dikey) metin kitap akışına ait değildir (extractLines ile aynı)
  if (Math.abs(a) < 1e-6 || Math.abs(b) > Math.abs(a) * 0.1) return null;
  const str = item.str.normalize('NFC').replace(INVISIBLE, '');
  if (str.trim() === '') return null;
  const size = Math.abs(item.height) || Math.hypot(c, d);
  if (!(size > 0)) return null;
  return { str, x: e, y: f, w: item.width, size };
}

/** Öğeleri okuma sırasında satırlara toplar: üstten alta; aynı taban çizgisindekiler (punto yarısı tolerans) soldan sağa. */
function readingLines(items: RawTextItem[]): Placed[][] {
  const placed = items.map(place).filter((p): p is Placed => p !== null);
  placed.sort((p, q) => q.y - p.y || p.x - q.x);
  const lines: Placed[][] = [];
  for (const it of placed) {
    const line = lines[lines.length - 1];
    const ref = line?.[0];
    if (line && ref && Math.abs(ref.y - it.y) <= 0.5 * Math.max(ref.size, it.size)) line.push(it);
    else lines.push([it]);
  }
  for (const line of lines) line.sort((p, q) => p.x - q.x);
  return lines;
}

/**
 * Sayfanın aranabilir haritası: öğeler okuma sırasına dizilir, metin `normalizeForSearch` biçimine getirilir ve her
 * karakter için kutu tutulur. Öğe genişliği öğenin karakterlerine eşit bölünür; kutu, taban çizgisinden punto
 * oranıyla yukarı (ASCENT) ve aşağı (DESCENT) uzanır. Koordinatlar sayfanın sol üstünden, y aşağı doğru.
 */
export function pageCharMap(page: PageText): PageCharMap {
  const [ox, oy] = page.origin ?? [0, 0];
  let text = '';
  const boxes: CharBox[] = [];
  const wordStart: boolean[] = [];
  /** satır başına: text içindeki [start, end) ve baskın punto */
  const lineSpans: { start: number; end: number; size: number }[] = [];

  readingLines(page.items).forEach((items, line) => {
    const start = text.length;
    const sizeChars = new Map<number, number>();
    let boundary = true;
    let prevEnd = -Infinity;
    for (const it of items) {
      if (it.x - prevEnd > WORD_GAP * it.size) boundary = true;
      prevEnd = Math.max(prevEnd, it.x + it.w);
      const chars = Array.from(it.str);
      const y = page.height - (it.y - oy) - ASCENT * it.size;
      const h = (ASCENT + DESCENT) * it.size;
      const step = it.w / chars.length;
      const before = text.length;
      chars.forEach((ch, i) => {
        const n = normChar(ch);
        if (!n) {
          boundary = true;
          return;
        }
        const x0 = it.x - ox + step * i;
        for (const c of n) {
          text += c;
          boxes.push({ x0, x1: x0 + step, y, h, line });
          wordStart.push(boundary);
          boundary = false;
        }
      });
      sizeChars.set(it.size, (sizeChars.get(it.size) ?? 0) + text.length - before);
    }
    if (text.length === start) return;
    let size = 0;
    let most = -1;
    for (const [s, count] of sizeChars) {
      if (count > most) [size, most] = [s, count];
    }
    lineSpans.push({ start, end: text.length, size });
  });

  // gövde: baskın puntonun (en çok harfin yazıldığı) belirgin altında olmayan satırlar
  const charsBySize = new Map<number, number>();
  for (const l of lineSpans)
    charsBySize.set(l.size, (charsBySize.get(l.size) ?? 0) + l.end - l.start);
  let bodySize = 0;
  let most = -1;
  for (const [s, count] of charsBySize) {
    if (count > most) [bodySize, most] = [s, count];
  }
  const body = lineSpans.filter((l) => l.size >= BODY_SIZE_RATIO * bodySize);

  return {
    width: page.width,
    height: page.height,
    text,
    boxes,
    wordStart,
    bodyStart: body[0]?.start ?? 0,
    bodyEnd: body[body.length - 1]?.end ?? 0,
  };
}

/** KMP önek fonksiyonu: pi[i], s[0..i]'nin kendisi dışındaki en uzun hem önek hem sonek uzunluğu. */
function prefixFunction(s: string): Int32Array {
  const pi = new Int32Array(s.length);
  for (let i = 1; i < s.length; i++) {
    let k = pi[i - 1];
    while (k > 0 && s[i] !== s[k]) k = pi[k - 1];
    if (s[i] === s[k]) k++;
    pi[i] = k;
  }
  return pi;
}

/** Harita metninde `i` konumu bir kelimenin sonu mu (sonraki karakter yeni kelime ya da metin bitti). */
function isWordEnd(map: PageCharMap, i: number): boolean {
  return i >= map.text.length || map.wordStart[i];
}

/** `from`dan sonraki ilk eşleşme; kelime sınırlarına oturan tercih edilir, yoksa ilk ham eşleşme. */
function findWhole(map: PageCharMap, needle: string, from: number): number {
  let first = -1;
  for (let i = map.text.indexOf(needle, from); i >= 0; i = map.text.indexOf(needle, i + 1)) {
    if (map.wordStart[i] && isWordEnd(map, i + needle.length)) return i;
    if (first < 0) first = i;
  }
  return first;
}

/** Gövdenin sonundaki, metnin en uzun baş kısmı (kelime başından başlayan); uzunluk ya da 0. */
function headAtBodyEnd(map: PageCharMap, needle: string): number {
  const end = map.bodyEnd;
  const window = map.text.slice(Math.max(map.bodyStart, end - needle.length + 1), end);
  const pi = prefixFunction(`${needle}\0${window}`);
  let k = pi[pi.length - 1] ?? 0;
  // daha kısa adaylar KMP zinciriyle: metnin başının hem öneki hem soneki olan parçalar
  while (k >= MIN_PARTIAL && !map.wordStart[end - k]) k = pi[k - 1];
  return k >= MIN_PARTIAL ? k : 0;
}

/** Gövdenin başındaki, metnin en uzun son kısmı (kelime sonunda biten); uzunluk ya da 0. */
function tailAtBodyStart(map: PageCharMap, needle: string): number {
  const start = map.bodyStart;
  const window = map.text.slice(start, Math.min(map.bodyEnd, start + needle.length - 1));
  const pi = prefixFunction(`${window}\0${needle}`);
  let k = pi[pi.length - 1] ?? 0;
  while (k >= MIN_PARTIAL && !isWordEnd(map, start + k)) k = pi[k - 1];
  return k >= MIN_PARTIAL ? k : 0;
}

/** [start, end) karakterlerini satır satır dikdörtgenlere toplar. */
function rectsOf(map: PageCharMap, start: number, end: number): TextRect[] {
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

/**
 * Metni (ör. bir cümleyi) sayfada bulur ve satır başına bir dikdörtgen döndürür.
 * - Metin normalleştirilir (`normalizeForSearch`) ve `fromHint`ten (harita metnindeki konum) sonraki ilk eşleşme
 *   aranır; orada yoksa sayfanın başından. Kelime sınırlarına oturan eşleşme tercih edilir.
 * - Tamamı yoksa cümle sayfa sınırından taşıyor olabilir: gövde metninin sonundaki en uzun baş kısmı (`head`) ya da
 *   başındaki en uzun son kısmı (`tail`) döner; ikisi de varsa uzun olanı.
 * - Hiçbiri yoksa (ya da metinde harf yoksa) null.
 */
export function findTextRects(map: PageCharMap, text: string, fromHint = 0): TextMatch | null {
  const needle = normalizeForSearch(text);
  if (needle === '' || map.text === '') return null;
  const result = (part: MatchPart, start: number, end: number): TextMatch => ({
    part,
    rects: rectsOf(map, start, end),
    start,
    end,
    pageWidth: map.width,
    pageHeight: map.height,
  });

  let at = findWhole(map, needle, Math.max(0, fromHint));
  if (at < 0 && fromHint > 0) at = findWhole(map, needle, 0);
  if (at >= 0) return result('whole', at, at + needle.length);

  const head = headAtBodyEnd(map, needle);
  const tail = tailAtBodyStart(map, needle);
  if (head === 0 && tail === 0) return null;
  if (head >= tail) return result('head', map.bodyEnd - head, map.bodyEnd);
  return result('tail', map.bodyStart, map.bodyStart + tail);
}
