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
  - [ ] `focus`: sayfanın geri kalanı %70 karartılır, cümle açık kalır (Görev 5/6 ile).
- [x] **Metin görünümü:** `CSS.highlights.set('mypdfbook-active', new Highlight(...ranges))` (`src/reader/modes/textHighlight.ts`).
  - [x] `::highlight(mypdfbook-active)` ile vurgulanır; destek yoksa bir şey yapılmaz.
  - [ ] Odakta bütün metin soluk (`color: var(--muted)` yarı saydam), etkin cümle ise `::highlight` ile koyu gösterilir (Görev 5/6 ile).
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
- `speedReader.ts`: süre sabit (1–30 sn, varsayılan 5) ya da dakikada kelime (en kısa süre ve virgül payı).
- Aynı vurgu ve odak katmanı kullanılır, sayfa kendiliğinden çevrilir, Wake Lock açık kalır.
- Kontroller sesli okumayla aynı çubuktadır.

### Görev 6 — Kalemle odak
- **Hover:**
  - `pointermove` ile `pointerType === 'pen'` (basmadan, Safari 16.1+) ya da fare.
  - Sayfa görünümünde nokta, sayfanın cümle dikdörtgenleriyle karşılaştırılır.
  - Metin görünümünde `caretPositionFromPoint`/`caretRangeFromPoint` → locator → cümle.
- Kalem dokunuşu sayfa çevirmez: capture aşamasında durdurulur. Parmak sayfa çevirir.
- "Kalem kalkınca son cümle açık kalsın" ayarı; ↑/↓ ile cümle cümle ilerleme.

### Görev 7 — PWA
- `vite-plugin-pwa`: manifest, simgeler, iOS meta etiketleri, çevrimdışı önbellek (uygulama, fontlar, pdf.js worker ve varlıkları).
- iPad için "Ana Ekrana Ekle" rehberi.
- Barındırma: kullanıcıya sorulur (GitHub Pages ile aynı depodan ücretsiz; Cloudflare Pages).
