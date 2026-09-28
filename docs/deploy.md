# Yayınlama (barındırma)

mypdfbook tamamen statik bir uygulamadır: sunucu, veritabanı ya da üyelik yoktur. Kitaplar yalnızca cihazın
tarayıcısında (IndexedDB) durur, hiçbir yere yüklenmez. Yayınlamak, `pnpm build` çıktısı olan `dist/` klasörünü
HTTPS veren bir statik barındırmaya koymaktan ibarettir. iPad'de service worker (çevrimdışı çalışma) ve "Ana Ekrana
Ekle" HTTPS ister; aşağıdaki iki seçenek de ücretsiz HTTPS verir.

> Bu depo kendiliğinden hiçbir yere yayınlanmaz. Aşağıdaki adımlar, karar verildiğinde elle kurulmak içindir.

## Derleme

```sh
pnpm install          # pdf.js varlıklarını public/pdfjs'e de kopyalar (postinstall)
pnpm build            # tsc -b && vite build → dist/
pnpm preview          # derlemeyi yerelde dener (service worker yalnızca derlemede vardır)
```

`dist/` içinde uygulama, `sw.js` (service worker), `manifest.webmanifest`, simgeler ve `pdfjs/` bulunur.
Derleme sonunda `precache N entries (… KiB)` satırı, çevrimdışı için önbelleğe alınan dosyaları gösterir.

### Alt yol: `BASE_PATH`

Uygulama bir alt yolda yayınlanacaksa (ör. `https://kullanici.github.io/myPDFbook/`) derlemede `BASE_PATH` verilir.
Router, pdf.js varlık adresleri, manifest (`start_url`, `scope`) ve service worker kapsamı bundan türetilir.
Verilmezse `/` (alan adının kökü) kullanılır.

```powershell
# PowerShell
$env:BASE_PATH = '/myPDFbook/'; pnpm build; Remove-Item Env:BASE_PATH
```

```sh
# Git Bash: MSYS_NO_PATHCONV=1 olmadan /myPDFbook/ bir Windows yoluna çevrilir (derleme bunu fark edip durur)
MSYS_NO_PATHCONV=1 BASE_PATH=/myPDFbook/ pnpm build
# macOS / Linux / GitHub Actions
BASE_PATH=/myPDFbook/ pnpm build
```

Alt yollu derleme yerelde `pnpm preview` ile `http://localhost:4173/myPDFbook/` adresinde denenir.
`pnpm e2e:pwa` da derlemeyi bu alt yolla sınar.

## Seçenek 1 — GitHub Pages (aynı depodan)

- Adres: `https://batuhanbasswe.github.io/myPDFbook/` → `BASE_PATH=/myPDFbook/`.
- Ücretsiz planda depo **herkese açık** olmalıdır (kod görünür; kitaplar zaten depoda değildir).
- GitHub Pages tek sayfalı uygulama yönlendirmesi yapmaz: `/myPDFbook/read/…` adresi service worker kurulmadan
  (ilk ziyarette ya da yer imiyle) açılırsa 404 döner. Çözüm: derlemeden sonra `dist/index.html`'i `dist/404.html`
  olarak kopyalamak. Service worker kurulduktan sonra bu adresler zaten önbellekteki `index.html` ile açılır.
- Tüm dosyalar ~10 dk önbellek başlığıyla sunulur; service worker güncellemesi bundan etkilenmez (tarayıcı `sw.js`'i
  her denetimde sunucudan ister). Yeni sürüm yayınlanınca uygulamada "Yeni sürüm hazır — Yenile" görünür.

Kurulum (bir kez):

1. Depoda **Settings → Pages → Build and deployment → Source: GitHub Actions** seçilir.
2. Aşağıdaki iş akışı `.github/workflows/pages.yml` olarak eklenir. Bu örnek yalnızca elle başlatılır
   (`workflow_dispatch`: **Actions → Pages → Run workflow**); her `main` gönderiminde yayınlansın istenirse
   `on:` altına `push: { branches: [main] }` eklenir.

```yaml
name: Pages
on:
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4 # sürümü package.json'daki packageManager alanından alır
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
        env:
          BASE_PATH: /${{ github.event.repository.name }}/
      - run: cp dist/index.html dist/404.html
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

Not: `*.github.io` kökeni, aynı hesabın bütün Pages sitelerince paylaşılır (depolama kotası da). Service worker
yalnızca `/myPDFbook/` altını denetler.

## Seçenek 2 — Cloudflare Pages

- Adres: `https://<proje-adı>.pages.dev/` (istenirse kendi alan adı) → kökte yayınlanır, `BASE_PATH` verilmez.
- Depo gizli kalabilir. Tek sayfalı uygulama yönlendirmesi kendiliğinden yapılır: `dist/` içinde `404.html`
  **olmamalıdır** (varsa Cloudflare bilinmeyen adreslerde onu döndürür).
- Varsayılan önbellek başlığı `max-age=0, must-revalidate`: yeni sürüm hemen görünür.

Kurulum (bir kez), iki yoldan biri:

- **Git bağlantısı:** Cloudflare panosu → Workers & Pages → Create → Pages → Connect to Git → `myPDFbook` deposu.
  - Framework preset: *None* · Build command: `pnpm build` · Build output directory: `dist`
  - Environment variables: `NODE_VERSION = 22` (pnpm, `packageManager` alanından ve kilit dosyasından tanınır)
  - Cloudflare her `main` gönderiminde yayınlar; diğer dallar için önizleme adresi üretir.
- **Elle yükleme (Git bağlantısı olmadan):** yerelde `pnpm build`, sonra
  `pnpm dlx wrangler pages deploy dist --project-name mypdfbook` (ilk seferde Cloudflare hesabıyla giriş ister).

## Hangisi?

| | GitHub Pages | Cloudflare Pages |
|---|---|---|
| Ücret | Ücretsiz | Ücretsiz |
| Depo | Herkese açık olmalı | Gizli kalabilir |
| Adres | `batuhanbasswe.github.io/myPDFbook/` (alt yol) | `mypdfbook.pages.dev` (kök) |
| Derin bağlantılar | `404.html` kopyası gerekir | Kendiliğinden |
| Kurulum | Depo ayarı + iş akışı dosyası | Cloudflare hesabı + panodan bağlama |

**Önemli:** Kitaplar, okuma konumu ve notlar adrese (kökene) bağlıdır. Barındırma ya da alan adı sonradan
değişirse yeni adreste kütüphane boş açılır. Bu yüzden bir adres seçip onda kalmak en iyisidir.

## iPad'e kurulum

1. Safari'de yayın adresi açılır (ilk açılışta uygulama çevrimdışı kullanım için kendini önbelleğe alır).
2. **Paylaş → Ana Ekrana Ekle.** Kütüphanedeki kart da bunu hatırlatır.
3. Ana ekrandaki simgeden açılan uygulama tam ekran çalışır; internet olmadan da kütüphane, sayfa ve metin
   görünümü ve sesli okuma kullanılabilir. Kitap içe aktarıldığında tarayıcıdan verileri kalıcı saklaması istenir.
