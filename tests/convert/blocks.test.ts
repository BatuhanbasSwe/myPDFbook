import { describe, expect, it } from 'vitest';
import { buildBlocks } from '../../src/convert/blocks';
import type { Block, Line, PageLines } from '../../src/convert/types';

const B = 10;
const L = (text: string, y: number, opts: Partial<Line> = {}): Line => ({
  text,
  x0: 40,
  x1: 380,
  y,
  size: B,
  ...opts,
});
const P = (pageIndex: number, lines: Line[]): PageLines => ({
  pageIndex,
  width: 420,
  height: 595,
  lines,
});
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
    expect(show(blocks)).toEqual([
      'para:Kapıyı açtı ve dışarı baktı, kimse yoktu.',
      'para:— Kim var orada? diye seslendi.',
    ]);
  });

  it('sayfa sonunda bitmeyen paragraf sonraki sayfada devam eder', () => {
    const blocks = buildBlocks(
      [
        P(0, [
          L('Yol boyunca herkes bir şeyler biliyor da', 500, { x0: 52 }),
          L('söylemiyormuş gibiydi', 485, { x1: 300 }),
        ]),
        P(1, [
          L('ve bu sessizlik onu huzursuz ediyordu.', 500, { x1: 330 }),
          L('Yeni paragraf.', 485, { x0: 52, x1: 150 }),
        ]),
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
        P(0, [
          L('Uzun bir paragraf burada başlıyor ve', 500, { x0: 52 }),
          L('burada bitiyor.', 485, { x1: 150 }),
        ]),
        P(1, [L('Bölüm sonrası girintisiz paragraf.', 500, { x1: 330 })]),
      ],
      B,
      new Set(),
    );
    expect(blocks).toHaveLength(2);
  });

  it('satır sonu tireli kelimeyi birleştirir', () => {
    const blocks = buildBlocks(
      [
        P(0, [
          L('Elinde yıllardır aradığı eski kita-', 500, { x0: 52 }),
          L('bı tutuyordu.', 485, { x1: 150 }),
        ]),
      ],
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

  it('başlık metninde yumuşak tire kalmaz', () => {
    const blocks = buildBlocks(
      [
        P(0, [
          L('KAYIP ŞEH­RİN', 540, { size: 16, x0: 150, x1: 270 }),
          L('Uzun bir gövde satırı burada devam ediyor ve', 500, { x0: 52 }),
          L('biter.', 485, { x1: 100 }),
        ]),
      ],
      B,
      new Set(),
    );
    expect(show(blocks)[0]).toBe('heading1:KAYIP ŞEHRİN');
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
        P(1, [
          L('bilemedi ve sustu.', 500, { x1: 170 }),
          L('Sonra konuştu.', 485, { x0: 52, x1: 160 }),
        ]),
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

describe('buildBlocks — inceleme düzeltmeleri', () => {
  it('küçük puntolu tam sayfa (mektup/önsöz) dipnot sanılmaz', () => {
    const lines = Array.from({ length: 30 }, (_, k) =>
      L(
        `Mektubun ${k}. satırı burada devam ediyor ve sayfanın sonuna kadar sürüyor`,
        540 - k * 12,
        {
          size: 8,
          x0: k === 0 ? 52 : 40,
        },
      ),
    );
    const blocks = buildBlocks([P(0, lines)], B, new Set());
    expect(blocks.map((b) => b.kind)).not.toContain('note');
  });

  it('sayfanın üçte birinden uzun dipnot bölünmez, gövdenin devamı dipnota yapışmaz', () => {
    const noteLines = Array.from({ length: 14 }, (_, k) =>
      L(k === 0 ? '¹ Uzun dipnot başlıyor' : `dipnotun ${k}. satırı`, 260 - k * 10, { size: 7.5 }),
    );
    const blocks = buildBlocks(
      [
        P(0, [L('Gövde paragrafı burada başlıyor ve sayfanın', 500, { x0: 52 }), ...noteLines]),
        P(1, [L('ötesinde devam edip biter.', 500, { x1: 200 })]),
      ],
      B,
      new Set(),
    );
    expect(show(blocks)[0]).toBe(
      'para:Gövde paragrafı burada başlıyor ve sayfanın ötesinde devam edip biter.',
    );
    expect(blocks.filter((b) => b.kind === 'note')).toHaveLength(1);
  });

  it('onuncudan sonraki sıra sayılı bölüm başlıklarını da tanır', () => {
    for (const title of [
      'ON BİRİNCİ BÖLÜM',
      'YİRMİNCİ BÖLÜM',
      'Yirmi Üçüncü Bölüm',
      'OTUZUNCU BÖLÜM',
    ]) {
      const blocks = buildBlocks(
        [
          P(0, [
            L(title, 540, { x0: 170, x1: 250 }),
            L('Uzun bir gövde satırı burada devam ediyor ve', 500, { x0: 52 }),
            L('biter.', 485, { x1: 100 }),
          ]),
        ],
        B,
        new Set(),
      );
      expect(show(blocks)[0]).toBe(`heading1:${title}`);
    }
  });

  it('çok uzun paragrafı doğrusal sürede kurar', () => {
    const pages = Array.from({ length: 400 }, (_, pi) =>
      P(
        pi,
        Array.from({ length: 38 }, (_, k) =>
          L(`satır ${pi}-${k} burada devam ediyor ve`, 570 - k * 14),
        ),
      ),
    );
    const started = performance.now();
    const blocks = buildBlocks(pages, B, new Set());
    expect(blocks).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe('buildBlocks — gövdeyle aynı puntolu, sola yaslı başlıklar', () => {
  /** Dolu sayfa: y=500'den 15'er aşağı 10 gövde satırı (kitabın tipik metin başı 500 olur). */
  const filler = (pageIndex: number) =>
    P(
      pageIndex,
      Array.from({ length: 10 }, (_, i) =>
        i === 9
          ? L('ve sayfa burada biter.', 500 - i * 15, { x1: 150 })
          : L('Uzun bir gövde satırı burada sürüyor ve sonraki satıra', 500 - i * 15),
      ),
    );

  it('aşağıdan başlayan sayfanın ilk kısa satırı bölüm başlığı, altındaki kısa satır alt başlıktır', () => {
    const blocks = buildBlocks(
      [
        filler(0),
        P(1, [
          L('Tanıtım', 400, { x1: 80 }),
          L('Benim hikayem', 385, { x1: 110 }),
          L('Lise ikinci sınıfımın son gününde yüzüme beyzbol sopasıyla', 370, { x1: 330 }),
          L('vuruldum ve her şey değişti.', 355, { x1: 200 }),
        ]),
        filler(2),
      ],
      B,
      new Set(),
    );
    expect(show(blocks).slice(1, 4)).toEqual([
      'heading1:Tanıtım',
      'heading2:Benim hikayem',
      'para:Lise ikinci sınıfımın son gününde yüzüme beyzbol sopasıyla vuruldum ve her şey değişti.',
    ]);
  });

  it('başlığın altındaki kısa ilk satır küçük harfle sürüyorsa paragrafın başıdır', () => {
    const blocks = buildBlocks(
      [
        filler(0),
        P(1, [
          L('Tanıtım', 400, { x1: 80 }),
          L('Ertesi gün kasabaya dönen yolcuların arasında', 385, { x1: 250 }),
          L('yaşlı bir kadın vardı.', 370, { x1: 160 }),
        ]),
        filler(2),
      ],
      B,
      new Set(),
    );
    expect(show(blocks).slice(1, 3)).toEqual([
      'heading1:Tanıtım',
      'para:Ertesi gün kasabaya dönen yolcuların arasında yaşlı bir kadın vardı.',
    ]);
  });

  it('tek başına bölüm numarası ve altındaki bölüm adı tek başlık olur (ad sonraki sayfada da olsa)', () => {
    const blocks = buildBlocks(
      [
        P(0, [
          ...filler(0).lines.slice(0, 8),
          L('1', 250, { x1: 47 }),
          L('Küçük Başlangıçlar', 235, { x1: 160 }),
          L('Her şey bir sabah başladı ve sonra hızla büyüyerek', 220),
          L('devam etti.', 205, { x1: 110 }),
        ]),
        P(1, [
          L('2', 500, { x1: 47 }),
          L('Alışkanlığın Gücü', 485, { x1: 150 }),
          ...filler(1).lines.slice(2),
        ]),
        P(2, [...filler(2).lines, L('3', 200, { x1: 47 })]),
        P(3, [L('Son Söz', 500, { x1: 100 }), ...filler(3).lines.slice(1)]),
      ],
      B,
      new Set(),
    );
    expect(show(blocks).filter((b) => b.startsWith('heading'))).toEqual([
      'heading1:1 Küçük Başlangıçlar',
      'heading1:2 Alışkanlığın Gücü',
      'heading1:3 Son Söz',
    ]);
  });

  it('büyük harfli kısa satır ara başlıktır; bölüm başındaki büyük harfli ilk kelime ve alıntı sahibi değildir', () => {
    const blocks = buildBlocks(
      [
        P(0, [
          ...filler(0).lines,
          L('İYİLEŞME', 350, { x1: 110 }),
          L('Neyse ki ertesi sabah nefesim düzeldi ve doktorlar beni', 335),
          L('komadan çıkardı.', 320, { x1: 140 }),
          L('Sert ve katı olan kırılacak.', 305, { x1: 170 }),
          L('-LAO TZU', 290, { x1: 90 }),
        ]),
        P(1, [
          L('4', 500, { x1: 47 }),
          L('Doğru Görünmeyen Adam', 485, { x1: 180 }),
          L('PSİKOLOG', 470, { x1: 100 }),
          L('GARY Klein bir keresinde bana bir aile toplantısını anlattı ve', 455),
          L('sonra sustu.', 440, { x1: 110 }),
          ...filler(1).lines.slice(5),
        ]),
      ],
      B,
      new Set(),
    );
    const out = show(blocks);
    expect(out).toContain('heading2:İYİLEŞME');
    expect(out).toContain('heading1:4 Doğru Görünmeyen Adam');
    expect(out).toContain(
      'para:PSİKOLOG GARY Klein bir keresinde bana bir aile toplantısını anlattı ve sonra sustu.',
    );
    expect(out.some((b) => b.startsWith('heading') && b.includes('LAO'))).toBe(false);
  });

  it('alt başlık zincirlenmez: başlığın altındaki liste satırları metin kalır', () => {
    const blocks = buildBlocks(
      [
        P(0, [
          ...filler(0).lines,
          L('İYİ BİR ALIŞKANLIK NASIL YARATILIR', 350, { x1: 260 }),
          L('1. Kanun: Bunu Açık Hale Getirin', 335, { x1: 220 }),
          L('1.1: Alışkanlık puan kartını doldurun', 320, { x1: 230 }),
          L('1.2: Uygulama niyetlerini kullanın', 305, { x1: 220 }),
        ]),
      ],
      B,
      new Set(),
    );
    expect(show(blocks).slice(1)).toEqual([
      'heading2:İYİ BİR ALIŞKANLIK NASIL YARATILIR',
      'heading2:1. Kanun: Bunu Açık Hale Getirin',
      'para:1.1: Alışkanlık puan kartını doldurun 1.2: Uygulama niyetlerini kullanın',
    ]);
  });
});
