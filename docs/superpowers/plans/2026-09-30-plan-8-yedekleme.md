# Plan 8 — Yedekleme ve cihazlar arası taşıma

> **Ajanlar için:** Görevler alt ajanlarla uygulanır, her görev ayrı bir alt ajanla kod incelemesinden geçer. Adımlar `- [ ]` ile izlenir.

**Kullanıcının seçimi (2026-09-30):** yedekleme ve cihazlar arası taşıma. Bütün veri yalnızca o cihazın tarayıcısında (IndexedDB) duruyor. iPad sıfırlanırsa ya da Safari verileri silerse kitaplar, notlar, fosforlu kalem çizgileri ve okuma yerleri gider. Başka bir cihaza (telefon ↔ iPad) taşımanın bir yolu da yok.

**Amaç:**
- Tek dokunuşla bir yedek dosyası (`.mypdfbook`) üretilir. Dosya iPad'de Dosyalar'a ya da iCloud Drive'a kaydedilir, AirDrop ya da paylaşım ile başka cihaza gönderilir.
- Başka bir cihazda (ya da aynı cihazda) bu dosya seçilince içindekiler birleştirilir: eksik kitaplar eklenir, notlar ikileşmez, okuma yeri en yenisi olur.

**Kısıtlar:**
- Sunucu ve hesap yok; iş tamamen dosya ile yapılır.
- Asıl cihaz eski WebKit'li bir iPad'dir. Safari 17'den yeni bir API kullanılmaz, kullanılacaksa yedeği eklenir.
- Büyük PDF'ler bellekte ikiye katlanmamalıdır; iPad'de bellek sınırı düşüktür.

**Mimari:**
- **Biçim:** ZIP (`fflate`, MIT; sıkıştırmasız STORE ile PDF'ler için hızlı).
  - `manifest.json`: biçim sürümü, uygulama sürümü, tarih, cihaz ve içindekiler.
  - `data.json`: kitap kayıtları (kapakları dahil), okuma yerleri, işaretler (fosforlu kalem, kalem, notlar), yer imleri ve ayarlar (`mypdfbook:*` localStorage anahtarları, tema dahil).
  - `contents/<bookId>.json`: dönüştürülmüş metin. İsteğe bağlıdır; geri yüklemede yeniden dönüştürmeyi önler.
  - `pdf/<bookId>.pdf`: isteğe bağlıdır ("PDF'leri de ekle", boyutu gösterilir).
  - Sayfalama önbelleği (`layouts`) yedeğe girmez, yeniden hesaplanır.
- **Kimlikler:**
  - Kitap kimliği SHA-256'dır, cihazdan bağımsızdır.
  - İşaretlerin (annotations) kimliği otomatik sayıdır, cihaza özeldir. Birleştirmede içerik parmak izi kullanılır: kitap + sayfa + tür + renk + noktaların özeti (ya da not metni). Aynı işaret iki kez eklenmez.
  - Yer imi `[bookId+pdfPage]` ile tekildir.
  - Okuma yerinde `updatedAt` büyük olan kazanır.
- **Dışa aktarma** (iPad uyumu):
  - Önce Web Share API denenir (`navigator.share({ files })`, iOS 15+): AirDrop, Dosyalar, Mesajlar.
  - Olmazsa `<a download>` + Blob kullanılır (iOS Safari 13+ "Dosyalar'a kaydet"i açar).
  - Dosya adı: `mypdfbook-yedek-YYYY-AA-GG.mypdfbook`.
- **İçe aktarma:**
  - Dosya seçici (`.mypdfbook,.zip`) ve kütüphaneye sürükle-bırak.
  - Önce özet gösterilir ("5 kitap, 3'ü yeni; 42 not; 7 yer imi; PDF'ler var/yok"), sonra onay alınır.
  - PDF'i yedekte olmayan ve cihazda da bulunmayan kitaplar "PDF bekleniyor" durumunda eklenir. Aynı PDF sonradan içe aktarılınca (hash eşleşir) kitap tamamlanır.
- **Ayarlar birleştirmesi:** "Ayarları da uygula" seçeneği, varsayılanı kapalı; cihaz ayarları korunur.

---

### Görev 1 — Yedek biçimi ve saf mantık
- [x] `src/backup/format.ts`: türler, sürüm ve doğrulama (bozuk ya da yeni sürüm dosyada anlaşılır Türkçe hata).
- [x] `src/backup/exportBackup.ts`: `{ includePdfs, includeContents }` seçenekleriyle `Blob` üretir.
  - PDF'ler DB'den tek tek okunup ZIP'e akıtılır; bellekte hepsi birden durmaz.
  - İlerleme bildirilir.
- [x] `src/backup/importBackup.ts`:
  - `inspect(file)` özet döndürür.
  - `apply(file, options)` tek Dexie işleminde birleştirir; PDF'ler işlem dışında parça parça yazılır.
  - İlerleme bildirilir.
- [x] **Birleştirme kuralları:**
  - kitap: yoksa eklenir; varsa kullanıcı düzenlemeleri (başlık, yazar) ve `lastOpenedAt` en yeniyle güncellenir;
  - okuma yeri: `updatedAt` en yeni olan kalır;
  - işaretler: parmak iziyle tekilleştirilir;
  - yer imleri: tekilleştirilir.
- [x] **Testler** (Node, fake-indexeddb):
  - dışa aktar → boş DB'ye içe aktar: birebir aynı;
  - iki cihaz senaryosu: iki yönlü birleştirmede ikileşme yok, en yeni okuma yeri kalıyor;
  - PDF'siz yedek + sonradan PDF içe aktarma: kitap tamamlanıyor;
  - bozuk ya da yeni sürüm dosya hatası;
  - 200 MB'lık PDF simülasyonunda bellek kullanımı (akış) makul kalıyor.
- [x] Commit: `feat(backup): yedek dosyası biçimi, dışa ve içe aktarma`.

### Görev 2 — Arayüz
- [ ] Kütüphanede "Yedekle / Geri yükle" düğmesi ve pencere:
  - PDF'leri de ekle (toplam boyut yazılır);
  - dönüştürülmüş metni ekle (varsayılan açık);
  - "Yedeği al": paylaş ya da kaydet, ilerleme çubuğu;
  - "Yedekten yükle": dosya seç → özet → onay → ilerleme → sonuç.
- [ ] Hatırlatıcı:
  - son yedek zamanı saklanır (localStorage);
  - kitap varken 14 günden uzun süre yedek alınmadıysa kütüphanede küçük, kapatılabilir bir uyarı çıkar;
  - ilk kitap eklendikten sonra bir kez "Yedek almayı unutma" ipucu gösterilir.
- [ ] "PDF bekleniyor" durumundaki kitap kartı: "PDF'i ekle" düğmesi; hash uyuşmazsa uyarı verilir.
- [ ] e2e (3 projede):
  - iki ayrı tarayıcı bağlamı; birinde işaret, yer imi ve okuma yeri oluşturulur, yedek alınır (indirme yakalanır), öteki bağlamda yüklenir, hepsi görünür;
  - ikinci yükleme ikileşme yaratmaz;
  - PDF'siz yedek senaryosu.
- [ ] Commit: `feat(backup): yedekle ve geri yükle penceresi, hatırlatıcı`.

### Görev 3 — İnceleme ve birleştirme
- [ ] Kod incelemesi, düzeltmeler, `main`'e birleştirme ve gerçek iPad'de paylaş/kaydet denemesi.
