# Plan 6 — Doğal sesli okuma

> **Ajanlar için:** Görevler alt ajanlarla uygulanır, her görev ayrı bir alt ajanla kod incelemesinden geçer. Adımlar `- [ ]` ile izlenir.

**Kullanıcı isteği (2026-09-29):** "Sesli okuma çok yapay." Önerilen VoiceStudio uygulamaya eklenemiyor:
- Electron masaüstü uygulaması, Python sunucusu ve GPU ister;
- iPad tarayıcısında çalışmaz;
- AGPL lisanslıdır.

Kullanıcı iki yolu birlikte seçti:
1. **iPad'in gelişmiş (Enhanced/Premium) sistem sesleri:** uygulama en iyi sesi seçer ve nasıl indirileceğini gösterir.
2. **Tarayıcıda yapay zekâ sesi (Piper):** Türkçe sinir ağı sesleri, cihazda ve internetsiz çalışır.

**Kısıtlar:**
- Uygulama statik, sunucusuz ve çevrimdışıdır (Vercel'de yayında).
- Asıl cihaz iPad'dir ve WebKit'i eskidir (iPadOS 18 ve öncesi, WebGPU yok). Model WASM ile çalışmalıdır.
- Model dosyaları uygulama paketine konmaz (~60 MB). İlk kullanımda bir kez indirilir ve cihazda saklanır.

**Mimari:** `SpeechEngine` arayüzü zaten var (`src/reader/modes/readAloud.ts`). Piper ikinci bir motor olur (`src/reader/modes/piper/`). Ses listesi iki türü birlikte gösterir: sistem sesleri ve "Yapay zekâ" sesleri. Denetleyici, vurgu, sayfa izleme ve hız aynen kullanılır.

---

### Görev 1 — Sistem seslerinden en iyisi ve indirme rehberi
- [x] Sesleri sınıfla: `quality: 'premium' | 'enhanced' | 'default'`. Kaynaklar: `voiceURI`/`name` içinde "premium", "enhanced", "(Gelişmiş)", "(Premium)" gibi işaretler (iOS ve macOS biçimleri) ve `localService`.
- [x] Varsayılan ses seçimi: kullanıcı ses seçmediyse kitabın dilinde en iyi kaliteli yerel ses seçilir.
- [x] Ses menüsü:
  - [x] Sesler kaliteye göre gruplanır ("Gelişmiş", "Standart").
  - [x] Gelişmiş Türkçe ses yoksa bir ipucu gösterilir: iPad/iPhone'da **Ayarlar → Erişilebilirlik → Seslendirilen İçerik → Sesler → Türkçe → Yelda (Gelişmiş) → indir**; macOS'ta Sistem Ayarları → Erişilebilirlik → Seslendirilen İçerik.
  - [x] Ses değişince kısa bir örnek cümle çalınır ("Dinle" düğmesi).
- [x] Testler: sınıflama birim testleri (iOS/macOS/Chrome/Windows ses adı örnekleri) ve e2e'de sahte ses listesiyle menü, ipucu ve varsayılan seçim.
- [x] Commit: `feat(reader): sesli okumada en iyi sistem sesi, gelişmiş ses rehberi`.

**Görev 1 notları (2026-09-30):**
- Sınıflama `classifyVoice` (readAloud.ts): "premium" (Apple `.premium.`/"(Premium)", iOS 16 öncesi `-premium`, Edge/Windows "(Natural)", "Neural"), "enhanced" (Apple `.enhanced.`, "(Enhanced)", "(Gelişmiş)" ve başka dillerdeki ekler), gerisi "default". macOS eğlence sesleri ve Eloquence sesleri "default" sayılır, en sona konur.
- Varsayılan ses (`pickVoice`): kayıtlı ses yoksa cihazdaki (`localService`) sesler içinden kalite → tarayıcının varsayılanı → dilin ana bölgesi. Cihazda ses yoksa ağ sesleri. Ağ sesi (Edge Natural, Google) cihaz sesinin önüne geçmez: okuma çevrimdışı da sürmeli.
- Ses seçimi artık yerel `<select>` değil, çubuğun üstünde açılan menü (VoiceMenu.tsx): gruplar, not ("Gelişmiş", "internet gerekir"), "Dinle", ipucu. Menü çubuğun yüksekliğini değiştirmez (kitap yeniden dizilmez); Esc ve dışarı dokunmak kapatır.
- Duraklamışken ses seçilince örnek cümle okunur; okurken seçilince okunan cümle yeni sesle baştan okunur (eskisi gibi).
- Paket: ana JS +7,0 kB (gzip +2,4 kB), precache +7,2 KiB.

### Görev 2 — Piper yapay zekâ sesi (tarayıcıda, çevrimdışı)
- [x] **Araştırma ve seçim** (plan belgesine not edilir):
  - Tarayıcıda Piper çalıştıran bakımlı bir kütüphane seçilir: onnxruntime-web WASM ve espeak-ng fonemleyici gerekir. Adaylar: `@diffusionstudio/vits-web`, `piper-tts-web`, doğrudan onnxruntime-web ile piper-phonemize wasm.
  - Seçim ölçütleri: lisans (MIT/Apache; AGPL olmaz), eski WebKit uyumu (WebGPU yok, WASM SIMD Safari 16.4+), boyut, bakım.
  - Türkçe sesler (`rhasspy/piper-voices`: `tr_TR-dfki-medium`, `tr_TR-fahrettin-medium`, `tr_TR-fettah-medium`) ve İngilizce için bir ses (ör. `en_US-lessac-medium`). Her sesin model kartındaki lisans okunur; yeniden dağıtıma izin verenler listelenir.
- [x] **Model indirme ve saklama:**
  - İlk seçimde model (.onnx + .json), ilerleme çubuğuyla indirilir ve Cache Storage'a konur (OPFS yazma eski Safari'de yok).
  - Kaynak: Hugging Face (CORS açık). Adres ayar dosyasında durur.
  - Silme: "Sesi kaldır" (yer açmak için). `navigator.storage.persist()` zaten isteniyor.
  - Workbox önbelleğine (precache) eklenmez; ONNX/WASM çalışma zamanı dosyaları ya uygulamayla gelir ya da ilk kullanımda önbelleğe alınır, böylece çevrimdışı çalışır.
- [x] **Motor (`PiperEngine implements SpeechEngine`):**
  - Sentez bir Web Worker'da yapılır (arayüz donmasın).
  - Cümle N çalınırken N+1 önceden sentezlenir; uzun cümleler parçalanır (mevcut 250 karakter parçalama).
  - Çalma Web Audio (`AudioContext`) ile yapılır; iOS'ta ilk dokunuşta açılır (`prime`).
  - Hız: `length_scale = 1 / rate` (perde bozulmaz).
  - Olaylar: `start`, `end`, `error`; `busy()` bekçiyle uyumlu.
  - `cancel()` sentezi ve çalmayı keser.
  - Sayfa gizlenince/kilitlenince mevcut davranış korunur.
- [x] **Arayüz:**
  - Ses menüsünde en üstte "Yapay zekâ (doğal)" grubu: "DFKI" (Fahrettin ve Fettah depodan kaldırıldı, notlara bakın; indirilmemişse "İndir · 96 MB").
  - İndirme sırasında ilerleme ve iptal; hazır olunca otomatik seçilir.
  - Tercih kalıcıdır (readAloudPrefs).
  - Yapay zekâ sesi varsa ve kullanıcı ses seçmediyse ilk açılışta bir kez önerilir.
- [x] **Performans ölçümü** (plan belgesine not edilir): masaüstü Chromium ve Playwright WebKit'te cümle başına sentez süresi (gerçek zaman oranı). iPad'de oran 1'in altında kalmalıdır; önceden sentez bunu gizler.
- [x] **Testler:**
  - Birim: parçalama, önceden sentez sırası, iptal, hız→length_scale; motor sahte sentezleyiciyle test edilir.
  - e2e: model indirme ağdan yapılamayacağı için test modeli yerel sabit bir dosyadan (route ile) sunulur ya da sahte sentezleyiciyle çalışılır. İndirme ilerlemesi, seçim, okuma ilerlemesi (vurgu) ve çevrimdışı sonraki açılış denetlenir.
- [x] Commit: `feat(reader): yapay zekâ sesiyle sesli okuma (Piper, cihazda)`.

**Görev 2 araştırma ve ölçüm notları (2026-09-30):**

*Kütüphane seçimi: hazır kütüphane değil, doğrudan onnxruntime-web + piper-phonemize WASM.*

| Aday | Lisans | Durum | Neden seçilmedi |
|---|---|---|---|
| `@diffusionstudio/vits-web` 1.0.3 | MIT | son sürüm 2024-09 | Modelleri OPFS'ye `createWritable` ile yazar: eski Safari'de yok. ONNX Runtime'ı ve fonemleyiciyi her açılışta CDN'den yükler: çevrimdışı çalışmaz. |
| `@mintplex-labs/piper-tts-web` 1.0.5 | MIT | vits-web çatalı, 2026-08 | Aynı OPFS saklama; ONNX Runtime 1.18. |
| `piper-tts-web` 1.1.2 | MIT | 2025-07 | Paket 47 MB (transformers.js ve WebGPU worker'ı da içinde); eski WebKit için gereksiz. |
| **onnxruntime-web 1.30.0 + piper-phonemize WASM** | MIT + fonemleyici GPL-3.0 (aşağıda) | ONNX Runtime bakımlı | Seçildi: kendi kodumuz az, Cache Storage, worker, çevrimdışı. |

- ONNX Runtime Web'in WASM'ı (`ort-wasm-simd-threaded.wasm`, 14,2 MB, gzip 3,7 MB) yalnızca SIMD, sign-ext, sat-float-to-int, bulk-memory ve paylaşımlı bellek ister (wabt ile tarandı). Exception handling, relaxed SIMD ve memory64 yok. Safari 16.4+ çalıştırır; WebGPU kullanılmaz. Sayfa `crossOriginIsolated` olmadığı için tek iş parçacığıyla çalışır (COOP/COEP başlığı Hugging Face'ten indirmeyi bozardı).
- Tarayıcıda en az şunlar gerekir: WASM SIMD (Safari/iPadOS 16.4+), module Worker, Web Audio, Cache Storage, BigInt64Array. Biri yoksa "Yapay zekâ" grubu gösterilmez; sistem sesleri aynen çalışır.

*Lisans ve espeak-ng (GPL) sorusu:*
- Piper sesleri espeak-ng'nin ses birimleriyle eğitildi, bu yüzden fonemleyici gerekir. Tarayıcıda çalışan tek derleme espeak-ng + piper-phonemize'ın Emscripten derlemesi: `@diffusionstudio/piper-wasm@1.0.0` (`piper_phonemize.js` 121 kB, `.wasm` 635 kB, `.data` 18,1 MB, bütün dillerin espeak-ng verisi).
- espeak-ng **GPL-3.0-or-later**, piper-phonemize MIT. npm paketi "MIT" yazsa da içindeki WASM ve veri GPL'dir: paketin etiketi yanlış.
- Uygulamada nasıl: GPL kodu **uygulamanın deposuna, paketine ve Vercel yayınına konmaz**. Kullanıcı sesi seçince jsDelivr'den (npm paketi, değişmez sürüm, SHA-256 denetimli) ayrı bir dosya olarak indirilir, Cache Storage'da durur ve worker'da ayrı bir program gibi çalıştırılır: `callMain` ile komut satırı argümanları verilir, çıktısı JSON satırı olarak okunur. GPL kodunu biz dağıtmıyoruz, dağıtan npm/jsDelivr. GPL çalıştırmayı kısıtlamaz.
- Dürüst not: FSF'ye göre aynı süreçte çalışıp işlev çağrısıyla konuşan programlar "birleşik iş" sayılabilir. Burada iletişim komut satırı ve metin çıktısıyla oluyor (FSF'nin "ayrı programlar" dediği biçim) ve dağıtım bizden değil. Kişisel kullanımda risk yok. Uygulama ileride kapalı kaynaklı ve ücretli dağıtılırsa ya da fonemleyici bizim sunucumuzdan sunulursa yeniden değerlendirilmeli. Çözümler: fonemleyiciyi kaynak bağlantısıyla GPL olarak sunmak ya da GPL'siz bir Türkçe fonemleyici yazmak. Türkçe yazım neredeyse sesçildir, ama espeak'in vurgu ve sayı okuma kurallarını taklit etmek iş ister.
- onnxruntime-web: MIT, uygulamayla gelir.

*Sesler (Hugging Face `rhasspy/piper-voices`, sabit sürüm `c10ece1`, 2026-09-17):*

| Ses | Boyut | Model kartı lisansı | Durum |
|---|---|---|---|
| `tr_TR-dfki-medium` ("DFKI") | 63,2 MB (+5 kB json) | Veri: CC BY-NC-SA 4.0 (ticari olmayan). Lessac sesinden ince ayar; Lessac/Blizzard 2013 verisi araştırma lisanslı | **Kullanıldı** (tek Türkçe ses) |
| `tr_TR-fahrettin-medium` | 63,2 MB | CC0 (NabuCasa voice-datasets) | **Kullanılmadı:** rhasspy 2025-12-30'da "katkıcıların isteğiyle" kaldırdı. Aynaları duruyor (diffusionstudio, speaches-ai, csukuangfj). Kullanıcı kararı gerekir |
| `tr_TR-fettah-medium` | 63,2 MB | CC0 | Aynı nedenle kullanılmadı |
| `en_US-ljspeech-medium` ("LJSpeech") | 63,5 MB | Kamu malı (LJ Speech), sıfırdan eğitim | **Kullanıldı** (İngilizce). `en_US-lessac-medium` verisi araştırma lisanslı olduğu için seçilmedi |

- İlk ses için indirilecek toplam **~96 MB**: model 63 MB + ONNX Runtime WASM 14 MB + fonemleyici 19 MB. İkinci ses için yalnızca 63 MB. Menüde gösterilir.

*Uygulama:*
- `src/reader/modes/piper/` içindeki dosyalar:
  - `voices.ts`: katalog, adresler, SHA-256.
  - `store.ts`: Cache Storage; indirme, ilerleme, iptal, denetim, silme, eski dosyaları temizleme.
  - `manager.ts`: kurulum durumu, destek denetimi, test kancası.
  - `synth.ts` + `piper.worker.ts`: worker; ONNX Runtime ve fonemleyici, dosyaları önbellekten kendisi okur.
  - `audio.ts`: Web Audio, iOS kilidi, `audioSession = playback`.
  - `piperEngine.ts`: SpeechEngine.
  - `combined.ts`: sistem sesi ve Piper tek motor.
- Denetleyiciye `lookahead`/`prefetch` eklendi: her konuşmadan sonra sıradaki parçalar bildirilir (sonraki cümlelere de geçerek).
  - Motor okunacak sesi öne alır, önceden sentezleri sırayla birer birer yapar; okur atlayınca bekleyenleri bırakır.
  - `cancel` çalmayı durdurur ve sıradaki sentezleri bırakır. Sürmekte olan tek sentez biter ve önbelleğe girer; worker'ı öldürmek modeli yeniden yüklemeyi gerektirirdi.
- Sentez yavaşsa (gerçek zaman oranının ortalaması > 0,75) önceden hazırlanan konuşma sayısı 2'den 4'e çıkar.
- İlk cümlede model yüklenir; bu sırada oynat düğmesinde dönen bir simge çıkar ("Ses hazırlanıyor").
- Web Audio bağlamı askıdaysa (iOS arka plan) motor meşgul sayılmaz: bekçi yeniden dener, olmazsa "Okumak için oynat düğmesine dokunun" der.
- Paket boyutu (main'e göre):
  - Ana JS +22 kB (gzip +8 kB, görev 1 dahil).
  - Worker 74 kB, precache'te.
  - Precache +94 KiB (208 dosya).
  - ONNX Runtime WASM (14,2 MB) precache'te değil, ilk kurulumda iner.

*Ölçüm (Windows masaüstü, makine başka ajanlarla paylaşımlı; gerçek model, tek iş parçacığı):*

| Tarayıcı | İlk cümle (model yükleme dahil) | Sonraki cümleler: sentez / ses süresi (RTF) |
|---|---|---|
| Chromium (masaüstü) | 54 karakter: 5,1 sn / 3,4 sn ses | 69 kr: 2,0 / 4,6 sn (0,43); 117 kr: 5,1 / 7,4 sn (0,69); 3 kr: 0,38 / 0,46 sn (0,82) |
| Playwright WebKit (Windows) | 54 karakter: 8,6 sn / 3,5 sn ses | 69 kr: 3,9 / 4,5 sn (0,86); 117 kr: 6,6 / 7,5 sn (0,87); 3 kr: 0,39 / 0,38 sn (1,02) |

- Gerçek ağdan indirme (Chromium): 96 MB 17 sn sürdü. CORS (Hugging Face yönlendirmesi, jsDelivr) sorunsuz.
- Yayın derlemesinde çevrimdışı ikinci açılış (gerçek model, gerçek worker, Chromium): ses cihazdan okundu, ilk cümle 8,2 sn'de hazırdı, okuma ilerledi.
- **iPad riski:**
  - WebKit'te oran 0,86–1,0, yani sınırda. Kısa cümlelerde sabit maliyet yüzünden oran 1'e yaklaşıyor.
  - Önceden sentez (2→4) değişkenliği gizler. Ama oran uzun süre 1'in üstünde kalırsa cümleler arasında boşluk olur.
  - İlk cümle 5–9 sn bekletir.
  - Gerçek iPad'de denenmeli (Görev 3). Olmazsa çareler: `low` kalitede ses (daha küçük model; Türkçe `low` yok) ya da kısa cümleleri birleştirip sabit maliyeti azaltmak.
- Playwright'ın Windows WebKit'inde Web Audio yok ve Cache Storage sayfa yenilenince boşalıyor. Bu yüzden e2e'de WebKit için en küçük bir sahte AudioContext konur ve çevrimdışı yeniden kullanım sayfa yenilenmeden denenir. Gerçek Safari'de ikisi de var.

*Testler:*
- `tests/reader/piperEngine.test.ts`, sahte sentezleyici ve ses çıkışıyla: hız→length_scale, önceden sentez sırası, atlama, iptal, hata, "hazırlanıyor" bildirimi, uyarlanan önden bakış, denetleyicinin bildirdiği sıradaki konuşmalar, birleşik motorun yönlendirmesi.
- `e2e/piper.spec.ts`, test kancasındaki sahte sentezleyiciyle, dosyalar route ile sunulur: öneri, indirme ilerlemesi ve iptali, seçim, okuma ilerlemesi ve vurgu, sayfa çevirme, hız, çevrimdışı yeniden kullanım, "Sesi kaldır".
- `e2e/offline.pwa.ts`: worker precache'te, WASM değil; indirilen ses service worker ile çevrimdışı yeniden açılışta kullanılıyor.


### Görev 3 — İnceleme ve birleştirme
- [ ] Kod incelemesi ve düzeltmeler, `main`'e birleştirme, Vercel'de iPad ile deneme.
