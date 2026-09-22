/**
 * Test PDF'lerini üretir: Chromium ile HTML → PDF ("yazdır").
 * Çıktılar tests/fixtures/ altına yazılır ve repoya eklenir; testler Chromium istemez.
 * Çalıştırma: pnpm fixtures
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(import.meta.dirname, '..', 'tests', 'fixtures');

const CSS = `
@page { size: 148mm 210mm; margin: 0 }
body { margin: 0; font-family: Georgia, 'Times New Roman', serif; color: #000 }
.page { width: 148mm; height: 210mm; box-sizing: border-box; padding: 18mm 14mm 20mm; position: relative; break-after: page; overflow: hidden }
.rh { position: absolute; top: 8mm; left: 14mm; right: 14mm; text-align: center; font-size: 8pt; letter-spacing: 0.5pt }
.pn { position: absolute; bottom: 9mm; left: 0; right: 0; text-align: center; font-size: 8pt }
.wm { position: absolute; bottom: 4mm; left: 0; right: 0; text-align: center; font-size: 6.5pt }
.fn { position: absolute; bottom: 16mm; left: 14mm; right: 14mm; font-size: 7.5pt; line-height: 1.3; border-top: 0.5pt solid #000; padding-top: 1mm }
p { font-size: 10.5pt; line-height: 1.45; text-align: justify; text-indent: 1.2em; margin: 0 }
p.cont, p.first { text-indent: 0 }
h1 { font-size: 16pt; text-align: center; margin: 22mm 0 2mm; font-weight: normal; letter-spacing: 1pt }
h2 { font-size: 12pt; text-align: center; margin: 0 0 9mm; font-style: italic; font-weight: normal }
.brk { text-align: center; font-size: 10.5pt; margin: 3mm 0 }
.title { text-align: center; margin-top: 60mm }
.title .t { font-size: 22pt; letter-spacing: 1pt }
.title .a { font-size: 12pt; margin-top: 8mm }
`;

interface PageSpec {
  body: string;
  runningHead?: string;
  pageNumber?: number;
  watermark?: boolean;
  footnote?: string;
}

const renderPage = (p: PageSpec) =>
  [
    '<div class="page">',
    p.runningHead ? `<div class="rh">${p.runningHead}</div>` : '',
    p.body,
    p.footnote ? `<div class="fn">${p.footnote}</div>` : '',
    p.pageNumber ? `<div class="pn">${p.pageNumber}</div>` : '',
    p.watermark ? '<div class="wm">www.ornekkitap.com</div>' : '',
    '</div>',
  ].join('');

const doc = (title: string, pages: PageSpec[], lang = 'tr') =>
  `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head><body>${pages.map(renderPage).join('')}</body></html>`;

// 6 sayfalık roman: başlık sayfası, boş sayfa, iki bölüm, sayfa başlıkları, numaralar,
// filigran, satır sonu tiresi, diyaloglar, sayfaya taşan paragraf, dipnot, sahne arası.
const NOVEL: PageSpec[] = [
  { body: '<div class="title"><div class="t">KAYIP ŞEHRİN IŞIKLARI</div><div class="a">Deniz Aksoy</div></div>' },
  { body: '' },
  {
    pageNumber: 3,
    watermark: true,
    body: `<h1>BİRİNCİ BÖLÜM</h1><h2>Sisli Sabah</h2>
<p class="first">Sabahın ilk ışıkları kasabanın dar sokaklarına düşerken Dr. Ahmet Bey penceresinin önünde durmuş, uzaklardaki dağların arkasından yükselen sisi seyrediyordu. Kahvesi çoktan soğumuştu ama o bunun farkında bile değildi; aklı, dün akşam gelen mektuptaydı.</p>
<p>— Nereye gidiyorsun? dedi annesi mutfaktan seslenerek.</p>
<p>— İstasyona, dedi Ahmet Bey. Akşama dönerim.</p>
<p>Paltosunu aldı, kapıyı yavaşça kapattı ve istasyona doğru yürümeye başladı. Yol boyunca karşılaştığı insanların yüzlerinde tuhaf bir telaş vardı; herkes bir şeyler biliyor da söylemiyormuş gibiydi</p>`,
  },
  {
    runningHead: 'KAYIP ŞEHRİN IŞIKLARI',
    pageNumber: 4,
    watermark: true,
    footnote: '¹ Kitabın ilk baskısı 1923 yılında yapılmıştır.',
    body: `<p class="cont">ve bu sessizlik onu her adımda biraz daha huzursuz ediyordu. İstasyonun önünde eski bir kitapçı vardı; vitrininde tozlu ciltler, sararmış haritalar vb. eşyalar duruyordu.</p>
<p>Kitapçının sahibi Prof. Nuri Bey onu görünce gülümsedi. Elinde, yıllardır aradığı o eski kita-<br>bı tutuyordu.¹ Ahmet Bey bir an ne diyeceğini bilemedi.</p>
<p>— Bunu nereden buldunuz? diye sordu sonunda.</p>
<p>— Bir müzayededen, dedi Nuri Bey. Sayfalarının arasında bir de not vardı; bkz. son sayfa.</p>`,
  },
  {
    runningHead: 'Sisli Sabah',
    pageNumber: 5,
    watermark: true,
    body: `<p>Notta yalnızca üç kelime yazıyordu: “Işıklar geri dönecek.” Ahmet Bey kâğıdı defalarca okudu; ne anlama geldiğini bir türlü çözemedi.</p>
<div class="brk">* * *</div>
<p class="first">O gece kasabada elektrikler kesildi. İnsanlar sokaklara çıktı, gökyüzüne baktı. Uzakta, dağların ardında, hiç görmedikleri bir ışık yanıp sönüyordu.</p>`,
  },
  {
    pageNumber: 6,
    watermark: true,
    body: `<h1>İKİNCİ BÖLÜM</h1><h2>İstasyon</h2>
<p class="first">Tren her zamankinden geç geldi. Perondaki saat durmuştu; akrep ile yelkovan on ikinin üzerinde birleşmişti. Ahmet Bey bunu bir işaret saydı.</p>
<p>Vagonların birinde yalnız bir kadın oturuyordu. Kucağında, Nuri Bey'in dükkânındakinin aynısı olan bir kitap vardı.</p>`,
  },
];

// Türkçe karakterleri yanlış kodlayan eski fontları taklit eder.
const broken = (s: string) =>
  s
    .replace(/ı/g, 'ý')
    .replace(/ş/g, 'þ')
    .replace(/ğ/g, 'ð')
    .replace(/İ/g, 'Ý')
    .replace(/Ş/g, 'Þ')
    .replace(/Ğ/g, 'Ð');

const LEGACY: PageSpec[] = [
  {
    pageNumber: 1,
    body: `<h1>${broken('BİRİNCİ BÖLÜM')}</h1><p class="first">${broken('Işıklar yanıp sönüyordu; dağların ardında, sisin içinde parlayan ışıklar herkesi şaşırtmıştı. Şehrin insanları sokaklara döküldü ve gece boyunca gökyüzünü seyretti.')}</p>`,
  },
];

const ENGLISH: PageSpec[] = [
  {
    pageNumber: 1,
    body: `<h1>Chapter One</h1><h2>The Lighthouse</h2>
<p class="first">It was the kind of evening when the sea seemed to hold its breath. The keeper had lit the lamp an hour before sunset, as he always did, and now he sat by the window with a cup of tea that had long gone cold.</p>
<p>“Is anyone out there?” he asked the empty room, and for a moment he thought the wind answered.</p>`,
  },
];

const imagePage = (jpeg: Buffer): PageSpec => ({
  body: `<img src="data:image/jpeg;base64,${jpeg.toString('base64')}" style="position:absolute;inset:0;width:148mm;height:210mm">`,
});

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 600, height: 900 } });
const page = await context.newPage();

const writePdf = async (file: string, html: string) => {
  await page.setContent(html);
  await page.pdf({
    path: path.join(OUT, file),
    preferCSSPageSize: true,
    printBackground: true,
    tagged: true,
    outline: true,
  });
  console.log('✓', file);
};

await writePdf('novel-tr.pdf', doc('Kayıp Şehrin Işıkları', NOVEL));
await writePdf('legacy-encoding-tr.pdf', doc('Eski Kodlama', LEGACY));
await writePdf('english.pdf', doc('The Lighthouse', ENGLISH, 'en'));

// Taranmış kitap: roman sayfalarının ekran görüntüleri (metin katmanı yok).
await page.setContent(doc('Taranmış', NOVEL));
const shot = (i: number) => page.locator('.page').nth(i).screenshot({ type: 'jpeg', quality: 70 });
const scans = [await shot(2), await shot(3), await shot(4)];
await writePdf('scanned.pdf', doc('Taranmış Kitap', scans.map(imagePage)));
await writePdf('mixed.pdf', doc('Karışık Kitap', [NOVEL[2], imagePage(scans[1]), NOVEL[4]]));

await browser.close();
