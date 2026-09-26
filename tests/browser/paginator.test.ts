import '@fontsource-variable/inter/index.css';
import '@fontsource-variable/literata/index.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/source-serif-4/400.css';
import '../../src/styles/book.css';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Block, Locator } from '../../src/convert/types';
import { buildPageElements, chapterSink, paginate, type PageBox } from '../../src/layout/paginator';
import {
  DEFAULT_TYPOGRAPHY,
  FONT_FAMILIES,
  FONTS,
  typographyStyle,
  type Typography,
} from '../../src/layout/typography';

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

function makeBox(width: number, height: number, t: Typography = DEFAULT_TYPOGRAPHY): PageBox {
  return { width, height, sink: chapterSink(t.size * t.lineHeight, height) };
}

const BOX = makeBox(360, 520);
let host: HTMLElement;

function makeHost(t: Typography = DEFAULT_TYPOGRAPHY, box = BOX): HTMLElement {
  const el = document.createElement('div');
  el.className = 'book-page-content';
  el.lang = 'tr';
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

/** Bütün sayfaları çizer; taşan sayfaların numaraları (1 px yuvarlama payı) */
function overflowingPages(
  blocks: Block[],
  starts: Locator[],
  t: Typography,
  box: PageBox,
): number[] {
  const bad: number[] = [];
  starts.forEach((_, p) => {
    const page = renderPage(blocks, starts, p, t, box);
    if (contentBottom(page) > box.height + 1) bad.push(p);
    page.remove();
  });
  return bad;
}

/** Sayfalardan geri kurulan metin özgün metinle aynı (her karakter tam olarak bir sayfada) */
function expectCoverage(blocks: Block[], starts: Locator[], box = BOX) {
  const pieces = new Map<number, string>();
  starts.forEach((_, p) => {
    for (const el of buildPageElements(blocks, starts[p], starts[p + 1], box)) {
      const i = Number(el.dataset.block);
      pieces.set(i, (pieces.get(i) ?? '') + (el.textContent ?? ''));
    }
  });
  blocks.forEach((b, i) => {
    if (b.kind === 'break') expect(pieces.has(i)).toBe(true);
    else if ('text' in b) expect(pieces.get(i), `blok ${i}`).toBe(b.text);
    else expect(pieces.has(i)).toBe(true);
  });
}

const before = (a: Locator, b: Locator) =>
  a.block < b.block || (a.block === b.block && a.offset < b.offset);

beforeAll(async () => {
  // Gerçek yazı tipleri: harf kutusu satır yüksekliğinden büyük olabilir (Literata ~1,49 em)
  await Promise.all(
    FONTS.map((f) => document.fonts.load(`20px ${FONT_FAMILIES[f]}`, 'Aa ğüşıöç ĞÜŞİÖÇ')),
  );
  await document.fonts.ready;
});
beforeEach(() => {
  host = makeHost();
});
afterEach(() => {
  document.body.replaceChildren();
});

describe('paginate', () => {
  it('sayfa başları kesin artan sırada; ilk sayfa kitabın başı', () => {
    const starts = paginate(host, makeBook(), BOX);
    expect(starts[0]).toEqual({ block: 0, offset: 0 });
    expect(starts.length).toBeGreaterThan(10);
    for (let i = 1; i < starts.length; i++) expect(before(starts[i - 1], starts[i])).toBe(true);
  });

  it('her karakter tam olarak bir sayfada', () => {
    const blocks = makeBook();
    expectCoverage(blocks, paginate(host, blocks, BOX));
  });

  it('hiçbir sayfa taşmıyor (ölçüm ile çizim aynı)', () => {
    const blocks = makeBook();
    const starts = paginate(host, blocks, BOX);
    expect(overflowingPages(blocks, starts, DEFAULT_TYPOGRAPHY, BOX)).toEqual([]);
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

  it('başlık, arkasındaki metin sığmadığı için sayfa dibinde yalnız kalmaz', () => {
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
    expect(paginate(host, blocks, BOX)).toEqual(a);
    const t = { ...DEFAULT_TYPOGRAPHY, size: 26 };
    expect(paginate(makeHost(t), blocks, makeBox(360, 520, t)).length).toBeGreaterThan(a.length);
  });
});

describe('paginate — yazı tipleri, kutular ve zor girdiler', () => {
  it('dört yazı tipi × dar ve geniş satır aralığında hiçbir sayfa taşmaz', () => {
    const blocks = makeBook(2, 10);
    for (const font of FONTS) {
      for (const lineHeight of [1.3, 1.4, 1.6, 1.8]) {
        const t: Typography = { ...DEFAULT_TYPOGRAPHY, font, lineHeight };
        const box = makeBox(360, 520, t);
        const starts = paginate(makeHost(t, box), blocks, box);
        expect(overflowingPages(blocks, starts, t, box), `${font} ${lineHeight}`).toEqual([]);
      }
    }
  });

  it('pek çok punto, hizalama ve kutu bileşiminde hiçbir sayfa taşmaz, metin kaybolmaz', () => {
    const blocks = makeBook(2, 10);
    for (let n = 0; n < 12; n++) {
      const t: Typography = {
        ...DEFAULT_TYPOGRAPHY,
        font: FONTS[n % 4],
        size: 14 + ((n * 5) % 15),
        lineHeight: 1.3 + ((n * 3) % 8) / 10,
        align: n % 3 === 0 ? 'left' : 'justify',
        hyphenate: n % 2 === 0,
      };
      const box = makeBox(260 + ((n * 97) % 400), 380 + ((n * 131) % 420), t);
      const starts = paginate(makeHost(t, box), blocks, box);
      expect(overflowingPages(blocks, starts, t, box), `bileşim ${n}`).toEqual([]);
      expectCoverage(blocks, starts, box);
    }
  });

  it('küçük ekranda sayfadan uzun bölüm başlığı taşmaz', () => {
    const t = { ...DEFAULT_TYPOGRAPHY, size: 30 };
    const box = makeBox(300, 240, t);
    const blocks: Block[] = [
      {
        kind: 'heading',
        level: 1,
        text: 'Birinci Bölüm: Sisli Sabahın Uzun ve Yorucu Yolculuğu',
        srcPage: 0,
      },
      { kind: 'para', text: SENTENCES.join(' '), srcPage: 0 },
      { kind: 'heading', level: 1, text: 'İkinci Bölüm: Akşam', srcPage: 1 },
      { kind: 'para', text: SENTENCES.join(' '), srcPage: 1 },
    ];
    const starts = paginate(makeHost(t, box), blocks, box);
    expect(overflowingPages(blocks, starts, t, box)).toEqual([]);
    expectCoverage(blocks, starts, box);
  });

  it('yumuşak tireli ve fazla boşluklu metin de taşmadan, kaybolmadan bölünür', () => {
    const shy = SENTENCES.join(' ').replace(/(\p{L}{3})(?=\p{L})/gu, '$1­');
    const blocks: Block[] = Array.from({ length: 12 }, (_, i) => ({
      kind: 'para',
      text: i % 4 === 3 ? `${SENTENCES[i % 6]}   ${SENTENCES[(i + 1) % 6]}` : shy,
      srcPage: i,
    }));
    for (const hyphenate of [true, false]) {
      const t = { ...DEFAULT_TYPOGRAPHY, hyphenate };
      const starts = paginate(makeHost(t), blocks, BOX);
      expect(overflowingPages(blocks, starts, t, BOX)).toEqual([]);
      expectCoverage(blocks, starts);
    }
  });

  it('tek paragraftan oluşan uzun kitap da hızlı sayfalanır (paragraf baştan dizilmez)', () => {
    const text = Array.from({ length: 1200 }, (_, i) => SENTENCES[i % 6]).join(' ');
    const blocks: Block[] = [{ kind: 'para', text, srcPage: 0 }];
    const started = performance.now();
    const starts = paginate(host, blocks, BOX);
    const ms = performance.now() - started;
    expect(starts.length).toBeGreaterThan(150);
    expect(ms).toBeLessThan(3000);
    expectCoverage(blocks, starts);
    for (const p of [0, 1, Math.floor(starts.length / 2), starts.length - 1]) {
      const page = renderPage(blocks, starts, p);
      expect(contentBottom(page), `sayfa ${p}`).toBeLessThanOrEqual(BOX.height + 1);
      page.remove();
    }
  });

  it('300 sayfalık kitap birkaç saniyeden kısa sürede sayfalanır', () => {
    const blocks = makeBook(30, 40);
    const started = performance.now();
    const starts = paginate(host, blocks, BOX);
    expect(starts.length).toBeGreaterThan(300);
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it('kutu belgeye bağlı değilse açık hata verir', () => {
    const detached = document.createElement('div');
    expect(() => paginate(detached, makeBook(1, 2), BOX)).toThrow();
  });
});
