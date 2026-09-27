import '../../src/styles/book.css';
import { afterEach, describe, expect, it } from 'vitest';
import type { Block } from '../../src/convert/types';
import { buildPageElements, type PageBox } from '../../src/layout/paginator';
import { sentenceRanges } from '../../src/reader/modes/textHighlight';

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
