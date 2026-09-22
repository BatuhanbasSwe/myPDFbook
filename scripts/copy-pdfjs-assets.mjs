// pdf.js'in tarayıcıda ihtiyaç duyduğu dosyaları public/pdfjs altına kopyalar:
// cmaps (Asya fontları), standard_fonts (gömülmemiş fontlar), wasm (JPX/JBIG2 taranmış görüntüler), iccs (renk profilleri).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'node_modules', 'pdfjs-dist');
const out = path.join(root, 'public', 'pdfjs');

if (!existsSync(src)) {
  console.warn('pdfjs-dist bulunamadı, kopyalama atlandı');
  process.exit(0);
}
mkdirSync(out, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  cpSync(path.join(src, dir), path.join(out, dir), { recursive: true });
}
console.log('pdf.js varlıkları kopyalandı → public/pdfjs');
