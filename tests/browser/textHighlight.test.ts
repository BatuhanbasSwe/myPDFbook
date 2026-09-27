import '../../src/styles/book.css';
import { afterEach, describe, expect, it } from 'vitest';
import type { Block } from '../../src/convert/types';
import { buildPageElements, type PageBox } from '../../src/layout/paginator';
import { paintFallback, sentenceRanges } from '../../src/reader/modes/textHighlight';

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
