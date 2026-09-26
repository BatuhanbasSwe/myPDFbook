# Plan 2 — Sayfalı kitap görünümü

> **Ajanlar için:** Görevler alt ajanlarla uygulanır, her görev ayrı bir alt ajanla kod incelemesinden geçer (superpowers:subagent-driven-development). Adımlar `- [ ]` ile izlenir. Görev 1–4, sayfalama kuralları gerçek yazı tipleriyle deneme yanılmayla ayarlandığı için önce yazılıp doğrulandı; bu belgede commit'leriyle birlikte kayıtlıdır.

**Amaç:** Dönüştürülmüş kitap, ekrana göre sayfalara bölünür ve gerçek kitap gibi okunur: kıvrılan sayfa (ya da slayt / efektsiz), dokunma, kaydırma, tuşlar ve isteğe bağlı düğmelerle çevirme. Yazı tipi, punto, satır aralığı, kenar boşluğu, hizalama, heceleme ve tek/çift sayfa ayarlanabilir; ayar değişince okunan yer korunur. İçindekilerden bölüme gidilir.

**Mimari:**
- **Konum:** Okuyucunun tek doğruluk kaynağı bir `Locator {block, offset}` çapasıdır. Sayfa her zaman `pageOf(starts, anchor)` ile bulunur. Böylece punto, döndürme veya tek/çift sayfa değişince aynı metin açık kalır.
- **Sayfalayıcı** (`src/layout/paginator.ts`) ekran dışındaki tek bir akışta ölçüm yapar. Sayfa sınırlarını öğe ve satır dikdörtgenlerinden çıkarır. Taşan paragraf kelime başından bölünür; devamı, yaklaşık 1,5 sayfalık bir pencerede ayrı bir kutuda dizilir.
- **Ortak işaretleme:** Ölçüm ve çizim aynı işaretlemeyi (`blockMarkup.ts`) ve aynı CSS'i (`book.css`) kullanır.
- **Çevirme motorları** tek arayüzün (`FlipBookHandle {next, prev}`) arkasındadır: `CurlEngine` (StPageFlip, `pnpm patch` ile yamalı), slayt ve efektsiz.

**Teknoloji:** React 19, TypeScript 6, Tailwind 4, Dexie 4, page-flip 2.0.7, Vitest 5 tarayıcı modu (@vitest/browser-playwright: Chromium + WebKit), Playwright e2e (masaüstü Chrome, iPad WebKit yatay, Pixel dikey).

**Tasarım:** `docs/superpowers/specs/2026-09-22-mypdfbook-design.md` (Faz 1 madde 4–6)

---

## Doğrulanmış teknik notlar
- **Satır ölçümü:** Glif dikdörtgenleri satır kutusu değildir; satır yüksekliği Literata'da 1,3–1,4 satır aralığında glif kutusundan kısadır. Satırlar karakter ortası ile bulunur ve öğenin üstüne göre tam satır yüksekliğine kalibre edilir.
- **Kelime ortasından bölme:** Chromium, kelime ortasından bölünmüş bir kuyruğu ("ann") yeniden sarar. Bu yüzden bölme kelime başından yapılır; tire, satır yerleşimine katılmayan `::after` ile çizilir.
- **Yükseklik ölçümü:** `scrollHeight` son çocuğun alt boşluğunu da sayar. Kullanılan yükseklik son çocuğun alt kenarından ölçülür.
- **page-flip 2.0.7:**
  - Tür tanımı yok; `src/types/page-flip.d.ts` elle yazıldı.
  - İçe aktarma `page-flip/dist/js/page-flip.module.js` üzerinden yapılır.
  - **Yama (`patches/page-flip@2.0.7.patch`):**
    - `flipNext`/`flipPrev` programdan çağrıldığında `disableFlipByClick` denetimine takılmaz. Dikey görünümde geri çevirme, sol köşe noktası "köşe" sayılmadığı için hiç çalışmıyordu.
    - Dikey görünümde fareyle sürüklenen sayfa, köşe sayfanın ortasını geçince çevrilir (yamasız hâlde sol kenarı geçmek gerekiyordu).
- **e2e:** Kıvrılan sayfa motoru kütüphaneyi efektten sonra kurar. Kitap, `data-ready` özniteliği gelince etkileşime hazırdır.

## Görevler

### Görev 1 — Tipografi ve sayfalayıcı ✅ (`27a3940`, inceleme düzeltmeleri `378796d`, `e374b93`)
- `src/layout/typography.ts`: `Typography` türü, varsayılanlar, CSS değişkenleri; localStorage deposu (`src/app/localStore.ts`).
- `src/layout/blockMarkup.ts`, `src/styles/book.css`: ölçüm ve çizimin ortak işaretlemesi ve stili.
- `src/layout/paginator.ts`:
  - `paginate`, `buildPageElements`, `pageOf`, `chapterSink`, `PAGINATOR_VERSION`;
  - kurallar: bölüm yeni sayfada başlar, başlık sayfa dibinde yalnız kalmaz, sayfa başında/sonunda tek satır bırakılmaz.
- Tarayıcı testleri (`tests/browser/paginator.test.ts`, 26 test): her karakter tam bir kez; taşan sayfa yok; bölüm yeni sayfada; 4 yazı tipi × satır aralığı matrisi; rastgele kitaplar; 300 sayfalık kitap 3 sn'nin altında.

### Görev 2 — Sayfa kutusu ve konum oranı ✅ (`f04af36`)
- `src/layout/pageBox.ts`: `pageLayout(viewport, typography)`. Ekran yataysa ve genişlik ≥ 900 ise çift sayfa; satır en fazla 34em.
- `src/reader/progress.ts`: blok oranları, `locatorFraction`, `locatorAtFraction`, `startLocator` (içerik sürümü değiştiyse kayıtlı orandan açılır).

### Görev 3 — Okuyucu: slayt ve efektsiz motor, ayarlar, içindekiler ✅ (`ac3090b`)
- `BookReader`, `BookPage`, `FlipBook` (InstantEngine, SlideEngine), `SettingsSheet`, `TocDrawer`, `readerPrefs`.
- Kaydırmalı geçici okuyucu (`ScrollReader`) kaldırıldı.
- e2e testleri `e2e/reader.spec.ts`'te.

### Görev 4 — Kıvrılan sayfa motoru ✅ (`e89e372`)
- `src/reader/CurlEngine.tsx`:
  - sayfa kutuları React dışında kurulur ve StPageFlip'e verilir;
  - içerikler portal ile çizilir, yalnızca ±4 komşu doldurulur;
  - dışarıdan gelen sayfa değişikliği `turnToPage` ile uygulanır;
  - dokunmayı okuyucu yönetir (sağ/sol üçte bir çevirir, orta menüyü açar);
  - köşeden çekme ve kaydırma kütüphaneye bırakılır.

### Görev 4b — Okuyucu incelemesi düzeltmeleri
Bulgular:
- slayt motorunun `transitionend` gelmeyince kilitlenmesi;
- klavyeyle menüye dönülememesi;
- "Orijinal sayfa" penceresi açıkken ok tuşlarının kitabı çevirmesi;
- panellerde odak yönetimi;
- panel açıkken kaydırmanın sayfa çevirmesi;
- boyut değişiminde gecikmesiz yeniden sayfalama ve kitabın kaybolması;
- her çevirmede sayfaların baştan kurulması;
- ekran okuyucu (`aria-hidden`/`inert`, `aria-live`);
- güvenli alanlar;
- e2e testinin ekran dışındaki sayfaya bakması.

Ayrıntılar inceleme raporunda ve commit mesajlarındadır.

### Görev 5 — Sayfalama önbelleği (IndexedDB)

**Dosyalar:**
- Yeni: `src/layout/layoutCache.ts`, `tests/layout/layoutCache.test.ts`.
- Değişecek: `src/db/db.ts`, `src/db/books.ts`, `src/reader/usePagination.ts`, `src/reader/ReaderPage.tsx`/`BookReader.tsx` (kitap kimliği ve içerik sürümü).

- [ ] **Şema:** `db.version(2)` ile yeni tablo: `layouts: '[bookId+signature], bookId, usedAt'`, kayıt türü `LayoutRecord {bookId, signature, starts: Locator[], usedAt}`. Sürüm 1'in tanımı aynen kalır. `BOOK_TABLES` birincil anahtarla sildiği için `layouts` oraya eklenmez. Bunun yerine `deleteBook`, aynı işlem içinde `db.layouts.where('bookId').equals(id).delete()` çağırır.
- [ ] **İmza:** `layoutSignature({lang, typography, box, contentVersion})` → dize. İçeriği:
  - `PAGINATOR_VERSION`;
  - tarayıcı motoru (`engineToken()`: kullanıcı aracısına göre `webkit` | `blink` | `gecko`; satır kırılımı motora göre değişir);
  - `lang`, yazı tipi, punto, satır aralığı, hizalama, heceleme;
  - kutunun genişlik, yükseklik ve `sink` değeri;
  - içerik sürümü.

  Kenar boşluğu ve tek/çift sayfa ayarı kutuyu değiştirdiği için ayrıca eklenmez.
- [ ] **Okuma ve yazma:**
  - `loadLayout(db, bookId, signature)` kaydı döndürür ve `usedAt`'ı günceller.
  - `saveLayout(db, bookId, signature, starts)` yazar. Kitap başına en çok 8 kayıt tutulur; fazlası `usedAt`'a göre en eskiden silinir.
- [ ] **Testler (Node, fake-indexeddb):**
  - kaydet → oku aynı sonucu verir;
  - farklı imza bulunmaz;
  - dokuzuncu kayıtta en eski kayıt silinir;
  - `deleteBook` kitabın düzenlerini de siler;
  - v1 veritabanı v2'ye yükseltilince kitaplar yerinde kalır.
- [ ] **`usePagination`:** yeni `cache?: {bookId, contentVersion}` parametresi alır. Arama sırası: bellekteki Map → IndexedDB → `paginate`, ardından `saveLayout`. Önbellekten gelen sonuç da yazı tipi yüklenmesini beklemez; çizim zaten o yazı tipiyle yapılacaktır.
- [ ] **e2e:** kitap açılır, sayfa sayısı okunur, sayfa yenilenir; aynı sayfa sayısıyla ve aynı sayfada açılır. İsteğe bağlı olarak IndexedDB'de `layouts` kaydı olduğu da denetlenir.
- [ ] **Doğrulama ve commit:**
  - `pnpm exec tsc -b`, `pnpm lint`, `pnpm test`, `pnpm test:browser`, `pnpm e2e`;
  - commit: `feat(layout): sayfalama önbelleği (IndexedDB)`.

### Görev 6 — Kitap gerçekçiliği
Satır kırılımını değiştirmeyen, yalnızca görsel ayrıntılar. Satır yüksekliğini etkileyen hiçbir şey (büyük ilk harf dahil) eklenmez, çünkü sayfalayıcı ölçümü `book.css` ile birebir aynı olmalı.
- [ ] **Kâğıt ve cilt:**
  - kâğıt rengi temadan gelir, üzerine hafif bir doku (CSS gradyan) eklenir;
  - çift sayfada iç kenarda cilt gölgesi (sol sayfanın sağında, sağ sayfanın solunda gradyan);
  - tek sayfada sol kenara ince bir gölge.
- [ ] **Sayfa kalınlığı:** okuma ilerlemesine göre kitabın sol ve sağ dış kenarında 0–6 px'lik katmanlı kenar çizgileri. Sol kalınlık okunan oranla, sağ kalınlık kalan oranla orantılıdır.
- [ ] **Bölüm açılışı:** bölümün ilk paragrafının ilk satırı küçük büyük harflerle yazılır (`::first-line { font-variant-caps: small-caps }`). Satır yüksekliği değişmez; sayfalayıcı tarayıcı testlerinde taşma olmadığı yeniden doğrulanır.
- [ ] **Sahne arası:** ⁂ süsü ortalanır ve rengi yumuşatılır. Bölüm açılış sayfasında sayfa başlığı gizlenir.
- [ ] **Doğrulama ve commit:**
  - `pnpm test:browser`, `pnpm e2e`; üç temada ekran görüntüsüyle göz kontrolü;
  - commit: `feat(reader): kitap görünümü ayrıntıları (cilt gölgesi, sayfa kalınlığı, bölüm açılışı)`.

### Görev 7 — Belgeler ve birleştirme
- [ ] **README:** sayfalı okuyucu, ayarlar, çevirme yolları, `pnpm test:browser` ve page-flip yaması anlatılır.
- [ ] **Son kontrol:** tüm testler çalıştırılır.
- [ ] **Birleştirme:** `main`'e yerel birleştirme, `git push`, çalışma ağacı (worktree) kaldırılır.
