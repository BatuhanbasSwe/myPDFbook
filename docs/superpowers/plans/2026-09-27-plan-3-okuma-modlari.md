# Plan 3 — Okuma modları: sesli okuma, hızlı okuma, kalemle odak

> **Ajanlar için:** Görevler alt ajanlarla uygulanır, her görev ayrı bir alt ajanla kod incelemesinden geçer. Adımlar `- [ ]` ile izlenir.

**Amaç:** Üç okuma modu iki görünümde de (Sayfa = PDF görüntüsü, Metin = yeniden dizilmiş metin) çalışır:
- **Sesli okuma:** tarayıcının sesiyle cümle cümle okunur, okunan cümle vurgulanır, sayfa kendiliğinden çevrilir.
- **Hızlı okuma:** cümleler süreyle ilerler (varsayılan 5 sn ya da dakikada kelime); etkin cümle dışındakiler kararır.
- **Odak:** Apple Pencil'ın (ya da farenin) üstünde durduğu cümle açık, gerisi karanlık kalır.

**Mimari:**
- **Cümle dizini** (`src/text/sentences.ts`) kitabın bloklarından cümleleri çıkarır: `Sentence {id, block, start, end, words}`. Hepsi DOM'suz saf TypeScript'tir, Node'da test edilir.
- **Sayfa geometrisi** (`src/text/pageGeometry.ts`): sayfa görünümünde cümlenin PDF sayfasındaki yeri, pdf.js metin öğelerinden okuma sırasında bulunur.
  - Sayfanın metni harf harf konumlarıyla düzleştirilir.
  - Cümle metni normalleştirilerek içinde aranır; boşluk, tire, yumuşak tire ve büyük/küçük harf farkı yok sayılır.
  - Sonuç, satır başına bir dikdörtgendir (PDF birimi). Dönüştürücü değişmez, eski kitaplar yeniden dönüştürülmez.
- **Vurgu:**
  - Sayfa görünümünde `PageImage` üstüne bir SVG katman çizilir: cümle dikdörtgenleri ve karartma maskesi.
  - Metin görünümünde CSS Custom Highlight API (`CSS.highlights`, `::highlight()`) kullanılır. DOM değişmediği için sayfalama etkilenmez.
  - Metin görünümünde cümlenin DOM aralığı, blok öğelerindeki metin düğümlerinden bulunur (yumuşak tireler atlanır).
- **Mod denetleyicisi** (`src/reader/modes/`): saf durum makinesi; saat ve ses dışarıdan verilir, sahte zamanlayıcıyla test edilir. Etkin cümle değişince okuyucuya "bu cümleyi göster" der; okuyucu gerekiyorsa sayfayı çevirir.

**Teknoloji:** `Intl.Segmenter`, Web Speech API (`speechSynthesis`), CSS Custom Highlight API (Safari 17.2+, Chrome 105+), Pointer Events (kalem hover: `pointerType === 'pen'`), Screen Wake Lock.

---

## Beyin fırtınası — sonraki fikirler (öncelik sırasıyla)
1. **PWA + iPad'e kurulum:** çevrimdışı çalışma, ana ekran simgesi.
   - Kullanıcı asıl olarak iPad'de okuyacak; şu an yalnızca bilgisayarda deneniyor.
   - Barındırma için kullanıcı onayı gerekir: GitHub Pages ya da Cloudflare Pages.
2. **Sayfa görünümünde gece modu:** PDF görüntüsü akıllı ters çevirmeyle karanlık gösterilir (`invert(1) hue-rotate(180deg)`, resimler korunur). Karanlıkta da gerçek sayfa görünümü korunur.
3. **Apple Pencil ile sayfaya not ve fosforlu kalem** (sayfa görünümünde, PDF koordinatlarında saklanır; metin görünümünde cümleye bağlanır).
4. **Köşe kıvırma yer imi**, yer imleri listesi.
5. **Kitap içinde arama** (Türkçe büyük/küçük harf duyarsız); sonuç sayfada vurgulanır (aynı geometri katmanı).
6. **Okuma istatistikleri:** günlük süre, seri, "bölümün bitmesine ~8 dk".
7. **Sayfa çevirme sesi** (isteğe bağlı, kısa ve yumuşak).
8. **Uyku zamanlayıcısı** (sesli okumada "15 dk sonra dur").
9. **Kitaplık rafı görünümü:** kapaklar raf üstünde; okunan/okunacak rafları.
10. **Alıntı kartı:** seçili cümleyi güzel bir görsel olarak paylaşma.

---

### Görev 1 — Cümle dizini
**Dosyalar:** yeni `src/text/sentences.ts`, `tests/text/sentences.test.ts`.

- [x] **`splitSentences(text, lang)`:** `Intl.Segmenter(lang, {granularity: 'sentence'})` ile böler ve metindeki başlangıç/bitiş konumlarını döndürür. Yanlış bölünen parçalar birleştirilir:
  - kısaltmalar: Dr., Prof., Doç., Av., vb., vs., bkz., örn., s., sf., No., St., Mr., Mrs., e.g., i.e.;
  - tek harf + nokta (baş harfler: "A. Yılmaz");
  - sıra sayıları ("3. bölüm", "19. yüzyıl": rakam + nokta + küçük harf);
  - "…"/"..." sonrası küçük harf;
  - tırnak ya da parantez kapanışı ile başlayan parça önceki cümleye eklenir.

  Baştaki ve sondaki boşluklar cümleye dahil edilmez.
- [x] **`buildSentenceIndex(blocks, lang)`:** `Sentence {id, block, start, end, words}` dizisi. Başlıklar tek cümledir. `break` ve `pageImage` bloklarından cümle çıkmaz. `id` kitap boyunca sıradır.
- [x] **`sentenceAt(index, locator)`:** ikili aramayla konumu içeren ya da ondan sonra gelen ilk cümle.
- [x] **Testler:**
  - Türkçe diyalog ("— Nereye? dedi.");
  - kısaltmalar, sıra sayıları, üç nokta;
  - İngilizce metin;
  - boş blok;
  - 1 MB metin 300 ms'nin altında (performans);
  - `sentenceAt` sınır durumları.
- [x] **Commit:** `feat(text): cümle dizini`.

### Görev 2 — Sayfa geometrisi (cümlenin PDF sayfasındaki yeri)
**Dosyalar:** yeni `src/text/pageGeometry.ts`, `tests/text/pageGeometry.test.ts`; `src/pdf/pdfSource.ts`'teki `getPageText` yeniden kullanılır.

- [x] **`pageCharMap(pageText: PageText)`:** öğeleri okuma sırasına dizer (üstten alta, soldan sağa; aynı taban çizgisi aynı satırdır). Normalleştirilmiş karakter dizisi üretir: NFKC, küçük harf (tr), yalnızca harf ve rakam. Her karakter için `{x0, x1, y, h}` tutar; öğe genişliği karakterlere orantılı bölünür.
- [x] **`findTextRects(map, text, fromHint?)`:** metni normalleştirir ve haritada arar (ipucundan sonraki ilk eşleşme). Bulamazsa en uzun baş/son parça eşleşmesiyle kısmi sonuç döndürür: cümle sayfa sınırından taşıyorsa sayfadaki kısmı. Eşleşen karakterleri satır satır dikdörtgenlere toplar (PDF birimi, y aşağı doğru, sayfa üstünden).
- [x] **Testler** (Node, pdfjs legacy; `tests/convert/fixtures.test.ts` kalıbı):
  - `novel-tr.pdf`'in bir sayfasındaki ilk paragrafın ilk cümlesi bulunur, dikdörtgenler sayfa içinde ve satır sayısı doğru;
  - satır sonu tiresiyle bölünmüş kelime içeren cümle bulunur;
  - sayfa sınırından taşan cümlenin iki sayfadaki parçaları;
  - bulunamayan metin boş sonuç verir;
  - `ebook-tr.pdf` ve `english.pdf` ile birer örnek.
- [x] **Commit:** `feat(text): cümlenin PDF sayfasındaki yeri`.

### Görev 3 — Vurgu katmanı (iki görünüm)
Plan 2b (sayfa görünümü) birleştikten sonra yapılır.
- [x] **Cümlenin sayfalardaki yeri** (`src/text/sentencePages.ts`): sayfa haritası sayfa başına bir kez kurulur (önbellek); cümle, önceki cümlenin bittiği sayfadan ve ipucundan aranır. Sayfa sınırından taşan cümle baş ve son parçasıyla döner. `firstOnPage`: önceki sayfadan süren paragrafın sayfaya taşan cümlesi dahil sayfanın ilk cümlesi.
- [x] **Sayfa görünümü:** `SentenceOverlay` (SVG, sayfa kutusuna ölçekli, `xMidYMid meet`), `usePdfBook`'a PDF sayfasına göre `overlays` olarak verilir (`useSentenceOverlays`).
  - [x] `highlight`: sıcak sarı, yarı saydam dikdörtgen (`mix-blend-mode: multiply`);
  - [x] `focus`: sayfanın geri kalanı %70 karartılır (SVG maske, cümle dikdörtgenleri delik), cümle açık kalır;
    cümlenin olmadığı açık sayfa tamamen karartılır (Görev 5 ile).
- [x] **Metin görünümü:** `CSS.highlights.set('mypdfbook-active', new Highlight(...ranges))` (`src/reader/modes/textHighlight.ts`).
  - [x] `::highlight(mypdfbook-active)` ile vurgulanır; destek yoksa bir şey yapılmaz.
  - [x] Odakta bütün metin soluk (`color: var(--muted)` yarı saydam), etkin cümle ise `::highlight` ile koyu gösterilir;
    API yoksa cümle yedek kutularla belirir (Görev 5 ile).
  - [x] Range, locator'dan DOM'a çeviren yardımcıyla bulunur (yumuşak tireler atlanır). Sayfa öğesi bloğun sayfadaki başlangıcını `data-from` ile taşır; cümle iki sayfaya bölünmüşse iki aralık.
- [x] Testler: Node'da `sentencePages` (fixture), tarayıcıda `sentenceRanges`; e2e'de vurgunun görünmesi (Görev 4 ile): metin görünümünde `CSS.highlights.has`, sayfa görünümünde SVG `rect` sayısı.
- [x] **Commit:** `feat(reader): cümle vurgusu (sayfa ve metin görünümü)`.

### Görev 4 — Sesli okuma
- [x] `src/reader/modes/readAloud.ts`: denetleyici (oynat, duraklat, önceki, sonraki, hız 0,5–2×, ses seçimi).
  - [x] Her cümle ayrı bir `SpeechSynthesisUtterance` olur (`webSpeech.ts`).
  - [x] Sonraki cümle, `end` olayında başlar; okunamayan cümle atlanır, üst üste üç hatada okuma durur.
  - [x] Hız değişince okunan cümle yeni hızla baştan okunur.
  - [x] iOS'ta ilk başlatma dokunuşla yapılır (sayfa görünümünde motor dokunuşta sessiz bir konuşmayla açılır).
  - [x] Konuşma motoru arayüzle soyutlanır; testlerde sahte motor ve sahte zamanlayıcı kullanılır.
- [x] Etkin cümle sayfa dışına çıkınca sayfa çevrilir (sayfa görünümünde cümlenin PDF sayfasına, metin görünümünde
  konumuna; bir sonraki sayfaysa efektle). Sayfa sınırından taşan cümlenin bir parçası açıksa çevrilmez.
- [x] Okuma açık sayfanın ilk cümlesinden başlar; kaldığı cümle açık sayfadaysa oradan sürer.
- [x] Okurken Screen Wake Lock açık kalır (`wakeLock.ts`).
- [x] UI (`ReadAloudBar.tsx`): başlıkta "Sesli oku" düğmesi; altta ortada yüzen çubuk (oynat/duraklat, ‹ ›, hız
  seçenekleri 0,75–2×, kitabın dilindeki sesler, uyku zamanlayıcısı, kapat). Dar ekranda satırlara bölünür.
  Boşluk oynatır/duraklatır, Esc kapatır. Hız ve ses (dile göre) cihazda saklanır (`readAloudPrefs.ts`).
- [x] Uyku zamanlayıcısı (beyin fırtınası 8): 15/30/60 dk; süre dolunca okunan cümle bitince durur.
- [x] Testler: Node'da denetleyici (sahte motor), e2e'de sahte `speechSynthesis` ile iki görünümde vurgu, ilerleme,
  sayfa çevirme, hız, ses ve tuşlar.
- [x] **Commit:** `feat(reader): sesli okuma (hız, ses, uyku zamanlayıcısı)`.

### Görev 5 — Hızlı okuma
- [x] `speedReader.ts`: saf denetleyici, saat dışarıdan (oynat, duraklat, önceki, sonraki, durdur). Süre sabit
  (1–30 sn, varsayılan 5) ya da dakikada kelime (100–1000, varsayılan 250): `kelime / wpm × 60 sn`, en az 1,2 sn,
  her virgül, noktalı virgül ve iki nokta için +0,15 sn. Duraklatınca kalan süre korunur; ayar hemen uygulanır.
- [x] Açık sayfadan başlar (kaldığı cümle açık sayfadaysa oradan), sayfa kendiliğinden çevrilir. Sayfa sınırından
  taşan cümlede süre harf oranına göre bölünür, sayfa cümlenin ortasında çevrilir.
- [x] Sesli okumayla ortak "cümle oynatıcısı" (`useSentencePlayer.ts`): cümle dizini, vurgu, sayfa izleme ve
  çevirme, göz atma, okurun işi sürerken bekleme, başlangıç cümlesi, tuşlar. Çubuğun kabı ortak (`PlayerBar.tsx`).
- [x] Aynı vurgu katmanı; **Odak** (açılıp kapanır, varsayılan açık): sayfa görünümünde SVG maskeyle cümle dışı
  %70 kararır, metin görünümünde yazı soluklaşır, etkin cümle `::highlight` ile koyu kalır.
- [x] Çubuk (`SpeedReaderBar.tsx`) sesli okuma çubuğunun yerinde ve görünüşünde; biri açılınca öteki kapanır:
  oynat/duraklat, ‹ ›, "Süre / Kelime/dk" kipi, süre seçenekleri (1, 2, 3, 5, 8, 10, 15, 20, 30 sn; 150–500
  kelime/dk), Odak, kapat; altında cümlede geçen süreyi gösteren ince çizgi. Başlıkta "Hızlı oku" düğmesi
  (üst çubuğun eylem listesinde: dar ekranda ⋯ menüsünde).
  Boşluk oynatır/duraklatır, Esc kapatır. Ayarlar cihazda saklanır (`speedPrefs.ts`). Oynarken Wake Lock açık,
  sekme gizlenince okuma duraklar.
- [x] Testler: Node'da denetleyici (sahte zamanlayıcı: süreler, wpm hesabı, virgül payı, en kısa süre, ilerleme,
  sayfa bildirimleri, duraklat/sürdür); e2e'de (3 proje) 1 sn'de ilerleme ve sayfa çevirme, cümle ortasında
  çevirme, odak maskesi ve soluk metin, kalıcı ayarlar.
- [x] **Commit:** `feat(reader): hızlı okuma (süre ya da dakikada kelime, odak)`.

#### RSVP (kullanıcı isteği: isteyene kelime kelime okuma, Spritz tarzı)
- [x] Kip seçiminde üçüncü seçenek: "Süre / Kelime/dk / **RSVP**". Kelimeler kitabın ortasında büyük bir kartta
  tek tek belirir (`RsvpCard.tsx`); kitap arkada kararmış görünür, etkin cümle sayfada vurgulu kalır.
- [x] Her kelime odak harfine (ORP) hizalanır: odak harfi vurgu renginde, hep aynı yerde, üstte ve altta ince
  çentiğin arasında. Konum uzunluğa göre: 1 → 0, 2–5 → 1, 6–9 → 2, 10–13 → 3, daha uzun → 4 (baştaki noktalama ve
  tırnak sayılmaz). Kitabın yazı tipi, büyük (telefonda küçülür); karta sığmayan kelime küçültülür.
- [x] Kartın altında cümlenin gösterilen kelimeye yakın kısmı soluk, gösterilen kelimenin altı çizili.
- [x] Hız dakikada kelime (100–1000, varsayılan 300; seçenekler 200, 250, 300, 350, 400, 500, 600, 800). Kelime
  başına `60000 / wpm` ms; cümle sonunda (. ! ? …) ×2, virgül, noktalı virgül, iki noktada ×1,5; 8 harften uzun
  kelimede ve sayıda ×1,3. "Yavaş başla" (varsayılan açık): oynatınca ya da duraklatıp sürdürünce ilk üç kelime %60
  hızdan tam hıza çıkar.
- [x] Kelimeler boşluktan bölünür; tireli bileşik tek kelime, uzun tire (—) ayrı kelime (`rsvp.ts`).
- [x] Denetimler aynı çubukta: oynat/duraklat (Boşluk ya da karta dokunmak), ‹ › cümle, duraklamışken ← → kelime,
  Esc kapatır. Sayfa kendiliğinden çevrilir (aynı izleme ve göz atma; taşan cümlede son parçanın ilk kelimesinde),
  okuma yeri kaydedilir. Ayarlar saklanır.
- [x] Denetleyici `speedReader.ts`'in kelime kipi (saf, saat dışarıdan); okuyucu her kelimede yeniden çizilmez
  (kart ve ilerleme çizgisi denetleyicinin anlık durumunu kendileri izler).
- [x] Testler: Node'da odak harfi, kelimelere bölme, süre çarpanları, yavaş başlama, duraklat/sürdür, kelime adımı,
  kip değişimi, taşan cümle; e2e'de (3 proje) kelimelerin sırası, odak harfi, duraklatma, ← →, sayfanın ilerlemesi.
- [x] **Commit:** `feat(reader): RSVP hızlı okuma (kelime kelime, odak harfi)`.

### Görev 6 — Kalemle odak
- [x] **Hover** (`useFocusMode.tsx`):
  - [x] `pointermove` ile `pointerType === 'pen'` (basmadan, Safari 16.1+) ya da fare; nokta her karede en çok bir
    kez denetlenir (rAF), odak küçük bir depoda durur: okuyucu her harekette yeniden çizilmez.
  - [x] Sayfa görünümünde nokta PDF sayfasına çevrilir, sayfanın cümle dikdörtgenleriyle (toleransla, en yakını)
    karşılaştırılır (`focusHit.ts`; sayfanın cümleleri `SentencePages.onPage`).
  - [x] Metin görünümünde `caretPositionFromPoint`/`caretRangeFromPoint` → locator → cümle (`locatorAtPoint`).
- [x] Kalem dokunuşu sayfa çevirmez, menü açmaz: capture aşamasında durdurulur ("Kalemle her zaman çiz" açıksa
  sayfa görünümünde çizer). Parmak dokunup kaydırınca sayfa çevirir; basılı tutup (~350 ms) sürükleyince odağı
  taşır (kitabın süren hareketi `cancelGesture` ile bırakılır).
- [x] Görünüş: aynı SVG maske ve `.sentence-focus` + `::highlight`, sarı vurgu yok. Karartma hafif %40, orta %70,
  güçlü %90; bulanık yalnızca metin görünümünde.
- [x] Düzeltme (bütün modlar): iki sayfalık kıvrılan kitapta (iPad yatay) `::highlight` çizilmiyordu (WebKit ve
  Chromium, `select-none` yazı). Vurgu açıkken yazı seçilebilir sayılır (`.sentence-lit`), seçim `selectstart`ta
  engellenir.
- [x] "Kalem kalkınca son cümle açık kalsın" ayarı (varsayılan açık; kapalıyken karartma söner); ↑/↓ ile cümle
  cümle ilerleme (sayfa gerekirse çevrilir), Esc kapatır. Ayarlar cihazda saklanır (`focusPrefs.ts`).
- [x] Başlıkta "Odak" düğmesi (üst çubuğun eylem listesinde: dar ekranda ⋯ menüsünde); çubuk (`FocusBar.tsx`)
  okuma modu çubuklarının yerinde. Sesli okuma ve hızlı okumayla aynı anda açık olmaz.
- [x] Testler: Node'da `focusHit` ve `focusPrefs`, `sentencePages.onPage`; tarayıcıda `offsetIn`/`locatorAtPoint`;
  e2e'de (3 proje) iki görünümde hover, ↑/↓, kalem ve parmak dokunuşu, basılı tutup sürükleme, ayarlar.
- [x] **Commit:** `feat(reader): kalemle odak (üstünde durulan cümle açık, gerisi karanlık)`.

### Görev 7 — PWA
- [x] `vite-plugin-pwa`: manifest, simgeler, iOS meta etiketleri, çevrimdışı önbellek (uygulama, fontlar, pdf.js worker ve varlıkları).
  - `vite-plugin-pwa` 1.3.0 (Vite 8 destekli), `registerType: 'prompt'`: yeni sürüm kütüphanede "Yeni sürüm
    hazır — Yenile" ile sorulur, okuma ekranında gizlidir; sayfa kendiliğinden yenilenmez.
  - Önbellek: uygulama kabuğu, pdf.js worker'ı, fontların Latin ve Latin Genişletilmiş alt kümeleri (diğerleri ilk
    kullanımda), pdf.js cmap, standart font, wasm (ve wasm'sız yedekleri), renk profili. `/read/:id` çevrimdışı da
    `index.html` ile açılır.
  - Manifest (`lang: tr`, `standalone`, `#f7f3ea`), simgeler `scripts/make-icons.ts` ile (`pnpm icons`):
    192, 512, maskelenebilir 512, apple-touch-icon 180, SVG. iOS: `black-translucent` durum çubuğu (üst ve alt
    çubuklar zaten `env(safe-area-inset-*)` kadar içeriden), başlık, simge; `theme-color` tema betiğiyle eşli.
  - Alt yol `BASE_PATH` ile (router, pdf.js varlıkları, manifest, service worker kapsamı); bkz. `docs/deploy.md`.
- [x] iPad için "Ana Ekrana Ekle" rehberi: kütüphanede kapatılabilir kart (kurulu değilken; iOS'ta "iPad'e kur:
  Paylaş → Ana Ekrana Ekle", Chromium'da "Uygulamayı yükle"). İçe aktarmadan sonra `navigator.storage.persist()`.
- [x] Testler: Node'da kartın görünürlük mantığı; `pnpm e2e:pwa` (derleme + önizleme, `/myPDFbook/` alt yolu,
  Chromium): service worker, manifest ve simgeler, çevrimdışı kütüphane, sayfa ve metin görünümü, sesli okuma.
- [x] **Commit:** `feat(pwa): çevrimdışı çalışma ve ana ekrana kurulum`.
- Barındırma: kullanıcıya sorulur (GitHub Pages ile aynı depodan ücretsiz; Cloudflare Pages). Seçenekler ve
  adımlar: `docs/deploy.md`.
