# Plan 8b — Yedek penceresi: şifre penceresi, büyük yedek, paylaşım sonucu, vazgeç

> **Ajanlar için:** Görevler alt ajanla uygulanır, sonunda kod incelemesinden geçer. Adımlar `- [ ]` ile izlenir.

**Neden:** Plan 8'in kod incelemesinde yedek penceresi için kalan maddeler (M5–M10) ve `window.prompt` sorunu. Asıl cihaz eski WebKit'li iPad (iPadOS ≤ 18, belki 16.4'ten eski); ana ekrana eklenmiş uygulamada `window.prompt` çalışmayabilir, `<a download>` hiçbir şey yapmayabilir ya da uygulamayı başka sayfaya götürebilir.

**Kısıtlar:**
- iOS 15/16'dan yeni API'ye yedek konur (`<dialog>` yoksa düz katman).
- Plan 9'un ortak bileşenleri ve jetonları kullanılır (`src/ui/List.tsx`, `IconButton`, `ui.css`). Kitap sayfasının görünümüne dokunulmaz.
- İndirme bir `await`'ten sonra programla tıklanmaz; yalnızca kullanıcının dokunduğu gerçek bağlantı indirir.

### Görev 1 — Uygulama içi şifre penceresi
- [x] `src/ui/passwordPrompt.ts`: söz (promise) döndüren servis. İstekler sıraya girer, aynı anda tek pencere açılır.
- [x] `src/ui/PasswordPrompt.tsx`: uygulamanın kökünde bir kez kurulan pencere.
  - Başlık kitabı adlandırır: "“{başlık}” şifreli".
  - Şifre kutusu (otomatik doldurma kapalı), "Aç" ve "Vazgeç"; yanlış şifrede "Şifre yanlış, tekrar dene".
  - `<dialog>` (`showModal`); desteklemeyen tarayıcıda sabit katman.
- [x] `askPassword(retry, title)`: içe aktarma (dosya adı), "Tekrar dene" ve okuyucu (kitabın adı) bu pencereyi kullanır.
- [x] Testler: servis sırası (birim); şifreli PDF içe aktarılırken şifre pencereden sorulur, yanlış şifrede uyarı (e2e). Şifreli test PDF'i (`encrypted.pdf`, şifre `gizli`) betikle üretilir.
- [x] Commit: `feat(import): şifre uygulama içi pencereden sorulur`.

### Görev 2 — "Şifreleri de ekle"
- [x] Yedek al bölümünde, yalnızca şifreli kitap varsa görünür; varsayılan açık.
- [x] Açıkken altında: "Şifreli PDF'lerin şifreleri yedek dosyasında açık olarak durur; dosyayı yalnızca güvendiğin yere kaydet."
- [x] `includePasswords` dışa aktarmaya verilir.

### Görev 3 — iOS'ta büyük yedek ve boy tahmini
- [x] iPad/iPhone'da (iPad kendini Mac olarak tanıtır: `maxTouchPoints > 1`) PDF'ler 400 MB'ı aşıyorsa "PDF'leri de ekle" varsayılan kapalı.
- [x] Uyarı: PDF'ler büyük, cihaz dosyayı bellekte oluşturamayabilir; PDF'siz yedek önerilir. Öteki cihazlarda 500 MB uyarısı aynı dille.
- [x] Paylaşım başarılı olunca dosya bırakılır, adresi geri alınır.
- [x] Boy tahmini (M7): kapaklar ve kayıtlar metin kapalıyken de sayılır (`contentBytes` ayrı).

### Görev 4 — Paylaşım ve indirme sonucu
- [x] `share()` vazgeçme dışı bir hatayla reddederse: "Paylaşılamadı. Aşağıdaki “İndir” ile kaydet." Programla indirme yok; `markBackedUp()` yalnızca gerçek paylaşım ya da dokunulan "İndir"de.
- [x] Ana ekrandan açılmış iOS uygulaması: yedek paylaşım sayfasıyla kaydedilir, pencerede yazar; "İndir" yalnızca paylaşım olmazsa ve yeni sekmede açılır (uygulamanın sayfası değişmez).
- [x] Blob adresi (M6): dokunulunca 60 sn sonra geri alınır; pencere kapanınca değil (dokunulmamışsa hemen).

### Görev 5 — Geri yükleme özeti
- [x] Sonuçta `pdfsRejected`, `contentsRejected`, `contentsSkipped` sade Türkçeyle (sayısı 0 olan satır görünmez).
- [x] 'partial' (yarıda kalan) yüklemede hata iletisi ve yazılanların özeti; kalıcı depolama istenir, metni olmayan kitaplar dönüştürme sırasına girer.
- [x] Bölümde (M5): "Bu cihazda sildiğin notlar ve yer imleri, eski bir yedeği yükleyince geri gelebilir."

### Görev 6 — Vazgeç (M8)
- [x] Yedek alınırken ve yüklenirken "Vazgeç" düğmesi; `AbortSignal` girdiler arasında denetlenir.
- [x] Vazgeçilen yükleme 'partial' ile aynı güvenceleri verir (tutarlı, aynı yedek yeniden yüklenebilir).
- [x] Vazgeçilen yedek hiçbir şey üretmez, "son yedek" yazılmaz.
- [x] Birim testleri.

### Görev 7 — Erişilebilirlik (M10)
- [x] Seçeneklerin açıklaması `aria-describedby` ile bağlanır.

### Görev 8 — Doğrulama
- [x] tsc, lint, prettier, birim ve tarayıcı testleri, e2e (3 proje).
- [x] Ekran görüntüleri: iPad açık ve koyu, telefon açık; şifre penceresi dahil.
- [x] Gerçek iPad'de denenecekler (aşağıda).

**Kararlar (2026-10-01):**
- Şifre penceresi her soruda yeniden açılır (`key` = soru); yanlış şifreden sonraki soruda uyarı satırı görünür. İçe aktarırken PDF açılmadan başlık okunamaz: pencere dosya adından gelen başlığı yazar; "Tekrar dene" ve okuyucu kitabın kayıtlı adını yazar.
- `askPassword(retry, title)`: ikinci bağımsız değişken eklendi, dönüş biçimi aynı (`Promise<string | null>`).
- İndirme bağlantısının adresi dokunuşta verilir (`href="#"`, tıklamada Blob adresi) ve 60 sn sonra bırakılır: dokunulmamış yedeğin adresi hiç oluşmaz, pencere kapanınca süren indirme kesilmez.
- Paylaşım başarılı olunca dosya bırakılır; "Yeni yedek al" ile yeniden üretilir.
- Boy tahmini: `contentBytes` (metin) ve `otherBytes` (kapaklar, kayıtlar) ayrıldı; gösterilen boy her zaman `otherBytes`'ı içerir.
- Yarıda kalan yükleme `PartialRestoreError` (yazılanların özeti `result`'ta); pencere özeti gösterir, kalıcı depolama ister ve dönüştürme sırasını başlatır. Kayıtlardan önce vazgeçilirse (`cancelled`) özet ekranına dönülür, hiçbir şey yazılmaz.
- Şifreli test PDF'i (`tests/fixtures/encrypted.pdf`, şifre `gizli`) elle kurulur (RC4 128, R3): `scripts/make-encrypted-fixture.ts`.

**Kod incelemesi düzeltmeleri (2026-10-01):**
- [x] Okuyucu kapanınca açık şifre sorusu sıradan çıkar (`requestPassword(…, signal)`); kütüphanede sahipsiz pencere kalmaz.
- [x] Ana ekrandaki iOS uygulamasında "İndir"e dokunmak yedeği "alındı" saymaz: pencerede "Yedek kaydedildi mi?" (Evet/Hayır).
- [x] Yedek alınırken "Yedekten yükle" kapalı; pencereye sürüklenen yedek yalnızca boşta açılır; pencere kapanınca süren iş durur.
- [x] İndirme adresi 5 dk sonra, pencere kapanınca 10 sn payla, sayfa kapanınca hemen bırakılır.
- [x] Şifre penceresi: odak şifre kutusuna, açıklama `aria-describedby`; `<dialog>` yoksa Esc belge düzeyinde, odak içeride döner.
- [x] Paylaşım sayfası açıkken "Paylaş ya da kaydet" kapalı; `InvalidStateError` hata sayılmaz.
- [x] Testler: sıra sıfırlama (afterEach), iki "Vazgeç" düğmesi için e2e (iş yavaşlatılarak).

**Gerçek iPad'de denenecekler:**
- Ana ekrandaki uygulamada şifre penceresi: klavye açılıyor mu, "Aç"/Enter çalışıyor mu.
- Ana ekrandaki uygulamada "Paylaş ya da kaydet" → Dosyalar'a Kaydet; paylaşım olmazsa yeni sayfada açılan "İndir" uygulamayı bırakmadan iniyor mu, ardından "Yedek kaydedildi mi?" sorusu.
- Safari'de "İndir" (adres dokunuşta verilir) Dosyalar'a kaydediyor mu.
- 400 MB üstü PDF'li kütüphanede varsayılan PDF'siz yedek ve uyarı; büyük yedekte "Vazgeç".
- iPadOS 15.4 öncesinde (`<dialog>` yok) şifre penceresinin sabit katman yedeği.
