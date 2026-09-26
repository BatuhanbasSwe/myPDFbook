import type { Block, Locator } from '../convert/types';
import { blockClassName, blockTag, blockText, type Part, WHOLE } from './blockMarkup';

/** Sayfanın metin kutusu (kenar boşlukları, sayfa başlığı ve numarası hariç), CSS pikseli */
export interface PageBox {
  width: number;
  height: number;
}

/** Bölüm başlığı sayfada bu kadar satır aşağıdan başlar (book.css'teki .b-heading.chapter ile aynı) */
export const CHAPTER_SINK_LINES = 3;

/** Satır ölçümlerindeki yuvarlama payı (px) */
const EPS = 0.5;

/**
 * Kitabı sayfalara böler; her sayfanın başladığı konumu döndürür (ilk sayfa {0, 0}).
 *
 * `host` belgeye bağlı, görünmez ama yerleşim yapılan (ör. ekran dışına konmuş) bir kutudur: `book-page-content`
 * sınıfı ve tipografi değişkenleri verilmiş, genişliği `box.width` olmalıdır. Kitap bu kutuda tek sütun olarak bir
 * kez dizilir; sayfa sınırları öğelerin ve satırların konumlarından bulunur (her sayfa için yeniden dizilmez).
 *
 * Kurallar: bölüm başlığı ve görsel sayfa yeni sayfada başlar (görsel sayfa tek başınadır); başlık sayfa dibinde
 * yalnız kalmaz; paragraf yalnızca satır başından bölünür, sayfa dibinde tek satırı kalacaksa bütünüyle sonraki
 * sayfaya geçer, sonraki sayfaya tek satırı kalacaksa bir satır geri alınır.
 */
export function paginate(host: HTMLElement, blocks: Block[], box: PageBox): Locator[] {
  if (blocks.length === 0) return [{ block: 0, offset: 0 }];
  const elements = blocks.map((_, i) => buildBlockElement(blocks, i, WHOLE, 0, undefined, box));
  host.replaceChildren(...elements);
  try {
    return measure(host, elements, blocks, box);
  } finally {
    host.replaceChildren();
  }
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
      hyphen:
        to !== undefined && /\p{L}/u.test(text[to - 1] ?? '') && /\p{L}/u.test(text[to] ?? ''),
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
    // Görsel sayfa bir sayfayı kaplar; görsel sayfa görünümünde React ile yerleştirilir
    el.style.height = `${box.height}px`;
    el.dataset.srcPage = String(b.srcPage);
  } else {
    el.textContent = blockText(b, from, to);
    if (b.kind === 'break') el.setAttribute('aria-hidden', 'true');
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
  const lineHeight = parseFloat(getComputedStyle(host).lineHeight) || 24;
  const sink = CHAPTER_SINK_LINES * lineHeight;
  const isChapter = (i: number) => blocks[i]?.kind === 'heading' && blocks[i].level === 1;

  // Paragrafın sonraki sayfadaki devamı ayrı bir kutuda kendi başına dizilir (çizimde de öyle görünür). Devamın
  // yüksekliği akıştaki hâlinden farklı olabilir; sonraki blokların konumları bu fark (shift) kadar kaydırılır.
  const scratch = host.cloneNode(false) as HTMLElement;
  host.after(scratch);
  let shift = 0;
  const rectOf = (i: number) => {
    const r = elements[i].getBoundingClientRect();
    return { top: r.top + shift, bottom: r.bottom + shift };
  };
  const topOf = (i: number) => rectOf(i).top - (isChapter(i) ? sink : 0);

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
      if (b.kind !== 'para' && b.kind !== 'note') {
        // bölünemeyen blok sığmıyor: sonraki sayfaya (tek başına da sığmıyorsa yine de o sayfaya konur)
        if (used) {
          i = breakBefore(i) - 1; // taşınan başlıklar yeniden ölçülsün
          continue;
        }
        used = true;
        continue;
      }
      const moved = splitParagraph(i, b.text);
      if (moved !== undefined) i = moved - 1;
    }
  } finally {
    scratch.remove();
  }
  return starts;

  /** Paragrafı sayfalara böler. Paragraf (önündeki başlıklarla) bütünüyle taşındıysa yeniden ölçülecek bloğu döndürür. */
  function splitParagraph(i: number, text: string): number | undefined {
    let cur = elements[i]; // dizili parça: önce akıştaki paragraf, bölününce devamı
    let base = 0; // cur'un metni paragrafın bu karakterinden başlar
    let offsetY = shift; // cur'un ekran koordinatını sayfa koordinatına çevirir
    let raw = lineBoxes(cur);
    let li = 0; // bu sayfadaki ilk satır
    for (;;) {
      const lines = raw.map((l) => ({ top: l.top + offsetY, bottom: l.bottom + offsetY }));
      let k = li;
      while (k < lines.length && lines[k].bottom - pageTop <= box.height + EPS) k++;
      if (k === lines.length) {
        used = true;
        // Paragraf bitti: sonraki bloklar, devamın akıştakinden farklı yüksekliği kadar kayar
        if (cur !== elements[i]) {
          shift =
            cur.getBoundingClientRect().bottom +
            offsetY -
            elements[i].getBoundingClientRect().bottom;
        }
        return undefined;
      }
      const fitted = k - li;
      // Paragrafın başı sayfa dibinde tek satır (ya da hiç) kalacaksa paragraf bütünüyle sonraki sayfaya geçer
      if (base === 0 && li === 0 && used && (fitted === 0 || (fitted === 1 && lines.length > 1))) {
        return breakBefore(i);
      }
      if (fitted === 0)
        k = li + 1; // satır sayfadan uzun: yine de bir satır koy
      // Sonraki sayfaya tek satır kalmasın
      else if (lines.length - k === 1 && fitted >= 3) k--;

      // Kesme kelime başında: heceleme tiresiyle bölünmüş kelime bütünüyle sonraki sayfaya geçer. Böylece bu sayfadaki
      // parça tam kelimeyle biter ve satırları akıştakiyle aynı kalır (kelime satırdan uzunsa ortadan bölünür).
      const prevLineStart = base + charOffsetAtLine(cur, raw[k - 1].top);
      let cut = base + charOffsetAtLine(cur, raw[k].top);
      let w = cut;
      while (w > prevLineStart && !/\s/.test(text[w - 1])) w--;
      if (w > prevLineStart) cut = w;

      newPage({ block: i, offset: cut }, lines[k].top);
      used = true;
      const cont = buildBlockElement(
        blocks,
        i,
        { cont: true, cut: false, hyphen: false },
        cut,
        undefined,
        box,
      );
      scratch.replaceChildren(cont);
      cur = cont;
      base = cut;
      raw = lineBoxes(cur);
      offsetY = pageTop - cont.getBoundingClientRect().top;
      li = 0;
    }
  }
}

/**
 * Öğedeki metnin satır kutuları (yukarıdan aşağı). Range dikdörtgenleri yalnızca harflerin alanını verir; satır
 * kutusu satır yüksekliği kadardır (üstte ve altta yarım satır aralığı payı), sayfa sınırı ona göre çizilir.
 */
function lineBoxes(el: HTMLElement): LineBox[] {
  const lh = parseFloat(getComputedStyle(el).lineHeight);
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = [...range.getClientRects()]
    .filter((r) => r.height > 0)
    .sort((a, b) => a.top - b.top);
  const lines: LineBox[] = [];
  for (const r of rects) {
    const last = lines[lines.length - 1];
    const mid = r.top + r.height / 2;
    if (last && mid < last.bottom) continue; // aynı satırın başka parçası
    const top = Number.isFinite(lh) ? mid - lh / 2 : r.top;
    lines.push({ top, bottom: Number.isFinite(lh) ? top + lh : r.bottom });
  }
  return lines;
}

/** Üst kenarı `lineTop` olan satırın ilk karakterinin metindeki yeri (ikili arama; yeniden dizme yok). */
function charOffsetAtLine(el: HTMLElement, lineTop: number): number {
  const node = el.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return 0;
  const text = node.textContent ?? '';
  const range = document.createRange();
  const topAt = (i: number) => {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    return range.getBoundingClientRect().top;
  };
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (topAt(mid) >= lineTop - EPS) hi = mid;
    else lo = mid + 1;
  }
  // Satır sonundaki boşluklar önceki satırda görünür; satır başı boşlukla başlamaz
  while (lo < text.length && /\s/.test(text[lo])) lo++;
  return lo;
}
