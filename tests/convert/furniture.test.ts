import { describe, expect, it } from 'vitest';
import { bodyFontSize, stripPageFurniture } from '../../src/convert/furniture';
import type { Line, PageLines } from '../../src/convert/types';

const line = (text: string, y: number, size = 10, x0 = 40, x1 = 380): Line => ({
  text,
  x0,
  x1,
  y,
  size,
});
const page = (pageIndex: number, lines: Line[]): PageLines => ({
  pageIndex,
  width: 420,
  height: 595,
  lines,
});
const bodyLines = (n: number, top = 520) =>
  Array.from({ length: n }, (_, i) =>
    line(`Gövde metni satır ${i} ve devamı burada yer alıyor.`, top - i * 15),
  );
const texts = (pages: PageLines[]) => pages.flatMap((p) => p.lines.map((l) => l.text));

describe('bodyFontSize', () => {
  it('en çok karakter taşıyan puntoyu seçer', () => {
    expect(bodyFontSize([page(0, [line('BAŞLIK', 560, 16), ...bodyLines(5)])])).toBe(10);
  });
});

describe('stripPageFurniture', () => {
  it('sayfa numaralarını siler', () => {
    const pages = [
      page(0, [...bodyLines(3), line('12', 25, 8, 205, 215)]),
      page(1, [...bodyLines(3), line('- 13 -', 25, 8, 200, 220)]),
    ];
    const out = texts(stripPageFurniture(pages, 10));
    expect(out).not.toContain('12');
    expect(out).not.toContain('- 13 -');
    expect(out).toHaveLength(6);
  });

  it('3+ sayfada tekrar eden üst/alt bilgiyi siler (rakamlar farklı olsa da)', () => {
    const pages = [0, 1, 2].map((i) =>
      page(i, [...bodyLines(3), line(`www.ornekkitap.com - s${i + 1}`, 12, 7)]),
    );
    expect(texts(stripPageFurniture(pages, 10)).some((t) => t.includes('ornekkitap'))).toBe(false);
  });

  it('üst bölgedeki küçük puntolu sayfa başlığını siler, gövdeyi ve dipnotu korur', () => {
    const pages = [
      page(0, [
        line('KAYIP ŞEHRİN IŞIKLARI', 565, 8, 150, 270),
        ...bodyLines(3),
        line('¹ Bu bir dipnottur.', 45, 7.5),
      ]),
    ];
    const out = texts(stripPageFurniture(pages, 10));
    expect(out).not.toContain('KAYIP ŞEHRİN IŞIKLARI');
    expect(out).toContain('¹ Bu bir dipnottur.');
    expect(out).toHaveLength(4);
  });

  it('üst bölgedeki büyük puntolu başlığa dokunmaz', () => {
    const pages = [page(0, [line('BİRİNCİ BÖLÜM', 560, 16, 150, 270), ...bodyLines(3)])];
    expect(stripPageFurniture(pages, 10)[0]?.lines[0]?.text).toBe('BİRİNCİ BÖLÜM');
  });
});

describe('stripPageFurniture — yanlış pozitifler', () => {
  it('sayfa sonunda tek kalan "mi." gibi kelimeyi sayfa numarası sanmaz; küçük Roma rakamını siler', () => {
    const pages = [
      page(0, [...bodyLines(3), line('mi.', 25, 10, 40, 60)]),
      page(1, [...bodyLines(3), line('xiv', 25, 8, 200, 220)]),
    ];
    const out = texts(stripPageFurniture(pages, 10));
    expect(out).toContain('mi.');
    expect(out).not.toContain('xiv');
  });

  it('rakamları farklı olup tekrar eden dipnotları silmez, sayfa numaralarını siler', () => {
    const pages = [0, 1, 2].map((i) =>
      page(i, [
        ...bodyLines(3),
        line(`¹ A.g.e., s. ${40 + i}.`, 40, 7.5),
        line(`${i + 10}`, 25, 8, 205, 215),
      ]),
    );
    const out = texts(stripPageFurniture(pages, 10));
    expect(out.filter((t) => t.startsWith('¹ A.g.e.'))).toHaveLength(3);
    expect(out.some((t) => /^\d+$/.test(t))).toBe(false);
  });
});

describe('stripPageFurniture — sayfa numarası bölgesi', () => {
  it('sayfa numaraları altta toplanmışsa sayfa başındaki tek başına sayıyı (bölüm numarası) silmez', () => {
    const pages = [0, 1, 2, 3, 4, 5].map((i) =>
      page(i, [...bodyLines(5), line(`${i + 10}`, 25, 8, 205, 215)]),
    );
    pages[2] = page(2, [
      line('11', 560, 10, 40, 52),
      line('Yavaş Yürüyün', 545, 10, 40, 140),
      ...bodyLines(5),
      line('12', 25, 8, 205, 215),
    ]);
    const out = texts(stripPageFurniture(pages, 10));
    expect(out.filter((t) => /^\d+$/.test(t))).toEqual(['11']);
  });
});

describe('stripPageFurniture — sayfa numarası dizisi', () => {
  it('bölüm açılışlarında alta inen sayfa numaralarını da siler (numaralar diziyi izler)', () => {
    const pages = Array.from({ length: 30 }, (_, i) =>
      page(
        i,
        i % 10 === 0
          ? [...bodyLines(5), line(`${i + 1}`, 25, 8, 205, 215)]
          : [line(`${i + 1}`, 560, 8, 205, 215), ...bodyLines(5)],
      ),
    );
    const out = texts(stripPageFurniture(pages, 10));
    expect(out.some((t) => /^\d+$/.test(t))).toBe(false);
  });
});
