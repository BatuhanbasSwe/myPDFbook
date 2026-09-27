# Plan 4 — Sayfaya not ve fosforlu kalem

> **Ajanlar için:** Görevler alt ajanlarla uygulanır, her görev ayrı bir alt ajanla kod incelemesinden geçer. Adımlar `- [ ]` ile izlenir.

**Kullanıcı isteği (2026-09-27):** "Not bırakma seçeneği getirelim, sayfada istediğimiz yeri fosforlu kalemle boyayabilelim." Asıl cihaz iPad ve Apple Pencil.

**Amaç:** Sayfa görünümünde (PDF sayfaları):
- fosforlu kalemle istenen yer boyanır;
- ince kalemle yazılıp çizilir;
- silgiyle silinir;
- sayfanın istenen yerine not iğnesi bırakılır.

Hepsi kalıcıdır, sayfayla birlikte çevrilir (kıvrılan sayfada da) ve "Notlar" listesinden bulunur.

**Mimari:**
- İşaretler PDF sayfasına göre **0–1 aralığında göreli koordinatla** saklanır. Ekran boyutu, tek/çift sayfa ya da çizim çözünürlüğü değişse de yerinde kalır. Kitap yeniden dönüştürülse de etkilenmez: PDF değişmez.
- **Veri:** Dexie `version(3)`: `annotations: '++id, [bookId+page], bookId, updatedAt'`.
  - Kayıt: `{id, bookId, page, kind: 'highlight' | 'ink' | 'note', color, width, points: number[] (x,y çiftleri, 0–1), text?, createdAt, updatedAt}`.
  - `deleteBook` kitabın işaretlerini de siler; `layouts` tablosunda olduğu gibi `where('bookId')` ile.
- **Çizim:** her `PdfPage`'in üstünde bir SVG katman (`AnnotationLayer`, viewBox 0 0 1 1 ölçekli), o sayfanın işaretlerini çizer.
  - Fosforlu kalem: kalın, yarı saydam, `mix-blend-mode: multiply` (yazı koyu kalır).
  - Kalem: ince ve opak.
  - Not: küçük iğne simgesi.
- **Kalem kipi:** üst çubuktaki "Kalem" düğmesiyle açılır ve bir araç çubuğu çıkar:
  - fosforlu kalem (sarı, yeşil, pembe, mavi), kalem (siyah, kırmızı, mavi), silgi, not, geri al, bitti.
  - Kip açıkken kitaba dokunma ve sürükleme çizime gider; sayfa çevrilmez.
  - Kıvrılan sayfada kütüphanenin fare/dokunma olayları capture aşamasında durdurulur.
  - Sayfa yine alt düğmeler, ok tuşları ve kaydırıcıyla çevrilebilir.
  - **Apple Pencil:** "Kalemle her zaman çiz" ayarı (iPad'de varsayılan açık). `pointerType === 'pen'` ile kip kapalıyken de kalem çizer, parmak sayfa çevirir.
- **Pürüzsüz çizgi:** noktalar `pointermove` + `getCoalescedEvents()` ile toplanır ve basit bir yumuşatma (Catmull-Rom → kübik Bezier) uygulanır. Fosforlu kalemde çizgi yatay tutulursa düzleştirme seçeneği olabilir (sonra).
- **Silgi:** dokunulan noktanın yakınından geçen çizgi ya da not bütün olarak silinir.
- **Notlar paneli:** kitaptaki bütün not ve boyamalar sayfa sırasıyla listelenir (sayfa no, renk, not metninin başı). Dokununca o sayfa açılır. Not düzenlenip silinebilir.

---

### Görev 1 — Veri ve saf mantık
**Dosyalar:** `src/db/db.ts`, `src/db/books.ts`, yeni `src/annotations/store.ts`, `src/annotations/geometry.ts`, testler `tests/annotations/*.test.ts`.

- [x] **Şema:** Dexie `version(3)` ve `annotations` tablosu. v2'den yükseltme testi yazılır.
- [x] **`store.ts`:**
  - `addAnnotation`, `updateAnnotation`, `deleteAnnotation`;
  - `pageAnnotations(bookId, page)` (dexie-react-hooks ile `useLiveQuery` kancası `usePageAnnotations`);
  - `bookAnnotations(bookId)` (sayfa sırasıyla).
- [x] **`geometry.ts`:**
  - `smoothPath(points, …)`: SVG path `d` üretir;
  - `hitTest(annotation, x, y, tolerance)`: silgi için, çizgi parçasına uzaklık;
  - `simplify(points, epsilon)`: Ramer–Douglas–Peucker, kayıt boyutu küçülsün;
  - `toRelative(clientPoint, pageRect)`.
- [x] **Node testleri:**
  - şema yükseltme; ekle/güncelle/sil;
  - sayfa ve kitap sorguları;
  - `deleteBook` işaretleri de siler;
  - `hitTest`, `simplify`, `smoothPath` örnekleri.
- [x] **Commit:** `feat(annotations): not ve boyama verisi`.

### Görev 2 — Çizim katmanı ve kalem kipi (sayfa görünümü)
**Dosyalar:**
- Yeni: `src/annotations/AnnotationLayer.tsx`, `src/annotations/PenToolbar.tsx`, `src/annotations/penPrefs.ts`, `src/annotations/NoteEditor.tsx`.
- Değişecek: `src/reader/pdfBook.tsx` (PdfPage katmanı), `src/reader/BookReader.tsx` (Kalem düğmesi ve kip), `src/reader/CurlEngine.tsx` ve `FlipBook.tsx` (kalem kipinde sayfa çevirme hareketleri kapalı).

- [x] **Katman:** SVG `viewBox="0 0 1 1"`, `preserveAspectRatio="none"`; çizgi kalınlığı sayfa genişliğine göre ölçeklenir (`vector-effect` ya da görece kalınlık).
- [x] **Kalem kipi:**
  - `pointerdown` / `move` / `up` ile çizim; çizilen çizgi anında görünür, bırakınca kaydedilir;
  - geri al (son işaret);
  - silgi;
  - not: dokunulan yere iğne, düzenleyici açılır (metin, kaydet, sil).
- [x] **Kalem ile sayfa çevirme çakışması:** kip açıkken `FlipBook`'a `gesturesDisabled`. CurlEngine'de StPageFlip'in `mousedown`/`touchstart`'ı capture aşamasında durdurulur ya da `useMouseEvents` yerine kip bayrağı kullanılır. Kitap yeniden kurulmamalı: dinleyici host üstünde capture ile.
- [x] **"Kalemle her zaman çiz"** (`penPrefs`, localStorage): kip kapalıyken `pointerType === 'pen'` çizer, parmak çevirir.
- [x] **e2e:**
  - Kalem kipinde fareyle çizilen fosforlu çizgi sayfada görünür (SVG path);
  - yenilemeden sonra da görünür;
  - sayfa çevrilip dönünce yerinde durur;
  - silgiyle silinir;
  - not eklenir, düzenlenir, silinir;
  - kip açıkken dokunma sayfa çevirmez.
- [x] **Doğrulama:** ekran görüntüleri (iPad ve Pixel).
- [x] **Commit:** `feat(annotations): sayfaya fosforlu kalem, kalem ve not`.

### Görev 3 — Notlar paneli
- [ ] Üst çubukta "Notlar" (içindekilerin yanında), panel: sayfa sırasıyla işaretler. Dokununca sayfaya gidilir; not metni düzenlenir.
- [ ] Metin görünümünde notlar paneli yine çalışır: sayfaya gidince sayfa görünümüne geçme önerilir. Metin üstünde boyama sonraki bir iştir (cümle geometrisiyle, Plan 3 Görev 2).
- [ ] e2e ve commit: `feat(annotations): notlar paneli`.
