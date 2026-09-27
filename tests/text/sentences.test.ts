import { describe, expect, it } from 'vitest';
import type { Block, Lang } from '../../src/convert/types';
import { buildSentenceIndex, sentenceAt, splitSentences } from '../../src/text/sentences';

/** Cümle metinleri (aralıklarla dilimlenmiş). */
const split = (text: string, lang: Lang = 'tr') =>
  splitSentences(text, lang).map((s) => text.slice(s.start, s.end));

describe('splitSentences', () => {
  it('düz Türkçe metni cümlelere böler', () => {
    expect(split('Sabah erken kalktı. Hava soğuktu! Nereye gidecekti?')).toEqual([
      'Sabah erken kalktı.',
      'Hava soğuktu!',
      'Nereye gidecekti?',
    ]);
  });

  it('Türkçe diyalogda soru işaretinden sonra küçük harfle süren kısmı aynı cümlede tutar', () => {
    expect(split('— Nereye? dedi. Kimse cevap vermedi.')).toEqual([
      '— Nereye? dedi.',
      'Kimse cevap vermedi.',
    ]);
    expect(split('— Gel buraya! diye bağırdı annesi. — Geliyorum.')).toEqual([
      '— Gel buraya! diye bağırdı annesi.',
      '— Geliyorum.',
    ]);
  });

  it('kısaltmalarda bölmez', () => {
    expect(
      split('Dr. Ahmet geldi. Prof. Dr. Ayşe Yılmaz da Doç. Mehmet ve Av. Can ile konuştu.'),
    ).toEqual(['Dr. Ahmet geldi.', 'Prof. Dr. Ayşe Yılmaz da Doç. Mehmet ve Av. Can ile konuştu.']);
    expect(split('Elma, armut vb. Meyveler. Kitap, defter vs. Her şey. Bkz. Ek. Örn. Bu.')).toEqual(
      ['Elma, armut vb. Meyveler.', 'Kitap, defter vs. Her şey.', 'Bkz. Ek.', 'Örn. Bu.'],
    );
    expect(split('Ayrıntı için s. 45 ve sf. 12 okunur. Bitti.')).toEqual([
      'Ayrıntı için s. 45 ve sf. 12 okunur.',
      'Bitti.',
    ]);
  });

  it('baş harflerde bölmez', () => {
    expect(split('A. Yılmaz ile J.R.R. Tolkien konuştu. Sonra gittiler.')).toEqual([
      'A. Yılmaz ile J.R.R. Tolkien konuştu.',
      'Sonra gittiler.',
    ]);
  });

  it('sıra sayılarında bölmez (rakam + nokta + küçük harf)', () => {
    expect(split('Bu 3. bölüm. 19. yüzyıl başında yazıldı. Son.')).toEqual([
      'Bu 3. bölüm.',
      '19. yüzyıl başında yazıldı.',
      'Son.',
    ]);
  });

  it('yalnızca sıra sayısından oluşan parçayı arkasındaki büyük harfle başlayan cümleye katar', () => {
    expect(split('2. Dünya Savaşı başladı. Sonra bitti.')).toEqual([
      '2. Dünya Savaşı başladı.',
      'Sonra bitti.',
    ]);
    expect(split('II. Abdülhamit tahta çıktı.')).toEqual(['II. Abdülhamit tahta çıktı.']);
    expect(split('1. Bölüm')).toEqual(['1. Bölüm']);
    // liste maddeleri
    expect(split('2. Özlem: Bir şey ister. 3. Tepki: Harekete geçer.')).toEqual([
      '2. Özlem: Bir şey ister.',
      '3. Tepki: Harekete geçer.',
    ]);
    // cümlenin içindeki Roma rakamlı sıra sayısı
    expect(split('Sonra II. Abdülhamit geldi. Herkes sustu.')).toEqual([
      'Sonra II. Abdülhamit geldi.',
      'Herkes sustu.',
    ]);
    // cümle sonundaki sayı sıra sayısı değildir
    expect(split('Sonuç 42. Başka bir şey.')).toEqual(['Sonuç 42.', 'Başka bir şey.']);
  });

  it('Türkçe kısaltmalarda bölmez (Hz., Yrd., Cad., Mah., Sok., vd., Bşk., Gen., Alb., Yzb., Sn.)', () => {
    expect(
      split(
        'Hz. Muhammed geldi. Yrd. Doç. Ali konuştu. Atatürk Cad. Gül Mah. Lale Sok. No. 5. ' +
          'Ahmet vd. Kitabı yazdı. Bşk. Yardımcısı, Gen. Ali, Alb. Veli ve Yzb. Can geldi. Sn. Ayşe teşekkür etti.',
      ),
    ).toEqual([
      'Hz. Muhammed geldi.',
      'Yrd. Doç. Ali konuştu.',
      'Atatürk Cad. Gül Mah. Lale Sok. No. 5.',
      'Ahmet vd. Kitabı yazdı.',
      'Bşk. Yardımcısı, Gen. Ali, Alb. Veli ve Yzb. Can geldi.',
      'Sn. Ayşe teşekkür etti.',
    ]);
  });

  it('üç noktadan sonra küçük harfle süren cümleyi bölmez, büyük harfle başlayanı böler', () => {
    expect(split('Bekledi... ve sonra gitti. Bekledi… ve gitti. Durdu… Yeni gün başladı.')).toEqual(
      ['Bekledi... ve sonra gitti.', 'Bekledi… ve gitti.', 'Durdu…', 'Yeni gün başladı.'],
    );
  });

  it('kapanış tırnağı, parantez ve dipnot imi önceki cümleye aittir', () => {
    expect(split('“Gel.” Sonra gitti. (Evet.) Kitabı tutuyordu.¹ Ahmet geldi.')).toEqual([
      '“Gel.”',
      'Sonra gitti.',
      '(Evet.)',
      'Kitabı tutuyordu.¹',
      'Ahmet geldi.',
    ]);
  });

  it('İngilizce metni böler; kısaltmaları tanır', () => {
    expect(
      split(
        'Mr. Smith met Mrs. Jones at St. Paul. See No. 5, e.g. this one. I said no. Then he left.',
        'en',
      ),
    ).toEqual([
      'Mr. Smith met Mrs. Jones at St. Paul.',
      'See No. 5, e.g. this one.',
      'I said no.',
      'Then he left.',
    ]);
    expect(split('It works, i.e. it runs. Good.', 'en')).toEqual([
      'It works, i.e. it runs.',
      'Good.',
    ]);
  });

  it('baştaki ve sondaki boşlukları dahil etmez; boş metinden cümle çıkmaz', () => {
    const text = '  Merhaba.   Nasılsın?  ';
    const spans = splitSentences(text, 'tr');
    expect(spans).toEqual([
      { start: 2, end: 10 },
      { start: 13, end: 22 },
    ]);
    expect(splitSentences('', 'tr')).toEqual([]);
    expect(splitSentences('   ', 'tr')).toEqual([]);
  });

  it('dil bilinmiyorsa da böler', () => {
    expect(split('Bir. İki.', 'other')).toEqual(['Bir.', 'İki.']);
  });

  it('1 MB metni 300 ms altında böler', () => {
    const para =
      '— Nereye gidiyorsun? dedi annesi. Dr. Ahmet 3. bölümü okudu... ve uyudu. ' +
      'Kasaba sisle örtülüydü; kimse konuşmuyordu. “Gel,” dedi. Sonra A. Yılmaz geldi! ';
    const repeats = Math.ceil(1_000_000 / para.length);
    const text = para.repeat(repeats);
    expect(splitSentences(para, 'tr')).toHaveLength(5);
    const t0 = performance.now();
    const spans = splitSentences(text, 'tr');
    const ms = performance.now() - t0;
    expect(spans).toHaveLength(repeats * 5);
    expect(ms).toBeLessThan(300);
  });
});

const blocks: Block[] = [
  { kind: 'heading', level: 1, text: 'BİRİNCİ BÖLÜM. Sisli Sabah', srcPage: 0 },
  { kind: 'para', text: 'İlk cümle. İkinci cümle burada.', srcPage: 0 },
  { kind: 'break', srcPage: 0 },
  { kind: 'pageImage', srcPage: 1 },
  { kind: 'para', text: '', srcPage: 2 },
  { kind: 'para', text: 'Tek cümle var.', srcPage: 2 },
  { kind: 'note', text: '¹ Dipnot. İki cümle.', srcPage: 2 },
];

describe('buildSentenceIndex', () => {
  const index = buildSentenceIndex(blocks, 'tr');

  it('başlık tek cümle, paragraf ve dipnot cümlelere bölünür; break, pageImage ve boş bloktan cümle çıkmaz', () => {
    expect(index.map((s) => [s.block, blocks[s.block].kind])).toEqual([
      [0, 'heading'],
      [1, 'para'],
      [1, 'para'],
      [5, 'para'],
      [6, 'note'],
      [6, 'note'],
    ]);
    const text = (b: Block) => ('text' in b ? b.text : '');
    expect(index.map((s) => text(blocks[s.block]).slice(s.start, s.end))).toEqual([
      'BİRİNCİ BÖLÜM. Sisli Sabah',
      'İlk cümle.',
      'İkinci cümle burada.',
      'Tek cümle var.',
      '¹ Dipnot.',
      'İki cümle.',
    ]);
  });

  it('id kitap boyunca sıradır; kelimeler sayılır', () => {
    expect(index.map((s) => s.id)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(index.map((s) => s.words)).toEqual([4, 2, 3, 3, 1, 2]);
  });

  it('boş kitapta boş dizin', () => {
    expect(buildSentenceIndex([], 'tr')).toEqual([]);
  });
});

describe('sentenceAt', () => {
  const index = buildSentenceIndex(blocks, 'tr');
  // blok 1: "İlk cümle. İkinci cümle burada." → [0,10) ve [11,31)

  it('konumu içeren cümle (başı dahil, sonu hariç)', () => {
    expect(sentenceAt(index, { block: 1, offset: 0 })?.id).toBe(1);
    expect(sentenceAt(index, { block: 1, offset: 9 })?.id).toBe(1);
    expect(sentenceAt(index, { block: 1, offset: 11 })?.id).toBe(2);
    expect(sentenceAt(index, { block: 1, offset: 30 })?.id).toBe(2);
  });

  it('cümleler arasındaki boşlukta sonraki cümle', () => {
    expect(sentenceAt(index, { block: 1, offset: 10 })?.id).toBe(2);
  });

  it('bloğun sonundan ya da cümlesiz bloktan sonra gelen ilk cümle', () => {
    expect(sentenceAt(index, { block: 1, offset: 31 })?.id).toBe(3);
    expect(sentenceAt(index, { block: 2, offset: 0 })?.id).toBe(3);
    expect(sentenceAt(index, { block: 3, offset: 0 })?.id).toBe(3);
  });

  it('ilk ve son sınırlar', () => {
    expect(sentenceAt(index, { block: 0, offset: 0 })?.id).toBe(0);
    expect(sentenceAt(index, { block: 6, offset: 20 })).toBeUndefined();
    expect(sentenceAt(index, { block: 99, offset: 0 })).toBeUndefined();
    expect(sentenceAt([], { block: 0, offset: 0 })).toBeUndefined();
  });
});
