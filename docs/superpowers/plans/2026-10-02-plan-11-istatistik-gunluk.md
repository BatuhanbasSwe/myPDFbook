# Plan 11 — Okuma istatistikleri ve kitap günlüğü

> **Ajanlar için:** Görevler alt ajanla uygulanır, sonunda kod incelemesinden geçer. Adımlar `- [x]` ile izlenir.

**Neden:** Kullanıcı istedi: "okuma istatistiklerini ekle", "kitap günlüğü de ekle" (özgün plandaki Faz 3 kitap kartı ve Faz 4 istatistik). Şimdiye dek hiçbir okuma süresi tutulmuyor: izleme sıfırdan kurulur.

**Kısıtlar:**
- Asıl cihaz eski WebKit'li iPad (iPadOS ≤ 18, belki 16.4'ten eski): yeni API'ye yedek konur; `:has()` ve `color-mix()` yedeksiz kullanılmaz. `crypto.randomUUID` yok sayılır (`getRandomValues` var).
- Plan 9'un ortak bileşenleri ve jetonları (`src/ui/`, `ui.css`): Apple Kitaplar / Fitness halkaları gibi sade. Grafikler düz SVG, yeni kütüphane yok.
- Okuyucunun kitap sayfası değişmez: tahminler alt çubuğun durum satırında, "bitirdin mi?" sorusu kitabın üstünde küçük bir kart.
- Okuyucuda sayfa başına iş yok: izleyici olayda yalnızca bir zaman yazar; 15 sn'de bir denetler, dakikada bir kaydeder.
- Başka çalışma ağacı (`perf`) `PageImage.tsx`, `pdfBook.tsx` ve kütüphane ⋯ menüsüne dokunuyor: onlara dokunulmaz, menüye tek öğe eklenir.

### Görev 1 — Veri modeli (Dexie 5. sürüm)
- [x] `sessions` tablosu: `{ id, bookId, start, end, activeMs, pages, words }`; dizin `id, bookId, start`. Kimlik rastgele metin (yedekte cihazlar arasında aynı kalır).
- [x] Günlük alanları kitap kaydında (dizinsiz, şema gerektirmez): var olan `readingStatus` ve `startedAt` korunur; yeni `finishedAt`, `rating` (0,5 adımlı), `review`, `journalUpdatedAt`, `finishAsked`.
- [x] `markOpened` başlama tarihini ve "okunuyor"u yazınca `journalUpdatedAt`'i de yazar.
- [x] Hedefler (günlük dakika, varsayılan 20; yıllık kitap, varsayılan 12) `mypdfbook:goals` ayarında; yedeğin ayarlarına girer.
- [x] Kitap silinince oturumları kalır (okuma geçmişi kullanıcınındır, toplamlar değişmez).
- [x] Testler: 4. sürümden yükseltme (kitaplar, işaretler, yer imleri korunur, `sessions` boş), günlük işlemleri.

### Görev 2 — Oturum izleyici
- [x] `src/stats/sessionTracker.ts` (saf, sahte zamanlayıcıyla sınanır): etkinlik (sayfa çevirme, dokunma, kalem, tuş, kaydırma) ya da sesli/hızlı okuma sürerken süre işler; 2 dk etkinlik yoksa durur (son etkinlikten 2 dk sonrasına dek sayılır), sekme gizlenince ya da sayfa kapanınca hemen biter ve yazılır.
- [x] 30 sn'den kısa göz atma kaydedilmez. Uzun oturum dakikada bir güncellenir (iPad sekmeyi habersiz kapatabilir).
- [x] Okunan sayfalar: oturumda yeni görünen PDF sayfaları (açılıştaki sayfa sayılmaz) ve onların kelimeleri.
- [x] `useSessionTracker` okuyucuda: olaylar pasif dinleyiciyle, hiçbir şey yeniden çizilmez.
- [x] Commit: `feat(stats): okuma oturumları izlenir`.

### Görev 3 — Hesaplar
- [x] `src/stats/aggregate.ts`: yerel güne bölme (gece yarısını aşan oturum iki güne paylaştırılır), seri (bugün henüz okunmadıysa dünden sürer) ve en uzun seri, hafta (pazartesiden), yıllık ısı haritası (son 53 hafta; dilimler hedefe göre), kitap başına toplam, sayfa/dk ve kelime/dk, bu yıl biten kitaplar.
- [x] Tahmin: bu kitabın hızı (en az 5 dk ve 3 sayfa), yoksa genel hız, yoksa gösterilmez. "Bölümün bitmesine ~8 dk", "Kitabın bitmesine ~3 sa 20 dk".
- [x] Birim testleri: gece yarısı ve saat dilimi, seri, ısı haritası dilimleri, tahminler.

### Görev 4 — İstatistikler ekranı (`/istatistik`)
- [x] Kütüphanenin ⋯ menüsünde "İstatistikler".
- [x] Bugün: hedef halkası (dakika / hedef), seri ve en uzun seri.
- [x] Bu hafta: sütun grafiği (hedef çizgisi, dokununca değer), yıllık ısı haritası (telefonda küçük hücreler), ekran okuyucuya tablo.
- [x] Bu yıl biten kitaplar / yıllık hedef; toplam süre, ortalama sayfa/dk ve kelime/dk; kitap başına liste (günlüğü açar).
- [x] Hedef ayarları (günlük dakika, yıllık kitap); veri yoksa boş ekran.
- [x] Commit: `feat(stats): istatistikler ekranı`.

### Görev 5 — Kitap günlüğü
- [x] `JournalSheet`: durum (Okunacak / Okunuyor / Bitti / Yarım), başlama ve bitiş tarihi (yerel tarih kutusu), yarım yıldızlı puan (radyo grubu: dokunma, oklar, ekran okuyucu), inceleme (kendiliğinden kaydedilir), kitabın okuma süresi ve son oturumları, not ve işaret sayısı.
- [x] "Bitti" seçilince bitiş tarihi bugün; tarihler elle değişebilir.
- [x] Kütüphanede kitabın ⋯ menüsünden ve okuyucunun ⋯ menüsünden açılır.
- [x] Kitap kartında durum ve puan sade biçimde ("Bitti · ★ 4,5").
- [x] Son sayfada bir kez: "Kitabı bitirdin mi?" (Evet: bitti, bugün, puan sorulur; Henüz değil). Yanıt kitapta saklanır.
- [x] Commit: `feat(journal): kitap günlüğü`.

### Görev 6 — Okurken tahmin
- [x] Durum satırı: "Sayfa 12 / 240 · Bölümde 8 sayfa kaldı · ~8 dk"; bölüm dışında kitabın kalanı. Yeterli veri yoksa görünmez.
- [x] Commit: `feat(stats): okurken kalan süre tahmini`.

### Görev 7 — Yedek
- [x] `data.json`'a `sessions` (yoksa boş: eski yedekler açılır); kitapta günlük alanları (yoksa yok sayılır). Biçim sürümü 1 kalır: eski uygulama bilinmeyen alanları atlar.
- [x] Birleştirme: oturum kimlikle (aynı kimlikte bitişi sonra olan kalır), günlük `journalUpdatedAt`'i yeni olan kazanır (eski yedekte eski kural).
- [x] Özet ve sonuç: yedekteki oturum sayısı ve yeni olanlar, eklenen oturumlar.
- [x] Birim testleri: doğrulama, birleştirme, gidiş-dönüş, eski yedek.
- [x] Commit: `feat(backup): oturumlar ve kitap günlüğü yedeğe girer`.

### Görev 8 — Doğrulama
- [x] tsc, lint, prettier, birim ve tarayıcı testleri, e2e (3 proje, ayrı ayrı).
- [x] e2e: sahte saatle okuma → istatistikte dakikalar; günlük puanı ve durumu yenilemeden sonra kalır; son sayfadaki soru kitabı bitirir.
- [x] Ekran görüntüleri: iPad açık ve koyu, telefon açık (istatistik, günlük, son sayfa sorusu).
- [x] Gerçek iPad'de denenecekler (aşağıda).

**Kararlar (2026-10-02):**
- Günlük alanları kitap kaydında (ayrı tablo yok): `readingStatus` ve `startedAt` zaten vardı, yeniden kullanıldı (unread = Okunacak, reading = Okunuyor, finished = Bitti, abandoned = Yarım bırakıldı). Dizinsiz alanlar: kitaplar için yükseltme gerekmez; 5. sürüm yalnızca `sessions` tablosunu ekler. `SCHEMA` dizisi: test eski sürümlü veritabanını ilk 4 sürümle kurar.
- Oturum = kesintisiz okuma: 2 dk etkinlik olmazsa biter ve süre son etkinlikten 2 dk sonrasına dek sayılır (uzun sayfa da okunur; bırakıp gidince en çok 2 dk fazla sayılır). Sekme gizlenince ya da okuyucudan çıkınca o an biter. Sesli/hızlı okuma sürerken süre işler. Göz atma eşiği 30 sn. Süren oturum dakikada bir aynı kimlikle yazılır.
- Sayfa birimi PDF sayfası (iki görünümde ve cihazlarda aynı): oturumda yeni açılan PDF sayfaları sayılır, açılıştaki ve geri dönülen sayılmaz, atlanan aradaki sayfalar sayılmaz. Kelime: o sayfaların blok metinlerinin kelimeleri (yaklaşık).
- Tahmin PDF sayfası ve sayfa/dk ile: bu kitabın hızı (en az 5 dk ve 3 sayfa), yoksa bütün kitaplarınki; yoksa gösterilmez (varsayılan hız yok: yanlış tahmin göstermektense hiç göstermemek). Durum satırında "Bölümde 8 sayfa kaldı · ~8 dk"; kitabın kalanı geniş ekranda bölüm adının yanında, bölüm dışındaysa durum satırında.
- Seri: en az 1 dk okunan art arda günler (hedefe ulaşmak gerekmez); bugün henüz okunmadıysa seri dünden sürer.
- Isı haritası dilimleri günlük hedefe göre (yarısından az, hedefe yakın, hedef, iki katı); renkler vurgu renginin opaklıkları (0,5 / 0,67 / 0,84 / 1), açık, sepya ve koyu temalarda sıralı ve ayrışır (dataviz doğrulayıcısı). Telefonda harita okunur boyda kalır ve yana kayar (en yeni hafta görünür).
- Yarım yıldız: 10 yerel radyo düğmesi (her yıldızın iki yarısı); dokunma, oklar, ekran okuyucu ("4,5 yıldız"). Seçilen puan kaydedilene dek gösterilir. "Kaldır" puanı siler.
- "Kitabı bitirdin mi?": son sayfada, kitap bitmemişse ve daha önce sorulmadıysa; yanıt `finishAsked` ile kitapta (cihaza özel, yedeğe girmez). Kalem kipi, panel ya da günlük açıkken görünmez.
- Kitap silinince oturumları kalır (toplam süre ve seri değişmez); kitap başına listede yalnızca var olan kitaplar.
- Yedek biçim sürümü 1 kaldı: yeni alanlar isteğe bağlı; eski uygulama `sessions`'ı ve kitaptaki yeni alanları atlar. Günlükte `journalUpdatedAt`'i yeni olan bütünüyle kazanır (yedekte olmayan puan/inceleme silinir); ikisinde de yoksa eski kural. `markOpened` ilk açılışta da `journalUpdatedAt` yazar.
- Raflar/etiketler eklenmedi (ucuz değil: kütüphanede süzgeç ve yönetim ekranı ister).

**Gerçek iPad'de denenecekler:**
- Okurken süre: Apple Pencil'la odak modunda (kalem havada) okumak etkinlik sayılıyor mu; ekran kilitlenince ve uygulamadan çıkınca oturum yazılıyor mu (ana ekrandaki uygulamada `pagehide`/`visibilitychange`).
- Sesli okumada ekran kapalıyken süre durur (sekme gizli): istenen bu mu.
- Günlükte tarih kutusu (iPadOS'un tarih seçicisi), yarım yıldıza parmakla dokunma (her yarı ~20 px), inceleme yazarken klavye pencereyi örtüyor mu.
- iPadOS 15.4 öncesinde `<dialog>` yok: günlük penceresi sabit katman olarak açılıyor mu.
- İstatistikler ekranı koyu ve sepya temada; ısı haritasında güne dokunma.
