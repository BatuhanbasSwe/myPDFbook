# Plan 12 — Kendi sesini ekle (Piper)

> **Ajanlar için:** Görevler alt ajanla uygulanır, sonunda kod incelemesinden geçer. Adımlar `- [ ]` ile izlenir.

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
- [ ] `src/reader/modes/piper/customVoice.ts`:
  - [ ] Piper ayar dosyası denetimi: `audio.sample_rate`, `phoneme_id_map`, `espeak.voice`, `num_speakers`, `inference` (`noise_scale`, `length_scale`, `noise_w`). Eksik ve yanlış türdeki alanlar Türkçe yazılır; `phoneme_type` espeak değilse reddedilir.
  - [ ] Dil: `espeak.voice`'tan ("tr", "en-us"). Türkçe değilse uyarı: ses yalnızca o dildeki kitaplarda listelenir.
  - [ ] Varsayılan ad: ayardaki `name` ya da `dataset` ("batuhan" → "Batuhan"), yoksa dosya adı ("tr_TR-batuhan-medium.onnx" → "Batuhan").
  - [ ] Seçilen dosyaların sınıflanması (.onnx, .onnx.json/.json, .zip); seçimler birleşir (önce model, sonra ayar seçilebilir).
  - [ ] ZIP: merkez dizinden (yedeğin ZIP okuyucusu, `src/backup/zip.ts` değişmeden kullanılır) tek `.onnx` ve ayarı bulunur; `__MACOSX/` ve `._` girdileri atlanır; CRC denetlenir.
  - [ ] Model dosyası ONNX gibi mi (ilk bayt, boş dosya: iCloud'da kalmış dosya).
- [ ] Birim testleri: iyi ayar, eksik alanlar, yanlış türler, ad varsayılanları, ZIP (STORE ve DEFLATE, alt klasör, macOS artıkları, eksik ayar, iki model, bozuk CRC).
- [ ] Commit: `feat(voices): kendi sesinin ayar dosyası denetimi ve ZIP okuma`.

### Görev 2 — Saklama, yönetici ve worker'da model denetimi
- [ ] `src/reader/modes/piper/customStore.ts`: Cache Storage'da `piper-custom/<kimlik>/model.onnx`, `model.onnx.json` ve en son yazılan `voice.json` (ad, dil, boyut, eklenme tarihi). `voice.json` yoksa ses yoktur: yarım kalan ekleme listede görünmez, sonraki açılışta silinir.
- [ ] Kimlik `piper:custom-…` (rastgele): aynı adla iki ses olabilir. Ad değiştirme yalnızca `voice.json`'u yeniden yazar. Kaldırma önce `voice.json`'u siler.
- [ ] `voices.ts`/`manager.ts`: kendi sesleri katalog sesleriyle aynı listede ve aynı kurulum durumuyla. Ses motoru (ONNX Runtime + fonemleyici) yoksa ("İndir · 33 MB") ekleme onu da indirir; başka ses kalmayınca motor silinir (kendi sesi varken silinmez). Eski sürüm temizliği (`prune`) kendi seslerine dokunmaz.
- [ ] Ekleme sırası: ses motoru → dosyaları kaydet → worker'da dene (ONNX Runtime oturumu, girdi adları, fonemleyicide dil, kısa bir sentez) → `voice.json`. Hata ya da vazgeçme: yazılanlar silinir.
- [ ] Yer kalmadı (QuotaExceededError): anlaşılır Türkçe ileti; yarım ses kalmaz.
- [ ] Worker: `check` isteği; denetim mantığı `piperModel.ts`'te (girdi adları, ses birimi kimlikleri, sentez), Node'da gerçek ONNX Runtime ve testte üretilen küçük bir modelle test edilir.
- [ ] Commit: `feat(voices): kendi sesi cihazda saklanır, worker'da denenir`.

### Görev 3 — Arayüz
- [ ] Ses menüsünde, yapay zekâ grubunun sonunda "Kendi sesini ekle…" (kitabın dilinde katalog sesi olmasa da).
- [ ] Ekleme penceresi (telefonda alttan, geniş ekranda ortada): dosya seç (.onnx + .onnx.json ya da .zip), tanınan dosyalar, ad kutusu, dil, boyut, gerekiyorsa ses motoru boyutu, gizlilik notu ("Bu ses yalnızca bu cihazda durur; yedeğe eklenmez."), "Ekle". İlerleme (motor indirme %, kaydetme, deneme) ve "Vazgeç".
- [ ] Menüde kendi sesi: "Batuhan" · "Kendi sesin · 63 MB"; seçilir, internetsiz okur. Düzenle: ad değiştir, boyut ve gizlilik notu, "Sesi kaldır" (onaylı).
- [ ] Pencere açılınca okuma duraklar; eklenen ses seçilir ve örnek cümleyle tanıtılır.
- [ ] Commit: `feat(voices): kendi sesini ekle penceresi ve ses menüsünde kendi sesin`.

### Görev 4 — e2e ve doğrulama
- [ ] e2e (`e2e/custom-voice.spec.ts`, Piper e2e'si gibi sahte sentezleyiciyle): ekle ve listede gör; seç; okuma o sesle sürer; yenilemeden sonra durur; ad değişir; kaldırılır; ZIP ile aynı adla ikinci ses; bozuk ayar ve yüklenemeyen model reddedilir, yarım ses kalmaz; yer kalmadı iletisi; yedeğe girmez.
- [ ] Tarayıcı testi (Chromium ve WebKit): gerçek worker ve ONNX Runtime ile küçük modelin denetimi.
- [ ] tsc, lint, prettier, birim ve tarayıcı testleri, e2e (3 proje).
- [ ] Ekran görüntüleri: ekleme penceresi ve kendi sesli menü (iPad açık ve koyu, telefon).
- [ ] Commit: `test(voices): kendi sesi e2e`; `docs(plan): Plan 12 kararlar`.

### Görev 5 — İnceleme, birleştirme ve iPad'de deneme (kullanıcı)
- [ ] Kod incelemesi ve düzeltmeler, `main`'e birleştirme.
- [ ] Gerçek iPad'de: Dosyalar'dan `.onnx` + `.onnx.json` ve `.zip` seçimi, 60 MB'lık modelin eklenmesi (bellek, süre), uçak kipinde okuma.
