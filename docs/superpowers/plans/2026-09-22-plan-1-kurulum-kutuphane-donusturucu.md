# Plan 1 — Kurulum, Kütüphane ve PDF→Metin Dönüştürücü

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Hedef:** Kullanıcı PDF'i uygulamaya ekler. Uygulama dosyayı saklar, kapak üretir ve PDF'i başlık/paragraf/bölüm yapısıyla metne dönüştürür. Kitap kütüphanede kartıyla görünür. Açılınca dönüştürülmüş metin, temalı basit bir kaydırmalı okuma ekranında okunur. "Orijinal sayfa" ile PDF'in aslı da görülebilir.

**Mimari:** Dönüştürücü (`src/convert/`) DOM'a ve pdf.js'e bağımlı değildir. `PdfSource` arayüzü üzerinden çalışır ve Node'da gerçek PDF'lerle test edilir. pdf.js'e özel kod `src/pdf/` altında toplanır. Veriler Dexie (IndexedDB) ile yalnızca cihazda tutulur. Arayüz React 19 + Tailwind 4 ile yazılır. Kitap görünümü (sayfa çevirme) Plan 2'de gelecek; bu plandaki kaydırmalı okuma ekranı geçicidir.

**Teknoloji:** Vite 8, React 19.3, TypeScript 6.0, Tailwind 4.3, react-router 8.4, Dexie 4.4, pdfjs-dist 6.3 (legacy build), Vitest 5, Playwright 1.63, pnpm 10, tsx.

**Tasarım:** `docs/superpowers/specs/2026-09-22-mypdfbook-design.md`

**Plan sırası:** Plan 1 (bu belge) → Plan 2: cümle dizini, heceleme, sayfalayıcı, kitap görünümü (kitap/slayt/efektsiz motorlar, dokunma/kaydırma/düğmeler), tipografi ayarları → Plan 3: odak modu, hızlı okuma, oturum kaydı, PWA.

---

## Doğrulanmış teknik notlar (planı yazarken denendi)
- pdf.js legacy build Node 25'te ek ayar gerekmeden çalışıyor (sahte worker kendiliğinden devreye giriyor).
- Chromium'un `page.pdf({ tagged: true, outline: true })` çıktısında h1/h2'lerden PDF içindekiler yapısı üretiliyor. Türkçe karakterler doğru çıkıyor.
- pdf.js metin parçaları kelime ortasından bölünebiliyor (`"ışık"` + `"ları"`). Parçalar arasına boşluk koyup koymama kararı, aradaki mesafeye göre verilmeli.
- Satır sonu tireleri iki biçimde geliyor: ayrı bir `"-"` parçası ya da kelimenin sonunda `"kita-"`.
- `fake-indexeddb` Node'da Blob saklıyor. Dexie'de `'convert.progress'` gibi anahtar yolu güncellemeleri çalışıyor.
- react-router 8: `BrowserRouter`, `Routes`, `Route`, `Link`, `useParams` hâlâ `react-router`'dan geliyor.
- typescript-eslint `typescript <6.1` istiyor. Bu yüzden TypeScript `~6.0.3` sürümüne sabitlendi.
- eslint-plugin-react-hooks 7: flat config `reactHooks.configs.flat.recommended`.
- pdfjs-dist 6'da `PDFDocumentProxy.destroy()` yok; belge `doc.loadingTask.destroy()` ile kapatılır.
- pdf.js 6 yükleme seçenekleri: `cMapUrl`, `standardFontDataUrl`, `wasmUrl`, `iccUrl`. Bu dosyalar `public/pdfjs/` altına kopyalanır.

## Uygulama sırasında incelemeyle yapılan değişiklikler
Görev metinleri planın ilk hâlidir; aşağıdaki düzeltmeler kod incelemesinden sonra commit'lendi (ayrıntı git geçmişinde).
- Task 2: fixture üreticisinde tarayıcı `try/finally` ile kapanır.
- Task 3: özel karakterler kaçış dizisiyle; `countWords` kıvrık kesme işaretini (’) tanır.
- Task 5: Roma rakamı sayfa numaraları i/v/x ile sınırlı ("mi.", "dil" silinmesin); rakamları farklı tekrar eden dipnotlar filigran sayılmaz.
- Task 6: dipnot bölgesi = sayfa sonundaki kesintisiz küçük punto dizisi (üstünde gövde satırı, sayfanın alt kısmında); "ON BİRİNCİ … YÜZÜNCÜ BÖLÜM" tanınır; paragraf satır parçalarıyla doğrusal sürede kurulur.
- Task 7: PDF içindekiler yalnızca başlıklara oturuyorsa ya da başlıklardan çıkan listeden kısa değilse kullanılır; art arda alt başlıklar bölüm adına eklenir.
- Task 8: sayfa boyutu `getViewport({ scale: 1, rotation: 0 })` ile (metinle aynı uzay); görsel kontrolünde ilerleme bildirilir.
- Task 9: Node'da pdf.js varlık yolları ileri eğik çizgili dosya yolu olarak verilir.
- Task 10: kapaklar ayrı `covers` tablosunda (`BookRecord.cover` yok); `BOOK_TABLES` listesi; `markOpened` işlem içinde. Task 12 ve Task 15 metinleri buna göre güncellendi.
- Task 11: dosya adındaki sondaki site etiketi atılır; yalnızca iki parçalı "Yazar - Kitap" bölünür; sayı olan ilk parça başlıktır.
- Task 12: içe aktarma dosyayı bir kez okuyup bırakır (Blob = dosyanın kendisi); dönüştürme sürerken silinen kitaba içerik yazılmaz; `resumeConversions` tek tur, asla reddetmez; aynı dosyanın eşzamanlı ikinci içe aktarması "zaten var" döner; metadata/ilk sayfa hatası kitabı reddetmez. Task 13'teki `loadPdf` açılamayan belgenin worker'ını yok eder.
- Task 13: `isEvalSupported` seçeneği kaldırıldı (pdfjs-dist 6'da yok); `renderPageToBlob` hata olsa da canvas'ı bırakır ve iOS canvas alan sınırına (16 MP) göre ölçeği küçültür. pdf.js worker dosyası `dist`'e ancak arayüz bu modülleri içe aktarınca girer; kontrolü Task 15'te.
- Task 15: PDF verisi IndexedDB'de Blob değil ArrayBuffer olarak saklanır (`FileRecord.data`); WebKit/Safari bazı durumlarda (gizli sekme, bazı iOS sürümleri, Playwright WebKit) Blob yazamıyor. Task 16'daki `usePdfDocument` buna göre güncellendi.
- Task 15 (kod incelemesi): içe aktarma dönüştürmeyi beklemez. Belge kayıttan önce kapanır, dönüştürmeler tek bir kuyrukta sırayla ve IndexedDB'deki kopyadan yapılır; böylece çoklu seçimde bütün dosyalar hemen kaydedilir ve bellekte fazladan kopya kalmaz. Her dosyanın sonucu kendi adıyla bildirilir, beklenmeyen hatalar konsola yazılır. Kota hatasında kullanım bilgisi gösterilir. Canlı bölge (`role="status"`) sayfada hep durur. Silme düğmesi 44 px, hata rengi temalı `--danger` (kontrast ≥ 4,5:1). Sayfa içi sürüklemeler dosya bırakma sayılmaz. `persist()` yalnızca izin yoksa istenir. e2e sunucusu yeniden kullanılmaz: port doluysa açık hata verir.
- Task 16 (kod incelemesi):
  - Kaldığı yer, yazı tipi yüklendikten sonra yapışkan başlık çubuğunun altına getirilir; kitabın başında kaydırma yapılmaz.
  - Okunan blok, çubuğun altında en az 8 px görünen ilk bloktur. Bu, konumun her açılışta bir paragraf geri kaymasını önler; yer değişmedikçe kayıt yazılmaz. Bekleyen kayıt kapanışta, `pagehide`'da ve `visibilitychange`'de hemen yazılır.
  - Orijinal sayfa penceresi açıkken sayfa kaydırılamaz (`html:has(dialog[open])`), pencerenin adı var ve eski sayfanın görseli gösterilmez.
  - `PageImage` ekrana yaklaşınca çizer, uzaklaşınca bırakır. Çizimler tek bir kuyruktan geçer (`enqueueRender`); sırası gelmeden uzaklaşan sayfa hiç çizilmez.
  - PDF yalnızca gerekince açılır (görsel sayfa varsa ya da orijinal sayfa istenince).
  - `ReaderRoute`, kitap değişince okuyucuyu `key` ile yeniden kurar. `ScrollReader` `memo`'ludur.
  - `markOpened` yalnızca dönüştürmesi bitmiş kitapta çalışır.
  - Yeni e2e testi konum geri yüklemeyi sınar; toplam e2e: 7 test × 3 cihaz = 21.
- Task 17: incelemelerle testler çoğaldığı için beklenen sayılar değişti: Vitest'te 13 dosya / 95 test, Playwright'ta 21 test (7 × 3 cihaz). `pnpm format` 33 dosyayı biçimlendirdi.
- Son bütün dal incelemesi:
  - Her PDF kendi worker'ıyla açılır; `closePdf` worker'ın yanıtını en fazla 3 sn bekler, sonra worker'ı sonlandırır (`loadingTask.destroy()` yanıt vermeyen worker'da hiç bitmiyordu).
  - Belge kapanışı içe aktarmayı ve dönüştürme kuyruğunu hiç bekletmez. Takılma sayacı açılışı da kapsar; durdurulan dönüştürme bir sonraki ilerlemede kendini keser.
  - `convert.attempts`: yarıda kalan (sekmesi kapanan ya da çöken) dönüştürme en fazla 3 kez denenir, sonra "dönüştürülemedi" olur. Kartta "Tekrar dene" düğmesi var ve hata mesajı düğmenin ipucunda (title) görünür. Hata metni tek yerden yazılır.
  - Çizim kuyruğunun takılma süresi iş başlayınca başlar.
  - `extractLines` metni NFC'ye çevirir. Tasarımda NFKC yazıyordu; NFKC "…"yu "..."ya, "½"yi "1⁄2"ye çevirdiği için NFC seçildi.
  - Başlık ve dipnot metninden de yumuşak tire temizlenir.
  - Yarım dönüştürmeler uygulama açılınca sürdürülür (`App`). Dili "other" olan kitapta `lang` özniteliği verilmez.
  - `OpenedPdf` türü `src/pdf/pdfSource.ts`'e taşındı.
  - Şema tabloları ile `BOOK_TABLES` testle eşlendi.
  - README'ye e2e tarayıcı kurulumu eklendi; `packageManager`/`engines` tanımlandı.
- Plan 2'ye notlar (son incelemeden):
  - Yeniden dönüştürme yolu yok. `CONVERTER_VERSION` hiç karşılaştırılmıyor.
    - Eski sürümlü kitaplar yeniden sıraya girmeli ve yeniden dönüşürken eski içerik okunabilir kalmalı.
    - `ProgressRecord`'a (ve vurgulara) `contentVersion` ya da `srcPage` + alıntı eklenmeli ki blok numaraları yeniden eşlenebilsin.
  - Paragrafın içindeki sayfa geçişleri (`srcPageEnd` ya da sayfa sınırı ofsetleri) şu an yok. Sayfalı görünümde "Orijinal sayfa" ve sayfa bazlı yüzde için gerekli; eklenmesi sürüm artışı ister.
  - Tipografi ayarları ilk sayfalamada eşzamanlı okunmalı: tema gibi localStorage + `useSyncExternalStore`. Zustand kurulu değil.
  - `test:browser` için `@vitest/browser` ve Playwright sağlayıcısı gerekir.
  - Yalnızca Locator saklanmalı, cümle numarası saklanmamalı: `Intl.Segmenter` tarayıcıdan tarayıcıya farklı bölebilir.
- Plan 3'e ek notlar (son incelemeden):
  - PWA/Workbox varsayılanları `.mjs` dosyalarını önbelleğe almaz. pdf.js worker'ı ve `public/pdfjs` (~3,8 MB) açıkça eklenmeli.
  - Literata'dan yalnızca latin ve latin-ext alt kümeleri alınmalı.
  - Şifre penceresi `type="password"` olmalı.
  - CSP eklenirse ön boyama betiği için hash gerekir.
  - Tema renkleri 4 yerde tanımlı (index.html, theme.ts, ThemePicker, index.css); bunları eşleyen bir test eklenmeli.
- Plan 2'ye notlar: ilerleme `offset`'i de hesaba katsın ve son sayfada %100 kaydedilsin (şimdi blok başı oranı, bitince ~%99 ya da kısa kitapta daha az); sahne arası ağırlığı; görsel sayfa yer tutucusunun oranı sayfanın kendi oranından; tek paylaşılan IntersectionObserver; `page@genişlik` anahtarlı LRU görsel önbelleği (8–12 adet).
- Plan 3'e notlar: pdf.js'i rota bazlı tembel yükleme (ana paket ~870 kB); `window.confirm`/`prompt` yerine uygulama içi pencere; aynı PDF yeniden eklenince tasarımdaki gibi kitap doğrudan açılsın (şimdilik "zaten kütüphanende" mesajı).
- Gerçek kitaplarla ayar listesi (Faz 1 sonu/Faz 2): büyük ilk harf (drop cap), iki sütun, sola yaslı metin, girintisiz kitaplar, epigraflar, tek satırlık bölüm numaraları, %90 puntolu dipnotlar, sayfa geçen dipnotlar.

## Dosya haritası
| Dosya | Sorumluluk |
|---|---|
| `src/convert/types.ts` | İçerik modeli: `RawTextItem`, `Line`, `PageLines`, `Block`, `Chapter`, `BookContent`, `Locator`, `PdfSource` |
| `src/convert/text.ts` | Satır birleştirme (tire), Türkçe karakter onarımı, dil tahmini, kelime sayımı |
| `src/convert/extractLines.ts` | pdf.js metin parçaları → satırlar |
| `src/convert/furniture.ts` | Gövde puntosu; sayfa numarası, üst/alt bilgi, filigran temizliği |
| `src/convert/blocks.ts` | Satırlar → başlık/paragraf/dipnot/sahne arası/sayfa görseli blokları |
| `src/convert/chapters.ts` | Bölüm listesi (PDF içindekiler veya başlıklar) |
| `src/convert/convertPdf.ts` | Dönüştürme akışı |
| `src/pdf/pdfSource.ts` | pdf.js belgesi → `PdfSource` (Node + tarayıcı) |
| `src/pdf/pdfjs.ts` | Tarayıcıda pdf.js yükleme (worker + varlıklar) |
| `src/pdf/renderPage.ts` | Sayfayı JPEG Blob / data URL olarak çizme |
| `src/pdf/openPdf.ts` | Tarayıcı için `OpenedPdf` üretimi |
| `src/db/db.ts`, `src/db/books.ts` | Dexie şeması ve kitap işlemleri |
| `src/import/hash.ts`, `fileName.ts`, `importBook.ts`, `deps.ts` | İçe aktarma akışı |
| `src/app/theme.ts`, `ThemePicker.tsx`, `App.tsx` | Tema ve yönlendirme |
| `src/library/*` | Kütüphane ekranı |
| `src/reader/*` | Geçici kaydırmalı okuma ekranı, orijinal sayfa penceresi |
| `scripts/make-fixtures.ts` | Test PDF'lerini üretir |
| `scripts/convert-pdf.ts` | Gerçek bir PDF'in dönüşüm dökümünü yazdırır |
| `scripts/copy-pdfjs-assets.mjs` | pdf.js varlıklarını `public/pdfjs`'e kopyalar |
| `tests/**` | Vitest (Node) testleri; `e2e/**` Playwright testleri |

---

### Task 1: Proje iskeleti ve araçlar

**Files:**
- Modify: `.gitignore`
- Create: `package.json`, `.gitattributes`, `.prettierrc.json`, `.prettierignore`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.test.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `index.html`, `scripts/copy-pdfjs-assets.mjs`, `src/main.tsx`, `src/app/App.tsx`, `src/styles/index.css`, `tests/setup.ts`

- [ ] **Step 1: `package.json` oluştur**

```json
{
  "name": "mypdfbook",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "dev:ipad": "vite --mode ipad --host",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b",
    "lint": "eslint .",
    "format": "prettier --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "fixtures": "tsx scripts/make-fixtures.ts",
    "convert": "tsx scripts/convert-pdf.ts",
    "postinstall": "node scripts/copy-pdfjs-assets.mjs"
  }
}
```

- [ ] **Step 2: Git ve biçim dosyalarını oluştur**

`.gitignore` (dosya zaten var ve yalnızca `.worktrees/` satırını içeriyor; tamamını şununla değiştir):
```
.worktrees/
node_modules/
dist/
public/pdfjs/
test-results/
playwright-report/
*.log
.DS_Store
```

`.gitattributes`:
```
* text=auto eol=lf
*.pdf binary
*.png binary
*.jpg binary
*.woff2 binary
```

`.prettierrc.json`:
```json
{ "singleQuote": true, "printWidth": 100 }
```

`.prettierignore`:
```
dist
public/pdfjs
tests/fixtures
pnpm-lock.yaml
docs
```

- [ ] **Step 3: TypeScript yapılandırması**

`tsconfig.json`:
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.test.json" }
  ]
}
```

`tsconfig.app.json`:
```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["vite/client"],
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "noEmit": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "isolatedModules": true,
    "moduleDetection": "force"
  },
  "include": ["src"]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "ES2023",
    "lib": ["ES2023", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "moduleDetection": "force"
  },
  "include": ["vite.config.ts", "vitest.config.ts", "playwright.config.ts", "scripts/**/*.ts", "e2e"]
}
```

`tsconfig.test.json`:
```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.test.tsbuildinfo",
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node", "vite/client"],
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "moduleDetection": "force"
  },
  "include": ["tests"]
}
```

- [ ] **Step 4: Vite, Vitest ve ESLint yapılandırması**

`vite.config.ts`:
```ts
import basicSsl from '@vitejs/plugin-basic-ssl';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `pnpm dev:ipad` → HTTPS + ağ erişimi. iPad'de crypto.subtle, service worker ve wake lock HTTPS ister.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), mode === 'ipad' && basicSsl()],
}));
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30_000,
  },
});
```

`tests/setup.ts`:
```ts
// Node'da IndexedDB yok; Dexie testleri için bellek içi uygulama.
import 'fake-indexeddb/auto';
```

`eslint.config.js`:
```js
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist', 'public/pdfjs', 'playwright-report', 'test-results', 'tests/fixtures']),
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
]);
```

- [ ] **Step 5: pdf.js varlık kopyalama betiği**

`scripts/copy-pdfjs-assets.mjs`:
```js
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
```

- [ ] **Step 6: HTML girişi, stiller ve iskelet uygulama**

`index.html`:
```html
<!doctype html>
<html lang="tr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#f7f3ea" />
    <title>mypdfbook</title>
    <script>
      // Tema, sayfa çizilmeden önce uygulanır (karanlık modda beyaz parlama olmasın).
      try {
        var t = localStorage.getItem('mypdfbook:theme') || 'system';
        if (t === 'system') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        document.documentElement.dataset.theme = t;
      } catch (e) {}
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/styles/index.css`:
```css
@import 'tailwindcss';

:root {
  --paper: #f7f3ea;
  --surface: #fffdf8;
  --ink: #1f1b16;
  --muted: #6b6257;
  --line: #e2d9c8;
  --accent: #9a5b2a;
  color-scheme: light;
}
:root[data-theme='sepia'] {
  --paper: #f1e4c6;
  --surface: #f7edd6;
  --ink: #4a3a26;
  --muted: #7c6a50;
  --line: #dac7a0;
  --accent: #8a4f22;
}
:root[data-theme='dark'] {
  --paper: #1b1a18;
  --surface: #252422;
  --ink: #ddd7cc;
  --muted: #9b9387;
  --line: #393631;
  --accent: #d9a46c;
  color-scheme: dark;
}
:root[data-theme='black'] {
  --paper: #000000;
  --surface: #111111;
  --ink: #c8c3ba;
  --muted: #858078;
  --line: #262626;
  --accent: #d9a46c;
  color-scheme: dark;
}

@theme inline {
  --color-paper: var(--paper);
  --color-surface: var(--surface);
  --color-ink: var(--ink);
  --color-muted: var(--muted);
  --color-line: var(--line);
  --color-accent: var(--accent);
}

@theme {
  --font-book: 'Literata Variable', Georgia, 'Times New Roman', serif;
}

html,
body {
  background: var(--paper);
  color: var(--ink);
}
body {
  margin: 0;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  -webkit-tap-highlight-color: transparent;
}
```

`src/app/App.tsx` (geçici; Task 15'te yönlendirme gelir):
```tsx
export function App() {
  return <main className="p-6 font-book">mypdfbook</main>;
}
```

`src/main.tsx`:
```tsx
import '@fontsource-variable/literata/index.css';
import './styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './app/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 7: Bağımlılıkları kur**

```bash
pnpm add react@19.3.0 react-dom@19.3.0 react-router@8.4.0 dexie@4.4.6 dexie-react-hooks@4.4.0 pdfjs-dist@6.3.289 lucide-react@1.47.0 @fontsource-variable/literata@5.3.0
pnpm add -D typescript@~6.0.3 vite@8.3.0 @vitejs/plugin-react@6.1.1 @vitejs/plugin-basic-ssl@2.3.0 tailwindcss@4.3.3 @tailwindcss/vite@4.3.3 @types/react@19.3.0 @types/react-dom@19.3.0 @types/node@26.6.2 vitest@5.0.1 fake-indexeddb@6.2.5 @playwright/test@1.63.0 tsx@4.23.15 eslint@10.11.0 @eslint/js@10.0.1 typescript-eslint@8.70.1 eslint-plugin-react-hooks@7.1.1 globals@17.12.0 prettier@3.9.8
node scripts/copy-pdfjs-assets.mjs
pnpm exec playwright install chromium webkit
```
Beklenen: son iki komuttan önce `pdf.js varlıkları kopyalandı → public/pdfjs` çıktısı görülür. `public/pdfjs/` altında `cmaps`, `standard_fonts`, `wasm`, `iccs` klasörleri oluşur.

- [ ] **Step 8: Doğrula**

```bash
pnpm typecheck
pnpm build
pnpm lint
pnpm test --passWithNoTests
```
Beklenen: dört komut da hatasız biter. `dist/index.html` oluşur. Vitest "No test files found" der ve 0 koduyla çıkar.

- [ ] **Step 9: Commit**

```bash
git add -A
git add --renormalize .
git commit -m "chore: Vite + React + TS iskeleti, Tailwind, Vitest, ESLint, Prettier"
```

---

### Task 2: Test PDF'leri (fixture) üreticisi

**Files:**
- Create: `scripts/make-fixtures.ts`
- Create (üretilir): `tests/fixtures/novel-tr.pdf`, `legacy-encoding-tr.pdf`, `english.pdf`, `scanned.pdf`, `mixed.pdf`

- [ ] **Step 1: Üreticiyi yaz**

`scripts/make-fixtures.ts`:
```ts
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
```

- [ ] **Step 2: Fixture'ları üret**

Run: `pnpm fixtures`
Beklenen:
```
✓ novel-tr.pdf
✓ legacy-encoding-tr.pdf
✓ english.pdf
✓ scanned.pdf
✓ mixed.pdf
```

- [ ] **Step 3: Tip kontrolü ve commit**

```bash
pnpm typecheck
git add scripts/make-fixtures.ts tests/fixtures
git commit -m "test: Chromium ile Türkçe/İngilizce/taranmış test PDF'leri"
```

---

### Task 3: İçerik modeli ve metin yardımcıları

**Files:**
- Create: `src/convert/types.ts`, `src/convert/text.ts`
- Test: `tests/convert/text.test.ts`

- [ ] **Step 1: İçerik modelini yaz**

`src/convert/types.ts`:
```ts
/** pdf.js TextItem'ın kullandığımız alt kümesi. transform: [a, b, c, d, e, f]; (e, f) taban çizgisinin sol noktası, y yukarı doğru artar. */
export interface RawTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName?: string;
  hasEOL?: boolean;
}

export interface PageText {
  width: number;
  height: number;
  items: RawTextItem[];
}

/** PDF içindekiler kaydı (sayfa numarası çözülmüş). level: 1 = en üst düzey. */
export interface OutlineEntry {
  title: string;
  pageIndex: number;
  level: number;
}

/** Dönüştürücünün PDF'ten ihtiyaç duyduğu her şey. pdf.js'e bağımlılık yalnızca src/pdf/ altındadır. */
export interface PdfSource {
  numPages: number;
  getPageText(pageIndex: number): Promise<PageText>;
  hasImages(pageIndex: number): Promise<boolean>;
  getOutline(): Promise<OutlineEntry[]>;
  getMetadata(): Promise<{ title?: string; author?: string }>;
}

/** Sayfadaki tek satır (PDF birimi: pt). */
export interface Line {
  text: string;
  x0: number;
  x1: number;
  /** taban çizgisi; y yukarı doğru artar */
  y: number;
  /** punto */
  size: number;
}

export interface PageLines {
  pageIndex: number;
  width: number;
  height: number;
  /** yukarıdan aşağıya sıralı */
  lines: Line[];
}

export type Block =
  | { kind: 'heading'; level: 1 | 2; text: string; srcPage: number }
  | { kind: 'para'; text: string; srcPage: number }
  | { kind: 'note'; text: string; srcPage: number }
  | { kind: 'break'; srcPage: number }
  | { kind: 'pageImage'; srcPage: number };

export interface Chapter {
  title: string;
  /** blocks dizisindeki başlangıç indeksi */
  block: number;
  level: number;
}

export type Lang = 'tr' | 'en' | 'other';

export interface BookContent {
  version: number;
  lang: Lang;
  blocks: Block[];
  chapters: Chapter[];
  /** görsel olarak gösterilen (metni olmayan) PDF sayfaları */
  textlessPages: number[];
  totalWords: number;
}

/** Kitap içinde konum: blok indeksi + blok metnindeki karakter. Font/ekran değişince de geçerli kalır. */
export interface Locator {
  block: number;
  offset: number;
}

/** Dönüştürücü kuralları değişince artırılır; eski kitaplar yeniden dönüştürülebilir. */
export const CONVERTER_VERSION = 1;
```

- [ ] **Step 2: Başarısız testleri yaz**

`tests/convert/text.test.ts`:
```ts
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
    expect(joinLines('değerlen\u2010', 'dirme')).toBe('değerlendirme');
  });
  it('yumuşak tireyi kaldırır', () => {
    expect(joinLines('karşılaş\u00AD', 'tırma')).toBe('karşılaştırma');
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
    expect(finalizeText('  kar\u00ADşı   ya ')).toBe('karşı ya');
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
```

- [ ] **Step 3: Testin başarısız olduğunu gör**

Run: `pnpm test tests/convert/text.test.ts`
Beklenen: FAIL — `Cannot find module '../../src/convert/text'` / "Failed to resolve import".

- [ ] **Step 4: Uygulamayı yaz**

`src/convert/text.ts`:
```ts
import type { Lang } from './types';

const LINE_END_HYPHEN = /\p{L}[-\u2010]$/u;

/** İki satırı birleştirir; satır sonunda tireyle bölünmüş kelimeleri yeniden birleştirir. */
export function joinLines(prev: string, next: string): string {
  if (prev.endsWith('\u00AD')) return prev.slice(0, -1) + next;
  if (LINE_END_HYPHEN.test(prev)) {
    // küçük harfle devam ediyorsa heceleme tiresidir: "kita-" + "bı" → "kitabı"
    if (/^\p{Ll}/u.test(next)) return prev.slice(0, -1) + next;
    // büyük harf/rakamla devam ediyorsa gerçek tiredir: "Kuzey-" + "Güney" → "Kuzey-Güney"
    return prev + next;
  }
  return `${prev} ${next}`;
}

/** Blok metnini son haline getirir: yumuşak tireleri siler, boşlukları sadeleştirir. */
export function finalizeText(text: string): string {
  return text.replace(/\u00AD/g, '').replace(/\s+/g, ' ').trim();
}

const BROKEN_TR = /[ýþðÝÞÐ]/g;
const PROPER_TR = /[ışğİŞĞ]/g;
const TR_MAP: Record<string, string> = { ý: 'ı', þ: 'ş', ð: 'ğ', Ý: 'İ', Þ: 'Ş', Ð: 'Ğ' };

/** Yanlış kodlanmış Türkçe fontlarda ı/ş/ğ harfleri ý/þ/ð olarak çıkar. */
export function needsTurkishRepair(sample: string): boolean {
  const broken = sample.match(BROKEN_TR)?.length ?? 0;
  const proper = sample.match(PROPER_TR)?.length ?? 0;
  return broken >= 5 && broken > proper;
}

export function repairTurkish(text: string): string {
  return text.replace(BROKEN_TR, (c) => TR_MAP[c] ?? c);
}

const TR_WORDS = new Set(['ve', 'bir', 'bu', 'da', 'de', 'için', 'ile', 'çok', 'ama', 'gibi', 'daha', 'ne', 'ben', 'sen', 'değil', 'kadar', 'sonra', 'olarak', 'diye', 'şey']);
const EN_WORDS = new Set(['the', 'and', 'of', 'to', 'in', 'is', 'that', 'it', 'was', 'for', 'on', 'with', 'as', 'he', 'she', 'his', 'you', 'not', 'had', 'at']);

/** Sık geçen kelimelere bakarak kaba dil tahmini. */
export function detectLanguage(sample: string): Lang {
  const trWords = sample.toLocaleLowerCase('tr').match(/\p{L}+/gu) ?? [];
  const enWords = sample.toLowerCase().match(/\p{L}+/gu) ?? [];
  let tr = trWords.filter((w) => TR_WORDS.has(w)).length;
  const en = enWords.filter((w) => EN_WORDS.has(w)).length;
  if ((sample.match(/[ığşİĞŞ]/g)?.length ?? 0) > 3) tr += 5;
  if (tr + en < 3) return 'other';
  return tr >= en ? 'tr' : 'en';
}

export function countWords(text: string): number {
  return text.match(/\p{L}[\p{L}\p{N}'’-]*/gu)?.length ?? 0;
}
```

- [ ] **Step 5: Testlerin geçtiğini gör**

Run: `pnpm test tests/convert/text.test.ts`
Beklenen: PASS (14 test).

- [ ] **Step 6: Commit**

```bash
git add src/convert/types.ts src/convert/text.ts tests/convert/text.test.ts
git commit -m "feat(convert): içerik modeli ve metin yardımcıları (tire, Türkçe onarım, dil)"
```

---

### Task 4: Metin parçalarından satır çıkarma

**Files:**
- Create: `src/convert/extractLines.ts`
- Test: `tests/convert/extractLines.test.ts`

- [ ] **Step 1: Başarısız testleri yaz**

`tests/convert/extractLines.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { extractLines } from '../../src/convert/extractLines';
import type { RawTextItem } from '../../src/convert/types';

const item = (str: string, x: number, y: number, width: number, size = 10): RawTextItem => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width,
  height: size,
});
const page = (items: RawTextItem[]) => ({ width: 400, height: 600, items });

describe('extractLines', () => {
  it('aynı taban çizgisindeki parçaları tek satırda, yukarıdan aşağıya sıralar', () => {
    const { lines } = extractLines(
      0,
      page([item('ikinci satır', 50, 480, 60), item('Birinci', 50, 500, 35), item('satır', 90, 500, 25)]),
    );
    expect(lines.map((l) => l.text)).toEqual(['Birinci satır', 'ikinci satır']);
  });

  it('bitişik parçaları boşluksuz birleştirir (kelime ortası bölünme)', () => {
    const { lines } = extractLines(
      0,
      page([item('Sabahın ilk ışık', 50, 500, 70), item('ları kasa', 120, 500, 40), item('banın', 160, 500, 25)]),
    );
    expect(lines[0]?.text).toBe('Sabahın ilk ışıkları kasabanın');
  });

  it('üst simgeyi (dipnot işareti) aynı satıra alır', () => {
    const { lines } = extractLines(
      0,
      page([item('tutuyordu.', 50, 500, 50), item('¹', 100.5, 503.5, 3, 6), item('Sonra', 60, 485, 30)]),
    );
    expect(lines.map((l) => l.text)).toEqual(['tutuyordu.¹', 'Sonra']);
  });

  it('döndürülmüş metni ve boş parçaları atlar', () => {
    const rotated: RawTextItem = { str: 'kenar yazısı', transform: [0, 10, -10, 0, 20, 300], width: 80, height: 10 };
    const { lines } = extractLines(0, page([rotated, item('', 50, 500, 0), item(' ', 45, 500, 3), item('metin', 50, 500, 25)]));
    expect(lines.map((l) => l.text)).toEqual(['metin']);
  });

  it('satır ölçülerini hesaplar', () => {
    const { lines } = extractLines(0, page([item('Başlık', 100, 520, 80, 16), item('metin', 40, 500, 30, 10)]));
    expect(lines[0]).toMatchObject({ x0: 100, x1: 180, y: 520, size: 16 });
    expect(lines[1]).toMatchObject({ x0: 40, x1: 70, y: 500, size: 10 });
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu gör**

Run: `pnpm test tests/convert/extractLines.test.ts`
Beklenen: FAIL — modül bulunamadı.

- [ ] **Step 3: Uygulamayı yaz**

`src/convert/extractLines.ts`:
```ts
import type { Line, PageLines, PageText, RawTextItem } from './types';

interface Positioned {
  str: string;
  x: number;
  y: number;
  w: number;
  size: number;
}

const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;

function toPositioned(item: RawTextItem): Positioned | null {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform;
  // döndürülmüş (dikey) metin kitap akışına ait değildir
  if (Math.abs(a) < 1e-6 || Math.abs(b) > Math.abs(a) * 0.1) return null;
  const str = item.str.replace(INVISIBLE, '').replace(/\u00A0/g, ' ');
  if (str.trim() === '') return null;
  const size = Math.hypot(c, d) || item.height;
  if (!(size > 0)) return null;
  return { str, x: e, y: f, w: item.width, size };
}

function buildLine(group: Positioned[]): Line | null {
  group.sort((p, q) => p.x - q.x);
  let text = '';
  let end = -Infinity;
  let dominant = group[0];
  for (const it of group) {
    // aradaki boşluk yazı boyunun %15'inden büyükse kelime arasıdır; değilse aynı kelimenin parçasıdır
    if (text !== '' && it.x - end > 0.15 * it.size && !text.endsWith(' ') && !it.str.startsWith(' ')) {
      text += ' ';
    }
    text += it.str;
    end = Math.max(end, it.x + it.w);
    if (it.str.length > dominant.str.length) dominant = it;
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  return { text, x0: group[0].x, x1: end, y: dominant.y, size: dominant.size };
}

/** pdf.js metin parçalarını taban çizgisine göre satırlara toplar (yukarıdan aşağıya). */
export function extractLines(pageIndex: number, page: PageText): PageLines {
  const items = page.items.map(toPositioned).filter((p): p is Positioned => p !== null);
  items.sort((p, q) => q.y - p.y || p.x - q.x);
  const groups: Positioned[][] = [];
  for (const it of items) {
    const group = groups[groups.length - 1];
    const ref = group?.[0];
    if (group && ref && Math.abs(ref.y - it.y) <= 0.5 * Math.max(ref.size, it.size)) group.push(it);
    else groups.push([it]);
  }
  const lines = groups.map((g) => buildLine(g)).filter((l): l is Line => l !== null);
  return { pageIndex, width: page.width, height: page.height, lines };
}
```

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `pnpm test tests/convert/extractLines.test.ts`
Beklenen: PASS (5 test).

- [ ] **Step 5: Commit**

```bash
git add src/convert/extractLines.ts tests/convert/extractLines.test.ts
git commit -m "feat(convert): pdf.js metin parçalarından satır çıkarma"
```

---

### Task 5: Gövde puntosu ve sayfa süsü temizliği

**Files:**
- Create: `src/convert/furniture.ts`
- Test: `tests/convert/furniture.test.ts`

- [ ] **Step 1: Başarısız testleri yaz**

`tests/convert/furniture.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { bodyFontSize, stripPageFurniture } from '../../src/convert/furniture';
import type { Line, PageLines } from '../../src/convert/types';

const line = (text: string, y: number, size = 10, x0 = 40, x1 = 380): Line => ({ text, x0, x1, y, size });
const page = (pageIndex: number, lines: Line[]): PageLines => ({ pageIndex, width: 420, height: 595, lines });
const bodyLines = (n: number, top = 520) =>
  Array.from({ length: n }, (_, i) => line(`Gövde metni satır ${i} ve devamı burada yer alıyor.`, top - i * 15));
const texts = (pages: PageLines[]) => pages.flatMap((p) => p.lines.map((l) => l.text));

describe('bodyFontSize', () => {
  it('en çok karakter taşıyan puntoyu seçer', () => {
    expect(bodyFontSize([page(0, [line('BAŞLIK', 560, 16), ...bodyLines(5)])])).toBe(10);
  });
});

describe('stripPageFurniture', () => {
  it('sayfa numaralarını siler', () => {
    const pages = [
      page(0, [...bodyLines(3), line('12', 25, 8, 205, 215)]),
      page(1, [...bodyLines(3), line('- 13 -', 25, 8, 200, 220)]),
    ];
    const out = texts(stripPageFurniture(pages, 10));
    expect(out).not.toContain('12');
    expect(out).not.toContain('- 13 -');
    expect(out).toHaveLength(6);
  });

  it('3+ sayfada tekrar eden üst/alt bilgiyi siler (rakamlar farklı olsa da)', () => {
    const pages = [0, 1, 2].map((i) => page(i, [...bodyLines(3), line(`www.ornekkitap.com - s${i + 1}`, 12, 7)]));
    expect(texts(stripPageFurniture(pages, 10)).some((t) => t.includes('ornekkitap'))).toBe(false);
  });

  it('üst bölgedeki küçük puntolu sayfa başlığını siler, gövdeyi ve dipnotu korur', () => {
    const pages = [page(0, [line('KAYIP ŞEHRİN IŞIKLARI', 565, 8, 150, 270), ...bodyLines(3), line('¹ Bu bir dipnottur.', 45, 7.5)])];
    const out = texts(stripPageFurniture(pages, 10));
    expect(out).not.toContain('KAYIP ŞEHRİN IŞIKLARI');
    expect(out).toContain('¹ Bu bir dipnottur.');
    expect(out).toHaveLength(4);
  });

  it('üst bölgedeki büyük puntolu başlığa dokunmaz', () => {
    const pages = [page(0, [line('BİRİNCİ BÖLÜM', 560, 16, 150, 270), ...bodyLines(3)])];
    expect(stripPageFurniture(pages, 10)[0]?.lines[0]?.text).toBe('BİRİNCİ BÖLÜM');
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu gör**

Run: `pnpm test tests/convert/furniture.test.ts`
Beklenen: FAIL — modül bulunamadı.

- [ ] **Step 3: Uygulamayı yaz**

`src/convert/furniture.ts`:
```ts
import type { PageLines } from './types';

const PAGE_NUMBER = /^[\s\-–—.([]*(\d{1,4}|[ivxlcdm]{1,7})[\s\-–—.)\]]*$/i;
const PAGE_LABEL = /^(sayfa|page|s\.)\s*\d{1,4}$/i;
const TOP_ZONE = 0.12;
const BOTTOM_ZONE = 0.1;

/** Kitabın gövde puntosu: en çok karakterin yazıldığı punto (0,5 pt hassasiyetle). */
export function bodyFontSize(pages: PageLines[]): number {
  const chars = new Map<number, number>();
  for (const p of pages) {
    for (const l of p.lines) {
      const key = Math.round(l.size * 2) / 2;
      chars.set(key, (chars.get(key) ?? 0) + l.text.length);
    }
  }
  let best = 10;
  let bestCount = -1;
  for (const [size, count] of chars) {
    if (count > bestCount) {
      best = size;
      bestCount = count;
    }
  }
  return best;
}

function furnitureKey(text: string, isTop: boolean): string {
  const norm = text
    .toLocaleLowerCase('tr')
    .replace(/\d+/g, '#')
    .replace(/[^\p{L}#]+/gu, ' ')
    .trim();
  return `${isTop ? 'T' : 'B'}:${norm}`;
}

/** Sayfa numaralarını, 3+ sayfada tekrar eden üst/alt bilgileri (filigran dahil) ve küçük puntolu sayfa başlıklarını çıkarır. */
export function stripPageFurniture(pages: PageLines[], bodySize: number): PageLines[] {
  // Aday: sayfanın ilk/son iki satırından üst ya da alt bölgede olanlar
  const candidates = pages.map((p) => {
    const n = p.lines.length;
    return [...new Set([0, 1, n - 2, n - 1])].filter((i) => {
      const l = p.lines[i];
      return l !== undefined && (l.y >= p.height * (1 - TOP_ZONE) || l.y <= p.height * BOTTOM_ZONE);
    });
  });

  const counts = new Map<string, number>();
  pages.forEach((p, pi) => {
    for (const i of candidates[pi]) {
      const l = p.lines[i];
      const key = furnitureKey(l.text, l.y > p.height / 2);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  });

  return pages.map((p, pi) => {
    const remove = new Set<number>();
    for (const i of candidates[pi]) {
      const l = p.lines[i];
      const text = l.text.trim();
      const isTop = l.y > p.height / 2;
      const key = furnitureKey(text, isTop);
      if (PAGE_NUMBER.test(text) || PAGE_LABEL.test(text)) remove.add(i);
      else if ((counts.get(key) ?? 0) >= 3 && key.length > 7) remove.add(i);
      else if (isTop && i <= 1 && l.size <= bodySize * 0.92 && text.length <= 80) remove.add(i);
    }
    return remove.size ? { ...p, lines: p.lines.filter((_, i) => !remove.has(i)) } : p;
  });
}
```

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `pnpm test tests/convert/furniture.test.ts`
Beklenen: PASS (5 test).

- [ ] **Step 5: Commit**

```bash
git add src/convert/furniture.ts tests/convert/furniture.test.ts
git commit -m "feat(convert): gövde puntosu, sayfa numarası/üst bilgi/filigran temizliği"
```

---

### Task 6: Satırlardan bloklar (paragraf, başlık, dipnot, sahne arası)

**Files:**
- Create: `src/convert/blocks.ts`
- Test: `tests/convert/blocks.test.ts`

- [ ] **Step 1: Başarısız testleri yaz**

`tests/convert/blocks.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildBlocks } from '../../src/convert/blocks';
import type { Block, Line, PageLines } from '../../src/convert/types';

const B = 10;
const L = (text: string, y: number, opts: Partial<Line> = {}): Line => ({ text, x0: 40, x1: 380, y, size: B, ...opts });
const P = (pageIndex: number, lines: Line[]): PageLines => ({ pageIndex, width: 420, height: 595, lines });
const show = (blocks: Block[]) =>
  blocks.map((b) => {
    if (b.kind === 'heading') return `heading${b.level}:${b.text}`;
    return 'text' in b ? `${b.kind}:${b.text}` : b.kind;
  });

describe('buildBlocks', () => {
  it('girinti yeni paragraf başlatır, devam satırları birleşir', () => {
    const blocks = buildBlocks(
      [
        P(0, [
          L('Birinci paragrafın ilk satırı', 500, { x0: 52 }),
          L('devam eden ikinci satırı.', 485, { x1: 250 }),
          L('İkinci paragraf burada başlar', 470, { x0: 52 }),
          L('ve biter.', 455, { x1: 120 }),
        ]),
      ],
      B,
      new Set(),
    );
    expect(show(blocks)).toEqual([
      'para:Birinci paragrafın ilk satırı devam eden ikinci satırı.',
      'para:İkinci paragraf burada başlar ve biter.',
    ]);
  });

  it('diyalog tiresi yeni paragraf başlatır', () => {
    const blocks = buildBlocks(
      [
        P(0, [
          L('Kapıyı açtı ve dışarı baktı, kimse', 500, { x0: 52 }),
          L('yoktu.', 485, { x1: 90 }),
          L('— Kim var orada? diye seslendi.', 470, { x1: 260 }),
        ]),
      ],
      B,
      new Set(),
    );
    expect(show(blocks)).toEqual(['para:Kapıyı açtı ve dışarı baktı, kimse yoktu.', 'para:— Kim var orada? diye seslendi.']);
  });

  it('sayfa sonunda bitmeyen paragraf sonraki sayfada devam eder', () => {
    const blocks = buildBlocks(
      [
        P(0, [L('Yol boyunca herkes bir şeyler biliyor da', 500, { x0: 52 }), L('söylemiyormuş gibiydi', 485, { x1: 300 })]),
        P(1, [L('ve bu sessizlik onu huzursuz ediyordu.', 500, { x1: 330 }), L('Yeni paragraf.', 485, { x0: 52, x1: 150 })]),
      ],
      B,
      new Set(),
    );
    expect(show(blocks)).toEqual([
      'para:Yol boyunca herkes bir şeyler biliyor da söylemiyormuş gibiydi ve bu sessizlik onu huzursuz ediyordu.',
      'para:Yeni paragraf.',
    ]);
  });

  it('önceki sayfa kısa ve noktalı bittiyse yeni sayfadaki girintisiz satır yeni paragraftır', () => {
    const blocks = buildBlocks(
      [
        P(0, [L('Uzun bir paragraf burada başlıyor ve', 500, { x0: 52 }), L('burada bitiyor.', 485, { x1: 150 })]),
        P(1, [L('Bölüm sonrası girintisiz paragraf.', 500, { x1: 330 })]),
      ],
      B,
      new Set(),
    );
    expect(blocks).toHaveLength(2);
  });

  it('satır sonu tireli kelimeyi birleştirir', () => {
    const blocks = buildBlocks(
      [P(0, [L('Elinde yıllardır aradığı eski kita-', 500, { x0: 52 }), L('bı tutuyordu.', 485, { x1: 150 })])],
      B,
      new Set(),
    );
    expect(show(blocks)).toEqual(['para:Elinde yıllardır aradığı eski kitabı tutuyordu.']);
  });

  it('büyük puntolu satır 1., ortalı alt başlık 2. düzey başlıktır; ardışık satırlar birleşir', () => {
    const blocks = buildBlocks(
      [
        P(0, [
          L('BİRİNCİ', 540, { size: 16, x0: 170, x1: 250 }),
          L('BÖLÜM', 520, { size: 16, x0: 180, x1: 240 }),
          L('Sisli Sabah', 495, { size: 12, x0: 180, x1: 240 }),
          L('Sabah oldu ve kasaba yavaş yavaş uyanmaya başladı; sokaklarda', 460, { x0: 52 }),
          L('ilk sesler duyuldu.', 445, { x1: 160 }),
        ]),
      ],
      B,
      new Set(),
    );
    expect(show(blocks)).toEqual([
      'heading1:BİRİNCİ BÖLÜM',
      'heading2:Sisli Sabah',
      'para:Sabah oldu ve kasaba yavaş yavaş uyanmaya başladı; sokaklarda ilk sesler duyuldu.',
    ]);
  });

  it('punto büyük olmasa da ortalı "3. BÖLÜM" kalıbı başlıktır', () => {
    const blocks = buildBlocks(
      [
        P(0, [
          L('3. BÖLÜM', 540, { x0: 190, x1: 230 }),
          L('Uzun bir gövde satırı burada devam ediyor ve', 500, { x0: 52 }),
          L('biter.', 485, { x1: 100 }),
        ]),
      ],
      B,
      new Set(),
    );
    expect(show(blocks)[0]).toBe('heading1:3. BÖLÜM');
  });

  it('sahne arası işaretini ayrı blok yapar', () => {
    const blocks = buildBlocks(
      [
        P(0, [
          L('Birinci sahne burada sona erdi ve herkes', 500, { x0: 52 }),
          L('evine döndü.', 485, { x1: 150 }),
          L('* * *', 465, { x0: 200, x1: 222 }),
          L('Ertesi sabah her şey değişmişti.', 445, { x1: 250 }),
        ]),
      ],
      B,
      new Set(),
    );
    expect(show(blocks)).toEqual([
      'para:Birinci sahne burada sona erdi ve herkes evine döndü.',
      'break',
      'para:Ertesi sabah her şey değişmişti.',
    ]);
  });

  it('dipnot, açık paragraf kapandıktan sonra eklenir', () => {
    const blocks = buildBlocks(
      [
        P(0, [
          L('Kitabı tutuyordu.¹ Ahmet Bey bir an ne diyeceğini', 500, { x0: 52 }),
          L('¹ Kitabın ilk baskısı 1923 yılındadır.', 60, { size: 7.5, x1: 250 }),
        ]),
        P(1, [L('bilemedi ve sustu.', 500, { x1: 170 }), L('Sonra konuştu.', 485, { x0: 52, x1: 160 })]),
      ],
      B,
      new Set(),
    );
    expect(show(blocks)).toEqual([
      'para:Kitabı tutuyordu.¹ Ahmet Bey bir an ne diyeceğini bilemedi ve sustu.',
      'note:¹ Kitabın ilk baskısı 1923 yılındadır.',
      'para:Sonra konuştu.',
    ]);
  });

  it('metinsiz sayfa görsel blok olur ve açık paragrafı kapatır', () => {
    const blocks = buildBlocks(
      [
        P(0, [L('Resimden önceki paragraf', 500, { x0: 52, x1: 300 })]),
        P(1, []),
        P(2, [L('resimden sonra devam etmez, yeni başlar.', 500, { x1: 330 })]),
      ],
      B,
      new Set([1]),
    );
    expect(show(blocks)).toEqual([
      'para:Resimden önceki paragraf',
      'pageImage',
      'para:resimden sonra devam etmez, yeni başlar.',
    ]);
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu gör**

Run: `pnpm test tests/convert/blocks.test.ts`
Beklenen: FAIL — modül bulunamadı.

- [ ] **Step 3: Uygulamayı yaz**

`src/convert/blocks.ts`:
```ts
import { finalizeText, joinLines } from './text';
import type { Block, Line, PageLines } from './types';

type Kind = 'heading1' | 'heading2' | 'break' | 'note' | 'body';

interface PageStats {
  left: number;
  right: number;
  /** tipik satır aralığı (taban çizgileri arası) */
  gap: number;
}

interface BodyRef {
  line: Line;
  stats: PageStats;
  page: number;
}

const CHAPTER =
  /^(bölüm|kısım|chapter|part|önsöz|sonsöz|giriş|epilog|prolog|prologue|epilogue|introduction|preface)(?!\p{L})|^(birinci|ikinci|üçüncü|dördüncü|beşinci|altıncı|yedinci|sekizinci|dokuzuncu|onuncu)\s+(bölüm|kısım)(?!\p{L})|^\d{1,3}\.?\s*(bölüm|kısım)(?!\p{L})|^[ivxlc]{1,6}\.?$/u;
const BREAK = /^[\s*•·⁂~✱❖◆◇#]+$/u;
const DIALOG = /^[—–]\s?|^-\s/u;
const TERMINAL = /[.!?…:;"'»”’)\]]$/u;
const NOTE_START = /^[\d¹²³⁴⁵⁶⁷⁸⁹⁰*†‡]/u;

function isChapterLike(text: string): boolean {
  return CHAPTER.test(text.toLocaleLowerCase('tr')) || CHAPTER.test(text.toLowerCase());
}

/** Sol kenar: en az iki kez görülen en küçük x0 (girintili satırlar değil, devam satırları). */
function leftMargin(lines: Line[]): number {
  const freq = new Map<number, number>();
  for (const l of lines) {
    const k = Math.round(l.x0);
    freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  const frequent = [...freq].filter(([, n]) => n >= 2).map(([k]) => k);
  const pool = frequent.length ? frequent : [...freq.keys()];
  return pool.length ? Math.min(...pool) : 0;
}

function computeStats(pages: PageLines[], body: number): Map<number, PageStats> {
  const isBody = (l: Line) => Math.abs(l.size - body) <= body * 0.12;
  const allBody = pages.flatMap((p) => p.lines.filter(isBody));
  const perPage = new Map<number, number>();
  for (const p of pages) {
    const ls = p.lines.filter(isBody);
    if (ls.length >= 3) perPage.set(p.pageIndex, leftMargin(ls));
  }
  const known = [...perPage.values()].sort((a, b) => a - b);
  const fallbackLeft = known.length
    ? known[Math.floor(known.length / 2)]
    : leftMargin(allBody.length ? allBody : pages.flatMap((p) => p.lines));

  const widths: number[] = [];
  const gaps: number[] = [];
  for (const p of pages) {
    const left = perPage.get(p.pageIndex) ?? fallbackLeft;
    const ls = p.lines.filter(isBody);
    ls.forEach((l, i) => {
      widths.push(l.x1 - left);
      const prev = ls[i - 1];
      if (prev) {
        const g = prev.y - l.y;
        if (g > 0 && g < body * 4) gaps.push(g);
      }
    });
  }
  widths.sort((a, b) => a - b);
  gaps.sort((a, b) => a - b);
  const width = widths.length ? widths[Math.floor(widths.length * 0.9)] : 300;
  const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : body * 1.45;

  const stats = new Map<number, PageStats>();
  for (const p of pages) {
    const left = perPage.get(p.pageIndex) ?? fallbackLeft;
    stats.set(p.pageIndex, { left, right: left + width, gap });
  }
  return stats;
}

/** Sayfanın altındaki küçük puntolu satırlar dipnottur; dipnot bölgesinin başladığı indeksi döndürür. */
function footnoteStart(p: PageLines, body: number): number {
  let i = p.lines.length;
  while (i > 0) {
    const l = p.lines[i - 1];
    if (l.size <= body * 0.85 && l.y < p.height * 0.35) i--;
    else break;
  }
  return i === 0 ? p.lines.length : i;
}

function classify(l: Line, s: PageStats, body: number, prevKind: Kind | undefined, prevLine: Line | undefined): Kind {
  const text = l.text.trim();
  if (BREAK.test(text) && text.replace(/\s/g, '').length <= 12) return 'break';
  const width = s.right - s.left;
  const centered =
    Math.abs((l.x0 + l.x1) / 2 - (s.left + s.right) / 2) < width * 0.08 && l.x0 > s.left + body * 1.5;
  if (text.length <= 120 && l.size >= body * 1.25) return 'heading1';
  if (text.length <= 60 && isChapterLike(text) && (centered || l.size > body * 1.05)) return 'heading1';
  if (text.length <= 80 && centered && l.size >= body * 1.08) return 'heading2';
  const afterHeading = prevKind === 'heading1' || prevKind === 'heading2';
  if (text.length <= 80 && centered && afterHeading && prevLine && prevLine.y - l.y < s.gap * 3.5) return 'heading2';
  return 'body';
}

function startsParagraph(l: Line, s: PageStats, body: number, prev: BodyRef | null, page: number, current: string): boolean {
  if (!prev) return true;
  if (DIALOG.test(l.text.trim())) return true;
  const indented = l.x0 > s.left + body * 0.8 && l.x0 < s.left + body * 6;
  if (indented) return true;
  if (prev.page === page && prev.line.y - l.y > s.gap * 1.6) return true;
  // önceki satır kısa kaldıysa ve cümle bittiyse paragraf bitmiştir (sayfa geçişinde de)
  const prevShort = prev.line.x1 < prev.stats.right - body * 2;
  return prevShort && TERMINAL.test(current.trim());
}

class BlockBuilder {
  readonly blocks: Block[] = [];
  private para: { text: string; srcPage: number } | null = null;
  private notes: Block[] = [];

  get paraText(): string | null {
    return this.para?.text ?? null;
  }
  startPara(text: string, srcPage: number): void {
    this.flush();
    this.para = { text, srcPage };
  }
  continuePara(text: string): void {
    if (this.para) this.para.text = joinLines(this.para.text, text);
  }
  /** Dipnotlar, o an açık olan paragraf kapanınca eklenir (paragraf sonraki sayfaya taşabilir). */
  queueNotes(notes: Block[]): void {
    this.notes.push(...notes);
  }
  push(block: Block): void {
    this.flush();
    this.blocks.push(block);
  }
  /** Açık paragraf yoksa son bloğu döndürür (ardışık başlık satırlarını birleştirmek için). */
  lastClosed(): Block | undefined {
    return this.para ? undefined : this.blocks[this.blocks.length - 1];
  }
  flush(): void {
    if (this.para) {
      const text = finalizeText(this.para.text);
      if (text) this.blocks.push({ kind: 'para', text, srcPage: this.para.srcPage });
      this.para = null;
    }
    if (this.notes.length) {
      this.blocks.push(...this.notes);
      this.notes = [];
    }
  }
}

/** Temizlenmiş sayfa satırlarını kitap bloklarına dönüştürür. */
export function buildBlocks(pages: PageLines[], body: number, textless: Set<number>): Block[] {
  const stats = computeStats(pages, body);
  const out = new BlockBuilder();
  let lastBody: BodyRef | null = null;

  for (const p of pages) {
    if (textless.has(p.pageIndex)) {
      out.push({ kind: 'pageImage', srcPage: p.pageIndex });
      lastBody = null;
      continue;
    }
    const s = stats.get(p.pageIndex)!;
    const noteFrom = footnoteStart(p, body);
    const notes: Block[] = [];
    let prevKind: Kind | undefined;
    let prevLine: Line | undefined;

    for (let i = 0; i < p.lines.length; i++) {
      const l = p.lines[i];
      const text = l.text.trim();
      const kind: Kind = i >= noteFrom ? 'note' : classify(l, s, body, prevKind, prevLine);

      if (kind === 'note') {
        const last = notes[notes.length - 1];
        if (last?.kind === 'note' && !NOTE_START.test(text)) last.text = joinLines(last.text, text);
        else notes.push({ kind: 'note', text, srcPage: p.pageIndex });
      } else if (kind === 'break') {
        out.push({ kind: 'break', srcPage: p.pageIndex });
        lastBody = null;
      } else if (kind === 'heading1' || kind === 'heading2') {
        const level = kind === 'heading1' ? 1 : 2;
        const last = out.lastClosed();
        if (prevKind === kind && last?.kind === 'heading' && last.level === level) last.text = `${last.text} ${text}`;
        else out.push({ kind: 'heading', level, text, srcPage: p.pageIndex });
        lastBody = null;
      } else {
        const current = out.paraText;
        if (current === null || startsParagraph(l, s, body, lastBody, p.pageIndex, current)) {
          out.startPara(text, p.pageIndex);
        } else {
          out.continuePara(text);
        }
        lastBody = { line: l, stats: s, page: p.pageIndex };
      }
      prevKind = kind;
      prevLine = l;
    }
    out.queueNotes(notes);
  }
  out.flush();
  return out.blocks;
}
```

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `pnpm test tests/convert/blocks.test.ts`
Beklenen: PASS (10 test).

- [ ] **Step 5: Commit**

```bash
git add src/convert/blocks.ts tests/convert/blocks.test.ts
git commit -m "feat(convert): paragraf, başlık, dipnot ve sahne arası tespiti"
```

---

### Task 7: Bölüm listesi

**Files:**
- Create: `src/convert/chapters.ts`
- Test: `tests/convert/chapters.test.ts`

- [ ] **Step 1: Başarısız testleri yaz**

`tests/convert/chapters.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildChapters } from '../../src/convert/chapters';
import type { Block } from '../../src/convert/types';

const blocks: Block[] = [
  { kind: 'heading', level: 1, text: 'KAYIP ŞEHRİN IŞIKLARI', srcPage: 0 },
  { kind: 'heading', level: 1, text: 'BİRİNCİ BÖLÜM', srcPage: 2 },
  { kind: 'heading', level: 2, text: 'Sisli Sabah', srcPage: 2 },
  { kind: 'para', text: 'Metin.', srcPage: 2 },
  { kind: 'heading', level: 1, text: 'İKİNCİ BÖLÜM', srcPage: 5 },
  { kind: 'para', text: 'Metin.', srcPage: 5 },
];

describe('buildChapters', () => {
  it('PDF içindekilerini başlık bloklarına eşler (büyük/küçük harf farkı önemsiz)', () => {
    const outline = [
      { title: 'BİRİNCİ BÖLÜM', pageIndex: 2, level: 1 },
      { title: 'Sisli Sabah', pageIndex: 2, level: 2 },
      { title: 'İkinci Bölüm', pageIndex: 5, level: 1 },
    ];
    expect(buildChapters(blocks, outline)).toEqual([
      { title: 'BİRİNCİ BÖLÜM', block: 1, level: 1 },
      { title: 'Sisli Sabah', block: 2, level: 2 },
      { title: 'İkinci Bölüm', block: 4, level: 1 },
    ]);
  });

  it('içindekiler yoksa başlıklardan üretir ve alt başlığı birleştirir', () => {
    expect(buildChapters(blocks, [])).toEqual([
      { title: 'KAYIP ŞEHRİN IŞIKLARI', block: 0, level: 1 },
      { title: 'BİRİNCİ BÖLÜM — Sisli Sabah', block: 1, level: 1 },
      { title: 'İKİNCİ BÖLÜM', block: 4, level: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu gör**

Run: `pnpm test tests/convert/chapters.test.ts`
Beklenen: FAIL — modül bulunamadı.

- [ ] **Step 3: Uygulamayı yaz**

`src/convert/chapters.ts`:
```ts
import type { Block, Chapter, OutlineEntry } from './types';

const norm = (t: string) => t.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]+/gu, '');

/** Bölümler: PDF içindekiler varsa ondan, yoksa başlık bloklarından. */
export function buildChapters(blocks: Block[], outline: OutlineEntry[]): Chapter[] {
  const fromOutline = chaptersFromOutline(blocks, outline);
  return fromOutline.length ? fromOutline : chaptersFromHeadings(blocks);
}

function chaptersFromOutline(blocks: Block[], outline: OutlineEntry[]): Chapter[] {
  const used = new Set<number>();
  const chapters: Chapter[] = [];
  for (const o of outline) {
    if (o.level > 2) continue;
    const headingOnPage = (b: Block, i: number) => b.kind === 'heading' && b.srcPage === o.pageIndex && !used.has(i);
    let idx = blocks.findIndex((b, i) => headingOnPage(b, i) && b.kind === 'heading' && norm(b.text) === norm(o.title));
    if (idx < 0) idx = blocks.findIndex(headingOnPage);
    if (idx < 0) idx = blocks.findIndex((b) => b.srcPage >= o.pageIndex);
    if (idx < 0 || used.has(idx)) continue;
    used.add(idx);
    chapters.push({ title: o.title, block: idx, level: o.level });
  }
  return chapters.sort((a, b) => a.block - b.block);
}

function chaptersFromHeadings(blocks: Block[]): Chapter[] {
  const chapters: Chapter[] = [];
  blocks.forEach((b, i) => {
    if (b.kind !== 'heading') return;
    const last = chapters[chapters.length - 1];
    // "BİRİNCİ BÖLÜM" + alt başlık "Sisli Sabah" → tek bölüm adı
    if (b.level === 2 && last && last.block === i - 1) {
      last.title = `${last.title} — ${b.text}`;
      return;
    }
    chapters.push({ title: b.text, block: i, level: b.level });
  });
  return chapters;
}
```

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `pnpm test tests/convert/chapters.test.ts`
Beklenen: PASS (2 test).

- [ ] **Step 5: Commit**

```bash
git add src/convert/chapters.ts tests/convert/chapters.test.ts
git commit -m "feat(convert): PDF içindekilerinden veya başlıklardan bölüm listesi"
```

---

### Task 8: pdf.js kaynağı ve dönüştürme akışı (gerçek PDF'lerle)

**Files:**
- Create: `src/pdf/pdfSource.ts`, `src/convert/convertPdf.ts`
- Test: `tests/convert/fixtures.test.ts`

- [ ] **Step 1: Başarısız entegrasyon testlerini yaz**

`tests/convert/fixtures.test.ts`:
```ts
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
```

- [ ] **Step 2: Testin başarısız olduğunu gör**

Run: `pnpm test tests/convert/fixtures.test.ts`
Beklenen: FAIL — `convertPdf` / `pdfSource` modülleri bulunamadı.

- [ ] **Step 3: pdf.js kaynağını yaz**

`src/pdf/pdfSource.ts`:
```ts
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { OutlineEntry, PdfSource, RawTextItem } from '../convert/types';

const IMAGE_OPS = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
  OPS.paintImageMaskXObjectRepeat,
  OPS.paintInlineImageXObjectGroup,
  OPS.paintImageMaskXObjectGroup,
]);

interface OutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items?: OutlineNode[];
}

/** pdf.js belgesini dönüştürücünün `PdfSource` arayüzüne uyarlar (Node'da ve tarayıcıda aynı). */
export function createPdfSource(doc: PDFDocumentProxy): PdfSource {
  return {
    numPages: doc.numPages,

    async getPageText(pageIndex) {
      const page = await doc.getPage(pageIndex + 1);
      const { width, height } = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: RawTextItem[] = [];
      for (const it of content.items) {
        if ('str' in it) {
          items.push({ str: it.str, transform: it.transform, width: it.width, height: it.height, fontName: it.fontName, hasEOL: it.hasEOL });
        }
      }
      page.cleanup();
      return { width, height, items };
    },

    async hasImages(pageIndex) {
      const page = await doc.getPage(pageIndex + 1);
      const ops = await page.getOperatorList();
      page.cleanup();
      return ops.fnArray.some((fn) => IMAGE_OPS.has(fn));
    },

    async getOutline() {
      const outline = (await doc.getOutline()) as OutlineNode[] | null;
      const out: OutlineEntry[] = [];
      const walk = async (nodes: OutlineNode[], level: number) => {
        for (const node of nodes) {
          const pageIndex = await resolveDest(doc, node.dest);
          if (pageIndex !== null) out.push({ title: node.title.trim(), pageIndex, level });
          if (node.items?.length) await walk(node.items, level + 1);
        }
      };
      if (outline) await walk(outline, 1);
      return out;
    },

    async getMetadata() {
      const { info } = await doc.getMetadata();
      const rec = info as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
      return { title: str(rec.Title), author: str(rec.Author) };
    },
  };
}

async function resolveDest(doc: PDFDocumentProxy, dest: string | unknown[] | null): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0) return null;
    const ref = explicit[0];
    if (typeof ref === 'number') return ref;
    return await doc.getPageIndex(ref as { num: number; gen: number });
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Dönüştürme akışını yaz**

`src/convert/convertPdf.ts`:
```ts
import { buildBlocks } from './blocks';
import { buildChapters } from './chapters';
import { extractLines } from './extractLines';
import { bodyFontSize, stripPageFurniture } from './furniture';
import { countWords, detectLanguage, needsTurkishRepair, repairTurkish } from './text';
import { CONVERTER_VERSION, type BookContent, type PageLines, type PdfSource } from './types';

export interface ConvertOptions {
  /** 0..1 arası ilerleme */
  onProgress?: (fraction: number) => void;
}

/** Bu kadar karakterden az metni olan sayfa "metinsiz" adayıdır (görsel ya da boş sayfa). */
const TEXTLESS_CHARS = 30;

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function convertPdf(src: PdfSource, opts: ConvertOptions = {}): Promise<BookContent> {
  const pages: PageLines[] = [];
  for (let i = 0; i < src.numPages; i++) {
    pages.push(extractLines(i, await src.getPageText(i)));
    opts.onProgress?.(((i + 1) / src.numPages) * 0.95);
    if (i % 8 === 7) await yieldToEventLoop(); // arayüz donmasın
  }

  const sample = pages
    .flatMap((p) => p.lines.map((l) => l.text))
    .join(' ')
    .slice(0, 200_000);
  const repair = needsTurkishRepair(sample);
  if (repair) {
    for (const p of pages) for (const l of p.lines) l.text = repairTurkish(l.text);
  }

  // Metinsiz sayfalar: kitabın çoğu metinsizse taranmıştır; değilse yalnızca resim içerenler görsel olur (boş sayfalar atlanır).
  const chars = pages.map((p) => p.lines.reduce((n, l) => n + l.text.replace(/\s/g, '').length, 0));
  const candidates = chars.flatMap((n, i) => (n < TEXTLESS_CHARS ? [i] : []));
  const scanned = candidates.length > src.numPages * 0.5;
  const textless = new Set<number>();
  for (const i of candidates) if (scanned || (await src.hasImages(i))) textless.add(i);

  const body = bodyFontSize(pages.filter((p) => !textless.has(p.pageIndex)));
  const blocks = buildBlocks(stripPageFurniture(pages, body), body, textless);
  const outline = (await src.getOutline()).map((o) => (repair ? { ...o, title: repairTurkish(o.title) } : o));
  const chapters = buildChapters(blocks, outline);
  const paras = blocks.flatMap((b) => (b.kind === 'para' ? [b.text] : []));
  const totalWords = blocks.reduce((n, b) => n + ('text' in b ? countWords(b.text) : 0), 0);

  opts.onProgress?.(1);
  return {
    version: CONVERTER_VERSION,
    lang: detectLanguage(paras.slice(0, 80).join(' ')),
    blocks,
    chapters,
    textlessPages: [...textless].sort((a, b) => a - b),
    totalWords,
  };
}
```

- [ ] **Step 5: Testleri çalıştır**

Run: `pnpm test tests/convert/fixtures.test.ts`
Beklenen: PASS (14 test).

Bir test başarısız olursa ekrana döküm alıp nedenini bul: `pnpm convert tests/fixtures/novel-tr.pdf` (Task 9'daki betik). Bu betik henüz yoksa geçici olarak testin içinde `console.log(c.blocks)` kullan. Düzeltmeyi dönüştürücü kurallarında yap; testteki beklentiyi, yalnızca fixture'ın gerçekten farklı ürettiği doğrulanırsa değiştir (örn. Chromium bir başlığı farklı bölerse).

- [ ] **Step 6: Tüm testleri ve tip kontrolünü çalıştır, commit**

```bash
pnpm test
pnpm typecheck
git add src/pdf/pdfSource.ts src/convert/convertPdf.ts tests/convert/fixtures.test.ts
git commit -m "feat(convert): pdf.js kaynağı ve PDF→kitap dönüşüm akışı; gerçek PDF testleri"
```

---

### Task 9: Gerçek kitaplar için dönüşüm döküm betiği

**Files:**
- Create: `scripts/convert-pdf.ts`

- [ ] **Step 1: Betiği yaz**

`scripts/convert-pdf.ts`:
```ts
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

const asset = (dir: string) => fileURLToPath(new URL(`../node_modules/pdfjs-dist/${dir}/`, import.meta.url));
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
```

- [ ] **Step 2: Fixture üzerinde dene**

Run: `pnpm convert tests/fixtures/novel-tr.pdf`
Beklenen: `6 sayfa · … · dil: tr` başlığı, 4 bölüm (BİRİNCİ BÖLÜM, Sisli Sabah, İKİNCİ BÖLÜM, İstasyon) ve H1/H2/PARA/NOTE/BREAK satırları.

- [ ] **Step 3: Commit**

```bash
pnpm typecheck
git add scripts/convert-pdf.ts
git commit -m "feat(scripts): pnpm convert ile dönüşüm dökümü"
```

---

### Task 10: Veritabanı şeması ve kitap işlemleri

**Files:**
- Create: `src/db/db.ts`, `src/db/books.ts`
- Test: `tests/db/books.test.ts`

- [ ] **Step 1: Şemayı yaz**

`src/db/db.ts`:
```ts
import { Dexie, type EntityTable } from 'dexie';
import type { BookContent, Lang, Locator } from '../convert/types';

export type ConvertState = 'pending' | 'running' | 'done' | 'failed';
export type ReadingStatus = 'unread' | 'reading' | 'finished' | 'abandoned';

export interface BookRecord {
  /** Dosya içeriğinin SHA-256 özeti: aynı PDF iki kez eklenmez; ileride senkron için sabit kimlik. */
  id: string;
  title: string;
  author: string;
  fileName: string;
  fileSize: number;
  pdfPageCount: number;
  lang: Lang;
  /** Kapak görseli (data URL); yoksa arayüz renkli kapak çizer. */
  cover?: string;
  /** Şifreli PDF'ler için; yalnızca bu cihazda saklanır. */
  password?: string;
  addedAt: number;
  lastOpenedAt?: number;
  convert: { state: ConvertState; progress: number; version: number; error?: string };
  readingStatus: ReadingStatus;
  startedAt?: number;
  totalWords: number;
}

export interface FileRecord {
  bookId: string;
  blob: Blob;
}

export interface ContentRecord extends BookContent {
  bookId: string;
}

export interface ProgressRecord {
  bookId: string;
  locator: Locator;
  percent: number;
  updatedAt: number;
}

export type BookDB = Dexie & {
  books: EntityTable<BookRecord, 'id'>;
  files: EntityTable<FileRecord, 'bookId'>;
  contents: EntityTable<ContentRecord, 'bookId'>;
  progress: EntityTable<ProgressRecord, 'bookId'>;
};

export function createDb(name = 'mypdfbook'): BookDB {
  const db = new Dexie(name) as BookDB;
  db.version(1).stores({
    books: 'id, addedAt, lastOpenedAt',
    files: 'bookId',
    contents: 'bookId',
    progress: 'bookId',
  });
  return db;
}

export const db = createDb();
```

- [ ] **Step 2: Başarısız testleri yaz**

`tests/db/books.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteBook, markOpened, saveProgress } from '../../src/db/books';
import { createDb, type BookDB, type BookRecord } from '../../src/db/db';

const book = (id: string): BookRecord => ({
  id,
  title: 'T',
  author: '',
  fileName: 't.pdf',
  fileSize: 1,
  pdfPageCount: 1,
  lang: 'tr',
  addedAt: 1,
  convert: { state: 'done', progress: 1, version: 1 },
  readingStatus: 'unread',
  totalWords: 0,
});

let db: BookDB;
beforeEach(async () => {
  db = createDb(`test-${crypto.randomUUID()}`);
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

describe('kitap işlemleri', () => {
  it('deleteBook kitabın tüm verisini siler', async () => {
    await db.books.add(book('a'));
    await db.files.add({ bookId: 'a', blob: new Blob(['x']) });
    await db.contents.add({ bookId: 'a', version: 1, lang: 'tr', blocks: [], chapters: [], textlessPages: [], totalWords: 0 });
    await saveProgress(db, 'a', { block: 3, offset: 0 }, 0.5);
    await deleteBook(db, 'a');
    expect(await db.books.count()).toBe(0);
    expect(await db.files.count()).toBe(0);
    expect(await db.contents.count()).toBe(0);
    expect(await db.progress.count()).toBe(0);
  });

  it('markOpened ilk açılışta başlama tarihini ve durumu yazar, sonra korur', async () => {
    await db.books.add(book('a'));
    await markOpened(db, 'a', 1000);
    await markOpened(db, 'a', 2000);
    expect(await db.books.get('a')).toMatchObject({ startedAt: 1000, lastOpenedAt: 2000, readingStatus: 'reading' });
  });

  it('saveProgress konumu ve oranı yazar', async () => {
    await saveProgress(db, 'a', { block: 7, offset: 12 }, 0.25, 500);
    expect(await db.progress.get('a')).toEqual({ bookId: 'a', locator: { block: 7, offset: 12 }, percent: 0.25, updatedAt: 500 });
  });
});
```

- [ ] **Step 3: Testin başarısız olduğunu gör**

Run: `pnpm test tests/db/books.test.ts`
Beklenen: FAIL — `src/db/books` bulunamadı.

- [ ] **Step 4: Kitap işlemlerini yaz**

`src/db/books.ts`:
```ts
import type { Locator } from '../convert/types';
import type { BookDB, BookRecord } from './db';

export async function deleteBook(db: BookDB, id: string): Promise<void> {
  await db.transaction('rw', [db.books, db.files, db.contents, db.progress], async () => {
    await Promise.all([db.books.delete(id), db.files.delete(id), db.contents.delete(id), db.progress.delete(id)]);
  });
}

/** Kitap açıldığında: son açılma zamanı; ilk açılışta başlama tarihi ve "okunuyor" durumu. */
export async function markOpened(db: BookDB, id: string, now = Date.now()): Promise<void> {
  const book = await db.books.get(id);
  if (!book) return;
  const patch: Partial<BookRecord> = { lastOpenedAt: now };
  if (!book.startedAt) patch.startedAt = now;
  if (book.readingStatus === 'unread') patch.readingStatus = 'reading';
  await db.books.update(id, patch);
}

export async function saveProgress(db: BookDB, bookId: string, locator: Locator, percent: number, now = Date.now()): Promise<void> {
  await db.progress.put({ bookId, locator, percent, updatedAt: now });
}
```

- [ ] **Step 5: Testlerin geçtiğini gör, commit**

Run: `pnpm test tests/db/books.test.ts`
Beklenen: PASS (3 test).

```bash
git add src/db tests/db
git commit -m "feat(db): Dexie şeması, kitap silme, açılış ve ilerleme kaydı"
```

---

### Task 11: Dosya adı ve özet (hash) yardımcıları

**Files:**
- Create: `src/import/hash.ts`, `src/import/fileName.ts`
- Test: `tests/import/utils.test.ts`

- [ ] **Step 1: Başarısız testleri yaz**

`tests/import/utils.test.ts`:
```ts
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
```

- [ ] **Step 2: Testin başarısız olduğunu gör**

Run: `pnpm test tests/import/utils.test.ts`
Beklenen: FAIL — modüller bulunamadı.

- [ ] **Step 3: Uygulamayı yaz**

`src/import/hash.ts`:
```ts
/** Dosyanın SHA-256 özeti (onaltılık). Tarayıcıda HTTPS veya localhost gerekir. */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

`src/import/fileName.ts`:
```ts
const JUNK_TITLE = /^(microsoft word|untitled|adsız|document|belge)(?!\p{L})|\.(docx?|pdf|indd|rtf|odt)$/iu;
const JUNK_AUTHOR = /^(user|admin|administrator|pc|owner|kullanıcı|unknown|bilinmiyor)$/i;

/** "Yazar - Kitap Adı.pdf" kalıbını ayırır; yoksa dosya adını başlık yapar. */
export function parseFileName(fileName: string): { title: string; author?: string } {
  const base = fileName.replace(/\.pdf$/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(base);
  if (m?.[1] && m[2]) return { author: m[1].trim(), title: m[2].trim() };
  return { title: base || 'Adsız kitap' };
}

/** PDF metadata'sı anlamlıysa onu, değilse dosya adını kullanır. */
export function chooseTitle(meta: { title?: string; author?: string }, fileName: string): { title: string; author: string } {
  const parsed = parseFileName(fileName);
  const metaTitle = meta.title?.trim();
  const metaAuthor = meta.author?.trim();
  const title = metaTitle && metaTitle.length > 1 && !JUNK_TITLE.test(metaTitle) ? metaTitle : parsed.title;
  const author = metaAuthor && !JUNK_AUTHOR.test(metaAuthor) ? metaAuthor : (parsed.author ?? '');
  return { title, author };
}
```

- [ ] **Step 4: Testlerin geçtiğini gör, commit**

Run: `pnpm test tests/import/utils.test.ts`
Beklenen: PASS (5 test).

```bash
git add src/import/hash.ts src/import/fileName.ts tests/import/utils.test.ts
git commit -m "feat(import): SHA-256 özeti ve başlık/yazar seçimi"
```

---

### Task 12: İçe aktarma akışı

**Files:**
- Create: `src/import/importBook.ts`
- Test: `tests/import/importBook.test.ts`

- [ ] **Step 1: Başarısız testleri yaz**

`tests/import/importBook.test.ts`:
```ts
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type BookDB } from '../../src/db/db';
import { importBook, resumeConversions, type ImportDeps, type OpenedPdf } from '../../src/import/importBook';
import { createPdfSource } from '../../src/pdf/pdfSource';

async function nodeOpenPdf(bytes: Uint8Array, password?: string): Promise<OpenedPdf> {
  const doc = await getDocument({ data: bytes, password }).promise;
  return { source: createPdfSource(doc), renderCover: async () => undefined, close: () => doc.loadingTask.destroy() };
}

async function fixtureFile(name: string, as = name): Promise<File> {
  const bytes = await readFile(new URL(`../fixtures/${name}`, import.meta.url));
  return new File([bytes], as, { type: 'application/pdf' });
}

let db: BookDB;
let deps: ImportDeps;
beforeEach(async () => {
  db = createDb(`test-${crypto.randomUUID()}`);
  await db.open();
  deps = { db, openPdf: nodeOpenPdf };
});
afterEach(async () => {
  await db.delete();
});

describe('importBook', () => {
  it('kitabı ekler, dosyayı saklar ve dönüştürür', async () => {
    const res = await importBook(await fixtureFile('novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf'), deps);
    expect(res.status).toBe('added');
    await res.done;
    const book = await db.books.get(res.bookId);
    expect(book).toMatchObject({
      title: 'Kayıp Şehrin Işıkları',
      author: 'Deniz Aksoy',
      pdfPageCount: 6,
      lang: 'tr',
      readingStatus: 'unread',
    });
    expect(book?.convert).toMatchObject({ state: 'done', progress: 1 });
    expect(await db.files.get(res.bookId)).toBeDefined();
    expect((await db.contents.get(res.bookId))?.blocks.length).toBeGreaterThan(10);
  });

  it('aynı dosyayı ikinci kez eklemez', async () => {
    const first = await importBook(await fixtureFile('novel-tr.pdf'), deps);
    await first.done;
    const second = await importBook(await fixtureFile('novel-tr.pdf', 'baska-ad.pdf'), deps);
    expect(second).toMatchObject({ status: 'exists', bookId: first.bookId });
    expect(await db.books.count()).toBe(1);
  });

  it('PDF olmayan dosyayı reddeder ve hiçbir şey kaydetmez', async () => {
    const bad = new File([new TextEncoder().encode('merhaba')], 'not.pdf');
    await expect(importBook(bad, deps)).rejects.toMatchObject({ code: 'invalid-pdf' });
    expect(await db.books.count()).toBe(0);
  });

  it('yarıda kalan dönüştürmeyi yeniden başlatır', async () => {
    const res = await importBook(await fixtureFile('novel-tr.pdf'), deps);
    await res.done;
    await db.books.update(res.bookId, { convert: { state: 'running', progress: 0.3, version: 1 } });
    await db.contents.clear();
    await resumeConversions(deps);
    expect((await db.books.get(res.bookId))?.convert.state).toBe('done');
    expect(await db.contents.get(res.bookId)).toBeDefined();
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu gör**

Run: `pnpm test tests/import/importBook.test.ts`
Beklenen: FAIL — `src/import/importBook` bulunamadı.

- [ ] **Step 3: Uygulamayı yaz**

`src/import/importBook.ts`:
```ts
import { convertPdf } from '../convert/convertPdf';
import { CONVERTER_VERSION, type PdfSource } from '../convert/types';
import type { BookDB, BookRecord } from '../db/db';
import { chooseTitle } from './fileName';
import { sha256Hex } from './hash';

export interface OpenedPdf {
  source: PdfSource;
  /** 1. sayfayı kapak olarak çizer (data URL); ortam desteklemiyorsa undefined. */
  renderCover(width: number): Promise<string | undefined>;
  close(): Promise<void>;
}

export interface ImportDeps {
  db: BookDB;
  openPdf(bytes: Uint8Array, password?: string): Promise<OpenedPdf>;
  /** Şifre sorar; kullanıcı vazgeçerse null. */
  askPassword?(retry: boolean): Promise<string | null>;
}

export type ImportErrorCode = 'invalid-pdf' | 'password-cancelled' | 'quota';

export const IMPORT_ERROR_MESSAGES: Record<ImportErrorCode, string> = {
  'invalid-pdf': 'Bu dosya açılamadı. Geçerli bir PDF olduğundan emin ol.',
  'password-cancelled': 'Şifre girilmediği için kitap eklenmedi.',
  quota: 'Cihazda yer kalmadı. Bazı kitapları silip tekrar dene.',
};

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  constructor(code: ImportErrorCode, options?: { cause?: unknown }) {
    super(IMPORT_ERROR_MESSAGES[code], options);
    this.name = 'ImportError';
    this.code = code;
  }
}

export interface ImportResult {
  status: 'added' | 'exists';
  bookId: string;
  /** Dönüştürme bitince çözülür (hata olursa kitap 'failed' olarak işaretlenir). */
  done: Promise<void>;
}

/** 1. sayfada bundan az karakter varsa (kapak/başlık sayfası) o sayfa kapak görseli olur. */
const COVER_TEXT_LIMIT = 200;

export async function importBook(file: File, deps: ImportDeps): Promise<ImportResult> {
  const { db } = deps;
  const buffer = await file.arrayBuffer();
  const id = await sha256Hex(buffer);
  if (await db.books.get(id)) return { status: 'exists', bookId: id, done: Promise.resolve() };

  const { opened, password } = await openWithPassword(buffer, deps);
  try {
    const { source } = opened;
    const { title, author } = chooseTitle(await source.getMetadata(), file.name);
    const firstChars =
      source.numPages > 0
        ? (await source.getPageText(0)).items.reduce((n, it) => n + it.str.replace(/\s/g, '').length, 0)
        : 0;
    const cover = firstChars < COVER_TEXT_LIMIT ? await opened.renderCover(360).catch(() => undefined) : undefined;
    const record: BookRecord = {
      id,
      title,
      author,
      fileName: file.name,
      fileSize: file.size,
      pdfPageCount: source.numPages,
      lang: 'other',
      password,
      addedAt: Date.now(),
      convert: { state: 'pending', progress: 0, version: CONVERTER_VERSION },
      readingStatus: 'unread',
      totalWords: 0,
    };
    try {
      await db.transaction('rw', [db.books, db.files, db.covers], async () => {
        await db.books.add(record);
        await db.files.add({ bookId: id, blob: new Blob([buffer], { type: 'application/pdf' }) });
        if (cover) await db.covers.add({ bookId: id, dataUrl: cover });
      });
    } catch (e) {
      throw isQuotaError(e) ? new ImportError('quota', { cause: e }) : e;
    }
  } catch (e) {
    await opened.close();
    throw e;
  }

  const done = runConversion(db, id, opened).finally(() => opened.close());
  return { status: 'added', bookId: id, done };
}

async function openWithPassword(buffer: ArrayBuffer, deps: ImportDeps): Promise<{ opened: OpenedPdf; password?: string }> {
  let password: string | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      // pdf.js verinin sahipliğini worker'a devreder; kaydedeceğimiz asıl veriye dokunmasın diye kopya veriyoruz
      const opened = await deps.openPdf(new Uint8Array(buffer.slice(0)), password);
      return { opened, password };
    } catch (e) {
      if (!isPasswordError(e)) throw new ImportError('invalid-pdf', { cause: e });
      const answer = deps.askPassword ? await deps.askPassword(attempt > 0) : null;
      if (answer === null) throw new ImportError('password-cancelled', { cause: e });
      password = answer;
    }
  }
}

const active = new Set<string>();

/** PDF'i dönüştürür ve sonucu kaydeder. Aynı kitap için aynı anda yalnızca bir dönüştürme çalışır. */
export async function runConversion(db: BookDB, id: string, opened: OpenedPdf): Promise<void> {
  if (active.has(id)) return;
  active.add(id);
  let saved = 0;
  let chain = Promise.resolve();
  try {
    await db.books.update(id, { 'convert.state': 'running', 'convert.progress': 0 });
    const content = await convertPdf(opened.source, {
      onProgress: (p) => {
        if (p - saved < 0.05 && p < 1) return;
        saved = p;
        chain = chain.then(async () => {
          await db.books.update(id, { 'convert.progress': p });
        });
      },
    });
    await chain;
    await db.transaction('rw', [db.books, db.contents], async () => {
      await db.contents.put({ bookId: id, ...content });
      await db.books.update(id, {
        convert: { state: 'done', progress: 1, version: content.version },
        lang: content.lang,
        totalWords: content.totalWords,
      });
    });
  } catch (e) {
    await chain.catch(() => undefined);
    await db.books.update(id, { 'convert.state': 'failed', 'convert.error': e instanceof Error ? e.message : String(e) });
  } finally {
    active.delete(id);
  }
}

/** Uygulama kapanınca yarıda kalan dönüştürmeleri yeniden başlatır. */
export async function resumeConversions(deps: ImportDeps): Promise<void> {
  const { db } = deps;
  const pending = await db.books.filter((b) => b.convert.state === 'pending' || b.convert.state === 'running').toArray();
  for (const book of pending) {
    if (active.has(book.id)) continue;
    const file = await db.files.get(book.id);
    if (!file) {
      await db.books.update(book.id, { 'convert.state': 'failed', 'convert.error': 'Dosya bulunamadı' });
      continue;
    }
    let opened: OpenedPdf;
    try {
      opened = await deps.openPdf(new Uint8Array(await file.blob.arrayBuffer()), book.password);
    } catch (e) {
      await db.books.update(book.id, { 'convert.state': 'failed', 'convert.error': String(e) });
      continue;
    }
    await runConversion(db, book.id, opened).finally(() => opened.close());
  }
}

function isPasswordError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'PasswordException';
}

function isQuotaError(e: unknown): boolean {
  const err = e as { name?: string; inner?: { name?: string } } | null;
  return err?.name === 'QuotaExceededError' || err?.inner?.name === 'QuotaExceededError';
}
```

- [ ] **Step 4: Testlerin geçtiğini gör**

Run: `pnpm test tests/import/importBook.test.ts`
Beklenen: PASS (4 test).

- [ ] **Step 5: Tüm testler + tip kontrolü, commit**

```bash
pnpm test
pnpm typecheck
git add src/import/importBook.ts tests/import/importBook.test.ts
git commit -m "feat(import): içe aktarma, şifre sorma, tekrar engelleme, yarıda kalanı sürdürme"
```

---

### Task 13: Tarayıcı pdf.js bağdaştırıcıları

**Files:**
- Create: `src/pdf/pdfjs.ts`, `src/pdf/renderPage.ts`, `src/pdf/openPdf.ts`, `src/import/deps.ts`

- [ ] **Step 1: pdf.js yükleyicisi**

`src/pdf/pdfjs.ts`:
```ts
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

// Legacy build: güncellenmemiş iPad/iPhone Safari sürümlerinde de çalışır.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const assets = `${import.meta.env.BASE_URL}pdfjs/`;

export type PdfDocument = PDFDocumentProxy;

/** Tarayıcıda PDF açar. Not: pdf.js verinin sahipliğini worker'a devreder. */
export async function loadPdf(data: Uint8Array, password?: string): Promise<PdfDocument> {
  const task = pdfjs.getDocument({
    data,
    password,
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
    iccUrl: `${assets}iccs/`,
    isEvalSupported: false,
  });
  try {
    return await task.promise;
  } catch (e) {
    // Açılamazsa (bozuk dosya, yanlış şifre) worker'ı ve devredilen PDF verisini bırak; şifre denemelerinde birikmesin.
    task.destroy().catch(() => undefined);
    throw e;
  }
}
```

- [ ] **Step 2: Sayfa çizimi**

`src/pdf/renderPage.ts`:
```ts
import type { PdfDocument } from './pdfjs';

/** PDF sayfasını verilen piksel genişliğinde JPEG olarak çizer. */
export async function renderPageToBlob(doc: PdfDocument, pageIndex: number, targetWidth: number, quality = 0.85): Promise<Blob> {
  const page = await doc.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: targetWidth / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Sayfa görsele çevrilemedi'))), 'image/jpeg', quality),
  );
  // iOS Safari'de canvas belleğini hemen bırak
  canvas.width = 0;
  canvas.height = 0;
  return blob;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
```

- [ ] **Step 3: Tarayıcı `OpenedPdf` üretimi ve uygulama bağımlılıkları**

`src/pdf/openPdf.ts`:
```ts
import type { OpenedPdf } from '../import/importBook';
import { createPdfSource } from './pdfSource';
import { loadPdf } from './pdfjs';
import { blobToDataUrl, renderPageToBlob } from './renderPage';

export async function openPdfInBrowser(bytes: Uint8Array, password?: string): Promise<OpenedPdf> {
  const doc = await loadPdf(bytes, password);
  return {
    source: createPdfSource(doc),
    renderCover: async (width) => blobToDataUrl(await renderPageToBlob(doc, 0, width, 0.8)),
    close: () => doc.loadingTask.destroy(),
  };
}
```

`src/import/deps.ts`:
```ts
import { db } from '../db/db';
import { openPdfInBrowser } from '../pdf/openPdf';
import type { ImportDeps } from './importBook';

export const appImportDeps: ImportDeps = {
  db,
  openPdf: openPdfInBrowser,
  askPassword: async (retry) =>
    window.prompt(retry ? 'Şifre yanlış. Tekrar dener misin?' : 'Bu PDF şifreli. Şifresini gir:'),
};
```

- [ ] **Step 4: Doğrula ve commit**

```bash
pnpm typecheck
pnpm build
git add src/pdf src/import/deps.ts
git commit -m "feat(pdf): tarayıcıda pdf.js yükleme, sayfa çizimi ve kapak"
```
Beklenen: derleme hatasız. `dist/assets` altında `pdf.worker.min-*.mjs` dosyası bulunur.

---

### Task 14: Tema sistemi

**Files:**
- Create: `src/app/theme.ts`, `src/app/ThemePicker.tsx`
- Modify: `src/main.tsx`
- Test: `tests/app/theme.test.ts`

- [ ] **Step 1: Başarısız testi yaz**

`tests/app/theme.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { resolveTheme } from '../../src/app/theme';

describe('resolveTheme', () => {
  it('"sistem" ayarını cihaz tercihine göre çözer', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
  it('açık seçimleri olduğu gibi döndürür', () => {
    expect(resolveTheme('sepia', true)).toBe('sepia');
    expect(resolveTheme('black', false)).toBe('black');
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu gör**

Run: `pnpm test tests/app/theme.test.ts`
Beklenen: FAIL — modül bulunamadı.

- [ ] **Step 3: Tema modülünü yaz**

`src/app/theme.ts`:
```ts
import { useSyncExternalStore } from 'react';

export const THEMES = ['system', 'light', 'sepia', 'dark', 'black'] as const;
export type ThemeSetting = (typeof THEMES)[number];
export type ResolvedTheme = Exclude<ThemeSetting, 'system'>;

// Tema cihaza özel bir tercih olduğu için localStorage'da tutulur (index.html'deki betik ilk çizimden önce okur).
const KEY = 'mypdfbook:theme';
const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: '#f7f3ea',
  sepia: '#f1e4c6',
  dark: '#1b1a18',
  black: '#000000',
};

export function resolveTheme(setting: ThemeSetting, prefersDark: boolean): ResolvedTheme {
  if (setting === 'system') return prefersDark ? 'dark' : 'light';
  return setting;
}

function readSetting(): ThemeSetting {
  try {
    const value = localStorage.getItem(KEY) ?? 'system';
    return (THEMES as readonly string[]).includes(value) ? (value as ThemeSetting) : 'system';
  } catch {
    return 'system';
  }
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(): void {
  const theme = resolveTheme(readSetting(), darkQuery().matches);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}

export function setThemeSetting(value: ThemeSetting): void {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // gizli sekme vb.: tema yalnızca bu oturumda geçerli olur
  }
  applyTheme();
  listeners.forEach((listener) => listener());
}

export function useThemeSetting(): ThemeSetting {
  return useSyncExternalStore(subscribe, readSetting, () => 'system');
}

/** Açılışta bir kez çağrılır; sistem teması değişince de günceller. */
export function initTheme(): void {
  applyTheme();
  darkQuery().addEventListener('change', applyTheme);
}
```

- [ ] **Step 4: Tema seçici bileşeni**

`src/app/ThemePicker.tsx`:
```tsx
import { Check } from 'lucide-react';
import { setThemeSetting, THEMES, useThemeSetting, type ThemeSetting } from './theme';

const LABELS: Record<ThemeSetting, string> = {
  system: 'Sistem',
  light: 'Açık',
  sepia: 'Sepya',
  dark: 'Koyu',
  black: 'Siyah',
};

const SWATCHES: Record<ThemeSetting, string> = {
  system: 'linear-gradient(135deg, #f7f3ea 50%, #1b1a18 50%)',
  light: '#f7f3ea',
  sepia: '#f1e4c6',
  dark: '#1b1a18',
  black: '#000000',
};

export function ThemePicker() {
  const current = useThemeSetting();
  return (
    <div role="radiogroup" aria-label="Tema" className="flex flex-wrap gap-3">
      {THEMES.map((theme) => (
        <button
          key={theme}
          type="button"
          role="radio"
          aria-checked={current === theme}
          data-testid={`theme-${theme}`}
          onClick={() => setThemeSetting(theme)}
          className="flex flex-col items-center gap-1 text-xs text-muted"
        >
          <span
            className="grid size-10 place-items-center rounded-full border border-line"
            style={{ background: SWATCHES[theme] }}
          >
            {current === theme && <Check className="size-4 text-accent" strokeWidth={3} />}
          </span>
          {LABELS[theme]}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Açılışta temayı uygula**

`src/main.tsx` (tamamı):
```tsx
import '@fontsource-variable/literata/index.css';
import './styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './app/App';
import { initTheme } from './app/theme';

initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 6: Testler ve commit**

```bash
pnpm test tests/app/theme.test.ts
pnpm typecheck
git add src/app src/main.tsx tests/app
git commit -m "feat(app): açık/sepya/koyu/siyah tema ve sistem temasını izleme"
```
Beklenen: 2 test PASS, tip kontrolü hatasız.

---

### Task 15: Kütüphane ekranı (uçtan uca testle)

**Files:**
- Create: `playwright.config.ts`, `e2e/helpers.ts`, `e2e/library.spec.ts`, `src/library/LibraryPage.tsx`, `src/library/BookCard.tsx`, `src/library/BookCover.tsx`
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Playwright yapılandırması ve yardımcılar**

`playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { baseURL: 'http://localhost:5174', trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm exec vite --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: 'masaustu-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'ipad', use: { ...devices['iPad Pro 11 landscape'] } },
    { name: 'pixel', use: { ...devices['Pixel 7'] } },
  ],
});
```

`e2e/helpers.ts`:
```ts
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const fixtures = path.resolve(import.meta.dirname, '..', 'tests', 'fixtures');

/** Fixture PDF'ini (istenirse farklı bir dosya adıyla) içe aktarır. */
export async function importFixture(page: Page, file: string, name = file): Promise<void> {
  const buffer = await readFile(path.join(fixtures, file));
  await page.getByTestId('file-input').setInputFiles({ name, mimeType: 'application/pdf', buffer });
}
```

- [ ] **Step 2: Başarısız uçtan uca testi yaz**

`e2e/library.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { importFixture } from './helpers';

test('PDF içe aktarılır, dönüştürülür ve kütüphanede görünür', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Henüz kitap yok')).toBeVisible();
  await importFixture(page, 'novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf');
  const card = page.getByTestId('book-card').filter({ hasText: 'Kayıp Şehrin Işıkları' });
  await expect(card).toContainText('Deniz Aksoy');
  await expect(card.getByTestId('book-open')).toBeVisible();
  await expect(card.locator('img')).toBeVisible(); // başlık sayfası kapak olarak çizildi
});

test('aynı PDF ikinci kez eklenmez', async ({ page }) => {
  await page.goto('/');
  await importFixture(page, 'english.pdf');
  await expect(page.getByTestId('book-open')).toHaveCount(1);
  await importFixture(page, 'english.pdf', 'kopya.pdf');
  await expect(page.getByRole('status')).toContainText('zaten kütüphanende');
  await expect(page.getByTestId('book-card')).toHaveCount(1);
});

test('kitap silinebilir', async ({ page }) => {
  await page.goto('/');
  await importFixture(page, 'english.pdf');
  await expect(page.getByTestId('book-card')).toHaveCount(1);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: /kitabını sil/ }).click();
  await expect(page.getByTestId('book-card')).toHaveCount(0);
  await expect(page.getByText('Henüz kitap yok')).toBeVisible();
});
```

- [ ] **Step 3: Testin başarısız olduğunu gör**

Run: `pnpm e2e e2e/library.spec.ts --project=masaustu-chrome`
Beklenen: FAIL — "Henüz kitap yok" metni bulunamaz (uygulama hâlâ iskelet).

- [ ] **Step 4: Kapak bileşeni**

`src/library/BookCover.tsx`:
```tsx
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type BookRecord } from '../db/db';

/** Kapak görseli varsa onu, yoksa başlık/yazarla renkli bir kapak çizer. Kapak ayrı tablodan, yalnızca bu kitap için okunur. */
export function BookCover({ book }: { book: Pick<BookRecord, 'id' | 'title' | 'author'> }) {
  // undefined = yükleniyor, null = kapak yok
  const cover = useLiveQuery(() => db.covers.get(book.id).then((c) => c ?? null), [book.id]);
  const frame = 'aspect-[2/3] w-full rounded-l-sm rounded-r-md shadow-md ring-1 ring-black/10';
  if (cover === undefined) return <div className={`${frame} bg-line`} />;
  if (cover) return <img src={cover.dataUrl} alt="" className={`${frame} object-cover`} />;
  const hue = parseInt(book.id.slice(0, 6), 16) % 360;
  return (
    <div
      className={`${frame} flex flex-col justify-between border-l-4 border-black/20 p-3`}
      style={{
        background: `linear-gradient(160deg, hsl(${hue} 38% 34%), hsl(${(hue + 30) % 360} 42% 22%))`,
        color: 'hsl(40 40% 92%)',
      }}
    >
      <span className="line-clamp-5 font-book text-sm leading-tight">{book.title}</span>
      <span className="line-clamp-2 text-[11px] opacity-80">{book.author}</span>
    </div>
  );
}
```

- [ ] **Step 5: Kitap kartı**

`src/library/BookCard.tsx`:
```tsx
import { Trash2 } from 'lucide-react';
import { Link } from 'react-router';
import { deleteBook } from '../db/books';
import { db, type BookRecord } from '../db/db';
import { BookCover } from './BookCover';

export function BookCard({ book, percent }: { book: BookRecord; percent: number }) {
  const ready = book.convert.state === 'done';

  async function onDelete() {
    if (window.confirm(`“${book.title}” kütüphaneden silinsin mi?`)) await deleteBook(db, book.id);
  }

  return (
    <article data-testid="book-card" className="flex flex-col gap-2">
      {ready ? (
        <Link to={`/read/${book.id}`} data-testid="book-open" aria-label={`${book.title} kitabını aç`}>
          <BookCover book={book} />
        </Link>
      ) : (
        <BookCover book={book} />
      )}
      <div className="min-w-0">
        <h3 className="line-clamp-2 font-book text-sm leading-snug">{book.title}</h3>
        {book.author && <p className="truncate text-xs text-muted">{book.author}</p>}
      </div>
      <Status book={book} percent={percent} />
      <button
        type="button"
        onClick={() => void onDelete()}
        aria-label={`${book.title} kitabını sil`}
        className="flex items-center gap-1 self-start text-xs text-muted hover:text-ink"
      >
        <Trash2 className="size-3.5" /> Sil
      </button>
    </article>
  );
}

function Status({ book, percent }: { book: BookRecord; percent: number }) {
  if (book.convert.state === 'failed') return <p className="text-xs text-red-600">Dönüştürülemedi</p>;
  if (book.convert.state !== 'done') {
    return <p className="text-xs text-muted">Hazırlanıyor… %{Math.round(book.convert.progress * 100)}</p>;
  }
  const value = Math.round(percent * 100);
  return (
    <div className="h-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={value} aria-label={`%${value} okundu`}>
      <div className="h-full bg-accent" style={{ width: `${value}%` }} />
    </div>
  );
}
```

- [ ] **Step 6: Kütüphane ekranı**

`src/library/LibraryPage.tsx`:
```tsx
import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { ThemePicker } from '../app/ThemePicker';
import { db, type BookRecord } from '../db/db';
import { appImportDeps } from '../import/deps';
import { ImportError, importBook, resumeConversions } from '../import/importBook';
import { BookCard } from './BookCard';
import { BookCover } from './BookCover';

export function LibraryPage() {
  const books = useLiveQuery(() => db.books.orderBy('addedAt').reverse().toArray(), []);
  const progress = useLiveQuery(async () => new Map((await db.progress.toArray()).map((p) => [p.bookId, p.percent])), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    void resumeConversions(appImportDeps);
  }, []);

  async function handleFiles(files: FileList | File[]) {
    setMessage(null);
    const pdfs = [...files].filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length === 0) {
      setMessage('Lütfen PDF dosyası seç.');
      return;
    }
    for (const file of pdfs) {
      try {
        const res = await importBook(file, appImportDeps);
        if (res.status === 'exists') setMessage(`“${file.name}” zaten kütüphanende.`);
        else void navigator.storage?.persist?.(); // tarayıcıdan verileri silmemesini iste
        await res.done;
      } catch (e) {
        setMessage(e instanceof ImportError ? e.message : 'Beklenmeyen bir hata oluştu.');
      }
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void handleFiles(e.dataTransfer.files);
  }

  const lastRead = books
    ?.filter((b) => b.lastOpenedAt && b.convert.state === 'done')
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0];

  return (
    <div
      className="min-h-dvh bg-paper text-ink"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <header className="sticky top-0 z-10 border-b border-line bg-paper/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <h1 className="flex items-center gap-2 font-book text-xl">
            <BookOpen className="size-6 text-accent" /> Kitaplığım
          </h1>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-paper"
          >
            <Plus className="size-4" /> PDF ekle
          </button>
          <input
            ref={inputRef}
            data-testid="file-input"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-6">
        {message && (
          <p role="status" className="mb-4 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
            {message}
          </p>
        )}
        {lastRead && <ContinueCard book={lastRead} percent={progress?.get(lastRead.id) ?? 0} />}
        {books && books.length === 0 ? (
          <div className="grid place-items-center gap-3 py-24 text-center">
            <p className="font-book text-lg">Henüz kitap yok.</p>
            <p className="text-sm text-muted">Bir PDF sürükleyip bırak ya da “PDF ekle”ye dokun.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {books?.map((book) => (
              <li key={book.id}>
                <BookCard book={book} percent={progress?.get(book.id) ?? 0} />
              </li>
            ))}
          </ul>
        )}
        <section className="mt-12 border-t border-line pt-6">
          <h2 className="mb-3 text-sm text-muted">Tema</h2>
          <ThemePicker />
        </section>
      </main>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 grid place-items-center bg-paper/80 font-book text-xl">
          PDF'i bırak
        </div>
      )}
    </div>
  );
}

function ContinueCard({ book, percent }: { book: BookRecord; percent: number }) {
  return (
    <Link to={`/read/${book.id}`} className="mb-8 flex items-center gap-4 rounded-xl border border-line bg-surface p-4">
      <div className="w-16 shrink-0">
        <BookCover book={book} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-wide text-muted">Okumaya devam et</p>
        <p className="truncate font-book text-lg">{book.title}</p>
        <p className="text-xs text-muted">%{Math.round(percent * 100)} okundu</p>
      </div>
    </Link>
  );
}
```

- [ ] **Step 7: Yönlendirme**

`src/app/App.tsx` (tamamı; okuma ekranı Task 16'da eklenir):
```tsx
import { Route, Routes } from 'react-router';
import { LibraryPage } from '../library/LibraryPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LibraryPage />} />
    </Routes>
  );
}
```

- [ ] **Step 8: Testlerin geçtiğini gör**

Run: `pnpm e2e e2e/library.spec.ts`
Beklenen: 3 test × 3 cihaz = 9 PASS.

Ayrıca `pnpm build` çalıştır: arayüz artık `src/pdf` modüllerini içe aktardığı için `dist/assets` altında `pdf.worker.min-*.mjs` bulunmalı.

- [ ] **Step 9: Commit**

```bash
pnpm typecheck
pnpm lint
git add playwright.config.ts e2e src/library src/app/App.tsx
git commit -m "feat(library): kütüphane ekranı, içe aktarma, kapaklar, silme; uçtan uca testler"
```

---

### Task 16: Geçici kaydırmalı okuma ekranı ve orijinal sayfa

**Files:**
- Create: `src/reader/progress.ts`, `src/reader/usePdfDocument.ts`, `src/reader/PageImage.tsx`, `src/reader/OriginalPageDialog.tsx`, `src/reader/ScrollReader.tsx`, `src/reader/ReaderPage.tsx`, `e2e/reader.spec.ts`
- Modify: `src/app/App.tsx`, `src/styles/index.css`
- Test: `tests/reader/progress.test.ts`

- [ ] **Step 1: İlerleme hesabı için başarısız birim testi**

`tests/reader/progress.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { Block } from '../../src/convert/types';
import { blockStartFractions } from '../../src/reader/progress';

describe('blockStartFractions', () => {
  it('blokların başlangıç oranını metin uzunluğuna göre hesaplar (görsel sayfa = 400 karakter)', () => {
    const blocks: Block[] = [
      { kind: 'para', text: 'a'.repeat(100), srcPage: 0 },
      { kind: 'pageImage', srcPage: 1 },
      { kind: 'para', text: 'b'.repeat(500), srcPage: 2 },
    ];
    expect(blockStartFractions(blocks)).toEqual([0, 0.1, 0.5]);
  });
});
```

Run: `pnpm test tests/reader/progress.test.ts`
Beklenen: FAIL — modül bulunamadı.

- [ ] **Step 2: İlerleme hesabını yaz**

`src/reader/progress.ts`:
```ts
import type { Block } from '../convert/types';

/** Metinsiz bloklar (görsel sayfa, sahne arası) bu kadar karakter sayılır. */
const IMAGE_WEIGHT = 400;

/** Her bloğun kitap içindeki başlangıç oranı (0..1). */
export function blockStartFractions(blocks: Block[]): number[] {
  const weights = blocks.map((b) => ('text' in b ? b.text.length : IMAGE_WEIGHT));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  return weights.map((w) => {
    const start = acc / total;
    acc += w;
    return start;
  });
}
```

Run: `pnpm test tests/reader/progress.test.ts`
Beklenen: PASS.

- [ ] **Step 3: Başarısız uçtan uca testi yaz**

`e2e/reader.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { importFixture } from './helpers';

test('kitap açılır, metin okunur, orijinal sayfa görülür, tema kalıcıdır', async ({ page }) => {
  await page.goto('/');
  await importFixture(page, 'novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf');
  await page.getByTestId('book-open').click();

  await expect(page.getByRole('heading', { name: 'BİRİNCİ BÖLÜM' })).toBeVisible();
  await expect(page.getByText('— Nereye gidiyorsun? dedi annesi mutfaktan seslenerek.')).toBeVisible();

  await page.getByTestId('original-page').click();
  await expect(page.getByRole('img', { name: /Orijinal sayfa/ })).toBeVisible();
  await page.getByRole('button', { name: 'Kapat' }).click();

  await page.getByTestId('reader-settings').click();
  await page.getByTestId('theme-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('heading', { name: 'BİRİNCİ BÖLÜM' })).toBeVisible();
});

test('taranmış PDF sayfaları görsel olarak gösterilir', async ({ page }) => {
  await page.goto('/');
  await importFixture(page, 'scanned.pdf');
  await page.getByTestId('book-open').click();
  await expect(page.getByRole('img', { name: 'Sayfa 1' })).toBeVisible({ timeout: 30_000 });
});
```

Run: `pnpm e2e e2e/reader.spec.ts --project=masaustu-chrome`
Beklenen: FAIL — `/read/...` rotası yok, başlık bulunamaz.

- [ ] **Step 4: PDF belgesi kancası ve sayfa görseli**

`src/reader/usePdfDocument.ts`:
```ts
import { useEffect, useState } from 'react';
import { db } from '../db/db';
import { loadPdf, type PdfDocument } from '../pdf/pdfjs';

/** Kitabın saklanan PDF'ini açar; bileşen kapanınca kapatır. bookId null ise (kitap kaydı henüz yüklenmedi) bekler. */
export function usePdfDocument(bookId: string | null, password?: string): PdfDocument | null {
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    let loaded: PdfDocument | null = null;
    void (async () => {
      try {
        const file = await db.files.get(bookId);
        if (!file || cancelled) return;
        const pdf = await loadPdf(new Uint8Array(file.data), password);
        if (cancelled) {
          void pdf.loadingTask.destroy();
          return;
        }
        loaded = pdf;
        setDoc(pdf);
      } catch {
        // dosya bozuk ya da şifre değişmiş: orijinal sayfa ve görsel sayfalar devre dışı kalır
      }
    })();
    return () => {
      cancelled = true;
      void loaded?.loadingTask.destroy();
    };
  }, [bookId, password]);
  return doc;
}
```

`src/reader/PageImage.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import type { PdfDocument } from '../pdf/pdfjs';
import { renderPageToBlob } from '../pdf/renderPage';

/** Metinsiz PDF sayfasını görünür olunca çizer. */
export function PageImage({ pdf, pageIndex }: { pdf: PdfDocument | null; pageIndex: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '600px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !visible) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    const width = Math.min(1600, Math.round((ref.current?.clientWidth ?? 600) * Math.min(window.devicePixelRatio || 1, 2)));
    renderPageToBlob(pdf, pageIndex, width)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pdf, visible, pageIndex]);

  return (
    <div ref={ref} className="page-image aspect-[2/3] w-full overflow-hidden rounded-sm bg-surface shadow">
      {url ? (
        <img src={url} alt={`Sayfa ${pageIndex + 1}`} className="size-full object-contain" />
      ) : (
        <div className="grid size-full place-items-center text-sm text-muted">Sayfa {pageIndex + 1} yükleniyor…</div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Orijinal sayfa penceresi**

`src/reader/OriginalPageDialog.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import type { PdfDocument } from '../pdf/pdfjs';
import { renderPageToBlob } from '../pdf/renderPage';

interface Props {
  pdf: PdfDocument;
  pageIndex: number;
  pageCount: number;
  onChange(pageIndex: number): void;
  onClose(): void;
}

/** PDF'in aslını gösterir (dönüştürmede kaybolan tablo/resim için). */
export function OriginalPageDialog({ pdf, pageIndex, pageCount, onChange, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    // StrictMode'da efekt iki kez çalışır; açık pencereyi yeniden açmaya çalışma
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    const width = Math.min(1400, Math.round(window.innerWidth * Math.min(window.devicePixelRatio || 1, 2)));
    renderPageToBlob(pdf, pageIndex, width)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pdf, pageIndex]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-black/95 p-0 text-white backdrop:bg-black/60"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <span className="text-sm">
            Orijinal sayfa {pageIndex + 1} / {pageCount}
          </span>
          <button type="button" onClick={() => ref.current?.close()} className="rounded-full bg-white/10 px-3 py-1 text-sm">
            Kapat
          </button>
        </div>
        <div className="flex-1 overflow-auto px-2">
          {url ? (
            <img src={url} alt={`Orijinal sayfa ${pageIndex + 1}`} className="mx-auto h-auto max-w-full bg-white" />
          ) : (
            <p className="p-8 text-center">Yükleniyor…</p>
          )}
        </div>
        <div className="flex justify-center gap-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <button
            type="button"
            disabled={pageIndex === 0}
            onClick={() => onChange(pageIndex - 1)}
            className="rounded-full bg-white/10 px-4 py-2 disabled:opacity-40"
          >
            ‹ Önceki
          </button>
          <button
            type="button"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => onChange(pageIndex + 1)}
            className="rounded-full bg-white/10 px-4 py-2 disabled:opacity-40"
          >
            Sonraki ›
          </button>
        </div>
      </div>
    </dialog>
  );
}
```

- [ ] **Step 6: Kaydırmalı okuyucu**

`src/reader/ScrollReader.tsx`:
```tsx
import { useEffect, useMemo, useRef } from 'react';
import type { Block, Lang } from '../convert/types';
import { saveProgress } from '../db/books';
import { db } from '../db/db';
import type { PdfDocument } from '../pdf/pdfjs';
import { PageImage } from './PageImage';
import { blockStartFractions } from './progress';

interface Props {
  bookId: string;
  blocks: Block[];
  lang: Lang;
  initialBlock: number;
  pdf: PdfDocument | null;
  onVisiblePage(pageIndex: number): void;
}

/** Geçici okuma görünümü (Plan 2'de kitap görünümüyle değişir). İlerlemeyi görünen ilk bloğa göre kaydeder. */
export function ScrollReader({ bookId, blocks, lang, initialBlock, pdf, onVisiblePage }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fractions = useMemo(() => blockStartFractions(blocks), [blocks]);

  useEffect(() => {
    containerRef.current?.querySelector(`[data-block="${initialBlock}"]`)?.scrollIntoView({ block: 'start' });
  }, [initialBlock]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const visible = new Set<number>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.block);
          if (entry.isIntersecting) visible.add(index);
          else visible.delete(index);
        }
        if (visible.size === 0) return;
        const first = Math.min(...visible);
        onVisiblePage(blocks[first]?.srcPage ?? 0);
        clearTimeout(timer);
        timer = setTimeout(() => void saveProgress(db, bookId, { block: first, offset: 0 }, fractions[first] ?? 0), 400);
      },
      { rootMargin: '0px 0px -70% 0px' },
    );
    root.querySelectorAll('[data-block]').forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [blocks, bookId, fractions, onVisiblePage]);

  return (
    <div ref={containerRef} lang={lang === 'en' ? 'en' : 'tr'} className="book-text mx-auto max-w-[38rem] px-5 pb-32 pt-6">
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} index={index} pdf={pdf} />
      ))}
    </div>
  );
}

function BlockView({ block, index, pdf }: { block: Block; index: number; pdf: PdfDocument | null }) {
  switch (block.kind) {
    case 'heading':
      return block.level === 1 ? (
        <h2 data-block={index} className="mb-2 mt-16 text-center font-book text-2xl tracking-wide">
          {block.text}
        </h2>
      ) : (
        <h3 data-block={index} className="mb-10 text-center font-book text-lg italic text-muted">
          {block.text}
        </h3>
      );
    case 'para':
      return (
        <p data-block={index} className="book-para">
          {block.text}
        </p>
      );
    case 'note':
      return (
        <aside data-block={index} className="my-3 border-l-2 border-line pl-3 text-sm text-muted">
          {block.text}
        </aside>
      );
    case 'break':
      return (
        <div data-block={index} className="book-break my-6 text-center text-muted" aria-hidden>
          ⁂
        </div>
      );
    case 'pageImage':
      return (
        <div data-block={index} className="my-6">
          <PageImage pdf={pdf} pageIndex={block.srcPage} />
        </div>
      );
  }
}
```

- [ ] **Step 7: Okuma ekranı**

`src/reader/ReaderPage.tsx`:
```tsx
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, FileText } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ThemePicker } from '../app/ThemePicker';
import { markOpened } from '../db/books';
import { db } from '../db/db';
import { OriginalPageDialog } from './OriginalPageDialog';
import { ScrollReader } from './ScrollReader';
import { usePdfDocument } from './usePdfDocument';

export function ReaderPage() {
  const { bookId = '' } = useParams();
  // undefined = yükleniyor, null = yok
  const book = useLiveQuery(() => db.books.get(bookId).then((b) => b ?? null), [bookId]);
  const content = useLiveQuery(() => db.contents.get(bookId).then((c) => c ?? null), [bookId]);
  const pdf = usePdfDocument(book ? book.id : null, book?.password);
  const [currentPage, setCurrentPage] = useState(0);
  const [originalPage, setOriginalPage] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [initialBlock, setInitialBlock] = useState<number | null>(null);

  useEffect(() => {
    if (bookId) void markOpened(db, bookId);
  }, [bookId]);

  // Kaldığı yer yalnızca açılışta bir kez okunur; okurken yapılan kayıtlar kaydırmayı etkilemez.
  useEffect(() => {
    let alive = true;
    void db.progress.get(bookId).then((p) => {
      if (alive) setInitialBlock(p?.locator.block ?? 0);
    });
    return () => {
      alive = false;
    };
  }, [bookId]);

  if (book === null) return <Centered>Kitap bulunamadı. <BackLink /></Centered>;
  if (book === undefined || content === undefined || initialBlock === null) return <Centered>Yükleniyor…</Centered>;
  if (book.convert.state === 'failed') return <Centered>Bu kitap dönüştürülemedi. <BackLink /></Centered>;
  if (book.convert.state !== 'done' || content === null) {
    return <Centered>Kitap hazırlanıyor… %{Math.round(book.convert.progress * 100)}</Centered>;
  }

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-paper/90 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur">
        <Link to="/" aria-label="Kütüphaneye dön" className="rounded-full p-2 hover:bg-surface">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-book">{book.title}</h1>
        <button
          type="button"
          data-testid="original-page"
          disabled={!pdf}
          onClick={() => setOriginalPage(currentPage)}
          className="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm hover:bg-surface disabled:opacity-40"
        >
          <FileText className="size-4" /> Orijinal sayfa
        </button>
        <button
          type="button"
          data-testid="reader-settings"
          aria-expanded={showSettings}
          onClick={() => setShowSettings((s) => !s)}
          className="rounded-full px-3 py-1.5 font-book text-sm hover:bg-surface"
        >
          Aa
        </button>
      </header>
      {showSettings && (
        <div className="border-b border-line bg-surface px-4 py-4">
          <ThemePicker />
        </div>
      )}
      <ScrollReader
        bookId={book.id}
        blocks={content.blocks}
        lang={content.lang}
        initialBlock={initialBlock}
        pdf={pdf}
        onVisiblePage={setCurrentPage}
      />
      {originalPage !== null && pdf && (
        <OriginalPageDialog
          pdf={pdf}
          pageIndex={originalPage}
          pageCount={book.pdfPageCount}
          onChange={setOriginalPage}
          onClose={() => setOriginalPage(null)}
        />
      )}
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="grid min-h-dvh place-items-center bg-paper p-6 text-center text-ink">{children}</div>;
}

function BackLink() {
  return (
    <Link to="/" className="text-accent underline">
      Kütüphaneye dön
    </Link>
  );
}
```

- [ ] **Step 8: Kitap metni stilleri ve rota**

`src/styles/index.css` dosyasının sonuna ekle:
```css
.book-text {
  font-family: var(--font-book);
  font-size: 1.125rem;
  line-height: 1.7;
  text-align: justify;
  hyphens: auto;
}
.book-para {
  margin: 0;
  text-indent: 1.5em;
}
h2 + .book-para,
h3 + .book-para,
.book-break + .book-para {
  text-indent: 0;
}
:root[data-theme='dark'] .page-image img,
:root[data-theme='black'] .page-image img {
  filter: brightness(0.85);
}
```

`src/app/App.tsx` (tamamı):
```tsx
import { Route, Routes } from 'react-router';
import { LibraryPage } from '../library/LibraryPage';
import { ReaderPage } from '../reader/ReaderPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LibraryPage />} />
      <Route path="/read/:bookId" element={<ReaderPage />} />
    </Routes>
  );
}
```

- [ ] **Step 9: Testlerin geçtiğini gör**

```bash
pnpm test
pnpm e2e
```
Beklenen: Vitest'te tüm birim ve dönüştürücü testleri PASS. Playwright'ta 5 test × 3 cihaz = 15 PASS.

- [ ] **Step 10: Commit**

```bash
pnpm typecheck
pnpm lint
git add src/reader src/app/App.tsx src/styles/index.css tests/reader e2e/reader.spec.ts
git commit -m "feat(reader): kaydırmalı okuma ekranı, ilerleme kaydı, orijinal sayfa, taranmış sayfa görselleri"
```

---

### Task 17: README ve son doğrulama

**Files:**
- Create: `README.md`

- [ ] **Step 1: README yaz**

`README.md`:
````markdown
# mypdfbook

İnternetten indirdiğin kitap PDF'lerini metne dönüştürüp gerçek bir kitap gibi okuyan web uygulaması.
Kitaplar ve notlar yalnızca bu cihazda (tarayıcının IndexedDB'sinde) saklanır.

## Çalıştırma

```bash
pnpm install      # bağımlılıklar + pdf.js varlıkları (public/pdfjs)
pnpm dev          # http://localhost:5173
pnpm dev:ipad     # HTTPS + yerel ağ: iPad'den https://<bilgisayarın-ip>:5173 (sertifika uyarısını kabul et)
```

## Test

```bash
pnpm test         # birim + dönüştürücü testleri (Node, gerçek PDF'lerle)
pnpm e2e          # uçtan uca testler (masaüstü Chrome, iPad WebKit, Pixel)
pnpm typecheck
pnpm lint
```

## Dönüştürücüyü gerçek bir kitapla denemek

```bash
pnpm convert "C:\Kitaplar\kitap.pdf"          # okunabilir döküm
pnpm convert "C:\Kitaplar\kitap.pdf" --json   # ham çıktı
```

## Test PDF'lerini yeniden üretmek

```bash
pnpm exec playwright install chromium
pnpm fixtures
```

## Yapı

| Klasör | İçerik |
|---|---|
| `src/convert` | PDF → metin dönüştürücü (DOM'suz, saf TypeScript) |
| `src/pdf` | pdf.js bağdaştırıcıları |
| `src/db` | IndexedDB şeması (Dexie) |
| `src/import` | içe aktarma akışı |
| `src/library` | kütüphane ekranı |
| `src/reader` | okuma ekranı |
| `docs/superpowers` | tasarım ve uygulama planları |
````

- [ ] **Step 2: Biçimlendir ve tam doğrulama yap**

```bash
pnpm format
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm e2e
```
Beklenen: hepsi hatasız. Vitest'te 9 test dosyası PASS, Playwright'ta 15 test PASS.

- [ ] **Step 3: Elle deneme**

`pnpm dev`'i çalıştır ve tarayıcıda http://localhost:5173 adresini aç.
1. `tests/fixtures/novel-tr.pdf`'i sürükleyip bırak. Kart "Hazırlanıyor… %…" yazısından sonra kapakla açılmalı.
2. Kitabı aç. Başlıklar ortalı, paragraflar girintili, diyaloglar ayrı satırda görünmeli. Dipnot, paragraftan sonra küçük yazıyla gelmeli.
3. "Aa" → "Koyu" seç. Kütüphaneye dönüp sayfayı yenilediğinde tema korunmalı.
4. Kitabı kapatıp yeniden aç. Kaldığın bölüm açılmalı.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: README; biçimlendirme"
```

---

## Plan sonu kontrol listesi (tasarıma göre)
- [x] PDF içe aktarma: seçici, sürükle-bırak, çoklu dosya, SHA-256 ile tekrar engelleme → Task 11, 12, 15
- [x] Başlık/yazar: metadata + dosya adı → Task 11
- [x] Kapak: az metinli 1. sayfa ya da renkli kapak → Task 12, 13, 15
- [x] Şifreli PDF, depolama dolu hatası, `storage.persist()` → Task 12, 13, 15
- [x] Dönüştürücü: satırlar, üst/alt bilgi, paragraf (sayfa geçişi dahil), tire, başlık, dipnot, sahne arası, Türkçe onarım, dil, bölümler, metinsiz sayfa → Task 3–8
- [x] Dönüştürücü sürümü, ilerleme, yarıda kalanı sürdürme → Task 3, 8, 12
- [x] Tema (açık/sepya/koyu/siyah/sistem) → Task 14
- [x] Orijinal sayfa → Task 16
- [ ] Başlık düzenleme, iOS "Ana Ekrana Ekle" rehberi → Plan 3
- [ ] Kitap görünümü, sayfa çevirme seçenekleri, tipografi, cümle dizini → Plan 2
- [ ] Odak modu, hızlı okuma, oturum kaydı, PWA → Plan 3
