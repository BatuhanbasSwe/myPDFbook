import { describe, expect, it } from 'vitest';
import type { PageText, RawTextItem } from '../../src/convert/types';
import { charRects } from '../../src/reader/modes/focusWords';
import { wordPageRange } from '../../src/reader/modes/wordPlace';
import { findTextRects, pageCharMap } from '../../src/text/pageGeometry';

const item = (str: string, x: number, y: number, width: number, size = 10): RawTextItem => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width,
  height: size,
});

/** İki satır: "Önce bir. Eski kita-" / "bı tuttu." (her harf 5 birim) */
const page: PageText = {
  width: 400,
  height: 800,
  items: [item('Önce bir. Eski kita-', 100, 700, 100), item('bı tuttu.', 100, 685, 45)],
};
const map = pageCharMap(page);

/** Cümle metnindeki kelimenin [start, end) aralığı */
const span = (text: string, word: string): [number, number] => {
  const at = text.indexOf(word);
  return [at, at + word.length];
};

describe('kelimenin sayfadaki yeri', () => {
  const text = 'Eski kitabı tuttu.';
  const m = findTextRects(map, text)!;

  it('bütün cümle: kelimenin harf haritasındaki aralığı (noktalama ve tire sayılmaz)', () => {
    expect(m.part).toBe('whole');
    const r = wordPageRange(m, text, ...span(text, 'tuttu'))!;
    expect(map.text.slice(...r)).toBe('tuttu');
    // Satır sonunda bölünen kelime iki satırda: iki dikdörtgen
    const k = wordPageRange(m, text, ...span(text, 'kitabı'))!;
    expect(map.text.slice(...k)).toBe('kitabı');
    const rects = charRects(map, ...k);
    expect(rects).toHaveLength(2);
    expect(rects[1].y).toBeGreaterThan(rects[0].y);
  });

  it('kelimede harf yoksa (tire) null', () => {
    const t = 'Eski — kitabı tuttu.';
    const mm = findTextRects(map, t)!;
    expect(wordPageRange(mm, t, ...span(t, '—'))).toBeNull();
  });

  it('sayfa sınırından taşan cümle: baş parçada sondaki kelimeler yok, son parçada baştakiler yok', () => {
    // Cümlenin başı bu sayfanın sonunda (baş parça)
    const head = {
      part: 'head' as const,
      start: map.text.indexOf('eski'),
      end: map.text.length,
    };
    const long = 'Eski kitabı tuttu ve gitti.';
    expect(map.text.slice(...wordPageRange(head, long, ...span(long, 'tuttu'))!)).toBe('tuttu');
    expect(wordPageRange(head, long, ...span(long, 'gitti'))).toBeNull();

    // Cümlenin sonu bu sayfanın başında (son parça): "…önce bir." → sayfada yalnızca "önce bir"
    const tail = { part: 'tail' as const, start: 0, end: map.text.indexOf('eski') };
    const crossing = 'Daha önce bir.';
    expect(wordPageRange(tail, crossing, ...span(crossing, 'Daha'))).toBeNull();
    expect(map.text.slice(...wordPageRange(tail, crossing, ...span(crossing, 'bir'))!)).toBe('bir');
  });

  it('satırın sol kenarı: cümle satırın ortasında başlasa da satırın ilk harfinin x’i', () => {
    expect(m.lineLeft).toBe(100);
    const other = findTextRects(map, 'Önce bir.')!;
    expect(other.lineLeft).toBe(100);
  });
});
