import '../../src/styles/book.css';
import { afterEach, describe, expect, it } from 'vitest';
import type { Block } from '../../src/convert/types';
import { buildPageElements, type PageBox } from '../../src/layout/paginator';
import {
  locatorAtPoint,
  offsetIn,
  paintFallback,
  sentenceRanges,
} from '../../src/reader/modes/textHighlight';

const BOX: PageBox = { width: 300, height: 400, sink: 0 };

const blocks: Block[] = [
  { kind: 'heading', level: 1, text: 'BİRİNCİ BÖLÜM', srcPage: 0 },
  { kind: 'para', text: 'İlk cümle burada. İkinci cümle iki sayfaya bölünür. Son.', srcPage: 0 },
];

/** Kitap sayfası gibi: `.book-page-content` içinde sayfalayıcının öğeleri */
function page(start: { block: number; offset: number }, end?: { block: number; offset: number }) {
  const content = document.createElement('div');
  content.className = 'book-page-content';
  content.replaceChildren(...buildPageElements(blocks, start, end, BOX));
  document.body.append(content);
  return content;
}

afterEach(() => document.body.replaceChildren());

describe('sentenceRanges', () => {
  const para = blocks[1] as { text: string };
  const second = { block: 1, start: para.text.indexOf('İkinci'), end: para.text.indexOf(' Son.') };

  it('bloğun içindeki cümlenin aralığı', () => {
    page({ block: 0, offset: 0 });
    const ranges = sentenceRanges(document.body, blocks, second);
    expect(ranges.map(String)).toEqual(['İkinci cümle iki sayfaya bölünür.']);
  });

  it('iki sayfaya bölünen cümle: her sayfada kendi parçası (öğenin bloktaki başlangıcı data-from)', () => {
    const cut = para.text.indexOf('sayfaya');
    page({ block: 0, offset: 0 }, { block: 1, offset: cut });
    page({ block: 1, offset: cut });
    const ranges = sentenceRanges(document.body, blocks, second);
    expect(ranges.map(String)).toEqual(['İkinci cümle iki ', 'sayfaya bölünür.']);
    // sonraki sayfadaki cümle yalnızca orada
    const last = { block: 1, start: para.text.indexOf('Son.'), end: para.text.length };
    expect(sentenceRanges(document.body, blocks, last).map(String)).toEqual(['Son.']);
  });

  it('başlık tek cümle; çizilmemiş blok boş sonuç', () => {
    page({ block: 0, offset: 0 }, { block: 1, offset: 0 });
    expect(
      sentenceRanges(document.body, blocks, { block: 0, start: 0, end: 13 }).map(String),
    ).toEqual(['BİRİNCİ BÖLÜM']);
    expect(sentenceRanges(document.body, blocks, second)).toEqual([]);
  });

  it('DOM’daki yumuşak tireler atlanır', () => {
    const content = page({ block: 0, offset: 0 });
    const p = content.querySelector<HTMLElement>('[data-block="1"]')!;
    const shy = String.fromCharCode(0xad);
    p.textContent = p.textContent!.replace('cümle iki', `cüm${shy}le iki`);
    const ranges = sentenceRanges(document.body, blocks, second);
    expect(ranges.map(String)).toEqual([`İkinci cüm${shy}le iki sayfaya bölünür.`]);
  });
});

describe('paintFallback (Highlight API yokken)', () => {
  it('aralığın satır kutularını sayfanın içinde, yazının arkasında çizer; yerleşim değişmez; kaldırılabilir', () => {
    const book = document.createElement('div');
    book.className = 'book-page';
    book.style.cssText = 'position: relative; width: 320px; height: 420px';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position: absolute; left: 10px; top: 10px; width: 300px; height: 400px';
    book.append(wrap);
    document.body.append(book);
    const content = document.createElement('div');
    content.className = 'book-page-content';
    content.replaceChildren(...buildPageElements(blocks, { block: 0, offset: 0 }, undefined, BOX));
    wrap.append(content);
    const before = content.getBoundingClientRect();
    const para = blocks[1] as { text: string };
    const second = {
      block: 1,
      start: para.text.indexOf('İkinci'),
      end: para.text.indexOf(' Son.'),
    };
    const [range] = sentenceRanges(document.body, blocks, second);

    const clear = paintFallback([range]);
    const layer = book.firstElementChild as HTMLElement;
    expect(layer.classList.contains('sentence-fallback')).toBe(true);
    expect(getComputedStyle(layer).pointerEvents).toBe('none');
    expect(getComputedStyle(layer).position).toBe('absolute');
    const marks = [...layer.children] as HTMLElement[];
    const rects = [...range.getClientRects()].filter((r) => r.width >= 0.5);
    expect(marks).toHaveLength(rects.length);
    const pageBox = book.getBoundingClientRect();
    const first = marks[0].getBoundingClientRect();
    expect(first.left).toBeCloseTo(rects[0].left, 0);
    expect(first.top).toBeCloseTo(rects[0].top, 0);
    expect(first.left).toBeGreaterThanOrEqual(pageBox.left);
    // yazı katmanın önünde: kutunun ortasındaki öğe metindir, katman değil
    const hit = document.elementFromPoint(first.left + 4, first.top + first.height / 2);
    expect(hit && layer.contains(hit)).toBe(false);
    expect(content.getBoundingClientRect()).toEqual(before);

    clear();
    expect(book.querySelector('.sentence-fallback')).toBeNull();
  });
});

describe('offsetIn ve locatorAtPoint (kalemle odak)', () => {
  const para = blocks[1] as { text: string };

  it('DOM yeri blok konumuna çevrilir; data-from ve yalnızca DOM’daki yumuşak tireler hesaba katılır', () => {
    const cut = para.text.indexOf('sayfaya');
    page({ block: 0, offset: 0 }, { block: 1, offset: cut });
    const second = page({ block: 1, offset: cut });
    const el = second.querySelector<HTMLElement>('[data-block="1"]')!;
    const node = [...el.childNodes].find((n) => n instanceof Text)!;
    // ikinci sayfadaki öğe blok metninin `cut`tan başlayan kısmı
    expect(offsetIn(el, para.text, cut, node, 0)).toBe(cut);
    expect(offsetIn(el, para.text, cut, node, 3)).toBe(cut + 3);

    const first = document.querySelector<HTMLElement>('.book-page-content [data-block="1"]')!;
    const shy = String.fromCharCode(0xad);
    first.textContent = first.textContent!.replace('cümle iki', `cüm${shy}le iki`);
    const text = first.firstChild as Text;
    const at = text.data.indexOf('le iki');
    expect(offsetIn(first, para.text, 0, text, at)).toBe(para.text.indexOf('le iki'));
    // öğenin dışındaki düğüm: null
    expect(offsetIn(first, para.text, 0, node, 0)).toBeNull();
  });

  it('noktanın altındaki harfin blok konumu; yazıdan uzak nokta null', () => {
    const content = page({ block: 0, offset: 0 });
    content.style.cssText = 'position: absolute; left: 0; top: 0; width: 300px';
    const el = content.querySelector<HTMLElement>('[data-block="1"]')!;
    const text = [...el.childNodes].find((n): n is Text => n instanceof Text)!;
    const at = text.data.indexOf('İkinci') + 2;
    const range = document.createRange();
    range.setStart(text, at);
    range.setEnd(text, at + 1);
    const r = range.getBoundingClientRect();
    const hit = locatorAtPoint(document.body, blocks, r.left + 1, r.top + r.height / 2, 12);
    expect(hit?.block).toBe(1);
    // imleç harfin önünde ya da arkasında durabilir
    expect(Math.abs(hit!.offset - para.text.indexOf('İkinci') - 2)).toBeLessThanOrEqual(1);
    const box = content.getBoundingClientRect();
    expect(locatorAtPoint(document.body, blocks, box.left + 5, box.bottom + 200, 12)).toBeNull();
  });
});
