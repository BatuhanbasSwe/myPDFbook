# Plan 10 — Sayfaların önceden hazırlanması ve "Uygulamayı yükle" menüde

> **Ajanlar için:** Görevler alt ajanla uygulanır, sonunda kod incelemesinden geçer. Adımlar `- [ ]` ile izlenir.

**Neden:** Kullanıcı: "kitap sayfası çevirince yükleniyor diyor o biraz kötü oluyor … kullanıcı kitaba girdiğinde arka planda geri kalan sayfaları hazır etsin." ve "uygulamayı yükle seçeneğine çarpıya tıklayınca bir daha karşıma gelmiyor … 3 nokta var ya oraya seçenek ekle."

**Kısıtlar:**
- Sayfa görünümünün görüntüsü değişmez (PDF sayfa görüntüleri, kıvrılma, gölgeler, kâğıt, iki tema). Yalnızca yükleme davranışı değişir.
- Asıl cihaz eski WebKit'li iPad (iPadOS ≤ 18, belki 16.4'ten eski): bellek sınırlı; `requestIdleCallback` yok (Safari), `OffscreenCanvas` yok, `toBlob('image/webp')` yok (PNG'ye düşer).
- Aynı anda tek pdf.js çizimi (`enqueueRender`); kıvrılma sürerken arka planda çizim yok.

### Görev 0 — Ölçüm (önce)
- [x] Uzun test kitabı: `long-tr.pdf` (60 sayfa, `pnpm fixtures long-tr.pdf`).
- [x] iPad (WebKit) ve "yavaş iPad" (iPad ekranı, Chromium, işlemci 6× yavaş) ile: sayfa başına çizim süresi ve JPEG boyu; olağan ve hızlı çevirmede yer tutucunun göründüğü kare sayısı; uzağa atlama.
- [x] Atomik Alışkanlıklar (yalnızca yerelde, repoya girmez) ile aynı ölçümler.

### Görev 1 — Sayfa önbelleği ve öncelik sırası (`src/pdf/pageCache.ts`, `src/pdf/renderPlan.ts`)
- [x] Önbellek: sayfa + çizim genişliği + nitelik (keskin / önizleme) → JPEG Blob ve adresi. Boyut bayt ile sayılır; bütçe aşılınca okuma yerine en uzak (eşitse en eski kullanılan) giriş çıkar, adresi bırakılır. Ekranda olan (iğnelenmiş) giriş çıkmaz.
- [x] Bütçe: iPad ve bilgisayar 136 MB keskin + 14 MB önizleme (toplam 150 MB); telefon 64 + 8 MB.
- [x] Sıra (saf işlev): açık sayfalar → yakın sayfaların önizlemesi (ileride 4, geride 2) → okuma yönünde sonraki iki açılış → önceki açılış → önizlemeler geniş bir pencerede → keskin sayfalar giderek uzağa. Bütçeye sığmayan uzak sayfa çizilmez.
- [x] Birim testleri: bütçe, çıkarma sırası, iğne, sıra.

### Görev 2 — Arka planda çizen (`src/pdf/pageRenderer.ts`)
- [x] Belge başına bir çizici: ön plan istekleri (görünen ve komşu sayfalar) her zaman önce; arka plan işi boşta (`requestIdleCallback`, yoksa `setTimeout`) ve tek tek, aralarında nefes.
- [x] Sayfa çevrilirken (kıvrılma ya da kayma) arka plan çizimi başlamaz, sürmekte olan çizim pdf.js'in parçaları arasında bekler (`onContinue`). Ön plan isteği gelirse ya da başka çizim (yakınlaştırma, kapak) sıra beklerse arka plan çizimi bırakılır.
- [x] Atlamada (kaydırıcı, içindekiler, sayfaya git) sıra yeni yerden yeniden hesaplanır; uzakta kalan çizim bırakılır.
- [x] Sekme gizliyken arka plan durur. Okuyucu kapanınca önbellek boşaltılır.
- [x] Takılan çizim (ölen worker) çiziciyi durdurmaz: 20 sn hiç ilerlemezse bırakılır, sayfa çizilemedi sayılır. Süre toplam değil ilerlemesiz süredir: yavaş ama ilerleyen çizim, çevirme sırasında bekleyen ya da gizli sekmede duran çizim bozuk sayılmaz (ilk sürümde toplam 25 sn'ydi; çok yavaşlatılmış denemede uzağa atlanan sayfa önizlemede kalıyordu).
- [x] Test kancası (yalnızca geliştirmede): `window.__pageCache()` → giriş sayısı ve bayt.

### Görev 3 — Sayfa görüntüsü (`PageImage.tsx`)
- [x] Önbellekte varsa ilk çizimde gösterilir (yer tutucu hiç görünmez).
- [x] Keskin yoksa önizleme (aynı kutuya, aynı oranla); keskin görüntü yüklenince önizleme kalkar (sıçrama yok). Koyu temadaki parlaklık süzgeci önizlemeye de uygulanır.
- [x] "Sayfa N yükleniyor…" yalnızca ekran okuyucu için; gözle görünen boş beyaz sayfa.
- [x] Yakınlaştırınca keskin yeniden çizim (Plan 7) aynen sürer.
- [x] `pdfBook.tsx` okuma yerini çiziciye bildirir; `CurlEngine` ve slayt çevirmenin sürdüğünü bildirir.
- [x] Kıvrılan kitapta dolu sayfa sayısı ±4 → ±6 (hızlı çevirmede sağ sayfa bir an boş kalıyordu; önbellekteki görüntü kutuya konunca birkaç karede yüklenir).

### Görev 4 — "Uygulamayı yükle" ⋯ menüsünde
- [x] Kütüphanenin ⋯ menüsünde "Uygulamayı yükle"; uygulama olarak açıldıysa görünmez.
- [x] Chromium kurulum olayı yakalandıysa tarayıcının kurulum penceresi açılır; yoksa küçük pencerede adımlar (iPad/iPhone: Paylaş → Ana Ekrana Ekle).
- [x] e2e: şerit kapatılır, ⋯ → Uygulamayı yükle → adımlar görünür.

### Görev 5 — Testler ve doğrulama
- [x] e2e: kitap açılıp biraz beklenince ileri çevirmede yer tutucu hiç görünmez; uzağa atlayınca önce önizleme, sonra keskin sayfa; önbellek bütçeyle sınırlı.
- [x] tsc, lint, prettier, birim (542) ve tarayıcı (40) testleri, e2e: ipad 111, pixel 111, masaüstü 109 geçti (3–5 atlandı).
- [x] Ölçümler (önce / sonra) aşağıda; ekran görüntüleri.

**Ölçümler (2026-10-02, 2026-11-07; Playwright, bu bilgisayar):**

Ölçüm betiği (`e2e-measure/`, repoda yok): kitap açılır, 4 sn okunur; 10 kez 2 sn arayla çevrilir ("olağan", çok hızlı bir okur); 150 ms arayla 10 kez → basılır ("hızlı"); sayfaya git ile uzağa atlanır. Her karede görünen sayfa kutularına bakılır: ne görüntüsü ne önizlemesi olan sayfa "boş" sayılır. "Yavaş iPad": iPad ekranı, Chromium, işlemci 3× yavaş (CDP); gerçek eski iPad'in yerine kaba bir benzetim. Atomik Alışkanlıklar yalnızca yerelde okundu, repoya girmez.

Sayfa başına çizim (pdf.js → JPEG 0,85), ortalama:

| Kitap | Tarayıcı | Keskin (1066 px) | Önizleme (266 px) |
|---|---|---|---|
| long-tr.pdf (60 s.) | iPad WebKit | 78 ms, 171 KB | 40 ms, 21 KB |
| long-tr.pdf | Chromium 6× yavaş | 358 ms, 193 KB | 95 ms, 23 KB |
| Atomik (202 s.) | iPad WebKit | 201 ms (medyan 94, en çok 826), 279 KB (en çok 384) | 166 ms (medyan 50), 28 KB |
| Atomik | Chromium 6× yavaş | 504 ms, 315 KB | 198 ms, 30 KB |

Uygulamada iPad Pro 11 yatayda çift sayfanın çizim genişliği 1142 px. Önizleme Atomik'te WebKit'te keskin sayfadan pek ucuz değil (çözümleme ağır basıyor); uzun test kitabında ~2 kat, yavaş Chromium'da ~3–4 kat ucuz.

Çevirirken boş sayfa görünen kare / toplam kare (önce → sonra; parantezde önizleme görünen kare):

| Kitap, tarayıcı | Olağan çevirme | Hızlı çevirme | Uzağa atlama |
|---|---|---|---|
| long-tr, iPad WebKit | 0/615 → 0/721 | 18/84 → 0/145 | 3/134 → 0/168 |
| long-tr, yavaş iPad (3×) | 0/928 → 0/991 | 117/165 → 0/181 | 23/168 → 0/175 |
| Atomik, iPad WebKit | 0/457 → 0/371 | 19/57 → 0/39 (8) | 4/122 → 5/77 |
| Atomik, yavaş iPad (3×) | 722/807 → 573/826 (123) | 142/142 → 154/154 | 162/162 → 162/162 |

- Uzun test kitabında iki tarayıcıda da çevirmede ve atlamada boş sayfa kalmadı (yavaş benzetimde ilk sayfa ~1,1 sn). WebKit'te Atomik'te de çevirmede boş sayfa yok. Atomik'te 200. sayfaya atlamada 5 kare boş: açıldıktan ~25 sn sonra önizlemeler henüz ~186. sayfaya varmıştı.
- Yavaş benzetimde Atomik'te keskin sayfa uygulamada ~470 ms sürüyor: 2 sn'de bir açılış çeviren okura (2 sayfa + önizlemeler) yetişemiyor. Gerçek okumada bir açılış dakikalar sürer, arka plan o sürede öne geçer. Bu satır gerçek iPad'de denenmeli (aşağıda).
- İlk sayfanın görünmesi değişmedi (WebKit'te ~0,8–1,5 sn; açılışta önce açık sayfalar çizilir).
- Önbellek: long-tr'nin tamamı 60 keskin + 53 önizleme ≈ 12,9 MB; Atomik'te sayfa başına ~300 KB ile 202 sayfa ≈ 60 MB keskin + ~6 MB önizleme.

**Kararlar:**
- **Önbellek yalnızca bellekte, IndexedDB'ye yazılmaz.** Ölçüme göre kitabın tamamı bütçeye sığıyor (200 sayfa ≈ 60 MB) ve sayfa yeniden çizimi ucuz (WebKit'te ~0,1–0,2 sn): açılışta açık sayfalar ~1 sn'de, sonrakiler okurken hazır. Kalıcı önbellek kitap başına 60–150 MB disk demek; Safari'nin depolama sınırı ve kullanılmayan sitelerin verisini silmesi, şema değişikliği ve yedekten ayrı tutma gerektirirdi. Kazancı yalnızca ikinci açılışın ilk birkaç saniyesi. Önbellek Dexie'ye hiç girmediği için yedeğe de giremez.
- **"Geri kalan sayfalar":** bütçeye sığdıkça kitabın tamamı (okuma yönünde önce). Sığmazsa okuma yerinin çevresinde bir pencere: en uzak (eşitse en eski kullanılan) giriş çıkar, bütçeye sığmayan uzak sayfa hiç çizilmez.
- **Bütçe:** iPad ve bilgisayar 136 MB keskin + 14 MB önizleme (toplam 150 MB), telefon 64 + 8 MB. Sayılan bayt sıkıştırılmış JPEG boyu; çözülmüş görüntü yalnızca kitabın kurduğu ±6 sayfada (ekranda olan ve gizli komşular) var. Ekrandaki (iğnelenmiş) giriş bütçeyi aşsa da çıkmaz.
- **Biçim:** JPEG 0,85 (eskisiyle aynı; görünüm değişmez), keskin genişlik en çok 1600 px ve piksel oranı en çok 2 (eskisi gibi). WebP yok: Safari `toBlob('image/webp')` desteklemez, PNG'ye düşer (büyük). ImageBitmap yok: sayfa başına ~7,8 MB çözülmüş bellek.
- **Önizleme:** keskin genişliğin dörtte biri (~286 px). `img` değil arka plan görüntüsü (ekran okuyucu ve testler sayfada tek görüntü görür); keskin görüntü yüklenince kalkar; koyu temada aynı parlaklık süzgeci.
- **Sıra ve öncelik:** tek pdf.js çizimi (`enqueueRender`), çizicinin aynı anda tek işi var. Ön plan (ekrandaki ve komşu sayfalar) hep önce; görüntüsü hiç olmayan komşu sayfanın önce önizlemesi. Ön plan isteği ya da başka bir çizim (yakınlaştırma, kapak) sıra beklerse arka plan çizimi pdf.js'in bir sonraki parçasında bırakılır, sonra yeniden denenir.
- **Takılma yok:** kıvrılma ya da kayma sürerken arka plan çizimi başlamaz; sürmekte olan çizim pdf.js'in parçaları arasında (`onContinue`) bekler, çevirme bitince 150 ms sonra sürer. Ekrandaki sayfa çevirme sırasında da çizilir (yoksa boş kalır). İşler arası `requestIdleCallback`, Safari'de 40 ms bekleme.
- **Yakınlaştırma (Plan 7)** aynen: keskin yeniden çizim kendi yolundan, `enqueueRender` ile; arka plan ona yol verir.
- **"Uygulamayı yükle":** şerit yeniden açılmaz; ⋯ menüsünden küçük pencere (Sheet) açılır: iPad/iPhone'da Paylaş → Ana Ekrana Ekle. Chromium `beforeinstallprompt` yakalandıysa doğrudan tarayıcının kurulum penceresi; ikisi de yoksa "tarayıcının menüsünden" adımı. Şeridin kapatılması (`mypdfbook:install-card`, localStorage) değişmedi. Uygulama olarak açıldıysa (`display-mode: standalone` ya da `navigator.standalone`) öğe yok.

**Gerçek iPad'de denenecekler:**
- Atomik'i açıp ilk sayfanın gelme süresi; 10–20 sn bekleyip art arda (hızlı da) çevirme: boş beyaz sayfa ya da bulanık önizleme görünüyor mu.
- Kıvrılma akıcı mı: arka planda çizim sürerken sayfayı parmakla çekmeye başlayınca takılma var mı.
- Sayfaya git / kaydırıcı ile uzağa atlama: önce bulanık önizleme, sonra keskin; sayfa yerinden sıçramıyor.
- Uzun okuma (10+ dk, 200+ sayfalık kitap): Safari sekmeyi yeniden yüklemiyor (bellek; bütçe 150 MB).
- Koyu ve siyah temada önizleme ile keskin sayfa aynı parlaklıkta.
- Kilit + yakınlaştırma: sayfa keskinleşiyor (Plan 7).
- Safari'de ⋯ → Uygulamayı yükle adımları doğru (iPad'de Paylaş üstte); ana ekrandan açılan uygulamada öğe yok.
