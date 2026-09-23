/**
 * Bir PDF'i dönüştürüp okunabilir döküm yazdırır; kuralları gerçek kitaplarla ayarlamak için.
 * Kullanım: pnpm convert <dosya.pdf> [--json]
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { convertPdf } from '../src/convert/convertPdf';
import { createPdfSource } from '../src/pdf/pdfSource';

const [file, flag] = process.argv.slice(2);
if (!file) {
  console.error('Kullanım: pnpm convert <dosya.pdf> [--json]');
  process.exit(1);
}

// pdf.js klasör yolunun "/" ile bitmesini ister; Windows'taki ters eğik çizgiler "/" yapılır (Node ikisini de okur).
const asset = (dir: string) =>
  fileURLToPath(new URL(`../node_modules/pdfjs-dist/${dir}/`, import.meta.url)).split('\\').join('/');
const doc = await getDocument({
  data: new Uint8Array(await readFile(file)),
  standardFontDataUrl: asset('standard_fonts'),
  cMapUrl: asset('cmaps'),
  cMapPacked: true,
  wasmUrl: asset('wasm'),
}).promise;
const pageCount = doc.numPages;
const started = performance.now();
const content = await convertPdf(createPdfSource(doc));
const ms = Math.round(performance.now() - started);
await doc.loadingTask.destroy();

if (flag === '--json') {
  console.log(JSON.stringify(content, null, 2));
} else {
  console.log(`# ${file}`);
  console.log(`${pageCount} sayfa · ${content.blocks.length} blok · ${content.totalWords} kelime · dil: ${content.lang} · ${ms} ms`);
  console.log(`Metinsiz sayfalar: ${content.textlessPages.map((p) => p + 1).join(', ') || '-'}`);
  console.log('\n## Bölümler');
  for (const ch of content.chapters) console.log(`${'  '.repeat(ch.level - 1)}- ${ch.title} (blok ${ch.block})`);
  console.log('\n## Bloklar');
  content.blocks.forEach((b, i) => {
    const tag = b.kind === 'heading' ? `H${b.level}` : b.kind.toUpperCase();
    const body = 'text' in b ? b.text : '';
    console.log(`${String(i).padStart(4)} ${tag.padEnd(9)} s.${String(b.srcPage + 1).padEnd(4)} ${body}`);
  });
}
