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

| Klasör             | İçerik                                            |
| ------------------ | ------------------------------------------------- |
| `src/convert`      | PDF → metin dönüştürücü (DOM'suz, saf TypeScript) |
| `src/pdf`          | pdf.js bağdaştırıcıları                           |
| `src/db`           | IndexedDB şeması (Dexie)                          |
| `src/import`       | içe aktarma akışı                                 |
| `src/library`      | kütüphane ekranı                                  |
| `src/reader`       | okuma ekranı                                      |
| `docs/superpowers` | tasarım ve uygulama planları                      |
