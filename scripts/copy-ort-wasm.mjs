// ONNX Runtime Web'in WASM'ını (yapay zekâ sesi, ~14 MB) public/ort/<paket sürümü>/ altına kopyalar. Uygulama motoru
// bu sürümlü adresten indirip cihazda saklar (src/reader/modes/piper/voices.ts): adres yalnızca paket sürümü değişince
// değişir, uygulama her güncellendiğinde motor yeniden inmez (Plan 13).
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkgDir = path.join(root, 'node_modules', 'onnxruntime-web');
const FILE = 'ort-wasm-simd-threaded.wasm';

if (!existsSync(pkgDir)) {
  console.warn('onnxruntime-web bulunamadı, kopyalama atlandı');
  process.exit(0);
}
const { version } = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
const base = path.join(root, 'public', 'ort');
// Eski sürümlerin klasörleri yayına girmesin
if (existsSync(base))
  for (const dir of readdirSync(base))
    if (dir !== version) rmSync(path.join(base, dir), { recursive: true, force: true });
const out = path.join(base, version);
mkdirSync(out, { recursive: true });
copyFileSync(path.join(pkgDir, 'dist', FILE), path.join(out, FILE));
console.log(`ONNX Runtime WASM kopyalandı → public/ort/${version}/${FILE}`);
