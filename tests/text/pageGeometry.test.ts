import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { convertPdf } from '../../src/convert/convertPdf';
import type { BookContent, PageText, RawTextItem } from '../../src/convert/types';
import { createPdfSource } from '../../src/pdf/pdfSource';
import {
  findTextRects,
  normalizeForSearch,
  pageCharMap,
  type PageCharMap,
  type TextMatch,
} from '../../src/text/pageGeometry';
import { buildSentenceIndex, type Sentence } from '../../src/text/sentences';

interface Fixture {
  content: BookContent;
  pages: PageText[];
  maps: PageCharMap[];
  sentences: Sentence[];
  /** cümlenin metni */
  text(s: Sentence): string;
  /** metni içeren ilk cümle */
  sentenceWith(part: string): Sentence;
}

async function openFixture(name: string): Promise<Fixture> {
  const data = new Uint8Array(await readFile(new URL(`../fixtures/${name}`, import.meta.url)));
  const doc = await getDocument({ data }).promise;
  try {
    const source = createPdfSource(doc);
    const content = await convertPdf(source);
    const pages: PageText[] = [];
    for (let p = 0; p < source.numPages; p++) pages.push(await source.getPageText(p));
    const sentences = buildSentenceIndex(content.blocks, content.lang);
    const text = (s: Sentence) => {
      const b = content.blocks[s.block];
      return 'text' in b ? b.text.slice(s.start, s.end) : '';
    };
    return {
      content,
      pages,
      maps: pages.map(pageCharMap),
      sentences,
      text,
      sentenceWith(part) {
        const s = sentences.find((x) => text(x).includes(part));
        if (!s) throw new Error(`cümle yok: ${part}`);
        return s;
      },
    };
  } finally {
    await doc.loadingTask.destroy();
  }
}

/** Dikdörtgenler sayfanın içinde, boyutları pozitif ve üstten alta sıralı. */
function expectInsidePage(m: TextMatch) {
  for (const r of m.rects) {
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
    expect(r.x + r.width).toBeLessThanOrEqual(m.pageWidth);
    expect(r.y + r.height).toBeLessThanOrEqual(m.pageHeight);
  }
  for (let i = 1; i < m.rects.length; i++) expect(m.rects[i].y).toBeGreaterThan(m.rects[i - 1].y);
}

const item = (str: string, x: number, y: number, width: number, size = 10): RawTextItem => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width,
  height: size,
});

describe('normalizeForSearch', () => {
  it('yalnızca harf ve rakam bırakır, Türkçe kurallarıyla küçültür', () => {
    expect(normalizeForSearch('— IŞIK, İstanbul’da; kita-\u00ADbı 3.')).toBe(
      'ışıkistanbuldakitabı3',
    );
  });
  it('bileşik harfleri ve bağlı harfleri (ligatür) açar, bozuk Türkçe kodlamayı katlar', () => {
    expect(normalizeForSearch('şﬁ')).toBe('şfi');
    expect(normalizeForSearch('BÝRÝNCÝ Iþýklar')).toBe(normalizeForSearch('BİRİNCİ Işıklar'));
  });
});

describe('pageCharMap', () => {
  const page: PageText = {
    width: 400,
    height: 800,
    items: [
      // okuma sırası öğe sırasından değil konumdan gelir
      item('bı tuttu.', 100, 685, 45),
      item('Eski', 100, 700, 20),
      item('kita-', 125, 700, 25),
      item('7', 200, 20, 3, 6),
    ],
  };
  const map = pageCharMap(page);

  it('metni okuma sırasında normalleştirir', () => {
    expect(map.text).toBe('eskikitabıtuttu7');
    expect(map.wordStart.map((w, i) => (w ? map.text[i] : '')).join('')).toBe('ekbt7');
  });

  it('öğe genişliğini karakterlere böler; kutular sol üstten, y aşağı doğru', () => {
    // "Eski": 4 karakter, 20 birim → 5'er birim; taban çizgisi 700 → üst = 800 − 700 − 0,9 × 10
    expect(map.boxes[0]).toEqual({ x0: 100, x1: 105, y: 91, h: 11.5, line: 0 });
    expect(map.boxes[3]).toMatchObject({ x0: 115, x1: 120 });
    // "kita-": 5 karakter, tire atlanır
    expect(map.boxes[4]).toMatchObject({ x0: 125, x1: 130, line: 0 });
    expect(map.boxes[8]).toMatchObject({ x0: 100, line: 1, y: 106 });
  });

  it('gövde metni küçük puntolu sayfa numarasını dışarıda bırakır', () => {
    expect(map.text.slice(map.bodyStart, map.bodyEnd)).toBe('eskikitabıtuttu');
  });

  it('harf ilerlemeleri varsa kutular onlara göre, yoksa eşit', () => {
    const m = pageCharMap({
      width: 400,
      height: 800,
      items: [{ ...item('mil', 100, 700, 16), advances: [9, 3, 4] }],
    });
    expect(m.boxes.map((b) => [b.x0, b.x1])).toEqual([
      [100, 109],
      [109, 112],
      [112, 116],
    ]);
    // ilerlemeler harflerle hizalı değilse (sayısı tutmuyor) eşit bölünür
    const bad = pageCharMap({
      width: 400,
      height: 800,
      items: [{ ...item('mil', 100, 700, 15), advances: [9, 3] }],
    });
    expect(bad.boxes.map((b) => b.x0)).toEqual([100, 105, 110]);
  });

  it('fontun yükselme/inme oranıyla konumlanır, kutu yüksekliği aynı kalır', () => {
    const m = pageCharMap({
      width: 400,
      height: 800,
      items: [{ ...item('Ab', 100, 700, 10), ascent: 0.8, descent: -0.35 }],
    });
    expect(m.boxes[0].h).toBeCloseTo(11.5);
    expect(m.boxes[0].y).toBeCloseTo(100 - 8);
  });

  it('sayfa kutusunun başlangıcını (CropBox) hesaba katar', () => {
    const shifted = pageCharMap({ ...page, origin: [50, 60] });
    expect(shifted.boxes[0]).toMatchObject({ x0: 50, y: 151 });
  });

  it('boş sayfa', () => {
    const empty = pageCharMap({ width: 100, height: 100, items: [] });
    expect(empty).toMatchObject({ text: '', bodyStart: 0, bodyEnd: 0 });
    expect(findTextRects(empty, 'Merhaba.')).toBeNull();
  });
});

describe('findTextRects (yapay sayfa)', () => {
  const page: PageText = {
    width: 400,
    height: 800,
    items: [item('Evetler geldi. Evet. Sonra', 100, 700, 260), item('yine Evet.', 100, 685, 100)],
  };
  const map = pageCharMap(page);

  it('satır sonu tiresiyle bölünmüş kelimeyi bulur, satır başına bir dikdörtgen verir', () => {
    const m = pageCharMap({
      width: 400,
      height: 800,
      items: [
        item('Eski', 100, 700, 20),
        item('kita-', 125, 700, 25),
        item('bı tuttu.', 100, 685, 45),
      ],
    });
    const found = findTextRects(m, 'Eski kitabı tuttu.');
    expect(found?.part).toBe('whole');
    expect(found?.rects).toEqual([
      { x: 100, y: 91, width: 50 - 5, height: 11.5 },
      { x: 100, y: 106, width: 40, height: 11.5 },
    ]);
  });

  it('kelimenin içindeki eşleşmeyi atlar ("Evet" ≠ "Evetler")', () => {
    const found = findTextRects(map, 'Evet.');
    expect(found?.start).toBe('evetlergeldi'.length);
    expect(found?.rects).toHaveLength(1);
    expect(found?.rects[0].x).toBe(100 + 10 * 15);
  });

  it('ipucundan sonraki ilk eşleşmeyi bulur; ipucundan sonra yoksa baştan arar', () => {
    const first = findTextRects(map, 'Evet.');
    const second = findTextRects(map, 'Evet.', first?.end);
    expect(second?.start).toBeGreaterThan(first?.start ?? Infinity);
    expect(second?.rects[0].y).toBe(106);
    expect(findTextRects(map, 'Evetler geldi.', second?.end)?.start).toBe(0);
  });

  it('sayfa aşan cümle: gövde puntosundaki sayfa numarası ve sayfa başlığı parçaları engellemez', () => {
    // Gövde 14 pt, sayfa numarası 12 pt (0,85 oranının üstünde) ve alt bölgede; sonraki sayfada gövde puntosunda
    // sayfa başlığı. Numara "12" gövdeden çıkar; baş parçası gövdenin son satırında, son parçası başlıktan sonraki
    // (ikinci) satırda bulunur.
    const before: PageText = {
      width: 400,
      height: 800,
      items: [
        item('Önceki cümle burada bitti. Yol boyunca kimse', 40, 700, 300, 14),
        item('konuşmadı; herkes bir şey bekliyor', 40, 684, 250, 14),
        item('12', 195, 30, 12, 12),
      ],
    };
    const after: PageText = {
      width: 400,
      height: 800,
      items: [
        item('KİTABIN ADI', 150, 770, 90, 14),
        item('gibiydi ve sessizlik sürdü. Sonra', 40, 700, 240, 14),
        item('yağmur başladı.', 40, 684, 110, 14),
        item('13', 195, 30, 12, 12),
      ],
    };
    const a = pageCharMap(before);
    const b = pageCharMap(after);
    expect(a.text.slice(a.bodyStart, a.bodyEnd)).not.toContain('12');
    const sentence =
      'Yol boyunca kimse konuşmadı; herkes bir şey bekliyor gibiydi ve sessizlik sürdü.';
    const head = findTextRects(a, sentence);
    expect(head?.part).toBe('head');
    expect(head?.rects).toHaveLength(2);
    const tail = findTextRects(b, sentence);
    expect(tail?.part).toBe('tail');
    expect(tail?.rects).toHaveLength(1);
    expect(tail!.rects[0].y).toBeGreaterThan(800 - 700 - 14);
    expect(a.text.slice(head!.start, head!.end) + b.text.slice(tail!.start, tail!.end)).toBe(
      normalizeForSearch(sentence),
    );
  });

  it('gövde puntosundaki alt bilgi baş parçayı engellemez (son iki satır)', () => {
    const m = pageCharMap({
      width: 400,
      height: 800,
      items: [
        item('Önce bu vardı. Sonra şu', 40, 700, 200, 14),
        item('Yazarın Adı', 150, 40, 80, 14),
      ],
    });
    const head = findTextRects(m, 'Sonra şu geldi.');
    expect(head?.part).toBe('head');
    expect(head?.end).toBe('öncebuvardısonraşu'.length);
  });

  it('bulunamayan ya da harfsiz metin null verir', () => {
    expect(findTextRects(map, 'Hayır.')).toBeNull();
    expect(findTextRects(map, '* * *')).toBeNull();
    expect(findTextRects(map, '')).toBeNull();
  });
});

describe('novel-tr.pdf', () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await openFixture('novel-tr.pdf');
  });

  it('bir sayfadaki ilk paragrafın ilk cümlesini satır satır bulur', () => {
    const para = f.content.blocks.findIndex((b) => b.kind === 'para' && b.srcPage === 2);
    const s = f.sentences.find((x) => x.block === para)!;
    expect(f.text(s)).toMatch(/^Sabahın ilk ışıkları .* seyrediyordu\.$/);
    const m = findTextRects(f.maps[2], f.text(s));
    expect(m?.part).toBe('whole');
    expect(m?.rects).toHaveLength(3);
    expectInsidePage(m!);
    // ilk satırın başı: x = 39,68; taban çizgisi 405,96 (sayfa yüksekliği 594,96)
    expect(m!.rects[0].x).toBeCloseTo(39.68, 1);
    // kutunun üstü fontun yükselme oranıyla (Georgia) konumlanır: varsayılan 0,9 puntoya yakın
    expect(m!.rects[0].y).toBeCloseTo(594.96 - 405.96 - 0.9 * 10.5, 0);
    // satır aralığı 15 birim
    expect(m!.rects[1].y - m!.rects[0].y).toBeCloseTo(15, 1);
    // son satır "seyrediyordu." ile biter, satırın gerisi (Kahvesi…) dahil değil
    expect(m!.rects[2].width).toBeLessThan(100);
  });

  it('satır sonu tiresiyle bölünmüş kelime içeren cümleyi bulur', () => {
    const s = f.sentenceWith('kitabı tutuyordu');
    expect(f.text(s)).toBe('Elinde, yıllardır aradığı o eski kitabı tutuyordu.¹');
    const m = findTextRects(f.maps[3], f.text(s));
    expect(m?.part).toBe('whole');
    expect(m?.rects).toHaveLength(3);
    expectInsidePage(m!);
    // ikinci satır "yıllardır aradığı o eski kita-" (39,68'den 125,31 genişlik), tire dahil değil
    const second = m!.rects[1];
    expect(second.x).toBeCloseTo(39.68, 1);
    expect(second.x + second.width).toBeLessThan(39.68 + 125.31);
    expect(second.x + second.width).toBeGreaterThan(39.68 + 120);
  });

  it('sayfa sınırından taşan cümlenin iki sayfadaki parçalarını bulur', () => {
    const s = f.sentenceWith('söylemiyormuş gibiydi ve bu sessizlik');
    expect(f.content.blocks[s.block].srcPage).toBe(2);
    const text = f.text(s);
    expect(text).toMatch(/^Yol boyunca .* ediyordu\.$/);

    const head = findTextRects(f.maps[2], text);
    expect(head?.part).toBe('head');
    // "başladı. Yol boyunca … telaş" ve "vardı; herkes … gibiydi"
    expect(head?.rects).toHaveLength(2);
    expect(head?.end).toBe(f.maps[2].bodyEnd);
    expectInsidePage(head!);

    const tail = findTextRects(f.maps[3], text);
    expect(tail?.part).toBe('tail');
    // "ve bu sessizlik … ediyordu." — sayfa başlığı (KAYIP ŞEHRİN IŞIKLARI) dahil değil
    expect(tail?.rects).toHaveLength(1);
    expect(tail?.start).toBe(f.maps[3].bodyStart);
    expect(tail!.rects[0].x).toBeCloseTo(39.68, 1);
    expect(tail!.rects[0].width).toBeLessThan(300);

    const joined =
      f.maps[2].text.slice(head!.start, head!.end) + f.maps[3].text.slice(tail!.start, tail!.end);
    expect(joined).toBe(normalizeForSearch(text));
  });

  it('sayfada olmayan metin null verir', () => {
    expect(findTextRects(f.maps[2], 'Bu cümle kitapta hiç geçmiyor.')).toBeNull();
    // sonraki sayfanın cümlesi bu sayfada ne tamamen ne de kısmen bulunur
    const next = f.sentenceWith('vitrininde tozlu ciltler');
    expect(findTextRects(f.maps[2], f.text(next))).toBeNull();
    expect(findTextRects(f.maps[3], f.text(next))?.part).toBe('whole');
  });

  it('kitabın her cümlesi kendi sayfasında (ya da iki sayfaya bölünmüş olarak) bulunur', () => {
    const missing: string[] = [];
    for (const s of f.sentences) {
      const page = f.content.blocks[s.block].srcPage;
      const text = f.text(s);
      const here = findTextRects(f.maps[page], text);
      if (here?.part === 'whole') continue;
      if (here?.part === 'head' && findTextRects(f.maps[page + 1], text)?.part === 'tail') continue;
      if (!here && findTextRects(f.maps[page + 1], text)?.part === 'whole') continue;
      missing.push(text);
    }
    expect(missing).toEqual([]);
  });
});

describe('ebook-tr.pdf', () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await openFixture('ebook-tr.pdf');
  });

  it('sayfadaki cümleler ipucu zinciriyle sırayla bulunur', () => {
    const onPage = f.sentences.filter((s) => f.content.blocks[s.block].srcPage === 0);
    expect(onPage.length).toBeGreaterThan(5);
    let hint = 0;
    for (const s of onPage) {
      const m = findTextRects(f.maps[0], f.text(s), hint);
      expect(m?.part, f.text(s)).toBe('whole');
      expect(m!.start).toBeGreaterThanOrEqual(hint);
      expectInsidePage(m!);
      hint = m!.end;
    }
  });

  it('iki satırlık cümle iki dikdörtgen verir', () => {
    const s = f.sentenceWith('Zamanla gördüm ki');
    const m = findTextRects(f.maps[0], f.text(s));
    expect(m?.rects).toHaveLength(2);
    expect(m!.rects[0].x).toBeCloseTo(39.68, 1);
  });
});

describe('english.pdf', () => {
  it('İngilizce cümleyi bulur (tırnaklı diyalog)', async () => {
    const f = await openFixture('english.pdf');
    const s = f.sentenceWith('Is anyone out there');
    expect(f.text(s)).toBe(
      '“Is anyone out there?” he asked the empty room, and for a moment he thought the wind answered.',
    );
    const m = findTextRects(f.maps[0], f.text(s));
    expect(m?.part).toBe('whole');
    expect(m?.rects).toHaveLength(2);
    expectInsidePage(m!);
    // ilk satır girintili (52,28); dikdörtgen yalnızca harfleri kapsar, açılış tırnağından (“) sonra başlar
    expect(m!.rects[0].x).toBeGreaterThan(52.28);
    expect(m!.rects[0].x).toBeLessThan(52.28 + 8);
  });
});

describe('legacy-encoding-tr.pdf', () => {
  it('bozuk kodlanmış sayfa metninde onarılmış cümleyi bulur', async () => {
    const f = await openFixture('legacy-encoding-tr.pdf');
    const s = f.sentenceWith('Işıklar yanıp sönüyordu');
    const m = findTextRects(f.maps[0], f.text(s));
    expect(m?.part).toBe('whole');
    expect(m?.rects).toHaveLength(2);
    expect(findTextRects(f.maps[0], 'BİRİNCİ BÖLÜM')?.part).toBe('whole');
  });
});
