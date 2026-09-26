# mypdfbook

İnternetten indirdiğin kitap PDF'lerini metne dönüştürüp gerçek bir kitap gibi okuyan web uygulaması.
Kitaplar ve notlar yalnızca bu cihazda (tarayıcının IndexedDB'sinde) saklanır.

## Okuma

- Metin ekrana göre sayfalara bölünür. Ekran yatay ve yeterince genişse (iPad yatay) kitap çift sayfa açılır.
- **Sayfa çevirme:**
  - sağ/sol kenara dokunma; ortaya dokunmak menüyü açar;
  - kaydırma ya da köşeden çekme;
  - ←/→, PageUp/PageDown, Boşluk;
  - isteğe bağlı alt düğmeler.
- **Esc** ya da **M** menüyü açıp kapatır.
- **Aa** paneli:
  - tema, yazı tipi, punto, satır aralığı, kenar boşluğu, hizalama, heceleme, tek/çift sayfa;
  - çevirme efekti: kıvrılan sayfa, slayt, efektsiz.

  Ayar değişince okunan yer korunur.

- **☰** içindekiler; **Orijinal sayfa** PDF'in aslını gösterir.
- Sayfalama, kitap ve ayar başına cihazda saklanır; kitap yeniden açılınca ölçülmeden gelir.

## Çalıştırma

```bash
pnpm install      # bağımlılıklar + pdf.js varlıkları (public/pdfjs)
pnpm dev          # http://localhost:5173
pnpm dev:ipad     # HTTPS + yerel ağ: iPad'den https://<bilgisayarın-ip>:5173 (sertifika uyarısını kabul et)
```

## Test

```bash
pnpm test         # birim + dönüştürücü testleri (Node, gerçek PDF'lerle)
pnpm exec playwright install chromium webkit   # tarayıcı ve uçtan uca testler için bir kez
pnpm test:browser # sayfalayıcı testleri (Vitest tarayıcı kipi: Chromium + WebKit, gerçek yazı tipleriyle)
pnpm e2e          # uçtan uca testler (masaüstü Chrome, iPad WebKit, Pixel); 5174 portu boş olmalı
pnpm typecheck
pnpm lint
```

## Dönüştürücüyü gerçek bir kitapla denemek

```bash
pnpm convert "C:\Kitaplar\kitap.pdf"          # okunabilir döküm
pnpm convert "C:\Kitaplar\kitap.pdf" --json   # ham çıktı
```

## Kıvrılan sayfa kütüphanesi (page-flip) yaması

`page-flip` 2.0.7 `patches/page-flip@2.0.7.patch` ile yamalıdır (`pnpm install` uygular):

- Program içinden çağrılan `flipNext`/`flipPrev`, "tıklamayla çevirme kapalı" ayarına takılmaz. Yamasız hâlde dikey görünümde geri çevirme çalışmıyordu.
- Dikey görünümde sürüklenen sayfa, köşe sayfanın ortasını geçince çevrilir.

Yamayı değiştirmek için `pnpm patch page-flip@2.0.7` kullanılır. `dist/js/page-flip.module.js` düzenlenir, ardından `pnpm patch-commit <klasör>` çalıştırılır.

## Test PDF'lerini yeniden üretmek

```bash
pnpm exec playwright install chromium
pnpm fixtures
```

## Yapı

| Klasör             | İçerik                                                    |
| ------------------ | --------------------------------------------------------- |
| `src/app`          | uygulama kabuğu, rotalar, tema                            |
| `src/convert`      | PDF → metin dönüştürücü (DOM'suz, saf TypeScript)         |
| `src/pdf`          | pdf.js bağdaştırıcıları                                   |
| `src/db`           | IndexedDB şeması (Dexie)                                  |
| `src/import`       | içe aktarma akışı                                         |
| `src/library`      | kütüphane ekranı                                          |
| `src/layout`       | tipografi, sayfa kutusu, sayfalayıcı, sayfalama önbelleği |
| `src/reader`       | okuma ekranı, sayfa çevirme motorları, ayarlar paneli     |
| `scripts`          | fixture üretici, dönüşüm dökümü, pdf.js varlıkları        |
| `tests`, `e2e`     | birim testleri (Vitest) ve uçtan uca testler (Playwright) |
| `docs/superpowers` | tasarım ve uygulama planları                              |
