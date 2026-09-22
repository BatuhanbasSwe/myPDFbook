# mypdfbook — Tasarım

> Tarih: 2026-09-22 · Durum: onaylandı · Kapsam: tüm yol haritası; Faz 0–1 ayrıntılı

## Bağlam
İnternetten indirilen kitap PDF'leri uygulamaya atılacak. Uygulama bunları otomatik olarak **metne dönüştürüp ekrana göre yeniden dizecek (EPUB mantığı)** ve gerçek bir kitap gibi, kıvrılarak çevrilen sayfalarla gösterecek. Uygulama web tabanlı olacak; telefon, iPad ve bilgisayarda çalışacak.

Temel istekler:
- karanlık mod,
- **odak modu**: Apple Pencil'ın üzerinde durduğu cümle açılır, geri kalan metin kararır,
- **hızlı okuma**: cümleler kendiliğinden ilerler, süre ayarlanabilir (varsayılan 5 sn).

Sonra gelecekler: OCR ve istatistik (öne alındı), kitap günlüğü (not, puan, başlama/bitiş tarihi) ve fosforlu kalem.

Proje klasörü (`C:\Users\Batuhan\mypdfbook`) boş, sıfırdan kurulacak. Ortamda Node 25, pnpm 10 ve git hazır.

## Kararlar
| Konu | Karar |
|---|---|
| Görünüm | PDF metne dönüştürülür ve yeniden dizilir. Her sayfadaki "Orijinal sayfa" düğmesi PDF'in aslını gösterir; tablo veya resim kaybolursa buradan bakılır. |
| Sayfa çevirme | `page-flip` (StPageFlip 2.0.7) ile kıvrılan sayfa. `FlipBook` arayüzünün arkasında durur, ileride 3D motorla değiştirilebilir. |
| Veri | Yalnızca cihazda (IndexedDB). Üyelik ve sunucu yok; statik barındırma (Cloudflare Pages veya Vercel). |
| Teknoloji | Vite 8, React 19, TypeScript, Tailwind 4 (arayüz), CSS değişkenleri (kitap tipografisi), Dexie 4, Zustand 5, react-router, pdfjs-dist 6.3, vite-plugin-pwa, Vitest 5, Playwright 1.63, pnpm |

## Mimari (veri akışı)
```
PDF ──içe aktar──► SHA-256 = kitap kimliği (aynı dosya iki kez eklenmez)
 │
 ├─ pdf/      pdf.js: sayfa başına metin öğeleri (konum, punto)   metinsiz sayfa → pageImage bloğu
 │                                                                (Faz 2'de OCR → aynı satır modeline)
 ├─ convert/  satırlar → üst/alt bilgi temizliği → paragraf, başlık, bölüm, tire birleştirme, Türkçe karakter onarımı
 │            └► BookContent {blocks, chapters} → IndexedDB'ye bir kez yazılır
 ├─ text/     cümle dizini (Intl.Segmenter + Türkçe kısaltma kuralları); konum = Locator {block, offset}
 ├─ layout/   sayfalayıcı: tipografi + sayfa kutusu → sayfa başlangıçları (önbellekli)
 └─ reader/   FlipBook (StPageFlip) ◄ PageView (cümle <span>'leri + süslemeler)
                ├─ Odak modu: kalem/fare/parmak konumu → aktif cümle
                └─ Hızlı okuma motoru: zamanlayıcı → aktif cümle → otomatik sayfa çevirme
```
Her katman ayrı test edilir:
- `convert/` ve `text/` DOM kullanmaz, Node'da test edilir.
- Sayfalayıcı yalnızca DOM ölçümü yapar.
- Modlar yalnızca cümle dizinini ve FlipBook API'sini kullanır.

Okuyucu ekranı (iPad yatay; telefonda tek sayfa):
```
┌──────────────────────────────────────────────────────┐
│ ← Kütüphane     Kitap Adı       ☰  Aa  ◎ Odak  ⏵ Hızlı │ ← dokununca görünür
│   ┌─────────────────────┬─────────────────────┐      │
│   │ KİTAP ADI           │           BÖLÜM ADI │      │
│   │ Metin metin metin…  │ Metin metin metin…  │      │
│   │                  12 │ 13                  │      │
│   └─────────────────────┴─────────────────────┘      │
│   ━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━  %34 · 3. Bölüm      │
└──────────────────────────────────────────────────────┘
```

## Veri modeli — `src/db/db.ts` (Dexie)
- `books`: id (sha256), title, author, lang, pdfPageCount, cover (Blob), addedAt, lastOpenedAt, convert {state, progress, version}, readingStatus, startedAt, totalWords
- `files`: bookId → orijinal PDF (Blob). Liste hızlı yüklensin diye ayrı tabloda.
- `contents`: bookId → {version, blocks[], chapters[]}
- `layouts`: [bookId+signature] → pageStarts: Locator[] (sayfalama önbelleği)
- `progress`: bookId → locator, percent, updatedAt
- `sessions`: bookId, startedAt, endedAt, activeMs, wordsRead. İstatistik verisi Faz 1'den itibaren birikir.
- `settings`: tema, tipografi, odak ve hızlı okuma ayarları
- Blok türleri: `heading{level}`, `para`, `note` (dipnot), `break` (sahne arası ✱), `pageImage{srcPage}`. Her blokta `srcPage` bulunur.
- Sonra eklenecek tablolar: `ocrPages` (Faz 2), `highlights`, `notes`, `bookmarks` (Faz 3)

## Faz 0 — Kurulum
- Vite react-ts iskeleti, `git init`, ESLint/Prettier ve yukarıdaki paketler kurulur; `page-flip` sürümü sabitlenir.
- Fontlar @fontsource ile gömülür (Türkçe glifler için latin-ext): Literata, Source Serif 4, Inter, Atkinson Hyperlegible.
- `@vitejs/plugin-basic-ssl` + `pnpm dev --host` ile iPad'de HTTPS üzerinden test edilir. crypto.subtle, service worker ve wake lock HTTPS ister.
- `scripts/make-fixtures.ts`, Playwright/Chromium `page.pdf` ile HTML'den test PDF'leri üretir:
  - roman: sayfa başlıkları, sayfa numarası, satır sonu tireleri, diyalog tireleri, kısaltmalar, bölümler + outline, dipnot
  - bozuk kodlama (ý/þ/ð)
  - taranmış (sadece resim)
  - karışık

## Faz 1 — MVP (her adım çalışan bir uygulama bırakır)

**1. Kütüphane ve içe aktarma** — `src/library/`, `src/import/importBook.ts`
- Dosya seçici ve sürükle-bırak, çoklu dosya. Hash aynıysa kitap yeniden eklenmez, doğrudan açılır.
- Başlık ve yazar pdf.js metadata'sından alınır; yoksa dosya adından çıkarılır ("Yazar - Kitap.pdf").
- Kapak: 1. sayfada az metin varsa o sayfa kapak olarak çizilir; yoksa renkli bir başlık kapağı üretilir.
- Şifreli PDF'te şifre sorulur. Depolama dolarsa kullanım bilgisiyle birlikte anlaşılır bir hata gösterilir.
- İlk içe aktarmada `navigator.storage.persist()` istenir. iOS'ta "Ana Ekrana Ekle" rehberi gösterilir; bu, Safari'nin verileri silmesine karşı önlemdir.
- Kapak ızgarası, ilerleme çubuğu, "Okumaya devam et" kartı, silme ve başlık düzenleme.

**2. PDF→metin dönüştürücü** — `src/convert/` (saf TS, DOM yok)
- `extractLines(page)`: `getTextContent` öğelerinden taban çizgisine göre satırlar oluşturur. Kelimeler arası boşluk, öğeler arasındaki mesafeye bakılarak eklenir; metin NFKC ile normalize edilir.
- `analyzeLayout(pages: Line[][]) → Block[]` (Faz 2'deki OCR da aynı arayüzü kullanır):
  - **Üst/alt bilgi ve sayfa numarası:** sayfanın üst ve alt bölgesinde tekrar eden satırlar temizlenir. Karşılaştırmada rakamlar normalize edilir, tek ve çift sayfalar ayrı sayılır.
  - **Paragraf sınırı:** girinti, büyük satır aralığı, kısa satır + bitiş noktalaması veya diyalog tiresi (— / –) yeni paragraf başlatır. Sayfa sonunda bitmeyen paragraf **sonraki sayfada devam ettirilir**.
  - **Satır sonu tireleri:** bölünmüş kelimeler birleştirilir (`kita-` + `bı` → `kitabı`).
  - **Başlık:** gövde puntosunun 1,25 katı ve üstündeki satırlar ya da BÖLÜM/KISIM/Chapter, "BİRİNCİ BÖLÜM", Roma rakamı kalıpları. Alt alta başlık satırları birleştirilir; `* * *` sahne arası olur.
  - **Dipnot:** sayfa altındaki küçük puntolu satırlar.
  - **Türkçe karakter onarımı:** bozuk font kodlaması tespit edilirse ý→ı, þ→ş, ð→ğ dönüşümü yapılır (büyük harfler dahil).
  - **Dil (tr/en):** sık geçen kelimelere bakılarak tahmin edilir.
- Bölümler öncelikle PDF'in içindekiler yapısından (`getOutline`) alınır; yoksa tespit edilen başlıklardan çıkarılır.
- Metinsiz sayfa `pageImage` bloğu olur. Böylece taranmış kitaplar Faz 1'de görsel olarak okunabilir, Faz 2'de metne dönüşür.
- Dönüştürme ana iş parçacığında parça parça çalışır (pdf.js ayrıştırmayı zaten kendi worker'ında yapar) ve ilerleme çubuğu gösterilir. `CONVERTER_VERSION` saklanır; ileride "yeniden dönüştür" için gerekir.

**3. Cümle dizini** — `src/text/sentences.ts`, `locator.ts`, `hyphenate-tr.ts`
- Her blok `Intl.Segmenter(lang, {granularity: 'sentence'})` ile cümlelere ayrılır. Yanlış bölünen parçalar şu kurallarla birleştirilir: Dr., Prof., vb., vs., bkz., örn., s., No. gibi kısaltmalar; madde numaraları; "…" sonrası küçük harf.
- Dizin kitap açılırken hesaplanır: `Sentence {id, start, end: Locator, words}`.
- Türkçe heceleme: hece kurallarına göre yumuşak tire (U+00AD) ekleyen küçük bir fonksiyon. Her tarayıcıda aynı sonucu verir. DOM→Locator dönüşümünde yumuşak tireler atlanır.

**4. Sayfalayıcı** — `src/layout/paginator.ts`, `typography.ts`, `layoutCache.ts`
- Sayfa kutusu: ekran yataysa ve yeterince genişse çift sayfa, değilse tek sayfa. Satır uzunluğu en fazla ~70 karakter olur.
- Ölçümden önce `document.fonts.load` çağrılır (Türkçe glifli örnek metinle). Ölçüm, sayfayla aynı CSS'e sahip gizli bir kutuda yapılır.
- Bloklar sırayla eklenir. Taşan paragraf **bir kez dizilir; bölme noktası `Range.getClientRects` ile ikili aramayla bulunur**, yani tekrar tekrar layout yapılmaz. İlk parçaya `text-align-last: justify` verilir, devam parçası girintisiz başlar.
- Kurallar: bölüm yeni sayfada başlar; başlık sayfa dibinde tek kalmaz; sayfa başında ve sonunda en az 2 satır bulunur.
- Çıktı `pageStarts: Locator[]` olur. Sonuç IndexedDB'de önbelleğe alınır; anahtar `signature = hash(font, punto, satır aralığı, kenar boşluğu, hizalama, sayfa boyutu, dönüştürücü sürümü)`.
- Font veya ekran değişince, Locator sayesinde aynı cümlenin bulunduğu sayfa açılır.

**5. Kitap görünümü** — `src/reader/FlipBook.tsx`, `PageView.tsx`, `ReaderPage.tsx`
- StPageFlip'e **imperatif olarak oluşturulan bir kapsayıcı** verilir; sayfa içerikleri React `createPortal` ile çizilir. Böylece StPageFlip'in DOM değişiklikleri React'i bozmaz. Yalnızca mevcut sayfa ve ±4 komşusu doldurulur.
- Kitap yapısı: sert ön kapak (`data-density="hard"`) → forza (iç kapak kağıdı) → içerik → (sayfa sayısını çift yapmak için boş sayfa) → sert arka kapak.
- Etkileşim:
  - StPageFlip ayarları: `showCover`, `usePortrait`, `disableFlipByClick`.
  - Kendi dokunma bölgeleri: sağ/sol üçte bir sayfa çevirir, orta bölüm menüyü açar.
  - Köşeden çekme, kaydırma ve ←/→ tuşları da çalışır.
- Gerçekçilik ayrıntıları:
  - kağıt rengi ve dokusu, iç kenarda cilt gölgesi,
  - ilerlemeye göre yan kenarlarda sayfa kalınlığı,
  - sayfa başlığı (kitap/bölüm adı) ve sayfa numarası,
  - bölüm başında büyük ilk harf, sahne arası süsü.
- Alt kaydırma çubuğu (bölüm ve sayfa önizlemesi), içindekiler çekmecesi ve "Orijinal sayfa" penceresi (kaynak sayfayı pdf.js ile gösterir).
- `pageImage` sayfaları pdf.js ile çizilir ve LRU blob önbelleğinde tutulur (DPR ≤ 2).
- **Erken deneme (spike):** iPad ve Android'de 1000 sayfalık StPageFlip performansı ölçülür. Takılma olursa ~60 sayfalık kayan pencereye geçilir; pencere, sayfa dururken sessizce yeniden kurulur. FlipBook API'si değişmez.

**6. Tipografi ve temalar** — `src/styles/themes.css`, `src/reader/SettingsSheet.tsx`
- Temalar: Açık (kağıt), Sepya, Koyu, OLED Siyah. Varsayılan olarak sistem temasını izler; hepsi CSS değişkenleriyle yapılır. Karanlık temada görsel sayfaların parlaklığı kısılır (ters çevirme isteğe bağlı).
- Aa paneli: yazı tipi, punto, satır aralığı, kenar boşluğu, iki yana/sola hizalama, heceleme, tek/çift sayfa. Değişiklik yeniden sayfalama tetikler; önbellekte varsa anında gelir.
- `prefers-reduced-motion` açıksa çevirme animasyonu kısalır.

**7. Odak modu** — `src/reader/modes/focus.ts`
- Cümleler `<span data-s>` ile sarılır. Odak modunda diğer cümleler ayara göre karartılır, bulanıklaştırılır ya da gizlenir. Hepsi CSS sınıfıyla yapıldığı için hızlıdır.
- Girdi: **Apple Pencil hover** (Safari 16.1+, `pointerType: 'pen'`, basmadan pointermove), fare hover veya parmakla sürükleme. Konum, `caretPositionFromPoint`/`caretRangeFromPoint` ile en yakın cümleye çevrilir.
- **Kalem odaklar, parmak sayfa çevirir.** Odak modunda kalem dokunuşları, capture aşamasında StPageFlip'e ulaşmadan durdurulur. Telefonda sayfa kenardan çekilerek ya da düğmeyle çevrilir. ↑/↓ tuşları cümle cümle ilerletir.
- Ayar: "Kalem kalkınca son cümle açık kalsın".

**8. Hızlı okuma** — `src/reader/modes/speedReader.ts` (saf TS, saat dışarıdan verilir), `SpeedControls.tsx`
- Süre iki şekilde ayarlanır: **sabit** (1–30 sn, varsayılan 5) veya **dakikada kelime** (en kısa süre sınırı ve virgül payı ile).
- Görünüm: sayfa üzerinde (yalnızca aktif cümle görünür ya da cümleler birikerek açılır) veya ekranın ortasında büyük kart.
- Sayfa kendiliğinden çevrilir. Sayfa sınırına taşan cümlenin süresi kelime oranına göre bölünür ve sayfa cümlenin ortasında çevrilir.
- Kontroller: oynat/duraklat (boşluk tuşu veya dokunma), önceki/sonraki cümle, hız kaydırıcısı, kaldığı yerden devam. Oynatma sırasında ekran açık kalır (Screen Wake Lock).

**9. İlerleme, oturumlar, PWA**
- Her sayfa çevirişte konum (Locator) kaydedilir (debounce ile); kitap kaldığı yerden açılır. İlk açılışta `startedAt` yazılır ve durum "okunuyor" olur.
- `sessionTracker`, aktif okuma süresini ve okunan kelime sayısını `sessions` tablosuna yazar. 2 dk hareketsizlikte veya sekme gizlenince sayaç durur.
- PWA: manifest, ikonlar, iOS meta etiketleri, safe-area. Uygulama, fontlar ve pdf.js worker çevrimdışı da çalışır.

## Sonraki fazlar
**Faz 2 — Taranmış PDF ve dönüştürme kalitesi (OCR, öne alındı)**
- Tesseract.js 7 (`tur` + `eng`) kendi worker'ında çalışır. Dil dosyaları ilk kullanımda indirilip önbelleğe alınır; CDN'e değil kendi sunucumuza bağlıdır.
- OCR arka planda, sayfa sayfa ilerleyen ve kaldığı yerden devam eden bir kuyrukla çalışır (`ocrPages`). Kitap hazırlanırken de okunabilir, ilerleme kitap kartında görünür. Telefonda 1, bilgisayarda 2 worker kullanılır.
- OCR satırları aynı `analyzeLayout`'tan geçer; `pageImage` blokları metinle değiştirilir.
- Ayrıca:
  - resim/şekil bölgeleri pdf.js operatör listesinden kırpılıp akışa eklenir,
  - iki sütun tespiti, şiir modu, italik/kalın koruma,
  - "yeniden dönüştür" seçeneği.

**Faz 3 — Kitap günlüğü ve fosforlu kalem (senin istediklerin)**
- Kitap kartı:
  - durum,
  - başlama/bitiş tarihi (otomatik ama düzenlenebilir; son sayfada "bitirdin mi?" diye sorulur),
  - 1–5 yıldız (yarım yıldız dahil),
  - inceleme ve notlar, raflar/etiketler.
- Fosforlu kalem:
  - seçim menüsünden ya da Apple Pencil'ı metnin üzerinden geçirerek (vurgu metne yapışır),
  - sarı ve 3 renk daha; her vurguya not eklenebilir, vurgular listelenir,
  - vurgu konumu Locator ve alıntı metniyle birlikte saklanır; kitap yeniden dönüştürülse de yerinde kalır.
- Köşe kıvırma yer imi, kitap içinde arama (Türkçe büyük/küçük harf duyarsız), Markdown dışa aktarma, tam yedekleme/geri yükleme (JSON + isteğe bağlı PDF'ler).

**Faz 4 — İstatistik ve hedefler (öne alındı)**
- Günlük okuma süresi ve hedef halkası, okuma serisi, yıllık ısı haritası, haftalık grafik.
- Yıllık kitap hedefi, ortalama kelime/dk.
- Okurken "bölümün bitmesine ~8 dk" ve "kitabın bitmesine ~3 sa 20 dk" tahminleri; yıl sonu özeti.
- Veri Faz 1'den birikir. İstersen Faz 3 ile yer değiştirebilir.

**Faz 5 — Diğer öneriler (sonra)**
- Sesli okuma (cümle senkronlu), alıntı kartı görseli, uzun basınca sözlük/çeviri, kelime defteri.
- Sayfa çevirme sesi ve okuma ortam sesleri, EPUB desteği.
- İsteğe bağlı bulut senkron: yalnızca not ve ilerleme, dosya hash'i ile eşleşir.
- 3D sayfa kıvrılması, yapay zekâ ile bölüm özeti.

## Riskler ve önlemler
| Risk | Önlem |
|---|---|
| PDF metin kalitesi dosyadan dosyaya değişir | Kurallar gerçek kitaplarla ayarlanır. "Orijinal sayfa" her zaman erişilebilir. Dönüştürücü sürümü tutulur, kitap yeniden dönüştürülebilir. |
| page-flip 2022'den beri güncellenmiyor | FlipBook arayüzünün arkasında durur, sürüm sabittir; gerekirse `pnpm patch` ile düzeltilir |
| iOS Safari verileri silebilir | `persist()`, ana ekrana ekleme, yedekleme (Faz 3) |
| Çok sayfa / bellek | Yalnızca ±4 sayfa dolu, LRU önbellek, DPR ≤ 2, gerekirse kayan pencere |
| Kalem, parmak ve sayfa çevirme çakışması | Ayrı modlar + `pointerType` ayrımı |
| Telefonda OCR yavaş | Arka plan kuyruğu; OCR sürerken kitap görsel olarak okunabilir |

## Doğrulama
- `pnpm test` (Vitest, Node + pdfjs-dist legacy build):
  - dönüştürücü, fixture PDF'lerle test edilir: üst/alt bilgi temizliği, tire birleştirme, paragraf/başlık/bölüm tespiti, karakter onarımı;
  - cümle bölme (kısaltmalar, diyalog) ve Türkçe heceleme;
  - hızlı okuma süreleri ve geçişleri (sahte zamanlayıcı);
  - veritabanı işlemleri (fake-indexeddb).
- `pnpm test:browser` (Vitest tarayıcı modu), sayfalayıcı kuralları:
  - her karakter tam olarak bir sayfada,
  - hiçbir sayfa taşmıyor,
  - aynı girdi aynı sonucu veriyor,
  - bölüm yeni sayfada başlıyor,
  - font değişince konum korunuyor.
- `pnpm e2e` (Playwright: masaüstü Chrome, iPad WebKit yatay, Pixel dikey):
  - içe aktarma → kapak ve başlık görünür; kitap açılınca metin görünür;
  - tıklama, tuş ve kaydırma ile sayfa çevrilir; yenilemeden sonra konum korunur;
  - koyu tema çalışır; odak modunda kalem ile yalnızca tek cümle görünür;
  - 1 sn'lik hızlı okumada cümle ilerler ve sayfa çevrilir; taranmış PDF görsel sayfa olarak açılır.
- Gerçek cihazda (iPad + Apple Pencil hover, iPhone Safari, Android Chrome):
  - PWA kurulumu ve çevrimdışı açılış,
  - sayfa çevirmenin akıcılığı (Safari Web Inspector ile),
  - hızlı modda ekranın açık kalması.
- Hedefler: 300 sayfalık metin PDF'i iPad'de 10 sn'den kısa sürede dönüşür; önbellekten açılış 1 sn'nin altında kalır; sayfa çevirme akıcıdır.

## Sonraki adımlar
1. Faz 0–1 için adım adım uygulama planı: `docs/superpowers/plans/` altında.
2. Dönüştürücü kuralları, kullanıcının vereceği 2–3 gerçek kitap PDF'iyle (en az biri metinli, biri taranmış) ayarlanacak.
