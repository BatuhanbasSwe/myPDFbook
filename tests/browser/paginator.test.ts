import '../../src/styles/book.css';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Block, Locator } from '../../src/convert/types';
import { buildPageElements, paginate, type PageBox } from '../../src/layout/paginator';
import { DEFAULT_TYPOGRAPHY, typographyStyle, type Typography } from '../../src/layout/typography';

const SENTENCES = [
  'Sabahın ilk ışıkları kasabanın dar sokaklarına düştüğünde herkes çoktan uyanmıştı.',
  'Kitapçının sahibi onu görünce gülümsedi ve raftaki eski ciltleri gösterdi.',
  'Işıklar geri dönecek, dedi yaşlı adam; kimse ona inanmadı ama kimse de gülmedi.',
  'Yolun sonundaki istasyonda tren her zamankinden geç kaldı.',
  'Çocuklar bahçede oynarken annesi pencereden seslendi, akşam yemeği hazırdı.',
  'Şehrin üzerindeki sis öğleye kadar dağılmadı; güneş ancak ikindiye doğru göründü.',
];

/** Uzunlukları farklı paragraflardan, bölümlerden, dipnottan, sahne arasından ve görsel sayfadan oluşan kitap */
function makeBook(chapters = 6, parasPerChapter = 14): Block[] {
  const blocks: Block[] = [];
  let seed = 7;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let c = 0; c < chapters; c++) {
    blocks.push({ kind: 'heading', level: 1, text: `${c + 1}. BÖLÜM`, srcPage: c * 10 });
    blocks.push({ kind: 'heading', level: 2, text: 'Sisli Sabah', srcPage: c * 10 });
    for (let p = 0; p < parasPerChapter; p++) {
      const n = 1 + Math.floor(rnd() * 9);
      const text = Array.from({ length: n }, (_, i) => SENTENCES[(p + i) % SENTENCES.length]).join(
        ' ',
      );
      blocks.push({ kind: 'para', text, srcPage: c * 10 + 1 });
      if (p === 5)
        blocks.push({
          kind: 'note',
          text: '¹ Kitabın ilk baskısı 1923 yılında yapılmıştır.',
          srcPage: c * 10 + 1,
        });
      if (p === 9) blocks.push({ kind: 'break', srcPage: c * 10 + 2 });
      if (p === 11 && c === 2) blocks.push({ kind: 'pageImage', srcPage: c * 10 + 3 });
    }
  }
  return blocks;
}

const BOX: PageBox = { width: 360, height: 520 };
let host: HTMLElement;

function makeHost(t: Typography = DEFAULT_TYPOGRAPHY, box = BOX): HTMLElement {
  const el = document.createElement('div');
  el.className = 'book-page-content';
  Object.assign(el.style, {
    position: 'absolute',
    left: '-10000px',
    top: '0',
    width: `${box.width}px`,
  });
  for (const [k, v] of Object.entries(typographyStyle(t))) el.style.setProperty(k, v);
  document.body.append(el);
  return el;
}

/** Sayfayı gerçek sayfa kutusunda çizer (sabit yükseklik) */
function renderPage(
  blocks: Block[],
  starts: Locator[],
  p: number,
  t = DEFAULT_TYPOGRAPHY,
  box = BOX,
) {
  const page = makeHost(t, box);
  page.style.height = `${box.height}px`;
  page.style.overflow = 'hidden';
  page.replaceChildren(...buildPageElements(blocks, starts[p], starts[p + 1], box));
  return page;
}

/** Son öğenin alt kenarı, sayfanın üstünden (son öğenin alt dış boşluğu sayılmaz) */
const contentBottom = (page: HTMLElement) =>
  Math.max(0, ...[...page.children].map((c) => c.getBoundingClientRect().bottom)) -
  page.getBoundingClientRect().top;

const before = (a: Locator, b: Locator) =>
  a.block < b.block || (a.block === b.block && a.offset < b.offset);

beforeEach(() => {
  host = makeHost();
});
afterEach(() => {
  document.body.replaceChildren();
});

describe('paginate', () => {
  it('sayfa başları kesin artan sırada; ilk sayfa kitabın başı', () => {
    const blocks = makeBook();
    const starts = paginate(host, blocks, BOX);
    expect(starts[0]).toEqual({ block: 0, offset: 0 });
    expect(starts.length).toBeGreaterThan(10);
    for (let i = 1; i < starts.length; i++) expect(before(starts[i - 1], starts[i])).toBe(true);
  });

  it('her karakter tam olarak bir sayfada', () => {
    const blocks = makeBook();
    const starts = paginate(host, blocks, BOX);
    const pieces = new Map<number, string>();
    starts.forEach((_, p) => {
      for (const el of buildPageElements(blocks, starts[p], starts[p + 1], BOX)) {
        const i = Number(el.dataset.block);
        pieces.set(i, (pieces.get(i) ?? '') + (el.textContent ?? ''));
      }
    });
    blocks.forEach((b, i) => {
      if (b.kind === 'para' || b.kind === 'note' || b.kind === 'heading')
        expect(pieces.get(i)).toBe(b.text);
      else expect(pieces.has(i)).toBe(true);
    });
  });

  it('hiçbir sayfa taşmıyor (ölçüm ile çizim aynı)', () => {
    const blocks = makeBook();
    const starts = paginate(host, blocks, BOX);
    starts.forEach((_, p) => {
      const page = renderPage(blocks, starts, p);
      expect(contentBottom(page), `sayfa ${p}`).toBeLessThanOrEqual(BOX.height + 1);
      page.remove();
    });
  });

  it('bölüm yeni sayfada başlar; görsel sayfa tek başınadır', () => {
    const blocks = makeBook();
    const starts = paginate(host, blocks, BOX);
    const startBlocks = new Set(starts.filter((s) => s.offset === 0).map((s) => s.block));
    blocks.forEach((b, i) => {
      if (b.kind === 'heading' && b.level === 1) expect(startBlocks.has(i)).toBe(true);
      if (b.kind === 'pageImage') {
        const p = starts.findIndex((s) => s.block === i && s.offset === 0);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(starts[p + 1]).toEqual({ block: i + 1, offset: 0 });
      }
    });
  });

  it('başlık sayfa dibinde yalnız kalmaz', () => {
    const blocks = makeBook();
    const starts = paginate(host, blocks, BOX);
    starts.forEach((_, p) => {
      const els = buildPageElements(blocks, starts[p], starts[p + 1], BOX);
      const last = blocks[Number(els[els.length - 1].dataset.block)];
      const onlyHeadings = els.every((el) => blocks[Number(el.dataset.block)].kind === 'heading');
      if (!onlyHeadings && p < starts.length - 1)
        expect(last.kind, `sayfa ${p}`).not.toBe('heading');
    });
  });

  it('aynı girdi aynı sonucu verir; punto büyüyünce sayfa sayısı artar', () => {
    const blocks = makeBook();
    const a = paginate(host, blocks, BOX);
    const b = paginate(host, blocks, BOX);
    expect(b).toEqual(a);
    const big = makeHost({ ...DEFAULT_TYPOGRAPHY, size: 26 });
    expect(paginate(big, blocks, BOX).length).toBeGreaterThan(a.length);
  });

  it('iki yana ve sola hizalamada, farklı kutu boyutlarında da sayfalar taşmaz', () => {
    const blocks = makeBook(3, 12);
    for (const [t, box] of [
      [
        { ...DEFAULT_TYPOGRAPHY, align: 'left', size: 16 },
        { width: 300, height: 420 },
      ],
      [
        { ...DEFAULT_TYPOGRAPHY, font: 'inter', size: 22, lineHeight: 1.9 },
        { width: 520, height: 700 },
      ],
    ] as const) {
      const h = makeHost(t, box);
      const starts = paginate(h, blocks, box);
      starts.forEach((_, p) => {
        const page = renderPage(blocks, starts, p, t, box);
        if (contentBottom(page) > box.height + 1)
          console.log(
            'TASMA',
            t.font,
            p,
            JSON.stringify(starts[p]),
            JSON.stringify(starts[p + 1]),
            [...page.children]
              .map(
                (c) =>
                  c.className +
                  '[' +
                  Math.round(c.getBoundingClientRect().top - page.getBoundingClientRect().top) +
                  '-' +
                  Math.round(c.getBoundingClientRect().bottom - page.getBoundingClientRect().top) +
                  ']',
              )
              .join(' '),
          );
        expect(contentBottom(page)).toBeLessThanOrEqual(box.height + 1);
        page.remove();
      });
    }
  });
});

describe('paginate — dayanıklılık ve hız', () => {
  it('pek çok yazı tipi, punto, satır aralığı ve kutu bileşiminde hiçbir sayfa taşmaz', () => {
    const blocks = makeBook(2, 10);
    const fonts = ['literata', 'source-serif', 'inter', 'atkinson'] as const;
    let checked = 0;
    for (let n = 0; n < 12; n++) {
      const t: Typography = {
        ...DEFAULT_TYPOGRAPHY,
        font: fonts[n % 4],
        size: 14 + ((n * 5) % 15),
        lineHeight: 1.3 + ((n * 3) % 8) / 10,
        align: n % 3 === 0 ? 'left' : 'justify',
        hyphenate: n % 2 === 0,
      };
      const box = { width: 260 + ((n * 97) % 400), height: 380 + ((n * 131) % 420) };
      const h = makeHost(t, box);
      const starts = paginate(h, blocks, box);
      starts.forEach((_, p) => {
        const page = renderPage(blocks, starts, p, t, box);
        expect(contentBottom(page), `bileşim ${n}, sayfa ${p}`).toBeLessThanOrEqual(box.height + 1);
        page.remove();
        checked++;
      });
      h.remove();
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('300 sayfalık kitap bir saniyeden kısa sürede sayfalanır', () => {
    const blocks = makeBook(30, 40);
    const started = performance.now();
    const starts = paginate(host, blocks, BOX);
    const ms = performance.now() - started;
    expect(starts.length).toBeGreaterThan(300);
    expect(ms).toBeLessThan(1000);
  });
});
