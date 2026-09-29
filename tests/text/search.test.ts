import { describe, expect, it } from 'vitest';
import type { Block } from '../../src/convert/types';
import {
  buildSearchIndex,
  makeSnippet,
  normalizeQuery,
  searchBook,
  searchIndex,
} from '../../src/text/search';

const para = (text: string, srcPage = 0): Block => ({ kind: 'para', text, srcPage });

/** Sonuçların blok metnindeki hâli */
function found(blocks: Block[], query: string, lang: 'tr' | 'en' = 'tr') {
  return searchBook(blocks, query, { lang }).results.map((r) => {
    const b = blocks[r.block];
    return 'text' in b ? b.text.slice(r.start, r.end) : '';
  });
}

describe('arama biçimi', () => {
  it('Türkçe büyük/küçük harf: I → ı, İ → i; aksanlar atılır, Türkçe harfler kalır', () => {
    expect(normalizeQuery('IŞIK')).toBe('ışık');
    expect(normalizeQuery('İSTANBUL')).toBe('istanbul');
    expect(normalizeQuery('Hâlâ')).toBe('hala');
    expect(normalizeQuery('Çağdaş Öykü')).toBe('çağdaş öykü');
    expect(normalizeQuery('ﬁkir')).toBe('fikir');
    // İngilizce kitapta I → i
    expect(normalizeQuery('INTERNET', 'en')).toBe('internet');
  });

  it('boşluk ve noktalama tek ayraç; yumuşak tire ve kesme işareti yok sayılır', () => {
    expect(normalizeQuery('  dedi,   ki —  ')).toBe('dedi ki');
    expect(normalizeQuery('kita\u00ADbı')).toBe('kitabı');
    expect(normalizeQuery('Türkiye’nin')).toBe('türkiyenin');
    // Ayrışık yazılmış harf (s + çengel) birleşik gibi
    expect(normalizeQuery('s\u0327eker')).toBe('şeker');
  });
});

describe('searchBook', () => {
  const blocks: Block[] = [
    { kind: 'heading', level: 1, text: 'BİRİNCİ BÖLÜM', srcPage: 0 },
    para('Sabahın ilk ışıkları kasabanın dar sokaklarına düşerdi.'),
    para('Notta yazıyordu: “IŞIKLAR geri dönecek.” Işık yanıp sönüyordu.'),
    { kind: 'break', srcPage: 1 },
    para('Hâlâ bekliyordu; isik diye bir kelime yok. Kita\u00ADbı aldı.', 1),
  ];

  it('büyük/küçük harf ve Türkçe harf duyarsız bulur', () => {
    expect(found(blocks, 'ışık')).toEqual(['ışık', 'IŞIK', 'Işık']);
    expect(found(blocks, 'IŞIK')).toEqual(['ışık', 'IŞIK', 'Işık']);
    // Yalın harf Türkçe harfi de bulur; Türkçe harf yalın harfi bulmaz
    expect(found(blocks, 'ısık')).toEqual(['ışık', 'IŞIK', 'Işık']);
    expect(found(blocks, 'isik')).toEqual(['ışık', 'IŞIK', 'Işık', 'isik']);
    expect(found(blocks, 'birinci')).toEqual(['BİRİNCİ']);
  });

  it('aramadaki büyük ASCII "I" hem ı hem i bulur (Türkçe harf sayılmaz); küçük ı yalnızca ı', () => {
    const cities: Block[] = [para('istanbul İstanbul ıstanbul ISTANBUL')];
    expect(searchBook(cities, 'Istanbul').results).toHaveLength(4);
    expect(found(cities, 'ISTANBUL')).toEqual(['istanbul', 'İstanbul', 'ıstanbul', 'ISTANBUL']);
    expect(found(cities, 'ıstanbul')).toEqual(['ıstanbul', 'ISTANBUL']);
    // Yalın "i" (ve "İ") zaten ikisini de bulur
    expect(found(cities, 'İstanbul')).toHaveLength(4);
    // Aynı aramadaki öteki Türkçe harfler yine kesin: "IŞIK" "isik"i bulmaz, "ışık"ı ve "işik"i bulur
    const light: Block[] = [para('ışık isik işik IŞIK')];
    expect(found(light, 'IŞIK')).toEqual(['ışık', 'işik', 'IŞIK']);
    expect(found(light, 'ISIK')).toEqual(['ışık', 'isik', 'işik', 'IŞIK']);
    // Arama biçimi değişmez: I → ı
    expect(normalizeQuery('Istanbul')).toBe('ıstanbul');
  });

  it('eşleşmeler üst üste binmez', () => {
    const b: Block[] = [para('aaaa aaa')];
    expect(searchBook(b, 'aa').results.map((r) => [r.start, r.end])).toEqual([
      [0, 2],
      [2, 4],
      [5, 7],
    ]);
  });

  it('bloğu doğru bulur: boş ve metinsiz bloklar atlanır', () => {
    const b: Block[] = [
      para('elma'),
      { kind: 'pageImage', srcPage: 1 },
      para(''),
      para('armut elma', 2),
      para('elma', 3),
    ];
    expect(searchBook(b, 'elma').results.map((r) => [r.block, r.start])).toEqual([
      [0, 0],
      [3, 6],
      [4, 0],
    ]);
  });

  it('aksan duyarsız: "hala" "Hâlâ"yı, "hâlâ" da bulur', () => {
    expect(found(blocks, 'hala')).toEqual(['Hâlâ']);
    expect(found(blocks, 'HÂLÂ')).toEqual(['Hâlâ']);
  });

  it('çok kelime art arda gelmeli; aradaki noktalama ve boşluk önemsiz', () => {
    expect(found(blocks, 'dar sokaklarına')).toEqual(['dar sokaklarına']);
    expect(found(blocks, 'sokaklarına dar')).toEqual([]);
    expect(found(blocks, 'yazıyordu ışıklar')).toEqual(['yazıyordu: “IŞIKLAR']);
    expect(found(blocks, 'geri   dönecek')).toEqual(['geri dönecek']);
  });

  it('yumuşak tire kelimeyi bölmez; eşleşme blok sınırını geçmez', () => {
    expect(found(blocks, 'kitabı')).toEqual(['Kita\u00ADbı']);
    expect(found(blocks, 'düşerdi notta')).toEqual([]);
  });

  it('sonuç blok, aralık, konum ve parça verir', () => {
    const [r] = searchBook(blocks, 'kasabanın').results;
    expect(r).toMatchObject({ block: 1, start: 21, end: 30, locator: { block: 1, offset: 21 } });
    expect(r.snippet).toEqual({
      before: 'Sabahın ilk ışıkları ',
      match: 'kasabanın',
      after: ' dar sokaklarına düşerdi.',
    });
  });

  it('harfsiz arama sonuç vermez', () => {
    expect(searchBook(blocks, '  ,. ').results).toEqual([]);
    expect(searchBook(blocks, '').more).toBe(false);
  });

  it('sınır: en çok limit sonuç, fazlası "more"', () => {
    const many = Array.from({ length: 30 }, (_, i) => para(`kedi ${i} kedi`));
    const all = searchBook(many, 'kedi', { limit: 100 });
    expect(all.results).toHaveLength(60);
    expect(all.more).toBe(false);
    const capped = searchBook(many, 'kedi', { limit: 50 });
    expect(capped.results).toHaveLength(50);
    expect(capped.more).toBe(true);
    // Tam sınır kadar sonuç: fazlası yok
    expect(searchBook(many, 'kedi', { limit: 60 }).more).toBe(false);
  });

  it('dizin kitap ve dil başına bir kez kurulur', () => {
    expect(searchIndex(blocks, 'tr')).toBe(searchIndex(blocks, 'tr'));
    expect(searchIndex(blocks, 'en')).not.toBe(searchIndex(blocks, 'tr'));
  });
});

describe('makeSnippet', () => {
  it('uzun metinde kelime ortasından kesmez, üç nokta koyar, yumuşak tireyi atar', () => {
    const words = Array.from({ length: 60 }, (_, i) => `kelime${i}`).join(' ');
    const text = `${words} HEDEF bu\u00ADrada ${words}`;
    const start = text.indexOf('HEDEF');
    const s = makeSnippet(text, start, start + 5);
    expect(s.match).toBe('HEDEF');
    expect(s.before.startsWith('…kelime')).toBe(true);
    expect(s.before.endsWith(' ')).toBe(true);
    expect(s.after.startsWith(' burada ')).toBe(true);
    expect(s.after.endsWith('…')).toBe(true);
    // Kesilen yer kelime sınırı: üç noktadan önce tam bir kelime
    expect(s.after).toMatch(/ kelime\d+…$/);
    expect(s.before).toMatch(/^…kelime\d+ /);
  });
});

describe('hız', () => {
  it('1 MB metinde arama 100 ms altında', () => {
    // Türkçe benzeri rastgele metin: ~1 MB, 2000 paragraf
    const syll = ['ka', 'la', 'şı', 'ğü', 'ön', 'Çe', 'rİ', 'Iş', 'ma', 'de', 'nü', 'yo', 'lâ'];
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const word = () =>
      Array.from(
        { length: 1 + Math.floor(rand() * 4) },
        () => syll[Math.floor(rand() * syll.length)],
      ).join('');
    const blocks: Block[] = [];
    let size = 0;
    for (let p = 0; size < 1_000_000; p++) {
      const text = Array.from({ length: 80 }, word).join(' ') + '.';
      size += text.length;
      blocks.push(para(text, Math.floor(p / 4)));
    }
    blocks.push(para('burada gizli bir iğne var'));
    const index = buildSearchIndex(blocks, 'tr');
    expect(index.exact.length).toBeGreaterThan(900_000);
    searchIndex(blocks, 'tr'); // önbelleğe al (kurulum ölçülmez)

    const time = (q: string) => {
      const runs: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        searchBook(blocks, q);
        runs.push(performance.now() - t0);
      }
      // Yük altında tek bir koşu yavaşlayabilir: en iyisi ölçülür
      return Math.min(...runs);
    };
    // Sık geçen (sınıra takılır), seyrek, hiç geçmeyen ve Türkçe harfli çok kelimeli aramalar
    expect(time('ka')).toBeLessThan(100);
    expect(time('gizli bir iğne')).toBeLessThan(100);
    expect(time('bulunmayan kelime')).toBeLessThan(100);
    expect(time('şığ')).toBeLessThan(100);
    expect(searchBook(blocks, 'GİZLİ BİR İĞNE').results).toHaveLength(1);
    expect(searchBook(blocks, 'ka').more).toBe(true);
  });
});
