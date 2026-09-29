# Plan 5 — Kitap içinde arama ve yer imleri

> **Ajanlar için:** Görevler alt ajanlarla uygulanır, her görev ayrı bir alt ajanla kod incelemesinden geçer. Adımlar `- [ ]` ile izlenir.

**Amaç:** Okur kitapta bir kelimeyi ya da ifadeyi arar, sonuçlara bakar ve istediği yere gider. Önemli sayfaları kâğıt kitaptaki gibi köşesini kıvırarak işaretler ve sonra bu yer imleri listesinden bulur. Bu iki özellik, özgün tasarımdaki Faz 3 maddelerindendir ve Plan 3'teki beyin fırtınası listesinde 4. ve 5. sırada yer alır.

**Mimari:**
- **Arama:**
  - Bloklar üzerinde, Türkçe büyük/küçük harf ve aksan duyarsız arama yapılır: "ısık" araması "Işık" ve "IŞIK" sonuçlarını da bulur. `src/text/pageGeometry.ts`'teki normalleştirme yeniden kullanılır ya da ortak bir modüle taşınır.
  - Sonuç: `{ locator, block, start, end, snippet }`. Sonuçlar bölümlere göre gruplanır.
  - Sayfa görünümünde eşleşme PDF sayfasının üstünde vurgulanır (`findTextRects`), metin görünümünde ise CSS Highlight ile.
- **Yer imleri:**
  - Dexie `version(4)` ile yeni bir tablo eklenir: `bookmarks: '++id, [bookId+pdfPage], bookId, createdAt'`.
  - Yer imi sayfa görünümünde PDF sayfasına bağlıdır. Metin görünümünde o konumun PDF sayfasına (`pdfPageOfLocator`) bağlanır; konum (locator) da saklanır.
  - `deleteBook` kitabın yer imlerini de siler.

---

### Görev 1 — Kitap içinde arama
- [x] **`src/text/search.ts`:** `searchBook(blocks, query, {limit})`.
  - Türkçeye uygun normalleştirme yapılır (I/ı, İ/i; â→a gibi aksanlar; yumuşak tire ve fazla boşluk yok sayılır).
  - Tam ifade aranır; birden çok kelimede kelimelerin art arda gelmesi gerekir.
  - Her sonucun çevresinden bir parça (snippet) alınır.
  - Sonuç sayısı sınırlanır (ör. 500); fazlası "daha fazla" diye bildirilir.
- [x] **Hız:** 1 MB metinde arama 100 ms'nin altında kalmalı. Normalleştirilmiş metin ve ofset haritası kitap başına bir kez hesaplanıp önbelleğe alınır.
- [x] **Arayüz:**
  - Üst çubuğa "Ara" eylemi eklenir (büyüteç simgesi). Eylem listesine girer; telefonda ⋯ menüsünde durur.
  - Panelde arama kutusu (otomatik odaklı, yazarken 200 ms gecikmeyle arar), sonuç sayısı ve bölüme göre gruplu sonuç listesi bulunur. Her satırda sayfa numarası ve eşleşmesi kalın gösterilen bir metin parçası vardır.
  - Bir sonuca dokununca o yere gidilir ve eşleşme sayfada vurgulanır. Vurgu kısa bir süre sonra solar ya da bir sonraki dokunuşta kalkar.
  - Panel açıkken ↑/↓ ile sonuçlar arasında gezilir, Enter ile gidilir, Esc ile kapanır.
  - Son aramalar hatırlanır (5 tane, localStorage).
- [x] **Testler:**
  - Birim testleri: Türkçe harf eşleşmeleri, çok kelimeli arama, metin parçası, sınır.
  - e2e (3 projede): arama → sonuç listesi → sonuca gitme → sayfa görünümünde SVG vurgusu, metin görünümünde `CSS.highlights`.
- [x] **Commit:** `feat(reader): kitap içinde arama`.

### Görev 2 — Köşe kıvırma yer imi
- [x] **Veri:** Dexie `version(4)` `bookmarks` tablosu, v3'ten yükseltme testiyle. `deleteBook` bu tabloyu da temizler.
- [x] **Sayfanın sağ üst köşesinde kıvrılmış köşe:**
  - Açık sayfada küçük, kâğıt renginde bir üçgen olarak görünür; gölgesi hafiftir.
  - Köşeye dokununca yer imi eklenir ya da kaldırılır (kısa bir kıvrılma animasyonuyla).
  - Yer imi yokken köşe yalnızca fare üzerine gelince ya da menü açıkken belirir, yani okumayı bozmaz.
  - Çift sayfada her sayfanın kendi dış köşesi vardır.
  - Köşeye dokunmak sayfa çevirme bölgesinden önce gelir ve sayfayı çevirmez.
- [x] **Yer imleri listesi:** Notlar paneline "Yer imleri" sekmesi eklenir ya da içindekiler paneline bir bölüm eklenir; hangisi daha sade duruyorsa. Her satırda sayfa numarası, bölüm adı, eklenme tarihi ve silme düğmesi bulunur. Bir satıra dokununca o sayfaya gidilir.
- [x] **Klavye:** `B` tuşu açık sayfanın yer imini ekler ya da kaldırır.
- [x] **Testler:** e2e (3 projede): ekleme → yenileme → hâlâ işaretli → listeden gitme → kaldırma. Birim/DB testleri de yazılır.
- [x] **Commit:** `feat(reader): köşe kıvırma yer imi`.

### Görev 3 — İnceleme ve birleştirme
- [ ] Kod incelemesi yapılır ve bulgular düzeltilir, ardından `main`'e birleştirilir ve 5173 güncellenir.
