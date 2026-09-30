# Plan 7 — Sayfa kilidi ve yakınlaştırma

**Amaç:** Okur tek tuşla sayfayı kilitler: kilitliyken sayfa hiçbir yolla çevrilmez ve sayfa yakınlaştırılabilir. Kilit açılınca yakınlaştırma 1×'e döner, sayfa yine çevrilir. Okurun onayladığı yorum: yakınlaştırma yalnızca sayfa kilitliyken çalışır ("kilit kalkınca yakınlaştırma olmasın").

**Mimari:**
- `src/reader/zoom/zoomMath.ts`: DOM'suz hesap (sınır, kıstırma odağı, çift dokunma, kaydırma sınırı, adım, tekerlek, keskin çizim genişliği, işaret katmanı için nokta dönüşümü).
- `src/reader/zoom/useZoom.ts`: yakınlaştırma durumu (dönüşüm kitabın kutusuna React dışında yazılır) ve okuma alanında yakalama aşamasında dinlenen hareketler.
- `src/reader/zoom/ZoomBar.tsx`: kilitliyken altta küçük çubuk (kilidi aç, −, oran, +, sıfırla) ve "Sayfa kilitli" işareti.
- Kitabın bütün kutusu `translate() scale()` ile büyür: sayfalar, vurgular, işaretler, iğneler ve yer imi köşeleri birlikte.

---

- [x] **Kilit:** üst çubukta "Kilitle" eylemi (kilit simgesi, `aria-pressed`; telefonda ⋯ menüsünde "Sayfayı kilitle") ve `L` tuşu. Kilit oturumluk, saklanmaz.
- [x] **Kilitliyken çevirme yok:** dokunma bölgeleri, kaydırma, kıvrılan sayfanın köşeden çekmesi, ‹ › düğmeleri, ok tuşları, Boşluk ve kaydırıcı sayfayı çevirmez; bunun yerine kısa bir "Sayfa kilitli" işareti görünür. Tek dokunma yalnızca menüyü açıp kapar.
- [x] **Yakınlaştırma (yalnızca kilitliyken):** iki parmakla kıstırma (işaretçi olaylarıyla; `gesturestart`e bağlı değil), çift dokunma (1× ↔ 2×, dokunulan yerde), +/− düğmeleri ve oran, sıfırlama, Ctrl/⌘ + tekerlek ya da dokunmatik yüzeyde kıstırma, `+` `−` `0` tuşları. 1×–4×; büyüyen sayfa okuma alanının kenarından içeri kaymaz. Yakınken tek parmak, fare ya da tekerlek kaydırır.
- [x] **Kilit açıkken yakınlaştırma yok:** kıstırma, çift dokunma ve Ctrl + tekerlek 1×'te bırakır; sayfa eskisi gibi çevrilir.
- [x] **Kilidi açma:** yalnızca kilit düğmesi (üst çubuk ya da yakınlaştırma çubuğu) ve `L`. 1×'e döner, keskin görüntüler bırakılır.
- [x] **Keskinlik:** 1,2×'ten büyük yakınlaştırma 150 ms durulunca açık PDF sayfaları genişlik × yakınlaştırma × piksel oranıyla yeniden çizilir (uzun kenar en çok 4096 px, telefonda 2560 px). Yenisi gelene dek eskisi görünür; kilit açılınca ve sayfa değişince bırakılır. Metin görünümü yeniden sayfalanmaz.
- [x] **Okuma modları:** kilitliyken sesli okuma, hızlı okuma, RSVP ve odak sayfayı çevirmez (var olan `hold` kullanılır: hızlı okuma duraklar, sesli okuma sayfayı izlemeyi bırakır).
- [x] **Kalem kipi:** kilitle birlikte kullanılır. Kalem ve fare çizer, parmaklar yakınlaştırır ve kaydırır; çizgi büyümüş sayfada doğru yere düşer.
- [x] **Gidilen yer:** arama sonucu, yer imi, içindekiler, Notlar paneli ve "Sayfaya git" önce kilidi açar, sonra gider.
- [x] **Erişilebilirlik:** yakınlaştırma düğmelerinin adları var; "Sayfa kilitlendi" / "Kilit açıldı" duyurulur.
- [x] **Testler:** birim (sınır, kıstırma odağı, çift dokunma, kaydırma sınırı, adım, nokta dönüşümü, keskin çizim) ve e2e (3 projede): kilitli sayfa çevrilmez; +/−, çift dokunma, Ctrl + tekerlek, kıstırma; kaydırma; kilidi açınca 1× ve çevirme; kilit açıkken yakınlaşmaz; kalem kipi + kilit + yakınlaştırmada çizginin yeri; keskin çizim; metin görünümü ve arama.
- [x] **Commit:** `feat(reader): sayfa kilidi ve yakınlaştırma`.
- [ ] Kod incelemesi, `main`'e birleştirme ve iPad'de deneme.
