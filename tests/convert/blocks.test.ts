import { describe, expect, it } from 'vitest';
import { buildBlocks } from '../../src/convert/blocks';
import type { Block, Line, PageLines } from '../../src/convert/types';

const B = 10;
const L = (text: string, y: number, opts: Partial<Line> = {}): Line => ({ text, x0: 40, x1: 380, y, size: B, ...opts });
const P = (pageIndex: number, lines: Line[]): PageLines => ({ pageIndex, width: 420, height: 595, lines });
const show = (blocks: Block[]) =>
  blocks.map((b) => {
    if (b.kind === 'heading') return `heading${b.level}:${b.text}`;
    return 'text' in b ? `${b.kind}:${b.text}` : b.kind;
  });

describe('buildBlocks', () => {
  it('girinti yeni paragraf başlatır, devam satırları birleşir', () => {
    const blocks = buildBlocks(
      [
        P(0, [
          L('Birinci paragrafın ilk satırı', 500, { x0: 52 }),
          L('devam eden ikinci satırı.', 485, { x1: 250 }),
          L('İkinci paragraf burada başlar', 470, { x0: 52 }),
          L('ve biter.', 455, { x1: 120 }),
        ]),
      ],
      B,
      new Set(),
    );
    expect(show(blocks)).toEqual([
      'para:Birinci paragrafın ilk satırı devam eden ikinci satırı.',
      'para:İkinci paragraf burada başlar ve biter.',
    ]);
  });

  it('diyalog tiresi yeni paragraf başlatır', () => {
    const blocks = buildBlocks(
      [
        P(0, [
          L('Kapıyı açtı ve dışarı baktı, kimse', 500, { x0: 52 }),
          L('yoktu.', 485, { x1: 90 }),
          L('— Kim var orada? diye seslendi.', 470, { x1: 260 }),
        ]),
      ],
      B,
      new Set(),
    );
    expect(show(blocks)).toEqual(['para:Kapıyı açtı ve dışarı baktı, kimse yoktu.', 'para:— Kim var orada? diye seslendi.']);
  });

  it('sayfa sonunda bitmeyen paragraf sonraki sayfada devam eder', () => {
    const blocks = buildBlocks(
      [
        P(0, [L('Yol boyunca herkes bir şeyler biliyor da', 500, { x0: 52 }), L('söylemiyormuş gibiydi', 485, { x1: 300 })]),
        P(1, [L('ve bu sessizlik onu huzursuz ediyordu.', 500, { x1: 330 }), L('Yeni paragraf.', 485, { x0: 52, x1: 150 })]),
      ],
      B,
      new Set(),
    );
    expect(show(blocks)).toEqual([
      'para:Yol boyunca herkes bir şeyler biliyor da söylemiyormuş gibiydi ve bu sessizlik onu huzursuz ediyordu.',
      'para:Yeni paragraf.',
    ]);
  });

  it('önceki sayfa kısa ve noktalı bittiyse yeni sayfadaki girintisiz satır yeni paragraftır', () => {
    const blocks = buildBlocks(
      [
        P(0, [L('Uzun bir paragraf burada başlıyor ve', 500, { x0: 52 }), L('burada bitiyor.', 485, { x1: 150 })]),
        P(1, [L('Bölüm sonrası girintisiz paragraf.', 500, { x1: 330 })]),
      ],
      B,
      new Set(),
    );
    expect(blocks).toHaveLength(2);
  });

  it('satır sonu tireli kelimeyi birleştirir', () => {
    const blocks = buildBlocks(
      [P(0, [L('Elinde yıllardır aradığı eski kita-', 500, { x0: 52 }), L('bı tutuyordu.', 485, { x1: 150 })])],
      B,
      new Set(),
    );
    expect(show(blocks)).toEqual(['para:Elinde yıllardır aradığı eski kitabı tutuyordu.']);
  });

  it('büyük puntolu satır 1., ortalı alt başlık 2. düzey başlıktır; ardışık satırlar birleşir', () => {
    const blocks = buildBlocks(
      [
        P(0, [
          L('BİRİNCİ', 540, { size: 16, x0: 170, x1: 250 }),
          L('BÖLÜM', 520, { size: 16, x0: 180, x1: 240 }),
          L('Sisli Sabah', 495, { size: 12, x0: 180, x1: 240 }),
          L('Sabah oldu ve kasaba yavaş yavaş uyanmaya başladı; sokaklarda', 460, { x0: 52 }),
          L('ilk sesler duyuldu.', 445, { x1: 160 }),
        ]),
      ],
      B,
      new Set(),
    );
    expect(show(blocks)).toEqual([
      'heading1:BİRİNCİ BÖLÜM',
      'heading2:Sisli Sabah',
      'para:Sabah oldu ve kasaba yavaş yavaş uyanmaya başladı; sokaklarda ilk sesler duyuldu.',
    ]);
  });

  it('punto büyük olmasa da ortalı "3. BÖLÜM" kalıbı başlıktır', () => {
    const blocks = buildBlocks(
      [
        P(0, [
          L('3. BÖLÜM', 540, { x0: 190, x1: 230 }),
          L('Uzun bir gövde satırı burada devam ediyor ve', 500, { x0: 52 }),
          L('biter.', 485, { x1: 100 }),
        ]),
      ],
      B,
      new Set(),
    );
    expect(show(blocks)[0]).toBe('heading1:3. BÖLÜM');
  });

  it('sahne arası işaretini ayrı blok yapar', () => {
    const blocks = buildBlocks(
      [
        P(0, [
          L('Birinci sahne burada sona erdi ve herkes', 500, { x0: 52 }),
          L('evine döndü.', 485, { x1: 150 }),
          L('* * *', 465, { x0: 200, x1: 222 }),
          L('Ertesi sabah her şey değişmişti.', 445, { x1: 250 }),
        ]),
      ],
      B,
      new Set(),
    );
    expect(show(blocks)).toEqual([
      'para:Birinci sahne burada sona erdi ve herkes evine döndü.',
      'break',
      'para:Ertesi sabah her şey değişmişti.',
    ]);
  });

  it('dipnot, açık paragraf kapandıktan sonra eklenir', () => {
    const blocks = buildBlocks(
      [
        P(0, [
          L('Kitabı tutuyordu.¹ Ahmet Bey bir an ne diyeceğini', 500, { x0: 52 }),
          L('¹ Kitabın ilk baskısı 1923 yılındadır.', 60, { size: 7.5, x1: 250 }),
        ]),
        P(1, [L('bilemedi ve sustu.', 500, { x1: 170 }), L('Sonra konuştu.', 485, { x0: 52, x1: 160 })]),
      ],
      B,
      new Set(),
    );
    expect(show(blocks)).toEqual([
      'para:Kitabı tutuyordu.¹ Ahmet Bey bir an ne diyeceğini bilemedi ve sustu.',
      'note:¹ Kitabın ilk baskısı 1923 yılındadır.',
      'para:Sonra konuştu.',
    ]);
  });

  it('metinsiz sayfa görsel blok olur ve açık paragrafı kapatır', () => {
    const blocks = buildBlocks(
      [
        P(0, [L('Resimden önceki paragraf', 500, { x0: 52, x1: 300 })]),
        P(1, []),
        P(2, [L('resimden sonra devam etmez, yeni başlar.', 500, { x1: 330 })]),
      ],
      B,
      new Set([1]),
    );
    expect(show(blocks)).toEqual([
      'para:Resimden önceki paragraf',
      'pageImage',
      'para:resimden sonra devam etmez, yeni başlar.',
    ]);
  });
});
