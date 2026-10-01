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
- [ ] Yedek al bölümünde, yalnızca şifreli kitap varsa görünür; varsayılan açık.
- [ ] Açıkken altında: "Şifreli PDF'lerin şifreleri yedek dosyasında açık olarak durur; dosyayı yalnızca güvendiğin yere kaydet."
- [ ] `includePasswords` dışa aktarmaya verilir.

### Görev 3 — iOS'ta büyük yedek ve boy tahmini
- [ ] iPad/iPhone'da (iPad kendini Mac olarak tanıtır: `maxTouchPoints > 1`) PDF'ler 400 MB'ı aşıyorsa "PDF'leri de ekle" varsayılan kapalı.
- [ ] Uyarı: PDF'ler büyük, cihaz dosyayı bellekte oluşturamayabilir; PDF'siz yedek önerilir. Öteki cihazlarda 500 MB uyarısı aynı dille.
- [ ] Paylaşım başarılı olunca dosya bırakılır, adresi geri alınır.
- [ ] Boy tahmini (M7): kapaklar ve kayıtlar metin kapalıyken de sayılır (`contentBytes` ayrı).

### Görev 4 — Paylaşım ve indirme sonucu
- [ ] `share()` vazgeçme dışı bir hatayla reddederse: "Paylaşılamadı. Aşağıdaki “İndir” ile kaydet." Programla indirme yok; `markBackedUp()` yalnızca gerçek paylaşım ya da dokunulan "İndir"de.
- [ ] Ana ekrandan açılmış iOS uygulaması: yedek paylaşım sayfasıyla kaydedilir, pencerede yazar; "İndir" yalnızca paylaşım olmazsa ve yeni sekmede açılır (uygulamanın sayfası değişmez).
- [ ] Blob adresi (M6): dokunulunca 60 sn sonra geri alınır; pencere kapanınca değil (dokunulmamışsa hemen).

### Görev 5 — Geri yükleme özeti
- [ ] Sonuçta `pdfsRejected`, `contentsRejected`, `contentsSkipped` sade Türkçeyle (sayısı 0 olan satır görünmez).
- [ ] 'partial' (yarıda kalan) yüklemede hata iletisi ve yazılanların özeti; kalıcı depolama istenir, metni olmayan kitaplar dönüştürme sırasına girer.
- [ ] Bölümde (M5): "Bu cihazda sildiğin notlar ve yer imleri, eski bir yedeği yükleyince geri gelebilir."

### Görev 6 — Vazgeç (M8)
- [ ] Yedek alınırken ve yüklenirken "Vazgeç" düğmesi; `AbortSignal` girdiler arasında denetlenir.
- [ ] Vazgeçilen yükleme 'partial' ile aynı güvenceleri verir (tutarlı, aynı yedek yeniden yüklenebilir).
- [ ] Vazgeçilen yedek hiçbir şey üretmez, "son yedek" yazılmaz.
- [ ] Birim testleri.

### Görev 7 — Erişilebilirlik (M10)
- [ ] Seçeneklerin açıklaması `aria-describedby` ile bağlanır.

### Görev 8 — Doğrulama
- [ ] tsc, lint, prettier, birim ve tarayıcı testleri, e2e (3 proje).
- [ ] Ekran görüntüleri: iPad açık ve koyu, telefon açık; şifre penceresi dahil.
- [ ] Gerçek iPad'de denenecekler (aşağıda).
