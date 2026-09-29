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
- [ ] **Araştırma ve seçim** (plan belgesine not edilir):
  - Tarayıcıda Piper çalıştıran bakımlı bir kütüphane seçilir: onnxruntime-web WASM ve espeak-ng fonemleyici gerekir. Adaylar: `@diffusionstudio/vits-web`, `piper-tts-web`, doğrudan onnxruntime-web ile piper-phonemize wasm.
  - Seçim ölçütleri: lisans (MIT/Apache; AGPL olmaz), eski WebKit uyumu (WebGPU yok, WASM SIMD Safari 16.4+), boyut, bakım.
  - Türkçe sesler (`rhasspy/piper-voices`: `tr_TR-dfki-medium`, `tr_TR-fahrettin-medium`, `tr_TR-fettah-medium`) ve İngilizce için bir ses (ör. `en_US-lessac-medium`). Her sesin model kartındaki lisans okunur; yeniden dağıtıma izin verenler listelenir.
- [ ] **Model indirme ve saklama:**
  - İlk seçimde model (.onnx + .json), ilerleme çubuğuyla indirilir ve Cache Storage'a konur (OPFS yazma eski Safari'de yok).
  - Kaynak: Hugging Face (CORS açık). Adres ayar dosyasında durur.
  - Silme: "Sesi kaldır" (yer açmak için). `navigator.storage.persist()` zaten isteniyor.
  - Workbox önbelleğine (precache) eklenmez; ONNX/WASM çalışma zamanı dosyaları ya uygulamayla gelir ya da ilk kullanımda önbelleğe alınır, böylece çevrimdışı çalışır.
- [ ] **Motor (`PiperEngine implements SpeechEngine`):**
  - Sentez bir Web Worker'da yapılır (arayüz donmasın).
  - Cümle N çalınırken N+1 önceden sentezlenir; uzun cümleler parçalanır (mevcut 250 karakter parçalama).
  - Çalma Web Audio (`AudioContext`) ile yapılır; iOS'ta ilk dokunuşta açılır (`prime`).
  - Hız: `length_scale = 1 / rate` (perde bozulmaz).
  - Olaylar: `start`, `end`, `error`; `busy()` bekçiyle uyumlu.
  - `cancel()` sentezi ve çalmayı keser.
  - Sayfa gizlenince/kilitlenince mevcut davranış korunur.
- [ ] **Arayüz:**
  - Ses menüsünde en üstte "Yapay zekâ (doğal)" grubu: "Fahrettin", "Fettah", "DFKI" (indirilmemişse "indir · ~60 MB").
  - İndirme sırasında ilerleme ve iptal; hazır olunca otomatik seçilir.
  - Tercih kalıcıdır (readAloudPrefs).
  - Yapay zekâ sesi varsa ve kullanıcı ses seçmediyse ilk açılışta bir kez önerilir.
- [ ] **Performans ölçümü** (plan belgesine not edilir): masaüstü Chromium ve Playwright WebKit'te cümle başına sentez süresi (gerçek zaman oranı). iPad'de oran 1'in altında kalmalıdır; önceden sentez bunu gizler.
- [ ] **Testler:**
  - Birim: parçalama, önceden sentez sırası, iptal, hız→length_scale; motor sahte sentezleyiciyle test edilir.
  - e2e: model indirme ağdan yapılamayacağı için test modeli yerel sabit bir dosyadan (route ile) sunulur ya da sahte sentezleyiciyle çalışılır. İndirme ilerlemesi, seçim, okuma ilerlemesi (vurgu) ve çevrimdışı sonraki açılış denetlenir.
- [ ] Commit: `feat(reader): yapay zekâ sesiyle sesli okuma (Piper, cihazda)`.

### Görev 3 — İnceleme ve birleştirme
- [ ] Kod incelemesi ve düzeltmeler, `main`'e birleştirme, Vercel'de iPad ile deneme.
