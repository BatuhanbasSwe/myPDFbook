import type { Block, Locator } from '../convert/types';
import { blockClassName, blockTag, blockText, type Part, WHOLE } from './blockMarkup';

/** Sayfanın metin kutusu (kenar boşlukları, sayfa başlığı ve numarası hariç), CSS pikseli */
export interface PageBox {
  width: number;
  height: number;
  /** bölüm başlığının sayfadaki üst boşluğu (bkz. chapterSink) */
  sink: number;
}

/**
 * Sayfalayıcının ve sayfa işaretlemesinin (book.css) sürümü. Sayfa sınırlarını değiştiren her değişiklikte artar;
 * sayfalama önbelleğinin anahtarına girer.
 */
export const PAGINATOR_VERSION = 1;

/** Bölüm başlığının üst boşluğu: yaklaşık 3 satır, ama küçük ekranda sayfanın en fazla beşte biri. */
export function chapterSink(lineHeightPx: number, boxHeight: number): number {
  return Math.floor(Math.min(3 * lineHeightPx, boxHeight * 0.2));
}

/** Satır ölçümlerindeki yuvarlama payı (px) */
const EPS = 0.5;

/**
 * Kitabı sayfalara böler; her sayfanın başladığı konumu döndürür (ilk sayfa {0, 0}).
 *
 * `host` belgeye bağlı, görünmez ama yerleşim yapılan (ör. ekran dışına konmuş) bir kutudur: `book-page-content`
 * sınıfı, tipografi değişkenleri ve kitabın dili (`lang`; heceleme ona bağlı) verilmiş olmalıdır. Genişliği burada
 * `box.width` yapılır. Kitap bu kutuda tek sütun olarak bir kez dizilir; sayfa sınırları öğelerin ve satırların
 * konumlarından bulunur (her sayfa için yeniden dizilmez).
 *
 * Kurallar:
 * - bölüm başlığı ve görsel sayfa yeni sayfada başlar; görsel sayfa tek başınadır;
 * - başlık, arkasından gelen metin sığmadığı için sayfa dibinde yalnız kalmaz (bölüm başlığından ya da görsel
 *   sayfadan hemen önceki ara başlık yerinde kalır: taşınırsa tek başına bir sayfada kalırdı);
 * - paragraf, satırın başında ya da o satırdaki kelimenin başında bölünür (kelimenin ortasından bölünmez);
 * - paragrafın başı sayfa dibinde tek satır kalacaksa paragraf sonraki sayfaya geçer; sonraki sayfaya tek satır
 *   kalacaksa bir satır geri alınır;
 * - sayfadan uzun başlık ya da dipnot da satır satır bölünür.
 */
export function paginate(host: HTMLElement, blocks: Block[], box: PageBox): Locator[] {
  if (blocks.length === 0) return [{ block: 0, offset: 0 }];
  host.style.width = `${box.width}px`;
  if (!host.isConnected || host.offsetWidth === 0) {
    throw new Error('Sayfalama kutusu belgeye bağlı ve görünür yerleşimde olmalı');
  }
  const elements = blocks.map((_, i) => buildBlockElement(blocks, i, WHOLE, 0, undefined, box));
  host.replaceChildren(...elements);
  try {
    return measure(host, elements, blocks, box);
  } finally {
    host.replaceChildren();
  }
}

/** Sayfa bir görsel sayfa mı (sayfa görünümünde React ile çizilir) */
export function isImagePage(blocks: Block[], start: Locator): boolean {
  return blocks[start.block]?.kind === 'pageImage';
}

/** Sayfanın öğeleri: `start`tan `end`e kadar (end hariç; yoksa kitabın sonuna kadar). */
export function buildPageElements(
  blocks: Block[],
  start: Locator,
  end: Locator | undefined,
  box: PageBox,
): HTMLElement[] {
  const out: HTMLElement[] = [];
  const last = end ? (end.offset > 0 ? end.block : end.block - 1) : blocks.length - 1;
  for (let i = start.block; i <= last && i < blocks.length; i++) {
    const b = blocks[i];
    const from = i === start.block ? start.offset : 0;
    const to = end && i === end.block && end.offset > 0 ? end.offset : undefined;
    const text = 'text' in b ? b.text : '';
    const part: Part = {
      cont: from > 0,
      cut: to !== undefined,
      // Kelimenin ortasından bölündüyse (yalnızca satırdan uzun kelimede) sona tire
      hyphen:
        to !== undefined &&
        /[\p{L}\p{N}­]/u.test(text[to - 1] ?? '') &&
        /[\p{L}\p{N}]/u.test(text[to] ?? ''),
    };
    out.push(buildBlockElement(blocks, i, part, from, to, box));
  }
  return out;
}

function buildBlockElement(
  blocks: Block[],
  index: number,
  part: Part,
  from: number,
  to: number | undefined,
  box: PageBox,
): HTMLElement {
  const b = blocks[index];
  const el = document.createElement(blockTag(b));
  el.className = blockClassName(blocks, index, part);
  el.dataset.block = String(index);
  if (b.kind === 'pageImage') {
    // Görsel sayfa bir sayfayı kaplar; sayfa görünümünde React ile yerleştirilir
    el.style.height = `${box.height}px`;
    el.dataset.srcPage = String(b.srcPage);
  } else {
    el.textContent = blockText(b, from, to);
    if (b.kind === 'break') el.setAttribute('aria-hidden', 'true');
    if (b.kind === 'heading' && b.level === 1)
      el.style.setProperty('--chapter-sink', `${box.sink}px`);
  }
  return el;
}

interface LineBox {
  top: number;
  bottom: number;
}

function measure(
  host: HTMLElement,
  elements: HTMLElement[],
  blocks: Block[],
  box: PageBox,
): Locator[] {
  const isChapter = (i: number) => blocks[i]?.kind === 'heading' && blocks[i].level === 1;
  const fontSize = parseFloat(getComputedStyle(host).fontSize) || 16;
  // Paragrafın devamı bu kadar karakterlik pencerede dizilir (yaklaşık bir buçuk sayfa): uzun paragraf her sayfada
  // baştan dizilmesin
  const pageChars = Math.ceil(
    (box.width / (fontSize * 0.42)) * (box.height / lineHeightOf(host)) * 1.5,
  );

  // Paragrafın sonraki sayfadaki devamı ayrı bir kutuda kendi başına dizilir (çizimde de öyle görünür). Devamın
  // yüksekliği akıştaki hâlinden farklı olabilir; sonraki blokların konumları bu fark (shift) kadar kaydırılır.
  const scratch = document.createElement('div');
  scratch.className = host.className;
  scratch.lang = host.lang;
  scratch.style.cssText = host.style.cssText;
  scratch.setAttribute('aria-hidden', 'true');
  document.body.append(scratch);
  let shift = 0;
  const rectOf = (i: number) => {
    const r = elements[i].getBoundingClientRect();
    return { top: r.top + shift, bottom: r.bottom + shift };
  };
  const topOf = (i: number) => rectOf(i).top - (isChapter(i) ? box.sink : 0);

  const starts: Locator[] = [{ block: 0, offset: 0 }];
  let pageTop = topOf(0);
  let pageFirst = 0; // sayfadaki ilk bloğun indeksi
  let used = false; // sayfada içerik var mı

  const newPage = (loc: Locator, top: number) => {
    starts.push(loc);
    pageTop = top;
    pageFirst = loc.block;
    used = false;
  };
  // i. bloktan önce sayfa bitir; sayfa dibinde kalacak başlık(lar) da yeni sayfaya geçer
  const breakBefore = (i: number) => {
    let first = i;
    while (first - 1 > pageFirst && blocks[first - 1].kind === 'heading') first--;
    newPage({ block: first, offset: 0 }, topOf(first));
    return first;
  };

  try {
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (used && (isChapter(i) || b.kind === 'pageImage' || blocks[i - 1]?.kind === 'pageImage')) {
        newPage({ block: i, offset: 0 }, topOf(i));
      }
      if (rectOf(i).bottom - pageTop <= box.height + EPS) {
        used = true;
        continue;
      }
      if (b.kind === 'pageImage' || b.kind === 'break') {
        // bölünemeyen blok sığmıyor: sonraki sayfaya (tek başına da sığmıyorsa yine de o sayfaya konur)
        if (used) {
          i = breakBefore(i) - 1; // taşınan başlıklar yeniden ölçülsün
          continue;
        }
        used = true;
        continue;
      }
      if (b.kind === 'heading' && used) {
        // başlık sayfa dibine sığmıyor: sonraki sayfaya (sayfadan uzunsa orada satır satır bölünür)
        i = breakBefore(i) - 1;
        continue;
      }
      const moved = splitText(i, b.text);
      if (moved !== undefined) i = moved - 1;
    }
  } finally {
    scratch.remove();
  }
  return starts;

  /**
   * Metin bloğunu (paragraf, dipnot; sayfadan uzunsa başlık) sayfalara böler. Blok (önündeki başlıklarla) bütünüyle
   * taşındıysa yeniden ölçülecek bloğu döndürür.
   */
  function splitText(i: number, text: string): number | undefined {
    let cur = elements[i]; // dizili parça: önce akıştaki blok, bölününce devamı
    let base = 0; // cur'un metni bloğun bu karakterinden başlar
    let complete = true; // cur bloğun sonuna kadar dizili mi (pencere)
    let window = pageChars;
    let offsetY = shift; // cur'un ekran koordinatını sayfa koordinatına çevirir
    let raw = lineBoxes(cur);

    const layoutFrom = (from: number) => {
      // Pencerenin sonu bir boşlukta biter; son satırı eksik olabileceği için ölçüme katılmaz
      let end = Math.min(text.length, from + window);
      while (end < text.length && !/\s/.test(text[end])) end++;
      complete = end >= text.length;
      const part: Part = { cont: from > 0, cut: false, hyphen: false };
      const el = buildBlockElement(blocks, i, part, from, complete ? undefined : end, box);
      scratch.replaceChildren(el);
      cur = el;
      base = from;
      raw = lineBoxes(cur);
      if (!complete) raw.pop();
    };

    for (;;) {
      const lines = raw.map((l) => ({ top: l.top + offsetY, bottom: l.bottom + offsetY }));
      let k = 0;
      while (k < lines.length && lines[k].bottom - pageTop <= box.height + EPS) k++;
      if (k === lines.length) {
        if (!complete) {
          // Pencere sayfaya sığdı: daha büyük pencereyle yeniden diz (aynı sayfa, aynı başlangıç)
          const top = cur.getBoundingClientRect().top + offsetY;
          window *= 2;
          layoutFrom(base);
          offsetY = top - cur.getBoundingClientRect().top;
          continue;
        }
        used = true;
        // Blok bitti: sonraki bloklar, devamın akıştakinden farklı yüksekliği kadar kayar
        if (cur !== elements[i]) {
          shift =
            cur.getBoundingClientRect().bottom +
            offsetY -
            elements[i].getBoundingClientRect().bottom;
        }
        return undefined;
      }
      const remaining = complete ? lines.length - k : Infinity;
      // Bloğun başı sayfa dibinde tek satır (ya da hiç) kalacaksa blok bütünüyle sonraki sayfaya geçer
      if (base === 0 && used && (k === 0 || (k === 1 && lines.length > 1))) return breakBefore(i);
      if (k === 0) {
        k = 1; // satır sayfadan uzun: yine de bir satır koy
      } else if (remaining === 1) {
        // Sonraki sayfaya tek satır kalmasın
        if (k >= 3) k--;
        else if (base === 0 && used) return breakBefore(i);
      }

      // Kesme kelime başında: heceleme tiresiyle bölünmüş kelime bütünüyle sonraki sayfaya geçer. Böylece bu sayfadaki
      // parça tam kelimeyle biter ve satırları akıştakiyle aynı kalır (kelime satırdan uzunsa ortadan bölünür).
      const prevLineStart = base + charOffsetAtLine(cur, raw[k - 1]);
      let cut = base + charOffsetAtLine(cur, raw[k]);
      let w = cut;
      while (w > prevLineStart && !/\s/.test(text[w - 1])) w--;
      if (w > prevLineStart) cut = w;
      // Vekil çiftin ortasından bölme; her durumda ilerle (sonsuz döngü olmasın)
      if (/[\uDC00-\uDFFF]/.test(text[cut] ?? '')) cut--;
      if (cut <= base) cut = base + 1;

      newPage({ block: i, offset: cut }, lines[k].top);
      used = true;
      window = pageChars;
      layoutFrom(cut);
      offsetY = pageTop - cur.getBoundingClientRect().top;
    }
  }
}

/** Öğenin satır yüksekliği (px); "normal" ya da birimsiz değer de karşılanır. */
function lineHeightOf(el: HTMLElement): number {
  const s = getComputedStyle(el);
  const fontSize = parseFloat(s.fontSize) || 16;
  if (s.lineHeight.endsWith('px')) return parseFloat(s.lineHeight);
  const n = parseFloat(s.lineHeight);
  return Number.isFinite(n) ? n * fontSize : fontSize * 1.2;
}

/**
 * Öğedeki metnin satır kutuları (yukarıdan aşağı). Range dikdörtgenleri yalnızca harflerin alanını verir; satır
 * kutusu satır yüksekliği kadardır. İlk satır öğenin üst kenarına oturacak biçimde ayarlanır (yazı tipinin üst ve alt
 * payı eşit olmayabilir).
 */
function lineBoxes(el: HTMLElement): LineBox[] {
  const lh = lineHeightOf(el);
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = [...range.getClientRects()]
    .filter((r) => r.height > 0)
    .sort((a, b) => a.top - b.top);
  const mids: number[] = [];
  for (const r of rects) {
    const mid = r.top + r.height / 2;
    const last = mids[mids.length - 1];
    if (last !== undefined && mid < last + lh / 2) continue; // aynı satırın başka parçası
    mids.push(mid);
  }
  if (mids.length === 0) return [];
  const calibrate = el.getBoundingClientRect().top - (mids[0] - lh / 2);
  return mids.map((m) => {
    const top = m - lh / 2 + calibrate;
    return { top, bottom: top + lh };
  });
}

/**
 * Satırın ilk karakterinin öğe metnindeki yeri (ikili arama; yeniden dizme yok). Karakterin orta noktasının satır
 * kutusunda olup olmadığına bakılır: yazı tipinin harf kutusu satır yüksekliğinden büyük olabilir.
 */
function charOffsetAtLine(el: HTMLElement, line: LineBox): number {
  const node = el.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return 0;
  const text = node.textContent ?? '';
  const range = document.createRange();
  const midAt = (i: number): number => {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const r = range.getBoundingClientRect();
    // Satır sonundaki boşluğun kutusu WebKit'te boş: önceki karakterin satırında sayılır
    if (r.height === 0) return i > 0 ? midAt(i - 1) : -Infinity;
    return r.top + r.height / 2;
  };
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (midAt(mid) >= line.top) hi = mid;
    else lo = mid + 1;
  }
  // Satır başı boşlukla başlamaz
  while (lo < text.length && /\s/.test(text[lo])) lo++;
  return lo;
}

/** Konumun bulunduğu sayfa: başlangıcı konumdan sonra olmayan son sayfa (ikili arama). */
export function pageOf(starts: Locator[], loc: Locator): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const s = starts[mid];
    if (s.block < loc.block || (s.block === loc.block && s.offset <= loc.offset)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
