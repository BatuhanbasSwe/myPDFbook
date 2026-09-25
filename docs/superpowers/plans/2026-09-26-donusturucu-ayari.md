# Dönüştürücü ayarı: aynı puntolu başlıklar ve yeniden dönüştürme — Uygulama planı

> **Ajanlar için:** Bu planın kodu, kurallar gerçek kitapla (Atomik Alışkanlıklar) deneme yanılmayla ayarlandığı için önce bir deneme dalında yazıldı ve doğrulandı. Görevler, o kodun görev başına commit'leri olarak işlendi; her görev ayrı bir alt ajanla kod incelemesinden geçer.

**Amaç:** Başlıkları gövdeyle aynı puntoda, sola yaslı olan kitaplarda (e-kitaptan dönüştürülmüş PDF'ler) bölümleri ve ara başlıkları bulmak. Dönüştürücü değişince kütüphanedeki kitapları okuma konumunu kaybetmeden arka planda yeniden dönüştürmek.

**Mimari:** Başlık tespiti `src/convert/blocks.ts` içindeki sınıflandırıcıya, puntoya bakmayan yeni bir kural katmanı (`sameSizeHeading`) olarak eklenir. Satırın bağlamı (üstündeki boşluk, alttaki satır, sayfanın ilk satırı mı, önceki blok bölüm numarası mı) `LineContext` ile verilir. Yeniden dönüştürme, mevcut tek dönüştürme kuyruğunu kullanır: eski sürümlü kitaplar en sona ve birer birer eklenir. Okuma konumu içerik sürümüyle birlikte saklanır; sürüm değiştiyse kitap kayıtlı okuma oranından açılır.

**Teknoloji:** TypeScript, Dexie 4, React 19, Vitest (Node, fake-indexeddb, gerçek PDF'ler), Playwright.

---

## Gözlemler (Atomik Alışkanlıklar, 202 sayfa)

- Gövde 13,98 pt, sola yaslı, **girintisiz**, sağı düzensiz; satır aralığı 16,1 pt. Başlıklar da aynı puntoda.
- Normal sayfa y=758'den başlar. Bölüm açılışlarında sayfa aşağıdan başlar (y≈600–630: "Tanıtım", "İYİLEŞME").
- Bölümler: tek başına numara satırı ("1") ve altında bölüm adı. Numaranın üstünde çoğunlukla büyük boşluk var; iki bölümde ("11", "20") numara sayfanın en üst satırında. Bu yüzden sayfa numarası sanılıp siliniyordu.
- Ara başlıklar tamamı büyük harf ve hiç boşluksuz ("ALIŞKANLIKLARI NASIL ÖĞRENDİM").
- Tuzaklar:
  - bölüm başında büyük harfle dizilmiş ilk kelime tek başına bir satırda ("PSİKOLOG" / "GARY Klein bir keresinde…");
  - alıntı sahibi ("-LAO TZU");
  - özet sayfalarındaki madde listeleri ("1. Kanun: …", "1.1: …");
  - PDF içindekileri yalnızca 4 giriş içeriyor ve hepsi ilk sayfalarda.
- Paragraf içindeki satırlar genişliğin %60'ının altına neredeyse hiç inmiyor; bu genişlikteki noktalamasız kısa satırlar başlık, liste ya da tablo.

## Dosya haritası

| Dosya | Değişiklik |
|---|---|
| `src/import/importBook.ts` | eski sürümlü kitabı yeniden dönüştürme (`outdated`, `keepOldContent`), düşük öncelikli sıra |
| `src/db/db.ts`, `src/db/books.ts` | `ProgressRecord.contentVersion`; `saveProgress(…, contentVersion, now)` |
| `src/reader/progress.ts` | `blockAtFraction`, `startBlock` |
| `src/reader/ReaderPage.tsx`, `ScrollReader.tsx` | açıldığı içeriği sabit tutma; konumu içerik sürümüyle kaydetme |
| `src/convert/blocks.ts` | `PageStats.top`, `LineContext`, `sameSizeHeading`, `subtitle` türü, sayfalar arası numara + ad birleşmesi |
| `src/convert/furniture.ts` | sayfa numarası bölgesi: numaralar açıkça tek bölgedeyse öteki bölgedeki tek başına sayı silinmez |
| `src/convert/chapters.ts` | `outlineStopsEarly`: yalnızca kitabın başını kapsayan içindekiler yerine başlıklar |
| `src/convert/types.ts` | `CONVERTER_VERSION = 2` |
| `scripts/make-fixtures.ts` | `ebook-tr.pdf`; `pnpm fixtures <dosya>` yalnızca verileni üretir |
| `tests/...` | aşağıdaki testler |

---

### Task 1: Yeniden dönüştürme yolu

**Files:** `src/import/importBook.ts`, `src/db/db.ts`, `src/db/books.ts`, `src/reader/progress.ts`, `src/reader/ReaderPage.tsx`, `src/reader/ScrollReader.tsx`, `tests/import/importBook.test.ts`, `tests/db/books.test.ts`, `tests/reader/progress.test.ts`

Davranış:
- **`outdated(book)`:** durum `done`, `convert.version < CONVERTER_VERSION` ve bu hedef sürüm için yapılan deneme sayısı `MAX_ATTEMPTS`'tan (3) azsa kitap yeniden dönüştürülür. Denemeler `convert.upgradeTo` ile hangi hedef sürüme ait olduklarını taşır; sonraki dönüştürücü sürümü sayacı sıfırdan başlatır.
- **`resumeAll`:** önce yarım kalanları sıraya ekler. Eski sürümlüleri en sona ve birer birer ekler: sıra boşalınca (`await queue`) bir tane eklenir. Böylece yeni eklenen kitap en fazla o an süren tek yeniden dönüştürmeyi bekler.
- **Yeniden dönüştürme sırasında:** kitap `done` kalır, eski içerik okunabilir. Açılıştan önce yalnızca `attempts` artırılır; sekme çökerse deneme sayılır.
- **Başarıda:** `convert` nesnesi tümden yenilenir (`attempts` ve `error` silinir), içerik ve sürüm güncellenir.
- **Başarısızlıkta** (`keepOldContent`): eski içerik kalır, `error` saklanır ve `convert.progress` 1'e döner. Kitap sonraki açılışlarda bu sürüm için en fazla 3 kez denenir; bir takılma, çökmelerle aynı hakkı kullanır.
- **Okuma ekranı:** yükleniyor, hazırlanıyor ve dönüştürülemedi ekranları ayrıdır. İçerik sabitlenince canlı sorgu durur, böylece kitabın ikinci kopyası bellekte tutulmaz.
- **`saveProgress`:** `saveProgress(db, bookId, { locator, percent, contentVersion }, now)`; alanlar karışmasın diye nesne parametresi.
- **Okuma konumu:** `ProgressRecord.contentVersion` saklanır (sürümsüz kayıt = 1). Açılışta `startBlock` şöyle karar verir: sürüm aynıysa kayıtlı blok; değilse `blockAtFraction(blockStartFractions(blocks), percent)`.
- **Açık kitap:** `ReaderPage` açıldığı içeriği sabit tutar (`if (!content && liveContent !== undefined && liveContent !== content) setContent(liveContent)`). Okurken yeniden dönüştürme bitse de ekrandaki bloklar ve kaydedilen konum tutarlı kalır.

Testler:
- `importBook — yeniden dönüştürme`:
  - eski sürümlü kitap yeniden dönüştürülür, bu sırada `done` ve eski içerik yerinde;
  - başarısızlıkta eski metin kalır ve kitap bir daha açılmaz;
  - yeni eklenen kitap, sıradaki yeniden dönüştürmelerin hepsini beklemez. Eski yöntemde (hepsini birden sıraya ekleme) bu test kalır.
- `blockAtFraction`, `startBlock` (aynı sürüm, farklı sürüm, sürümsüz kayıt).
- `saveProgress` içerik sürümünü yazar.

Commit: `feat(import): eski kurallarla dönüştürülmüş kitapları arka planda yeniden dönüştür; konum içerik sürümüyle`

### Task 2: Gövdeyle aynı puntolu başlıklar

**Files:** `src/convert/blocks.ts`, `src/convert/furniture.ts`, `src/convert/chapters.ts`, `src/convert/types.ts`, `scripts/make-fixtures.ts`, `tests/fixtures/ebook-tr.pdf`, `tests/convert/{blocks,furniture,chapters,fixtures}.test.ts`

Kurallar (`sameSizeHeading`):
- **Ne zaman uygulanır:** Puntoya dayalı eski kurallar tutmadığında denenir, iki koşulla:
  - Kitapta puntosuyla ayrılan başlıkların bulunduğu sayfa sayısı `max(3, sayfa × %2)`'den az olmalı (`sameSize`). Puntolu başlıkları olan kitaplar (çoğu roman) hiç etkilenmez, böylece sürüm artışıyla yeniden dönüştürülürken bozulmaz.
  - Satır gövde puntosunda olmalı (±%12). Küçük puntolu şekil yazıları ve grafik etiketleri kurallardan geçmez.
- **Terimler:**
  - `isolated`: Sayfanın ilk satırında, sayfa en az üç satır aşağıdan başlamalı. Ölçü kitabın tipik metin başıdır (`top` = dolu sayfaların ilk satırının üst çeyreği). Sayfa içinde ise üstteki boşluk tipik satır aralığının 1,8 katından büyük olmalı. Ancak boşluklu satır geçişi kitapta %3'ten fazlaysa (`gapsCommon`: şiir, paragraf aralıklı metin) sayfa içi boşluk işaret sayılmaz. Atomik Alışkanlıklar'da bu oran %0,5.
  - `headingEnd`: satır harf, rakam, `?` ya da `)` ile biter ve diyalog değildir.
  - `standsAlone`: alttaki satır büyük harf, rakam, tırnak ya da tireyle başlıyor veya alt satır yok. Böylece paragrafın ilk satırı başlık sanılmaz.
  - Şekil/tablo yazıları (`Şekil 3`, `Tablo 2`, `Figure 1`…) hiçbir kurala girmez.
- **Kurallar** (koddaki numaralarla):
  1. Tek başına 1–3 haneli sayı → 1. düzey başlık. Koşul: `isolated` olmalı, ya da sayfanın ilk satırı olup altında bölüm adına benzeyen bir satır bulunmalı.
  2. Önceki blok tek başına numaraysa, bu satır bölüm adıdır ve numaraya eklenir. Ad sonraki sayfada olsa da eklenir. `standsAlone` gerekir: romanın numaralı bölümünde ilk satır başlığa katılmaz.
  3. Uzun bölüm adının aynı puntodaki kısa devamı başlığa eklenir.
  4. Bölüm sözcüğü (`isChapterLike`) + `isolated` + `headingEnd` + `standsAlone` → 1. düzey. "Giriş kapısında bekledi." gibi bir cümle başlık olmaz.
  5. Tamamı büyük harf satır → 2. düzey. Koşullar:
     - en az 4 harf ve en az bir iki harfli kelime ("A B C" dizini başlık olmaz);
     - en fazla 80 karakter;
     - `.`, `!`, `,`, `;` ya da tırnakla bitmez; tire ya da tırnakla başlamaz.
     - İstisna: başlığın hemen altındaki tek büyük harfli kelime metnin başıdır ("PSİKOLOG"). Ama üstteki satır da büyük harfliyse bu, iki satıra taşan başlığın devamıdır ("…NE KADAR" / "SÜRER?").
  6. `isolated` + `headingEnd` + `standsAlone` + genişliğin %65'inden kısa → sayfanın ilk satırıysa 1. düzey, değilse 2. düzey.
  7. Başlığın hemen altındaki (`headingEnd` + `standsAlone` + genişliğin %75'inden kısa) tek satır → `subtitle`: ayrı bir 2. düzey başlık olur, zincirlenmez.
- **Tekrar eden büyük harfli başlık:** Kitapta 30 kereden fazla tekrar eden büyük harfli 2. düzey başlık (tiyatroda konuşmacı adı gibi) paragraf olur.
- **Sayfa numarası:** Sayfa numarası diziyi izler: "numara − sayfa sırası" farkı en az 3 kez tekrar etmelidir. Diziye uymayan tek başına sayı (sayfa başındaki bölüm numarası "11") silinmez. Numaralar üstteyken bölüm açılışında alta inen numaralar da diziye uyar ve silinir. 5'ten az numarada dizi kurulamaz, hepsi eskisi gibi silinir.
- **Bölüm listesi:** İçindekiler kitabın yarısına ulaşmıyorsa ve başlıklardan, içindekilerin bittiği sayfadan sonra en az 2 tane 1. düzey bölüm çıkıyorsa, içindekiler korunur ve o sayfadan sonraki başlıklar eklenir.
- `CONVERTER_VERSION = 2`: kütüphanedeki kitaplar Task 1'deki yolla yeniden dönüştürülür.

Testler:
- Eski dönüştürücüde 10'u da kalıyor:
  - `buildBlocks — gövdeyle aynı puntolu, sola yaslı başlıklar`;
  - sayfa numarası;
  - kısa içindekiler;
  - `ebook-tr.pdf` başlıkları, bölüm listesi, büyük harfli ilk kelime ve sayfa numaraları.
- Kod incelemesinden sonra, ilk sürümde (248cb02) 9'u da kalıyor:
  - `buildBlocks — … başka türde kitaplarda yanlış başlık üretmez`: numaralı roman bölümü; düzyazı içinde şiir; paragraf aralıklı metin ve mektup imzası; bölüm sözcüğüyle başlayan cümle; tırnaklı büyük harf ve harf dizini; puntolu başlıkları olan kitap; şekil yazıları; iki satıra taşan büyük harfli başlık;
  - bölüm açılışında alta inen sayfa numaraları.
- Mevcut test PDF'lerinin (roman, İngilizce, bozuk kodlama, taranmış, karışık) beklentileri değişmedi.

Commit: `feat(convert): gövdeyle aynı puntolu başlıklar (bölüm numarası, büyük harf, aşağıdan başlayan sayfa); dönüştürücü sürüm 2`

## Sonuç (Atomik Alışkanlıklar)

- Önce: 4 anlamsız içindekiler girişi; bölüm başlıkları paragrafların içinde ("İYİLEŞME Neyse ki…").
- Sonra: 20 bölümün hepsi numarası ve adıyla ("1 Atom Alışkanlıklarının Şaşırtıcı Gücü", …, "20 İyi Alışkanlıklar Yaratmanın Dezavantajı"). "Tanıtım — Benim hikayem" ve 107 ara başlık bulunuyor; iki satıra taşan büyük harfli başlıklar tam, harf dizini başlık değil.
- Kalan küçük kusurlar:
  - şekil içindeki bir satır alt başlık oluyor ("HER GÜN %1 DAHA İYİ — Bir yıl boyunca…");
  - içindekiler sayfasında "İçindekiler Giriş sayfası";
  - "Bölüm özeti" satırı (boşluksuz, normal yazı) hâlâ paragrafın başında.

## Sonraya bırakılanlar

- "Bölüm özeti" gibi boşluksuz, normal yazılı kısa etiketler; kitapta tekrar eden etiketler bir ipucu olabilir.
- Alıntı sahibi ("-LAO TZU") sonraki paragrafla birleşiyor; alıntı ve imza bloğu ayrı olmalı.
- Kaynaktaki yapışık kelimeler ("SonrasındaAylarca") dönüştürücüden değil PDF'in kendisinden geliyor.
- Yeniden dönüştürülen kitabın "Tekrar dene" benzeri elle yeniden deneme yolu yok; 3 denemede de başarısız olursa kitap bir sonraki dönüştürücü sürümüne kadar eski metinde kalır.
- Plan 2 için (inceleme notları):
  - `startBlock` bir `Locator` döndürsün: aynı sürümde paragraf içi konumu (`offset`) korusun, farklı sürümde de onu orandan hesaplasın.
  - Kitap okunurken yeniden dönüştürmeler bekletilsin; okuyucunun PDF'i ve yeniden dönüştürmenin PDF'i aynı anda bellekte olmasın.
  - Sayfalama önbelleğinin anahtarı sabitlenmiş `content.version`'ı kullansın. Vurgular da `contentVersion` ve alıntıyla yeniden bağlansın.
