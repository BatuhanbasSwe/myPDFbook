# Plan 13 — Dokunduğun cümleden oku ve ses motorunun güncellemede yeniden inmesi

> **Ajanlar için:** Görevler TDD ile, görev görev uygulanır. Adımlar `- [x]` ile izlenir. Çalışma ağacı `.worktrees/dokun`, dal `plan-13-dokun-oku` (main 11b7a5d'den). main'e birleştirme ve push kullanıcının.

**Kullanıcı isteği (2026-11-11):**
- "Sese tıkladıktan sonra üstüne dokunduğun yeri okumaya başlasın": sesli okuma açıkken metindeki bir cümleye dokunmak okumayı o cümleden başlatır.
- Hata: DFKI daha önce indirilmişti; yeni sürüm yayınlanınca ses menüsünde DFKI yine "İndir · 96 MB" görünüyor.

**Kısıtlar:**
- Asıl cihaz eski WebKit'li iPad (iPadOS ≤ 18) + Apple Pencil. Konuşma ve ses bağlamı (iOS) dokunuşun içinde başlamalı: mevcut `start`/`prime` örüntüsü.
- Sayfa çevirme bozulmaz: köşe/kenar çekme, kaydırma, ok tuşları, sayfa düğmeleri aynen kalır.
- Kod tekrarı yok: dokunulan noktadaki cümle odak modunun (`focusHit.ts`, `useFocusMode.tsx`) mantığıyla bulunur; o mantık ortak bir dosyaya taşınır.
- Kendi sesleri (Plan 12, `mypdfbook-piper-custom-v1`) etkilenmez.

---

### Görev 1 — Ses motoru uygulama güncellemesinde yeniden inmesin (hata)
- [x] Kök neden araştırması (aşağıda **Kök neden**).
- [x] Test (önce kırmızı): iki ardışık derleme. Birinci derlemede DFKI iner (ONNX Runtime WASM'ı Vite'ın hash'li adresinde), ikinci derlemede adres değişir → `ensure` sonrası DFKI "Cihazda" kalmalı, ağdan bir şey inmemeli, model silinmemeli.
- [x] ONNX Runtime WASM'ı sürümlü sabit adreste: `public/ort/<onnxruntime-web sürümü>/ort-wasm-simd-threaded.wasm` (kurulumda `scripts/copy-ort-wasm.mjs` kopyalar, depoya girmez). Adres yalnızca paketin sürümü değişince değişir. `ORT_VERSION` sabiti ile kurulu paketin sürümü testte karşılaştırılır.
- [x] Geçiş: eski anahtarda (`…/assets/ort-wasm-simd-threaded-<hash>.wasm`) duran motor yeni anahtara taşınır (boyu tutuyorsa), sonra eski kayıt temizlikte silinir. Yeniden indirilmez.
- [x] Durum denetimi hızlı: `missing`/`hasAll` her dosya için `cache.match` yerine bir kez `cache.keys()` (WebKit `match`'te gövdeyi de okur: 63 MB'lık model için yavaş).
- [x] Durum henüz okunmadıysa ("unknown") menü "İndir · 96 MB" demez: "Denetleniyor…". Dokunulursa durum okunduktan sonra iner (inikse hemen "Cihazda").
- [x] `vercel.json`: `/ort/` dosyaları uzun önbellekli ve `application/wasm`.
- [x] Commit: `fix(voices): ses motoru uygulama güncellemesinde yeniden inmez …`.

### Görev 2 — Noktadaki cümle: odak modundan ortak dosyaya
- [x] `src/reader/modes/pointHit.ts`: metin görünümünde imleç yerinden (`locatorAtPoint` → `sentenceAtOffset`), sayfa görünümünde noktadaki PDF sayfası (`.pdf-page[data-pdf-page]`), sayfanın harf haritası ve cümleleri (önbellekli, yüklenirken `undefined`) ve noktadaki cümle (`clientToPage` → `sentenceAtPoint`). `HIT_TOLERANCE` (18 px) burada.
- [x] `useFocusMode.tsx` bunları kullanır (davranış aynı; odak e2e'si değişmeden geçer).
- [x] Commit: `refactor(reader): noktadaki cümle odak modundan ortak dosyaya`.

### Görev 3 — Dokunduğun cümleden oku
- [x] Kural (`tapRead.ts`, saf, birim testli): dokunuş kitabın dış kenar şeridindeyse (tek sayfada sayfa genişliğinin %12'si; çift sayfada her dış sayfanın %12'si) eskisi gibi; değilse ve sesli okuma açıksa noktadaki cümle aranır. Uzun basma (≥ 500 ms) ve süren metin seçimi okumaz.
- [x] `FlipBook`/`CurlEngine`: `onTap(x, tap)` — `tap`: `clientX`, `clientY`, basma süresi. Sürükleme (eşik 8 px) dokunuş sayılmaz (değişmedi).
- [x] `useSentencePlayer.startAtPoint(x, y, play, { prime, miss })`: metin görünümünde eşzamanlı; sayfa görünümünde sayfanın cümleleri önbellekteyse eşzamanlı, değilse önce `prime` (dokunuşta), sonra eşzamansız `play` ya da `miss`. Süren başlatmayı geçersiz kılar (`start` ile aynı sayaç).
- [x] `useReadAloud.readAt(x, y, miss)`: oynuyor ya da duraklatılmışsa da o cümleden oynar; yapay zekâ sesinde ses bağlamı dokunuşta açılır (`engine.prime`). Örnek cümle susar, okuma yeniden sayfayı izler.
- [x] `BookReader.onTap`: sesli okuma açık, kalem kipi kapalı, panel/menü/not yok → kenar şeridi dışında cümle aranır; bulunmazsa (kenar boşluğu, satır arası uzak) eski davranış (sol/sağ üçte bir çevirir, orta menüyü açar).
- [x] İpucu: sesli okuma çubuğunun üstünde bir kez "Bir cümleye dokun, oradan okusun" (8 sn ya da ilk dokunuşta söner); tercihlere (`localStorage`, `createLocalStore`: try/catch'li) `tapHint: true` yazılır. Çubuğun yüksekliğini değiştirmez (kitap yeniden sayfalanmaz).
- [x] Birim testleri: kenar şeridi kuralı (tek/çift sayfa, sınırlar), uzun basma.
- [x] Commit: `feat(reader): sesli okumada dokunulan cümleden okunur …`.

### Görev 4 — e2e ve doğrulama
- [x] e2e (`e2e/tap-read.spec.ts`, sahte konuşma ve sahte Piper): sayfa ve metin görünümünde cümleye dokun → okunan cümle değişir, vurgu o cümlede; duraklatılmışken dokun → oynar; kenar şeridine dokun → sayfa çevrilir; sesli okuma kapalıyken dokunma eskisi gibi (orta menü, sağ çevirir); ipucu bir kez; yapay zekâ sesinde dokunulan cümle sentezlenir.
- [x] tsc, lint, prettier, birim ve tarayıcı testleri, e2e (3 proje ayrı ayrı).
- [x] Ekran görüntüleri: ipucu ve dokununca vurgulanan cümle (iPad açık/koyu, telefon).

---

## Kararlar

### Dokunma kuralı
| Durum | Dokunuş |
| --- | --- |
| Sesli okuma kapalı | Eskisi gibi: sol üçte bir önceki, sağ üçte bir sonraki sayfa (ayar açıksa), orta menü. |
| Sesli okuma açık, dış kenar şeridi | Eskisi gibi (çevirir). Şerit: sayfa genişliğinin **%12'si**; çift sayfada her dış sayfanın %12'si (kitabın %6'sı). |
| Sesli okuma açık, şerit dışı, noktada cümle var | O cümleden okur (duraklatılmışsa da oynar). Menü açık/kapalı durumu değişmez. |
| Sesli okuma açık, şerit dışı, noktada yazı yok (üst/alt boşluk, resim) | Eskisi gibi (üçte bir kuralı). |
| Panel, menü, not açık | Önce onu kapatır (değişmedi). |
| Kalem kipi, sayfa kilidi | Kitap dokunuşları zaten çizime/yakınlaştırmaya gider (`gesturesDisabled`): okumaz. |
| Odak, hızlı okuma | Sesli okumayla aynı anda açık olmaz: etkisiz. |
| Uzun basma (≥ 500 ms), metin seçimi var | Okumaz (eskisi gibi). |

**Neden %12 şerit:** okur başparmağıyla sayfanın kenarına dokunarak çevirmeye alışık; sesli okuma açıkken orta bölge cümle seçimine gider. PDF kitaplarda kenar boşluğu çoğunlukla sayfa genişliğinin %10–15'i: şerit büyük ölçüde boşluğa düşer, yazıya dokunmak yine kolay. Daha geniş (üçte bir) şerit yazının üçte ikisini okunamaz yapardı; daha dar şerit (ör. %5) parmakla tutturulamaz (iPad'de ~40 px). Çift sayfada yalnızca dış kenarlar (iç kenar sayfa ortası: orada yazı var). Şeritte yazı olsa da çevirir: kenara dokunan okur çevirmek istiyordur.

**Neden noktada yazı yoksa eski davranış:** sesli okuma açıkken menüyü göstermenin dokunmayla yolu kalsın (üst/alt kenar boşluğu), `m` tuşu da var.

### Ses ve iOS
Metin görünümünde cümle eşzamanlı bulunur: konuşma dokunuşun içinde başlar. Sayfa görünümünde sayfanın cümleleri önbellekte değilse (ilk dokunuş) önce `engine.prime(ses)` dokunuşta, `play` sayfa metni gelince (mevcut `start` örüntüsü). Yapay zekâ sesinde metin görünümünde de `prime` çağrılır (Web Audio bağlamı).

### Kök neden (Görev 1)
- **Şüphe:** ONNX Runtime WASM'ı Vite'ın hash'li adresinden (`ort-wasm-simd-threaded.wasm?url` → `/assets/ort-wasm-simd-threaded-<hash>.wasm`). Önbellek anahtarı adrestir; adres değişirse motor "eksik" sayılır, `prune` eskisini siler.
- **Deney:** e168991 (Plan 11) ve 11b7a5d (bugünkü main) ayrı ayrı derlendi: ikisinde de `ort-wasm-simd-threaded-DcHrbrbl.wasm`. Vite (Rolldown) hash'i içerikten: paket sürümü değişmedikçe adres değişmiyor. Yani son güncellemelerde motor bu yoldan silinmedi; ama Vite/Rolldown sürümü ya da hash biçimi değişince silinirdi (gizli tuzak). Bu durumda menü 14 MB derdi, 96 MB değil.
- **96 MB nereden:** 96 MB = DFKI modeli (63 MB) + motor (33 MB): hepsi eksik ya da **durum henüz okunmamış**. Yönetici açılışta her ses için durumu "unknown" ve `need`'i tam boy (96 MB) başlatır; menü "unknown"u "İndir · 96 MB" diye gösteriyordu. Durum `ensure`'da önce eski sürüm temizliği, kendi seslerinin taşınması/temizliği, sonra her sesin her dosyası için `cache.match` ile okunur. WebKit `match`'te kaydın gövdesini de diskten getirir: 63 MB'lık model(ler) ve motor her ses için ayrı ayrı → eski iPad'de, hele güncellemeden sonraki ilk açılışta (service worker yeni sürümü kurarken), bu saniyeler sürebilir. O sırada menü "İndir · 96 MB" der; dokunulursa `download` eksik bir şey bulmaz, hemen "Cihazda" olur — okur bunu "yeniden indirdi" diye görür.
- **Diğer olasılık (kodla düzeltilemez):** iOS'ta ana ekrana eklenen uygulamanın depolaması Safari sekmesininkinden ayrıdır. DFKI Safari'de indirildiyse, Plan 10'un "Uygulamayı yükle"siyle ana ekrana eklenen uygulamada her şey eksiktir (96 MB) — kitaplar da görünmez. iPad'de denerken buna bakılacak.
- **Düzeltme:** sürümlü sabit adres + eski anahtardan taşıma (motor yeniden inmez), `keys()` ile hızlı denetim, "unknown" için "Denetleniyor…". İndirilmiş modellerin adresleri (Hugging Face sabit commit, `voices/batuhan-v1/`) zaten derlemeden bağımsız: `prune` onlara dokunmaz (testle güvencede).

---

## iPad'de denenecekler (kullanıcı)
- [ ] Sesli okumayı aç, sayfa görünümünde bir paragrafın ortasındaki cümleye parmakla dokun: okuma o cümleden başlar, cümle hemen vurgulanır. Duraklatıp başka cümleye dokun: oradan oynar.
- [ ] Apple Pencil ile cümleye dokun (Kalemle her zaman çiz kapalıyken): aynı. Açıkken kalem çizer, okumaz.
- [ ] Sağ/sol kenara (yazının dışındaki şerit) dokun: sayfa çevrilir. Köşeden çek, kaydır: çevrilir.
- [ ] Metin görünümünde aynı denemeler.
- [ ] DFKI (ya da Batuhan) sesiyle dokun: yapay zekâ sesi o cümleden okur.
- [ ] İlk açılışta çubuğun üstünde "Bir cümleye dokun, oradan okusun" görünür; ikinci açılışta görünmez.
- [ ] Güncellemeden sonra (bu sürüm yayınlanınca) ses menüsü: DFKI "Denetleniyor…" kısa sürer, sonra "Cihazda"; yeniden inmez. Bir sonraki sürümde de aynı.
- [ ] Okuma duraklatılmışken cümleye dokunarak başlayan okuma: iOS konuşmayı/sesi yalnızca dokunuşta açar, dokunuş `pointerup`'ta işlenir. Sistem sesiyle (Yelda/Emel) ve yapay zekâ sesiyle (DFKI) dene; sesli okumayı sistem sesiyle açıp ses menüsünden yapay zekâ sesine geçtikten sonra cümleye dokun: ses gelmeli.
- [ ] Okuma sürerken ileriye sayfa çevir, alt boşluğa dokun (menü açılır): okuma sayfayı geri çekmemeli.
- [ ] Ana ekrandaki uygulamayla Safari sekmesi ayrı depolama mı (kitaplar ve sesler) — DFKI hangisinde indirildi?

## Uygulama notları (2026-11-11)
- **Kalem kipi ve sayfa kilidi:** kitaba dokunuş `FlipBook`'a hiç ulaşmaz (`gesturesDisabled`), "Kalemle her zaman çiz" açıkken kalem dokunuşu çizim katmanında durur (`AnnotationLayer`): bu yüzden ayrıca e2e yazılmadı, `onTap`'te kalem kipi yine de denetlenir.
- **İpucu:** sesli okuma ilk açılınca tercihlere `tapHint: true` yazılır; çubuk ipucunu yapay zekâ sesi önerisi ve ses menüsü kapalıyken gösterir, 8 sn sonra ya da ilk dokunuşta söner. Çubuğun yüksekliğine girmez (`PlayerBar` `hint`: mutlak konumlu).
- **Sayfa görünümünde hız:** açık sayfa ve iki komşusunun cümleleri okuma açıkken önceden okunur (`useSentencePlayer`): dokunuş çoğunlukla eşzamanlı bulunur, konuşma dokunuşun içinde başlar.
- **e2e sahteleri:** sistem sesinin sahtesi `e2e/speechStubs.ts`'e taşındı (read-aloud ve tap-read ortak). e2e'de dokunulacak yer kitap yerleşimi oturduktan sonra ölçülür (çubuk ve öneri açılınca kitap küçülür, kıvrılan sayfa yeniden kurulur).
- **Derleme:** worker'daki `onnxruntime-web/wasm` Vite'a hash'li WASM'ı yine yayımlatıyor (`assets/ort-wasm-simd-threaded-*.wasm`, precache'te değil); uygulama artık onu değil `ort/<sürüm>/`'ü indirir.

## İnceleme düzeltmeleri (2026-11-11)
- **Boşluğa dokunuş okumayı bozmuyor:** `startAtPoint` başlatma sayacını ve sayfa izlemeyi yalnızca cümle gerçekten okunacaksa değiştirir. Önceden yazı olmayan yere dokunuş (menü) okumayı gezilen sayfadan geri çekiyor, açılmakta olan okumayı iptal ediyordu. Eşzamansız aramada geç gelen sonuç (yeni dokunuş, başka başlatma, sayfa değişti, öğe kalktı) yok sayılır.
- **Motor yerine sayfa saklanmaz:** sunucuda `/ort/…` yoksa Vercel'in yönlendirmesi index.html'i 200 ile döndürebilirdi. İndirilen dosyanın boyu denetlenir (`verify` açıkken), ONNX Runtime WASM'ının SHA-256'sı yazıldı (test paketteki dosyayla karşılaştırır), `vercel.json` yönlendirmesi `/((?!ort/|voices/).*)` (test), kopyalama betiği dosya yoksa kurulumu durdurur.
- **Taşıma bitmeden sentez yok:** `afterReady`: sentezleyici ilk istekte bir kez `piperManager.ensure()`'u bekler (güncellemeden sonraki ilk açılışta motor yeni anahtara taşınırken worker onu aramasın).
- Komşu sayfaların cümle ön okuması 300 ms ertelenir (çevirme animasyonu). İpucu tercihi ipucu gerçekten görününce yazılır; duyuru bölgesi (`role="status"`) hep durur. Okunamayan ses "Denetleniyor…"da kalmaz ("absent").
- e2e: ileriye göz atarken boşluğa dokunuş, uzun basma ve seçim (Pixel öykünmesinde programla yapılan seçim boş döndüğü için o adım orada atlanır), çift sayfada dış şerit (iPad), sayfanın cümleleri okunmamışken eşzamansız yol (Chrome ve iPad'de bu yoldan geçtiği doğrulandı).
