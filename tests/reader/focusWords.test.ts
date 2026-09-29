import { describe, expect, it } from 'vitest';
import type { Block, PageText } from '../../src/convert/types';
import {
  charAfterWords,
  charAtPoint,
  movePageCenter,
  moveTextCenter,
  pageEdge,
  pageWindow,
  textWindow,
  textWords,
  wordAtOffset,
} from '../../src/reader/modes/focusWords';
import { pageCharMap, type PageCharMap } from '../../src/text/pageGeometry';

// Yapay sayfa: 300×400, 10 puntoluk satırlar (her harf 5 birim geniş), altta sayfa numarası
const SIZE = 10;
const LINES = [
  'Sabahın ilk ışıkları, kasabanın dar',
  'sokaklarına düşerken Dr. Ahmet Bey',
  'penceresinin önünde durmuş; uzaklardaki',
  'dağların arkasından yükselen sisi seyrediyordu.',
];
/** satırın taban çizgisi (PDF uzayında, alttan) */
const baseline = (line: number) => 350 - line * 15;

function page(lines = LINES): PageText {
  const item = (str: string, y: number) => ({
    str,
    transform: [SIZE, 0, 0, SIZE, 20, y],
    width: str.length * 5,
    height: SIZE,
  });
  return {
    width: 300,
    height: 400,
    items: [...lines.map((s, i) => item(s, baseline(i))), item('3', 20)],
  };
}

/** Harita metninin [start, end) aralığındaki kelimeler (normalleştirilmiş) */
function wordsOf(map: PageCharMap, start: number, end: number): string[] {
  const out: string[] = [];
  for (let i = start; i < end; i++) {
    if (map.wordStart[i] || i === start) out.push('');
    out[out.length - 1] += map.text[i];
  }
  return out;
}

/** Kelimenin (normalleştirilmiş) ilk harfinin harita metnindeki yeri */
function charOf(map: PageCharMap, word: string): number {
  for (let i = map.text.indexOf(word); i >= 0; i = map.text.indexOf(word, i + 1))
    if (map.wordStart[i]) return i;
  throw new Error(`kelime yok: ${word}`);
}

describe('pageWindow', () => {
  const map = pageCharMap(page());

  it('kalemin kelimesi ve iki yanında 5 kelime: satırları aşar, satır başına bir dikdörtgen', () => {
    const win = pageWindow(map, charOf(map, 'ahmet') + 2, 5)!;
    expect(win.count).toBe(11);
    expect(win.center).toBe(charOf(map, 'ahmet'));
    expect(wordsOf(map, win.start, win.end)).toEqual([
      'kasabanın',
      'dar',
      'sokaklarına',
      'düşerken',
      'dr',
      'ahmet',
      'bey',
      'penceresinin',
      'önünde',
      'durmuş',
      'uzaklardaki',
    ]);
    // üç satır: ilk satırın sonu, ikinci satırın tamamı, üçüncü satırın tamamı (son kelimesi dahil)
    expect(win.rects).toHaveLength(3);
    const [a, b, c] = win.rects;
    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(c.y);
    // "kasabanın" ilk satırın 23. harfinden başlar
    expect(a.x).toBeCloseTo(20 + 22 * 5);
    expect(a.x + a.width).toBeCloseTo(20 + LINES[0].length * 5);
    expect(b.x).toBeCloseTo(20);
    expect(c.x + c.width).toBeCloseTo(20 + LINES[2].length * 5);
    // dikdörtgen harflerin kutusu: taban çizgisinin üstünde ve altında
    expect(b.y).toBeCloseTo(400 - baseline(1) - 0.9 * SIZE);
    expect(b.height).toBeCloseTo(1.15 * SIZE);
  });

  it('pencerenin boyu: 3, 5, 8, 12 kelime', () => {
    // gövdede 19 kelime ("Dr." bir kelime); "Ahmet" 9. kelime
    const at = charOf(map, 'ahmet');
    expect(pageWindow(map, at, 3)!.count).toBe(7);
    expect(pageWindow(map, at, 5)!.count).toBe(11);
    expect(pageWindow(map, at, 8)!.count).toBe(17);
    // 12'lik pencere önde 8, arkada 10 kelimeyle sınırlanır: gövdenin tamamı
    const wide = pageWindow(map, at, 12)!;
    expect(wide.count).toBe(19);
    expect(wide.rects).toHaveLength(4);
  });

  it('sayfanın başında ve sonunda kısalır; sayfa numarası pencereye girmez', () => {
    const first = pageWindow(map, 0, 5)!;
    expect(first.start).toBe(0);
    expect(first.count).toBe(6);
    expect(wordsOf(map, first.start, first.end)[0]).toBe('sabahın');

    const last = pageWindow(map, charOf(map, 'seyrediyordu'), 5)!;
    expect(last.count).toBe(6);
    expect(wordsOf(map, last.start, last.end).at(-1)).toBe('seyrediyordu');
    expect(last.end).toBe(map.bodyEnd);
    expect(last.rects).toHaveLength(2);

    // sayfa numarasının üstündeki kalem yalnızca onu açar
    const num = pageWindow(map, map.text.length - 1, 5)!;
    expect(num.count).toBe(1);
    expect(map.text.slice(num.start, num.end)).toBe('3');
  });

  it('büyük boşlukla ayrılan bölüm başlığına taşmaz; ↑/↓ başlığa geçer', () => {
    const withHeading = page();
    withHeading.items.unshift({
      str: 'BİRİNCİ BÖLÜM',
      transform: [14, 0, 0, 14, 60, 380],
      width: 13 * 7,
      height: 14,
    });
    const m = pageCharMap(withHeading);
    expect(m.text.startsWith('birincibölüm')).toBe(true);
    const first = pageWindow(m, charOf(m, 'sabahın'), 5)!;
    expect(first.count).toBe(6);
    expect(wordsOf(m, first.start, first.end)[0]).toBe('sabahın');
    const heading = pageWindow(m, charOf(m, 'bölüm'), 5)!;
    expect(wordsOf(m, heading.start, heading.end)).toEqual(['birinci', 'bölüm']);
    expect(movePageCenter(m, charOf(m, 'sabahın'), -5)).toBe(0);
  });

  it('boş sayfa: null', () => {
    const empty = pageCharMap({ width: 300, height: 400, items: [] });
    expect(pageWindow(empty, 0, 5)).toBeNull();
    expect(pageEdge(empty, false)).toBeNull();
  });
});

describe('charAtPoint', () => {
  const map = pageCharMap(page());
  const top = (line: number) => 400 - baseline(line) - 0.9 * SIZE;

  it('harfin kutusundaki nokta o harf', () => {
    // "Sabahın": 7. harf "n" (x 50–55)
    expect(charAtPoint(map, 52, top(0) + 5, 4)).toBe(6);
  });

  it('satır arasında ve satırın hemen yanında en yakın harf; uzakta null', () => {
    // ikinci satırın altı ile üçüncü satırın üstü arası: üçüncü satıra daha yakın
    const i = charAtPoint(map, 22, top(2) - 0.5, 4)!;
    expect(i).toBe(charOf(map, 'penceresinin'));
    // satırın sağında
    const end = charAtPoint(map, 20 + LINES[0].length * 5 + 3, top(0) + 5, 4)!;
    expect(map.text[end]).toBe('r');
    expect(charAtPoint(map, 280, 200, 4)).toBeNull();
  });
});

describe('pencereyi kaydırma (↑/↓)', () => {
  const map = pageCharMap(page());

  it('N kelime ileri, geri; sayfanın ucunda durur', () => {
    const at = charOf(map, 'ahmet');
    expect(movePageCenter(map, at, 5)).toBe(charOf(map, 'uzaklardaki'));
    expect(movePageCenter(map, at, -5)).toBe(charOf(map, 'kasabanın'));
    // sona 3 kelime kala 5 ileri: son kelimede durur; son kelimede null
    const last = charOf(map, 'seyrediyordu');
    expect(movePageCenter(map, charOf(map, 'yükselen'), 5)).toBe(last);
    expect(movePageCenter(map, last, 5)).toBeNull();
    expect(movePageCenter(map, 0, -5)).toBeNull();
  });

  it('sayfanın ilk ve son gövde kelimesi; cümlenin başından N kelime ileri', () => {
    expect(pageEdge(map, false)).toBe(0);
    expect(pageEdge(map, true)).toBe(charOf(map, 'seyrediyordu'));
    expect(charAfterWords(map, 0, 5)).toBe(charOf(map, 'sokaklarına'));
    expect(charAfterWords(map, charOf(map, 'sisi'), 5)).toBe(charOf(map, 'seyrediyordu'));
  });
});

describe('metin görünümü', () => {
  it('kelimeler: bitişik noktalama kelimenin, tek başına tire kelime değil', () => {
    const text = '— Nereye gidiyorsun? dedi annesi, “Işıklar geri dönecek.”';
    expect(textWords(text).map((w) => text.slice(w.start, w.end))).toEqual([
      'Nereye',
      'gidiyorsun?',
      'dedi',
      'annesi,',
      '“Işıklar',
      'geri',
      'dönecek.”',
    ]);
  });

  it('konumun kelimesi: kelimenin içi ve hemen sonu; boşlukta en yakını', () => {
    const words = textWords('Bir  iki   üç');
    // "Bir" [0,3), "iki" [5,8), "üç" [11,13)
    expect(wordAtOffset(words, 0)).toBe(0);
    expect(wordAtOffset(words, 3)).toBe(0);
    expect(wordAtOffset(words, 4)).toBe(0);
    expect(wordAtOffset(words, 5)).toBe(1);
    expect(wordAtOffset(words, 9)).toBe(1);
    expect(wordAtOffset(words, 10)).toBe(2);
    expect(wordAtOffset(words, 40)).toBe(2);
    expect(wordAtOffset([], 0)).toBe(-1);
  });

  const blocks: Block[] = [
    { kind: 'para', text: 'Bir iki üç dört.', srcPage: 0 },
    { kind: 'image', src: 'x', alt: '', srcPage: 0 } as unknown as Block,
    { kind: 'para', text: 'Beş, altı yedi sekiz dokuz on.', srcPage: 0 },
  ];

  it('pencere paragraf sınırını aşar (kelimesi olmayan blok atlanır)', () => {
    // "altı": ikinci paragrafın 2. kelimesi
    const win = textWindow(blocks, { block: 2, offset: 6 }, 3)!;
    expect(win.count).toBe(7);
    expect(win.center).toEqual({ block: 2, offset: 5 });
    expect(win.ranges).toEqual([
      { block: 0, start: 8, end: 16 }, // "üç dört."
      { block: 2, start: 0, end: 26 }, // "Beş, altı yedi sekiz dokuz"
    ]);
  });

  it('kitabın başında ve sonunda kısalır', () => {
    const start = textWindow(blocks, { block: 0, offset: 0 }, 5)!;
    expect(start.count).toBe(6);
    expect(start.ranges[0]).toEqual({ block: 0, start: 0, end: 16 });
    const end = textWindow(blocks, { block: 2, offset: 29 }, 5)!;
    expect(end.count).toBe(6);
    expect(end.ranges).toEqual([{ block: 2, start: 0, end: 30 }]);
    expect(textWindow(blocks, { block: 1, offset: 0 }, 5)).toBeNull();
  });

  it('ortayı N kelime kaydırır (bloklar arasında); kitabın ucunda null', () => {
    expect(moveTextCenter(blocks, { block: 0, offset: 0 }, 5)).toEqual({ block: 2, offset: 5 });
    expect(moveTextCenter(blocks, { block: 2, offset: 5 }, -5)).toEqual({ block: 0, offset: 0 });
    expect(moveTextCenter(blocks, { block: 2, offset: 28 }, 3)).toBeNull();
    expect(moveTextCenter(blocks, { block: 0, offset: 0 }, -3)).toBeNull();
  });
});
