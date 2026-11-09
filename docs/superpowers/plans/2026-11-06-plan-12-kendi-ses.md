# Plan 12 — Kendi sesini ekle (Piper)

> **Ajanlar için:** Görevler alt ajanla uygulanır, sonunda kod incelemesinden geçer. Adımlar `- [x]` ile izlenir.

**Kullanıcı isteği (2026-11-06):** Kendi sesi ("Batuhan") sesli okumada bir ses olsun. Sesi bilgisayarında Piper (VITS) ile ince ayarla eğitiyor: sonuç `tr_TR-dfki-medium` ile aynı biçimde bir `.onnx` (~60 MB, medium) ve `.onnx.json` ayar dosyası.

**Gizlilik:** Kendi sesinin modeli herkese açık depoya ve Vercel yayınına **konmaz** (herkes indirebilirdi). Uygulamaya "Kendi sesini ekle" gelir: kullanıcı dosyaları iPad'e aktarır (AirDrop → Dosyalar) ve uygulamada seçer. Model yalnızca o cihazda durur, yedeğe girmez.

**Kısıtlar:**
- Asıl cihaz eski WebKit'li iPad (iPadOS ≤ 18). Piper zaten WASM SIMD ister (Safari 16.4+); bu yüzden "Kendi sesini ekle" yalnızca yapay zekâ sesi çalışan tarayıcıda görünür.
- iOS dosya seçicisi `.onnx`/`.zip` uzantısına göre süzemez (bilinmeyen tür soluk görünür): iOS'ta `accept` konmaz, içerik denetlenir.
- Büyük dosya (60–120 MB): dosya Blob olarak, kopyalanmadan saklanır. ZIP'te sıkıştırmasız girdi `Blob.slice` ile alınır; sıkıştırılmış girdi parça parça açılıp küçük Blob'larla birleştirilir.
- Dexie şemasına ve yedek dosyalarına dokunulmaz (başka çalışma ağaçlarında Plan 10 ve 11 sürüyor). Sesler Plan 6'nın indirdiği seslerle aynı yerde, Cache Storage'da (`mypdfbook-piper-v1`) durur.
- Plan 9'un ortak bileşenleri ve jetonları kullanılır (`src/ui`, `ui.css`).

---

### Görev 1 — Ayar dosyası denetimi, ZIP ve varsayılan ad (saf işlevler)
- [x] `src/reader/modes/piper/customVoice.ts`:
  - [x] Piper ayar dosyası denetimi: `audio.sample_rate`, `phoneme_id_map`, `espeak.voice`, `num_speakers`, `inference` (`noise_scale`, `length_scale`, `noise_w`). Eksik ve yanlış türdeki alanlar Türkçe yazılır; `phoneme_type` espeak değilse reddedilir.
  - [x] Dil: `espeak.voice`'tan ("tr", "en-us"). Türkçe değilse uyarı: ses yalnızca o dildeki kitaplarda listelenir.
  - [x] Varsayılan ad: ayardaki `name` ya da `dataset` ("batuhan" → "Batuhan"), yoksa dosya adı ("tr_TR-batuhan-medium.onnx" → "Batuhan").
  - [x] Seçilen dosyaların sınıflanması (.onnx, .onnx.json/.json, .zip); seçimler birleşir (önce model, sonra ayar seçilebilir).
  - [x] ZIP: merkez dizinden (yedeğin ZIP okuyucusu, `src/backup/zip.ts` değişmeden kullanılır) tek `.onnx` ve ayarı bulunur; `__MACOSX/` ve `._` girdileri atlanır; CRC denetlenir.
  - [x] Model dosyası ONNX gibi mi (ilk bayt, boş dosya: iCloud'da kalmış dosya).
- [x] Birim testleri: iyi ayar, eksik alanlar, yanlış türler, ad varsayılanları, ZIP (STORE ve DEFLATE, alt klasör, macOS artıkları, eksik ayar, iki model, bozuk CRC).
- [x] Commit: `feat(voices): kendi sesinin ayar dosyası denetimi ve ZIP okuma`.

### Görev 2 — Saklama, yönetici ve worker'da model denetimi
- [x] `src/reader/modes/piper/customStore.ts`: Cache Storage'da `piper-custom/<kimlik>/model.onnx`, `model.onnx.json` ve en son yazılan `voice.json` (ad, dil, boyut, eklenme tarihi). `voice.json` yoksa ses yoktur: yarım kalan ekleme listede görünmez, sonraki açılışta silinir.
- [x] Kimlik `piper:custom-…` (rastgele): aynı adla iki ses olabilir. Ad değiştirme yalnızca `voice.json`'u yeniden yazar. Kaldırma önce `voice.json`'u siler.
- [x] `voices.ts`/`manager.ts`: kendi sesleri katalog sesleriyle aynı listede ve aynı kurulum durumuyla. Ses motoru (ONNX Runtime + fonemleyici) yoksa ("İndir · 33 MB") ekleme onu da indirir; başka ses kalmayınca motor silinir (kendi sesi varken silinmez). Eski sürüm temizliği (`prune`) kendi seslerine dokunmaz.
- [x] Ekleme sırası: ses motoru → dosyaları kaydet → worker'da dene (ONNX Runtime oturumu, girdi adları, fonemleyicide dil, kısa bir sentez) → `voice.json`. Hata ya da vazgeçme: yazılanlar silinir.
- [x] Yer kalmadı (QuotaExceededError): anlaşılır Türkçe ileti; yarım ses kalmaz.
- [x] Worker: `check` isteği; denetim mantığı `piperModel.ts`'te (girdi adları, ses birimi kimlikleri, sentez), Node'da gerçek ONNX Runtime ve testte üretilen küçük bir modelle test edilir.
- [x] Commit: `feat(voices): kendi sesi cihazda saklanır, worker'da denenir`.

### Görev 3 — Arayüz
- [x] Ses menüsünde, yapay zekâ grubunun sonunda "Kendi sesini ekle…" (kitabın dilinde katalog sesi olmasa da).
- [x] Ekleme penceresi (telefonda alttan, geniş ekranda ortada): dosya seç (.onnx + .onnx.json ya da .zip), tanınan dosyalar, ad kutusu, dil, boyut, gerekiyorsa ses motoru boyutu, gizlilik notu ("Bu ses yalnızca bu cihazda durur; yedeğe eklenmez."), "Ekle". İlerleme (motor indirme %, kaydetme, deneme) ve "Vazgeç".
- [x] Menüde kendi sesi: "Batuhan" · "Kendi sesin · 63 MB"; seçilir, internetsiz okur. Düzenle: ad değiştir, boyut ve gizlilik notu, "Sesi kaldır" (onaylı).
- [x] Pencere açılınca okuma duraklar; eklenen ses seçilir ve örnek cümleyle tanıtılır.
- [x] Commit: `feat(voices): kendi sesini ekle penceresi ve ses menüsünde kendi sesin`.

### Görev 4 — e2e ve doğrulama
- [x] e2e (`e2e/custom-voice.spec.ts`, Piper e2e'si gibi sahte sentezleyiciyle): ekle ve listede gör; seç; okuma o sesle sürer; yenilemeden sonra durur; ad değişir; kaldırılır; ZIP ile aynı adla ikinci ses; bozuk ayar ve yüklenemeyen model reddedilir, yarım ses kalmaz; yer kalmadı iletisi; yedeğe girmez.
- [x] Tarayıcı testi (Chromium ve WebKit): gerçek worker ve ONNX Runtime ile küçük modelin denetimi.
- [x] tsc, lint, prettier, birim ve tarayıcı testleri, e2e (3 proje).
- [x] Ekran görüntüleri: ekleme penceresi ve kendi sesli menü (iPad açık ve koyu, telefon).
- [x] Commit: `test(voices): kendi sesi e2e`; `docs(plan): Plan 12 kararlar`.

**Kararlar ve notlar (2026-11-07):**
- **Nerede durur:** Plan 6'nın Cache Storage'ı (`mypdfbook-piper-v1`), uygulamanın adresinin altında `piper-custom/<kimlik>/` (`model.onnx`, `model.onnx.json`, `voice.json`). Bu adresler ağdan istenmez, yalnızca anahtardır. Dexie şeması ve yedek dosyaları değişmedi; yeni tablo gerekmedi. Yedek IndexedDB'yi ve ayarları yazar: ses girmez. Yalnızca sesli okuma tercihlerinde seçili sesin kimliği (`piper:custom-…`, ad yok) yedeğe girer; başka cihazda bu kimlik yoktur, en iyi sistem sesine düşülür.
- **Yarım ses olmaz:** `voice.json` en son yazılır. Liste yalnızca üç kaydı da olan sesleri gösterir. Ekleme hata verir ya da vazgeçilirse yazılanlar silinir. Sayfa ekleme sırasında kapanırsa artıklar sonraki açılışta (`ensure`) silinir.
- **Deneme worker'da:** okuyucunun kendi sentezleyicisiyle (`check` isteği). Ses motoru → model (ONNX Runtime oturumu) → girdiler (`input`, `input_lengths`, `scales`, çok konuşmacıda `sid`) → fonemleyicide dil (deneme cümlesi) → kısa sentez (ses sayı mı). Model denemeden sonra bellekte kalır: ses seçilince hemen okur. "Ekle"ye dokununca okunan sesin worker'ı bırakılır (iPad'de bellekte iki model olmasın), ses bağlamı aynı dokunuşta yeniden açılır.
- **Ses motoru:** kendi sesi de ONNX Runtime ve fonemleyiciyi ister (33 MB, bir kez internet). Cihazda yoksa ekleme önce onu indirir (ilerleme yüzdeyle). Kendi sesi varken DFKI kaldırılırsa motor silinmez. Uygulama güncellenip motorun adresi değişirse kendi sesi "ses motorunu indir · 14 MB" der.
- **Dil:** `espeak.voice`'tan. Türkçe ses Türkçe kitaplarda, İngilizce ses İngilizce kitaplarda; dili tanınmayan kitapta bütün kendi sesleri listelenir. Türkçe değilse pencerede uyarı.
- **Ad:** ayardaki `name`, `dataset`, dosya adı sırasıyla. `dataset` katalog sesininse ("dfki": ince ayarda ayar dosyası DFKI'den kopyalanmış olabilir) dosya adı önce gelir. Aynı adla iki ses olabilir (rastgele kimlik).
- **Büyük dosya:** seçilen dosya `new Response(file)` ile saklanır (diskten okunur, JS belleğine kopyalanmaz). ZIP'te sıkıştırmasız girdi `Blob.slice` (kopya yok); sıkıştırılmış girdi 8 MB'lık parçalarla açılır ve küçük Blob'larda toplanır (en çok model boyu kadar bellek). İki dosyayı ayrı ayrı AirDrop'la göndermek en az bellek ister. Model en çok 400 MB.
- **iOS dosya seçicisi:** `accept` iOS'ta konmaz (`.onnx` soluk görünürdü); `multiple` açık. Önce model, sonra ayar dosyası ayrı ayrı da seçilebilir; seçimler birleşir.
- **Pencere:** ortak `src/ui/Modal.tsx` (şifre penceresinden çıkarıldı). Telefonda alttan açılan sayfa, geniş ekranda ortada. Odak pencereden düşse de (ör. "Ekle" ilerlemeye dönüşünce) tuşlar pencerenindir: Esc pencereyi kapatır, okuyucunun kısayollarına gitmez.
- **Kaldırma** düzenleme penceresinde ve onaylıdır (kendi sesi yeniden indirilemez). DFKI'nin çöp kutusu düğmesi aynen kaldı.
- **Yedek penceresi metni** ("Yapay zekâ sesleri yedeğe girmez…") Plan 11 yedek dosyalarıyla çakışmasın diye değiştirilmedi; birleşince "kendi sesin de" eklenebilir.

*Testler:*
- Birim (Node): `customVoice.test.ts` 21 (ayar denetimi, ad, dosya türü, ZIP STORE/DEFLATE/alt klasör/macOS artıkları/CRC), `customVoiceManager.test.ts` 9 (ekleme sırası, yeniden açılış, aynı ad, ses motoru, deneme hataları, yer kalmadı, vazgeç, artık temizliği, ad, kaldırma ve motor), `piperModel.test.ts` 6 (gerçek ONNX Runtime ve testte üretilen küçük Piper benzeri model: `tests/helpers/tinyOnnx.ts`, depoya model konmadı).
- Tarayıcı (Chromium ve WebKit): `piperCheck.test.ts`, gerçek worker ve ONNX Runtime ile küçük modelin denenmesi (iyi model, ONNX olmayan, eksik girdi, çok konuşmacı).
- e2e: `custom-voice.spec.ts` 4 test × 3 proje; Piper e2e'sinin sahteleri `e2e/piperStubs.ts`'e taşındı (sahte sentezleyiciye `check` eklendi).

*Gerçek iPad'de denenecekler:*
- Dosyalar'dan `.onnx` + `.onnx.json` çoklu seçimi ve `.zip` seçimi (iOS seçicisinin `.onnx`'i seçtirdiği).
- 60 MB'lık modelin eklenmesi: kaydetme ve deneme süresi, bellek (Safari sekmesi kapanmamalı), ilk cümlenin süresi.
- Uçak kipinde kendi sesiyle okuma; uygulama kapatılıp açılınca sesin durması.

### Görev 5 — İnceleme, birleştirme ve iPad'de deneme (kullanıcı)
- [ ] Kod incelemesi ve düzeltmeler, `main`'e birleştirme.
- [ ] Gerçek iPad'de: Dosyalar'dan `.onnx` + `.onnx.json` ve `.zip` seçimi, 60 MB'lık modelin eklenmesi (bellek, süre), uçak kipinde okuma.
