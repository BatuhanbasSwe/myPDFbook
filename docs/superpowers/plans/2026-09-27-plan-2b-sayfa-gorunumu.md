# Plan 2b — Sayfa görünümü: PDF'in kendi sayfalarını çevirme

> **Ajanlar için:** Görevler alt ajanlarla uygulanır, her görev ayrı bir alt ajanla kod incelemesinden geçer. Adımlar `- [ ]` ile izlenir.

**Kullanıcı isteği (2026-09-27):** "Kitap sayfası çevirir gibi" demek, kitabın **gerçek sayfa görüntüsünün** çevrilmesi demek. Metne dönüştürme; karanlık mod, hızlı okuma, sesli okuma ve kalemle odak gibi yalnızca metinle yapılabilen işler için kullanılır.

**Amaç:** Okuyucuda iki görünüm olur:
- **Sayfa** (varsayılan): PDF sayfaları görüntü olarak, kıvrılan sayfa (ya da slayt / efektsiz) ile çevrilir. Yatay geniş ekranda (iPad yatay) çift sayfa açılır.
- **Metin**: Plan 2'deki yeniden dizilmiş metin; tipografi ayarları, karanlık tema ve Plan 3'ün modları burada çalışır.

Görünüm değişince okunan yer korunur.

**Mimari:**
- Aynı `FlipBook` motorları kullanılır, yalnızca sayfa kaynağı değişir: `count = pdfPageCount` ve `renderPage(i) = <PageImage pageIndex={i} fill eager={komşu}>`.
- Sayfa kutusu PDF sayfasının en-boy oranına göre ekrana sığdırılır (`pdfPageLayout`).
- Konum iki görünüm arasında blokların `srcPage` alanıyla çevrilir:
  - Metin → sayfa: çapanın bloğunun `srcPage`'i.
  - Sayfa → metin: `srcPage`'i o sayfa olan ilk blok (yoksa sonraki ilk blok).
- İlerleme kaydına isteğe bağlı `pdfPage` eklenir; böylece sayfa görünümü, metin bloğu olmayan sayfada da (resim, boş sayfa) tam yerinde açılır. Şema değişmez, alan indeksli değil.

---

### Görev 1 — Sayfa görünümü
**Dosyalar:**
- Yeni: `src/reader/PdfBookView.tsx` (ya da `BookReader` içinde görünüm dalı), `src/layout/pdfPageBox.ts` + `tests/layout/pdfPageBox.test.ts`.
- Değişecek:
  - `src/reader/readerPrefs.ts`: `view: 'page' | 'text'`, varsayılan `'page'`;
  - `src/reader/BookReader.tsx`, `src/reader/ReaderPage.tsx`;
  - `src/db/db.ts`: `ProgressRecord.pdfPage?`;
  - `src/reader/progress.ts`: dönüşüm fonksiyonları ve testleri;
  - `src/reader/SettingsSheet.tsx`, `e2e/reader.spec.ts`.

- [x] **`pdfPageLayout(viewport, aspect, spread: 'auto'|'single')`:** en-boy oranı korunarak kutuya sığan sayfa boyutu. Ekran yatay, genişlik ≥ 900 ve ayar `auto` ise çift sayfa olur (iki sayfa yan yana sığar). Birim testleri yazılır.
- [x] **İlk sayfanın en-boy oranı:** pdf.js `getViewport({scale: 1, rotation: 0})` ile alınır. Belge yüklenene dek bir yer tutucu gösterilir.
- [x] **Konum dönüşümleri** (`progress.ts`): `pdfPageOfLocator(blocks, loc)` ve `locatorOfPdfPage(blocks, page)`. Testlerde metinsiz sayfalar ve son sayfa da yer alır.
- [x] **Sayfa görünümü:**
  - aynı üst ve alt çubuk kullanılır (kaydırıcı PDF sayfa sayısıyla çalışır, durum "Sayfa X / N");
  - aynı dokunma, kaydırma ve tuşlar geçerlidir;
  - içindekiler bölümün `srcPage`'ine gider;
  - "Orijinal sayfa" düğmesi bu görünümde gizlenir (zaten orijinal);
  - açık sayfa ve ±2 komşusu `eager` çizilir, çizim genişliği sayfa kutusunun genişliğidir (DPR ≤ 2).
- [x] **Görünüm değiştirici:** üst çubukta "Sayfa / Metin" düğmesi (etiketli, 44 px) ve ayarlar panelinde aynı seçim. Tipografi ayarları yalnızca metin görünümünde gösterilir; tema ve çevirme efekti her ikisinde de geçerlidir.
- [x] **Konumun kaydı:** sayfa görünümünde çevirince `pdfPage` ile birlikte, sayfaya karşılık gelen locator ve yüzde de kaydedilir. Açılışta görünüm sayfa ise önce `pdfPage`, yoksa locator'dan hesaplanan sayfa kullanılır.
- [x] **Taranmış kitap (hiç metni yok):** metin görünümü de zaten sayfa görüntüleri gösterir; sorunsuz çalışmalı.
- [x] **e2e:**
  - kitap sayfa görünümünde açılır ve `img` sayfa görüntüsü görünür;
  - tuş, dokunma ve kaydırma sayfa çevirir;
  - Metin'e geçince aynı bölgedeki metin görünür, Sayfa'ya dönünce aynı sayfa açılır;
  - yenileyince aynı sayfada açılır.

  Mevcut metin testleri önce Metin görünümüne geçer.
- [x] **Doğrulama:** `tsc -b`, `lint`, `prettier`, `pnpm test`, `pnpm test:browser`, `pnpm e2e` (iki kez); iPad yatay ve Pixel ekran görüntüleriyle göz kontrolü.
- [x] **Commit:** `feat(reader): sayfa görünümü — PDF sayfaları kitap gibi çevrilir`.

### Görev 2 — Birleştirme
- [x] İnceleme düzeltmeleri, ardından `main`'e birleştirme ve `git push`.
