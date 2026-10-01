# Plan 9 — Arayüz yenilemesi: Apple tarzı, sade ve şık

> **Ajanlar için:** Görevler alt ajanlarla uygulanır, her görev ayrı bir alt ajanla kod incelemesinden geçer. Adımlar `- [ ]` ile izlenir. Tasarım skill'leri (`redesign-existing-projects`, `minimalist-ui`) yüklenip yönergeleri uygulanır.

**Kullanıcı isteği (2026-09-30):**
- "Şu an gayet iyi ama daha profesyonel ve Apple mantığıyla sade şık bir frontend tasarımıyla gidelim, skilleri kullan."
- "Butonların ne işe yaradığını elle üstünde tutulunca göstersin, PC'de de fare üstüne getirince."

**Dokunulmayacaklar:**
- Sayfa görünümünün kitap sayfası ve kıvrılma görünümü (PDF görüntüsü, gölgeler, kâğıt, sayfa kenarı, cilt gölgesi).
- Metin görünümünün sayfa tipografisi (kitap yazı tipleri, sayfalama).
- Temaların sayfa renkleri.

Kullanıcı bunlarda "güzel" dedi (bkz. hafıza: sayfa görünümü tercihleri). Yenileme uygulama kabuğunu kapsar: kütüphane, üst ve alt çubuk, paneller, oynatıcı çubukları, araç çubukları, pencereler, menüler, düğmeler.

## Denetim (2026-09-30, ekran görüntüleri: iPad yatay ve Pixel, açık ve koyu)

1. **Üst çubuk kalabalık:** 10 simge yan yana (içindekiler, yer imi, ara, hızlı oku, odak, notlar, Metin, Kalem, kilit, Aa). Çoğunun etiketi yok, ne işe yaradıkları anlaşılmıyor. Simge ve metin karışık ("Metin", "Kalem" yazılı, diğerleri yalnızca simge).
2. **Ayarlar paneli:** onay kutulu çerçeveli kutucuklar web formu gibi duruyor.
   - Apple karşılığı: gruplu, köşesi yuvarlatılmış liste (inset grouped); açma/kapama düğmesi (switch); bölümlü seçici (segmented control).
3. **Kütüphane:**
   - Başlık ve düğme sıradan.
   - Kitap kartı: "Sil" her zaman görünüyor (Apple'da bağlam menüsünde olur), ilerleme yalnızca ince bir çizgi, "%" ya da "kaldı" bilgisi yok, "Okumaya devam et" öne çıkmıyor.
   - Tema seçici kütüphane sayfasının altında duruyor.
4. **Yazı:** arayüzde kitap yazı tipi (Literata) ile sistem yazısı karışık. Apple'da arayüz sistem yazısıdır (SF), serif yalnızca içerikte kullanılır.
5. **Durumlar:** düğmelerin çoğunda üzerine gelme ve basılma geri bildirimi zayıf. Araç ipucu (tooltip) yok.
6. **Tutarlılık:** yarıçap, boşluk ve gölge değerleri dosyadan dosyaya değişiyor; ortak bir ölçek yok.

## Tasarım dili

- **Yazı:**
  - Arayüzde sistem yazı tipi: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Inter, sans-serif`.
  - Başlıklarda `-apple-system` ve SF Pro Display ağırlıkları 600/700, eksi harf aralığı.
  - Sayılarda `tabular-nums`. Kitap yazı tipleri yalnızca kitap içeriğinde.
- **Renk:**
  - Mevcut tema değişkenleri korunur. Vurgu rengi (kahve) biraz daha yumuşak tutulur, tek vurgu renginde kalınır.
  - Nötr tonlar tek ailedendir (sıcak).
  - Koyu temada saf siyah yalnızca "Siyah" temada, arayüz yüzeyleri koyu gridir.
- **Malzeme:** çubuklar ve paneller için buzlu cam (`backdrop-filter: saturate(180%) blur(20px)`, yarı saydam yüzey, 0.5 px kenar çizgisi). Eski WebKit `-webkit-backdrop-filter` ister. Desteklemeyen cihazda düz yüzey kullanılır.
- **Ölçek (tasarım jetonları, `src/styles/ui.css`):**
  - boşluk: 4 / 8 / 12 / 16 / 20 / 24 / 32;
  - yarıçap: 8 (iç öğe), 12 (düğme), 16 (panel), 22 (sayfa); tam yuvarlak yalnızca simge düğmesinde;
  - gölge: yumuşak, iki katman ve sıcak tonlu;
  - z-index ölçeği: çubuk, panel, menü, pencere, ipucu.
- **Hareket:** 200–250 ms, iOS eğrisi (`cubic-bezier(0.32, 0.72, 0, 1)`); basılınca `scale(0.97)`. `prefers-reduced-motion` açıksa hareket yok.
- **Simgeler:** lucide kalır; çizgi kalınlığı her yerde 1.75, boyut 20/22.

## Görevler

### Görev 1 — Temel bileşenler ve araç ipucu
- [x] `src/styles/ui.css`: tasarım jetonları (yukarıdaki ölçekler, malzeme, hareket).
- [x] `src/ui/Tooltip.tsx`: araç ipucu.
  - Fareyle üzerine gelince 500 ms sonra görünür.
  - Dokunmatik ekranda basılı tutunca (450 ms) görünür; basılı tutma düğmeyi ÇALIŞTIRMAZ, bırakınca ipucu 1,5 sn kalır.
  - Klavye odağında da görünür.
  - Yazısı düğmenin `aria-label`'ından ve varsa kısayolundan gelir ("Sayfayı kilitle · L").
  - Ekran kenarında taşmaz, çubuk konumuna göre alta ya da üste açılır.
  - Kalem (pen) girdisinde görünmez.
- [x] `IconButton` (ipucu ve basma geri bildirimi dahil), `SegmentedControl`, `Switch`, `ListGroup` / `ListRow`, `Sheet`.
  - `Sheet`: telefonda alttan açılan panel, iPad ve bilgisayarda açılır pencere (popover).
- [x] Testler:
  - Birim: ipucu zamanlaması.
  - e2e: fareyle üzerine gelince ve dokunarak basılı tutunca ipucu görünür; basılı tutma eylemi tetiklemez.
  - Her üst çubuk düğmesinin bir ipucu vardır.

### Görev 2 — Okuyucu kabuğu
- [x] **Üst çubuk (iPad ve bilgisayar):**
  - Sol: geri, kitap adı.
  - Sağ: İçindekiler, Ara, Okuma modları menüsü, Kalem kipi, Aa, ⋯.
  - Okuma modları menüsü tek düğmedir (kulaklık ya da "oku" simgesi) ve Sesli oku, Hızlı oku ve Odak'ı içerir.
  - ⋯ menüsünde yer imi, notlar, Metin/Sayfa görünümü ve kilit durur. Kilit ve yer imi çok kullanılıyorsa sağda görünür kalabilir; en az dokunuşla ulaşılacak biçimde karar verilir.
  - Tüm düğmelerin ipucu vardır.
- [x] **Telefon:** aynı gruplama, daha az simge.
- [x] **Ayarlar paneli (Aa):**
  - gruplu liste;
  - Görünüm, efekt ve hizalama için bölümlü seçici;
  - açma/kapama seçenekleri için switch;
  - tema seçici yuvarlak örneklerle, iOS benzeri;
  - parlaklık kaydırıcısı korunur.
- [x] **Alt çubuk:** kaydırıcı ve durum satırı sadeleşir (iOS Kitaplar'daki gibi "Sayfa 12 / 240 · Bölümde 8 sayfa kaldı"). ‹ › düğmeleri ve yakınlaştırma çubuğu aynı dili kullanır.
- [x] **Oynatıcı çubukları** (sesli okuma, hızlı okuma ve RSVP, odak), kalem araç çubuğu, ses menüsü, arama, içindekiler ve not panelleri aynı malzeme, yarıçap ve boşluklarla yeniden giydirilir. İşlevleri değişmez.
- [x] e2e test seçicileri (`data-testid`) korunur; kullanıcıya görünen adlar değişirse testler güncellenir.

**Karar (üst çubuk gruplaması, 2026-09-30):**
- iPad ve bilgisayar, sağda: İçindekiler, Ara, Okuma modları, Kalem kipi, **Kilit**, Aa, ⋯.
  - Kilit çubukta kaldı: iPad'de yakınlaştırmanın tek yolu kilit; okurken sık açılıp kapanır, basılı durumu görünür olmalı (L tuşu klavyesiz iPad'de yok). Menüde olsaydı iki dokunuş gerekirdi.
  - Yer imi ⋯ menüsünde: sayfanın köşesine tek dokunuşla da konur (ve B tuşu); çubukta ikinci bir yol gereksiz.
  - ⋯: Yer imi, Notlar | Metin/Sayfa görünümü (öbekler arasında ayırıcı; görünüm Aa panelinde de var).
- Telefon, sağda: İçindekiler, Okuma modları, Aa, ⋯ (başlık okunsun). ⋯: Kitapta ara, Yer imi, Notlar | Kalem kipi, Sayfayı kilitle | Metin/Sayfa görünümü.
- Eylem listesi veriye dayalı kaldı (her eylemin geniş ve dar ekrandaki yeri); menü düğmesinin `data-actions`'ı içindeki eylemlerdir (e2e `headerAction` buradan bulur).
- Kitap sayfasına dokunulmadı: sayfa ve metin görünümünde kitabın pikselleri önce/sonra aynı (yüzen ‹ › düğmeleri hariç); okuma modu çubuklarının yüksekliği korundu (kitabın altında ayrılan yer değişmez).

### Görev 3 — Kütüphane (Plan 8 yedekleme birleştikten sonra)
- [x] **Büyük başlık:** "Kitaplık" (iOS büyük başlık gibi, kaydırınca küçülen çubuk).
- [x] **Sağ üst:** "+" (PDF ekle), ⋯ (Yedekle/Geri yükle, Tema, Hakkında).
- [x] **"Okumaya devam et" kartı:** son okunan kitap büyük kapakla, ilerleme yüzdesi ve "Kaldığın yerden devam et".
- [x] **Kitap ızgarası:** kapaklar gölgeli ve yuvarlatılmış.
  - Altında başlık, yazar ve ilerleme ("%34" ya da "Yeni").
  - Silme ve yeniden adlandırma bağlam menüsünde (⋯ ya da basılı tut).
  - Dönüştürme durumu kapak üstünde ince bir çubuk olarak gösterilir.
- [x] **Boş durum:** sade bir çizim ve tek bir "PDF ekle" çağrısı.
- [x] **Tema seçici:** ⋯ menüsüne ya da ayrı bir ayar sayfasına taşınır.
- [x] **Kurulum kartı ve yedek hatırlatıcısı:** tek, sade bir bilgi şeridi.

**Uygulama notları (Görev 3):**
- Kitabın menüsü: kartın ⋯ düğmesi, kapağa dokunarak basılı tutma (500 ms, kitap açılmaz) ve sağ tık; "Yeniden adlandır" küçük bir pencere, "Sil" onaylı.
- İlerleme: hiç açılmamış kitap "Yeni", sonuna gelinmiş "Bitti", arada "%34".
- Kurulum ve yedek hatırlatması aynı sade şerit (InfoStrip); ikisi birden görünebilir.
- Yedek penceresi aynı dilde: gruplu satırlar ve switch'ler, düğmeler dolu/soluk.

### Görev 4 — Gözden geçirme
- [ ] Önce/sonra ekran görüntüleri (iPad ve telefon, açık ve koyu).
- [ ] Erişilebilirlik: kontrast, dokunma hedefi (44 px), odak halkası.
- [ ] Eski WebKit uyumu: `-webkit-backdrop-filter`, `:has()` kullanılmaz.
- [ ] Kod incelemesi, ardından `main`'e birleştirme.
