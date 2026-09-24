import { describe, expect, it } from 'vitest';
import { chooseTitle, parseFileName } from '../../src/import/fileName';
import { sha256Hex } from '../../src/import/hash';

describe('sha256Hex', () => {
  it('bilinen özeti üretir', async () => {
    const bytes = new TextEncoder().encode('abc');
    expect(await sha256Hex(bytes.buffer)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
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
    expect(
      chooseTitle(
        { title: 'Microsoft Word - kitap.docx', author: 'User' },
        'Orhan Veli - Şiirler.pdf',
      ),
    ).toEqual({
      title: 'Şiirler',
      author: 'Orhan Veli',
    });
  });
});

describe('parseFileName — indirilen dosya adları', () => {
  it('sondaki site etiketini atar', () => {
    expect(parseFileName('Kurk_Mantolu_Madonna_(www.kitapindir.com).pdf')).toEqual({
      title: 'Kurk Mantolu Madonna',
    });
    expect(parseFileName('Sabahattin Ali - Kürk Mantolu Madonna [ornekkitap.com].pdf')).toEqual({
      author: 'Sabahattin Ali',
      title: 'Kürk Mantolu Madonna',
    });
  });

  it('ikiden fazla parçalı adı bölmez', () => {
    expect(parseFileName('Tutunamayanlar - Oğuz Atay - YKY.pdf')).toEqual({
      title: 'Tutunamayanlar - Oğuz Atay - YKY',
    });
  });

  it('yalnızca sayı olan ilk parçayı başlık sayar', () => {
    expect(parseFileName('1984 - George Orwell.pdf')).toEqual({
      title: '1984',
      author: 'George Orwell',
    });
  });

  it('parantez içindeki site dışı ek bilgiyi korur', () => {
    expect(parseFileName('Suç ve Ceza (Cilt 1).pdf')).toEqual({ title: 'Suç ve Ceza (Cilt 1)' });
  });
});
