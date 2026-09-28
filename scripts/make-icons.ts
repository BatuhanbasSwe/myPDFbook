// Uygulama simgelerini üretir: public/icons altına SVG (sekme simgesi) ve PNG'ler (manifest, iOS ana ekranı).
// Açık kitap çizimi, kütüphane başlığındaki simgeyle aynıdır (lucide "book-open", ISC lisansı).
// Çalıştırma: pnpm icons  (Playwright'ın Chromium'u ile çizilir; ek paket gerekmez)
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PAPER = '#f7f3ea';
const INK = '#9a5b2a';

const out = path.resolve(import.meta.dirname, '..', 'public', 'icons');

/**
 * Kitap, 24 birimlik lucide ızgarasında x 2–22, y 3–21 aralığındadır (merkez 12,12).
 * `scale`: kitabın genişliğinin simge genişliğine oranı. Maskelenebilir simgede kitap, ortadaki güvenli daireye
 * (çapı simgenin %80'i) sığmalıdır: köşegeni 20×18 birim → genişlik en çok ~%59.
 */
function iconSvg(size: number, scale: number, { rounded = false } = {}): string {
  const unit = (size * scale) / 20;
  const offset = size / 2 - 12 * unit;
  const radius = rounded ? size * 0.2 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${PAPER}"/>
  <g transform="translate(${offset} ${offset}) scale(${unit})" fill="none" stroke="${INK}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 5v16"/>
    <path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"/>
  </g>
</svg>
`;
}

const PNGS = [
  { file: 'icon-192.png', size: 192, scale: 0.66 },
  { file: 'icon-512.png', size: 512, scale: 0.66 },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.54 },
  // iOS köşeleri kendisi yuvarlar; saydamlık olmamalı
  { file: 'apple-touch-icon-180.png', size: 180, scale: 0.66 },
];

mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'icon.svg'), iconSvg(512, 0.66, { rounded: true }));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const { file, size, scale } of PNGS) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0">${iconSvg(size, scale)}</body></html>`);
    await page.locator('svg').screenshot({ path: path.join(out, file), omitBackground: false });
    console.log(`${file} (${size}×${size})`);
  }
} finally {
  await browser.close();
}
console.log(`simgeler yazıldı → ${path.relative(process.cwd(), out)}`);
