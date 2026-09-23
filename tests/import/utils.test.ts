import { describe, expect, it } from 'vitest';
import { chooseTitle, parseFileName } from '../../src/import/fileName';
import { sha256Hex } from '../../src/import/hash';

describe('sha256Hex', () => {
  it('bilinen özeti üretir', async () => {
    const bytes = new TextEncoder().encode('abc');
    expect(await sha256Hex(bytes.buffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('parseFileName', () => {
  it('"Yazar - Kitap" kalıbını ayırır', () => {
    expect(parseFileName('Sabahattin Ali - Kürk Mantolu Madonna.pdf')).toEqual({
      author: 'Sabahattin Ali',
      title: 'Kürk Mantolu Madonna',
    });
  });
  it('alt çizgileri boşluğa çevirir', () => {
    expect(parseFileName('Kurk_Mantolu_Madonna.PDF')).toEqual({ title: 'Kurk Mantolu Madonna' });
  });
});

describe('chooseTitle', () => {
  it('geçerli metadata başlığını tercih eder, yazarı dosya adından tamamlar', () => {
    expect(chooseTitle({ title: 'Kayıp Şehrin Işıkları' }, 'Deniz Aksoy - kitap.pdf')).toEqual({
      title: 'Kayıp Şehrin Işıkları',
      author: 'Deniz Aksoy',
    });
  });
  it('anlamsız metadata başlığını ve yazarını yok sayar', () => {
    expect(chooseTitle({ title: 'Microsoft Word - kitap.docx', author: 'User' }, 'Orhan Veli - Şiirler.pdf')).toEqual({
      title: 'Şiirler',
      author: 'Orhan Veli',
    });
  });
});
