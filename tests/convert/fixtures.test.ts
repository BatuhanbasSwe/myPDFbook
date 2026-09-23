import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { convertPdf } from '../../src/convert/convertPdf';
import type { Block, BookContent } from '../../src/convert/types';
import { createPdfSource } from '../../src/pdf/pdfSource';

async function convertFixture(name: string): Promise<BookContent> {
  const data = new Uint8Array(await readFile(new URL(`../fixtures/${name}`, import.meta.url)));
  const doc = await getDocument({ data }).promise;
  try {
    return await convertPdf(createPdfSource(doc));
  } finally {
    await doc.loadingTask.destroy();
  }
}

const texts = (blocks: Block[]) => blocks.flatMap((b) => ('text' in b ? [b.text] : []));

describe('novel-tr.pdf', () => {
  let c: BookContent;
  beforeAll(async () => {
    c = await convertFixture('novel-tr.pdf');
  });

  it('dili Türkçe olarak tanır ve kelimeleri sayar', () => {
    expect(c.lang).toBe('tr');
    expect(c.totalWords).toBeGreaterThan(150);
  });

  it('başlıkları düzeyleriyle çıkarır', () => {
    const headings = c.blocks.flatMap((b) => (b.kind === 'heading' ? [`${b.level}:${b.text}`] : []));
    expect(headings).toEqual([
      '1:KAYIP ŞEHRİN IŞIKLARI',
      '2:Deniz Aksoy',
      '1:BİRİNCİ BÖLÜM',
      '2:Sisli Sabah',
      '1:İKİNCİ BÖLÜM',
      '2:İstasyon',
    ]);
  });

  it('sayfa numarası, filigran ve sayfa başlıklarını temizler', () => {
    const all = texts(c.blocks);
    expect(all.join('\n')).not.toContain('ornekkitap');
    expect(all.filter((t) => t.includes('KAYIP ŞEHRİN IŞIKLARI'))).toHaveLength(1);
    expect(all.some((t) => /^\d+$/.test(t))).toBe(false);
  });

  it('sayfa geçişinde bölünen paragrafı birleştirir', () => {
    expect(texts(c.blocks).some((t) => t.includes('söylemiyormuş gibiydi ve bu sessizlik'))).toBe(true);
  });

  it('diyalogları ayrı paragraf yapar', () => {
    expect(texts(c.blocks)).toContain('— Nereye gidiyorsun? dedi annesi mutfaktan seslenerek.');
  });

  it('satır sonu tirelerini birleştirir', () => {
    const all = texts(c.blocks).join(' ');
    expect(all).toContain('eski kitabı tutuyordu');
    expect(all).not.toContain('kita-');
  });

  it('dipnotu, işaretin geçtiği paragraftan sonra ayrı blok yapar', () => {
    const noteIdx = c.blocks.findIndex((b) => b.kind === 'note');
    const markerIdx = c.blocks.findIndex((b) => b.kind === 'para' && b.text.includes('tutuyordu.¹'));
    expect(markerIdx).toBeGreaterThan(-1);
    expect(noteIdx).toBeGreaterThan(markerIdx);
    expect(texts([c.blocks[noteIdx]])[0]).toMatch(/^¹ Kitabın ilk baskısı 1923/);
  });

  it('sahne arasını korur', () => {
    expect(c.blocks.some((b) => b.kind === 'break')).toBe(true);
  });

  it('bölümleri PDF içindekilerinden alır', () => {
    expect(c.chapters.map((ch) => `${ch.level}:${ch.title}`)).toEqual([
      '1:BİRİNCİ BÖLÜM',
      '2:Sisli Sabah',
      '1:İKİNCİ BÖLÜM',
      '2:İstasyon',
    ]);
    expect(c.blocks[c.chapters[0].block]).toMatchObject({ kind: 'heading', text: 'BİRİNCİ BÖLÜM' });
  });

  it('boş sayfayı görsel saymaz', () => {
    expect(c.textlessPages).toEqual([]);
  });
});

describe('diğer PDF türleri', () => {
  it('bozuk Türkçe kodlamayı onarır (bölüm adı dahil)', async () => {
    const c = await convertFixture('legacy-encoding-tr.pdf');
    const all = texts(c.blocks).join(' ');
    expect(all).toContain('BİRİNCİ BÖLÜM');
    expect(all).toContain('ışıklar');
    expect(all).not.toMatch(/[ýþð]/);
    expect(c.chapters[0]?.title).toBe('BİRİNCİ BÖLÜM');
  });

  it('taranmış PDF\'in tüm sayfalarını görsel blok yapar', async () => {
    const c = await convertFixture('scanned.pdf');
    expect(c.textlessPages).toEqual([0, 1, 2]);
    expect(c.blocks.map((b) => b.kind)).toEqual(['pageImage', 'pageImage', 'pageImage']);
  });

  it('karışık PDF\'te yalnızca resimli sayfayı görsel yapar', async () => {
    const c = await convertFixture('mixed.pdf');
    expect(c.textlessPages).toEqual([1]);
    expect(c.blocks.filter((b) => b.kind === 'pageImage')).toHaveLength(1);
    expect(c.blocks.some((b) => b.kind === 'para')).toBe(true);
  });

  it('İngilizce kitabı tanır', async () => {
    expect((await convertFixture('english.pdf')).lang).toBe('en');
  });
});
