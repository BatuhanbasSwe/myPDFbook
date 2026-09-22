import { describe, expect, it } from 'vitest';
import {
  countWords,
  detectLanguage,
  finalizeText,
  joinLines,
  needsTurkishRepair,
  repairTurkish,
} from '../../src/convert/text';

describe('joinLines', () => {
  it('normal satırları boşlukla birleştirir', () => {
    expect(joinLines('bir iki', 'üç')).toBe('bir iki üç');
  });
  it('heceleme tiresini kaldırır', () => {
    expect(joinLines('eski kita-', 'bı tuttu')).toBe('eski kitabı tuttu');
  });
  it('Unicode tireyi (U+2010) de tanır', () => {
    expect(joinLines('değerlen‐', 'dirme')).toBe('değerlendirme');
  });
  it('yumuşak tireyi kaldırır', () => {
    expect(joinLines('karşılaş­', 'tırma')).toBe('karşılaştırma');
  });
  it('büyük harfle devam eden gerçek tireyi korur', () => {
    expect(joinLines('Kuzey-', 'Güney yolu')).toBe('Kuzey-Güney yolu');
  });
  it('boşluklu tireyi normal birleştirir', () => {
    expect(joinLines('dedi -', 'sonra')).toBe('dedi - sonra');
  });
});

describe('finalizeText', () => {
  it('yumuşak tireleri ve fazla boşlukları temizler', () => {
    expect(finalizeText('  kar­şı   ya ')).toBe('karşı ya');
  });
});

describe('Türkçe karakter onarımı', () => {
  const brokenText = 'Iþýklar yanýp sönüyordu, daðlarýn ardýnda BÝRÝNCÝ ýþýk';
  it('bozuk kodlamayı tespit eder', () => {
    expect(needsTurkishRepair(brokenText)).toBe(true);
  });
  it('düzgün metinde onarım istemez', () => {
    expect(needsTurkishRepair('Işıklar yanıp sönüyordu, dağların ardında')).toBe(false);
  });
  it('harfleri düzeltir', () => {
    expect(repairTurkish(brokenText)).toBe('Işıklar yanıp sönüyordu, dağların ardında BİRİNCİ ışık');
  });
});

describe('detectLanguage', () => {
  it('Türkçe', () => {
    expect(
      detectLanguage('Bu kitap çok güzel ve bir o kadar da hüzünlü, ama okumak için sabır gerekir.'),
    ).toBe('tr');
  });
  it('İngilizce', () => {
    expect(
      detectLanguage('It was the best of times and it was the worst of times, as he said to her.'),
    ).toBe('en');
  });
  it('belirsiz', () => {
    expect(detectLanguage('12345 ...')).toBe('other');
  });
});

describe('countWords', () => {
  it('harfle başlayan sözcükleri sayar', () => {
    expect(countWords("Ahmet Bey'in 3 kitabı var — güzel!")).toBe(5);
  });
});
