# Plan 12 — Kendi sesini ekle (Piper)

> **Ajanlar için:** Görevler alt ajanla uygulanır, sonunda kod incelemesinden geçer. Adımlar `- [x]` ile izlenir.

**Kullanıcı isteği (2026-11-06):** Kendi sesi ("Batuhan") sesli okumada bir ses olsun. Sesi bilgisayarında Piper (VITS) ile ince ayarla eğitiyor: sonuç `tr_TR-dfki-medium` ile aynı biçimde bir `.onnx` (~60 MB, medium) ve `.onnx.json` ayar dosyası.

**Gizlilik:** Kendi sesinin modeli herkese açık depoya ve Vercel yayınına **konmaz** (herkes indirebilirdi). Uygulamaya "Kendi sesini ekle" gelir: kullanıcı dosyaları iPad'e aktarır (AirDrop → Dosyalar) ve uygulamada seçer. Model yalnızca o cihazda durur, yedeğe girmez.

**Kısıtlar:**
- Asıl cihaz eski WebKit'li iPad (iPadOS ≤ 18). Piper zaten WASM SIMD ister (Safari 16.4+); bu yüzden "Kendi sesini ekle" yalnızca yapay zekâ sesi çalışan tarayıcıda görünür.
- iOS dosya seçicisi `.onnx`/`.zip` uzantısına göre süzemez (bilinmeyen tür soluk görünür): iOS'ta `accept` konmaz, içerik denetlenir.
- Büyük dosya (~60 MB, en çok 150 MB): JS tarafında gereksiz kopya yapılmaz (ZIP'te sıkıştırmasız girdi `Blob.slice`, sıkıştırılmış girdi parça parça açılır). Ama eklerken bellekte birkaç kopya olur (bkz. Kararlar).
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
- **Nerede durur:** kendi Cache Storage'ı `mypdfbook-piper-custom-v1` (inceleme düzeltmesi: önce Plan 6'nın `mypdfbook-piper-v1`'indeydi; uygulamanın eski bir sürümüne dönülürse onun eski sürüm temizliği kendi seslerini silerdi). Adresler uygulamanın altında `piper-custom/<kimlik>/` (`model.onnx`, `model.onnx.json`, `voice.json`); ağdan istenmez, yalnızca anahtardır. İlk sürümün kayıtları açılışta yeni önbelleğe taşınır (önce hepsi kopyalanır, eskiler sonra silinir). Dexie şeması değişmedi; yeni tablo gerekmedi. Yedek IndexedDB'yi ve ayarları yazar: ses girmez. Sesli okuma tercihlerinde seçili sesin kimliği (`piper:custom-…`, ad yok) yedeğe girebilir; ses kaldırılınca tercihten silinir, başka cihazda kimlik yoktur ve en iyi sistem sesine düşülür.
- **Yarım ses olmaz:** `voice.json` en son yazılır. Liste yalnızca üç kaydı da olan sesleri gösterir. Ekleme hata verir ya da vazgeçilirse yazılanlar silinir. Sayfa ekleme sırasında kapanırsa artıklar sonraki açılışta (`ensure`) silinir.
- **Deneme worker'da:** okuyucunun kendi sentezleyicisiyle (`check` isteği). Ses motoru → model (ONNX Runtime oturumu) → girdiler (`input`, `input_lengths`, `scales`, çok konuşmacıda `sid`) → fonemleyicide dil (deneme cümlesi) → kısa sentez (ses sayı mı). Model denemeden sonra bellekte kalır: ses seçilince hemen okur. "Ekle"ye dokununca okunan sesin worker'ı bırakılır (iPad'de bellekte iki model olmasın), ses bağlamı aynı dokunuşta yeniden açılır.
- **Ses motoru:** kendi sesi de ONNX Runtime ve fonemleyiciyi ister (33 MB, bir kez internet). Cihazda yoksa ekleme önce onu indirir (ilerleme yüzdeyle). Kendi sesi varken DFKI kaldırılırsa motor silinmez. Uygulama güncellenip motorun adresi değişirse kendi sesi "ses motorunu indir · 14 MB" der.
- **Dil:** `espeak.voice`'tan. Türkçe ses Türkçe kitaplarda, İngilizce ses İngilizce kitaplarda; dili tanınmayan kitapta bütün kendi sesleri listelenir. Türkçe değilse pencerede uyarı.
- **Ad:** ayardaki `name`, `dataset`, dosya adı sırasıyla. `dataset` katalog sesininse ("dfki": ince ayarda ayar dosyası DFKI'den kopyalanmış olabilir) dosya adı önce gelir. Aynı adla iki ses olabilir (rastgele kimlik).
- **Büyük dosya ve bellek (inceleme düzeltmesi):** JS tarafında gereksiz kopya yok: seçilen dosya `new Response(file)` ile saklanır, ZIP'te sıkıştırmasız girdi `Blob.slice`, sıkıştırılmış girdi 8 MB'lık parçalarla açılıp küçük Blob'larda toplanır. Yine de bellekte birkaç kopya olur: ZIP'ten açılan model (1×), WebKit'in DOMCache'i yanıtın gövdesini yazmadan önce toplar (1×), deneme modeli worker'a okur (1×) ve ONNX Runtime kendi belleğine kopyalar (1×). En kötü durumda (ZIP) model boyunun **3–4 katı**. Bu yüzden ZIP'ten açılan model saklanır saklanmaz bırakılır (yönetici `voice.model`'i boş Blob yapar, pencere seçimden de bırakır; hata olursa ZIP yeniden seçilir) ve model en çok **150 MB** olabilir ("medium" ~63 MB). İki dosyayı ayrı ayrı AirDrop'la göndermek en az bellek ister.
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

**İnceleme düzeltmeleri (2026-11-10):**
- Deneme sürerken "Vazgeç": sinyal okuyucunun worker'ını bırakır, deneme hemen "canceled" ile biter, model bellekten atılır.
- Dili kitabınkine uymayan ses (Türkçe kitapta İngilizce ses) eklenir ama seçilmez; pencere kapanır.
- Artık temizliği yalnızca `voice.json`'u olmayan ya da okunup geçersiz çıkan (ya da modeli/ayarı olmayan) sesleri siler; okuma hatasında ve bu sürümün bilmediği yeni biçimde (`v > 1`) dokunmaz.
- Kendi sesleri okunamadıysa ses motoru silinmez. Kendi sesinin "indir"i yalnızca ses motorunu indirir.
- Kaldırılan ses sesli okuma tercihinden de silinir (her dilde).
- Kipli pencereler yığını (`src/ui/modalStack.ts`): pencere açıkken okuyucunun yakalama aşamasındaki tuş dinleyicileri (sesli/hızlı okuma, odak) tuşları bırakır; üst üste pencerede Esc'i yalnızca en üstteki işler.
- Yedek penceresinin metni: kendi eklenen sesler de yedeğe girmez.

### Uygulamayla yayınlanan "Batuhan" sesi (kullanıcı isteği, 2026-11-10)
Kullanıcı kendi sesini DFKI gibi katalogda, uygulamayla birlikte yayınlamak istiyor (indirilebilir, uygulamanın kendi adresinden). Model henüz eğitilmedi; kod hazır, dosya eklenmedi.
- [x] `voices.ts`: `SameOriginVoiceDef` / `sameOriginVoice` / `publishedVoices`. `BATUHAN_VOICE`: ad "Batuhan", dil tr, kalite medium, lisans "CC BY-NC-SA 4.0 · DFKI Türkçe sesinden türetildi", klasör `public/voices/batuhan-v1/`. Boyu ve SHA-256'sı yazılmadıkça katalogda görünmez.
- [x] Service worker: `vite.config.ts`'te `globIgnores: ['voices/**']` (globPatterns zaten kapsamıyordu; açık kural). Sahte bir dosyayla derlenip denendi: `dist/voices/…` yayına girer, `sw.js`'de geçmez.
- [x] Vercel: `vercel.json`'da `/voices/(.*).onnx` → `application/octet-stream`, `/voices/(.*).json` → `application/json`, ikisi de `public, max-age=31536000, immutable` (klasör sürümlü olduğu için). Dosya yoksa Vercel'in `/(.*)` → `index.html` yönlendirmesi 200 ile HTML döner: SHA-256 denetimi bunu "bozuk indi" diye reddeder.
- [x] **Dosyaları eklerken (model hazır olunca):** (2026-11-11, aşağıdaki nota bakın)
  1. Dosyaları koy: `public/voices/batuhan-v1/tr_TR-batuhan-medium.onnx`, `public/voices/batuhan-v1/tr_TR-batuhan-medium.onnx.json`, `public/voices/batuhan-v1/LICENSE.txt` (CC BY-NC-SA 4.0 metni ve "DFKI Türkçe sesinden (tr_TR-dfki-medium, rhasspy/piper-voices) türetildi; ses: Batuhan" atfı).
  2. Boy ve SHA-256: PowerShell'de `(Get-Item <dosya>).Length` ve `(Get-FileHash <dosya> -Algorithm SHA256).Hash.ToLower()` (ya da Git Bash'te `stat -c %s` ve `sha256sum`), iki dosya için.
  3. `src/reader/modes/piper/voices.ts` → `BATUHAN_VOICE.model` ve `.config`'e `bytes` ve `sha256` yazılır. Bundan sonra ses katalogda "Batuhan · İndir · 96 MB" olarak görünür.
  4. Ayar dosyasında `espeak.voice` "tr" olmalı; `dataset`/ad önemli değil (menü adı `BATUHAN_VOICE.name`).
  5. Git: model ~60 MB. GitHub 50 MB'tan büyük dosyada uyarır, 100 MB'ta reddeder. 100 MB'ın altındaysa doğrudan commit edilebilir; Git LFS kullanılırsa Vercel projesinde "Git LFS" açılmalı (yoksa yayına işaretçi dosya gider ve SHA-256 tutmaz).
  6. Vercel'in tek dosya ve yayın boyu sınırını denetle (Hobby planında yayın boyu sınırlıdır); olmazsa model Hugging Face gibi CORS açık bir yerden sunulur (DFKI gibi: `model.url` mutlak adres).
  7. Testler: `e2e/piper.spec.ts` menüde tek yapay zekâ satırı (`voice-neural`) bekliyor: Batuhan da görününce o test DFKI satırını adıyla seçmeli (`filter({ hasText: 'DFKI' })`); `tests/reader/voices.test.ts`'teki katalog listesi (`['DFKI', 'LJSpeech']`) güncellenir. İsteğe bağlı: e2e'de `/voices/` adresi de sahte içerikle sunulur.
  8. Model değişirse yeni klasör (`batuhan-v2`) ve yeni SHA-256: eski adres uzun önbellekte kalabilir.
  9. Gizlilik: bu yolla ses herkese açık olur (yayındaki herkes indirebilir). Kullanıcı bunu istedi; yalnızca kendisi kullanacaksa "Kendi sesini ekle" yolu yeterli.
- [x] **Batuhan sesi eklendi (2026-11-11):**
  - Dosyalar `public/voices/batuhan-v1/`: `tr_TR-batuhan-medium.onnx` 63.516.050 bayt, SHA-256 `51078f8fce247557f036f010569c5289994af9b82fdfac3b06d252335a5931f6`; `tr_TR-batuhan-medium.onnx.json` 5.843 bayt, SHA-256 `302fae2396eb15ff17afd069ed5bee226ecc686840b069dc80961d70f9424f7a` (`espeak.voice` "tr", tek konuşmacı, 22.050 Hz); `LICENSE.txt` (CC BY-NC-SA 4.0, DFKI'den türetme atfı, ses: Batuhan, izinli). Kopya, depo (git blob) ve `dist/` SHA-256'ları kaynakla aynı; `tests/reader/voices.test.ts` dosyaların boyunu ve SHA-256'sını `voices.ts` ile karşılaştırır.
  - Git: LFS yok; `.gitattributes`'ta `*.onnx binary` ve `public/voices/** -text` (satır sonu dönüşmesin, SHA-256 bozulmasın); `.prettierignore`'da `public/voices`.
  - Menü: "Batuhan · İndir · 97 MB" (çalışma zamanı dosyalarıyla; DFKI'den sonra). Yapay zekâ grubunun altında katalog seslerinin lisans ve atfı (`voice-credits`). Lisans metni: "CC BY-NC-SA 4.0 (ticari olmayan kullanım) · DFKI Türkçe sesinden türetildi".
  - Precache: `pnpm build` sonrası `dist/sw.js`'de `voices/` yok; `dist/voices/batuhan-v1/` var. `offline.pwa.ts` da `sw.js`'de `voices/` geçmediğini denetler.
  - Vercel (Hobby, 2026-11 dokümanı): yayın çıktısında tek dosya ya da toplam boy sınırı yok; 100 MB sınırı yalnızca CLI ile yüklenen kaynak dosyalar için (izlenen dosyalar ~66 MB, altında). CDN'in 10 MB "önbelleğe alınabilir yanıt" sınırı Vercel Function yanıtları için; statik dosyalar kendiliğinden önbelleklenir. Aylık 100 GB Fast Data Transfer: tam indirme ~64 MB, yani ayda ~1.500 ilk indirme. Hobby yalnızca ticari olmayan kullanım (lisansla uyumlu).
  - Hız: seçenekler 0,75× · 1× · 1,25× · 1,5× · 2× (`RATE_CHOICES`), yapay zekâ sesi seçiliyken de görünür; `length_scale = 1/hız`. Node'da gerçek ONNX Runtime ve Batuhan modeliyle aynı cümle ("Bu kitabı sesli okumak için yapay zekâ sesini seçtim, şimdi biraz daha hızlı okuyalım.", espeak-ng ile 101 ses birimi): 0,75× 5,29 sn · 1× 4,50 sn · 1,25× 4,01 sn · 1,5× 3,44 sn · 2× 3,04 sn ses. Kısalma doğrusal değil (1,5×'te %76, 2×'te %68): Piper her birimin süresini kare sayısına yuvarlar (ceil), birimler arası boşluklar en az bir kare kalır.
  - Gerçek tarayıcı (Chromium, dev sunucu): menüde görünür, iner (~23 sn, yerel), Cache Storage'daki dosyaların SHA-256'sı tutar, `novel-tr.pdf`'yi Batuhan sesiyle okur (vurgu ilerler), 1,5× seçilince okumayı sürdürür. Not: ilk denemede Vite'ın bağımlılık iyileştiricisi worker'ın ilk açılışında sayfayı bir kez yeniledi (yalnızca dev sunucu); ikinci denemede yok.

### Görev 5 — İnceleme, birleştirme ve iPad'de deneme (kullanıcı)
- [ ] Kod incelemesi ve düzeltmeler, `main`'e birleştirme.
- [ ] Gerçek iPad'de: Dosyalar'dan `.onnx` + `.onnx.json` ve `.zip` seçimi, 60 MB'lık modelin eklenmesi (bellek, süre), uçak kipinde okuma.
