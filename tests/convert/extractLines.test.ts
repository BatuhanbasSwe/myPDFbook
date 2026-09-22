import { describe, expect, it } from 'vitest';
import { extractLines } from '../../src/convert/extractLines';
import type { RawTextItem } from '../../src/convert/types';

const item = (str: string, x: number, y: number, width: number, size = 10): RawTextItem => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width,
  height: size,
});
const page = (items: RawTextItem[]) => ({ width: 400, height: 600, items });

describe('extractLines', () => {
  it('aynı taban çizgisindeki parçaları tek satırda, yukarıdan aşağıya sıralar', () => {
    const { lines } = extractLines(
      0,
      page([item('ikinci satır', 50, 480, 60), item('Birinci', 50, 500, 35), item('satır', 90, 500, 25)]),
    );
    expect(lines.map((l) => l.text)).toEqual(['Birinci satır', 'ikinci satır']);
  });

  it('bitişik parçaları boşluksuz birleştirir (kelime ortası bölünme)', () => {
    const { lines } = extractLines(
      0,
      page([item('Sabahın ilk ışık', 50, 500, 70), item('ları kasa', 120, 500, 40), item('banın', 160, 500, 25)]),
    );
    expect(lines[0]?.text).toBe('Sabahın ilk ışıkları kasabanın');
  });

  it('üst simgeyi (dipnot işareti) aynı satıra alır', () => {
    const { lines } = extractLines(
      0,
      page([item('tutuyordu.', 50, 500, 50), item('¹', 100.5, 503.5, 3, 6), item('Sonra', 60, 485, 30)]),
    );
    expect(lines.map((l) => l.text)).toEqual(['tutuyordu.¹', 'Sonra']);
  });

  it('döndürülmüş metni ve boş parçaları atlar', () => {
    const rotated: RawTextItem = { str: 'kenar yazısı', transform: [0, 10, -10, 0, 20, 300], width: 80, height: 10 };
    const { lines } = extractLines(0, page([rotated, item('', 50, 500, 0), item(' ', 45, 500, 3), item('metin', 50, 500, 25)]));
    expect(lines.map((l) => l.text)).toEqual(['metin']);
  });

  it('satır ölçülerini hesaplar', () => {
    const { lines } = extractLines(0, page([item('Başlık', 100, 520, 80, 16), item('metin', 40, 500, 30, 10)]));
    expect(lines[0]).toMatchObject({ x0: 100, x1: 180, y: 520, size: 16 });
    expect(lines[1]).toMatchObject({ x0: 40, x1: 70, y: 500, size: 10 });
  });
});
