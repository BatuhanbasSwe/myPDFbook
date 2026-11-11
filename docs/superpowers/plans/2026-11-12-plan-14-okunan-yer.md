# Plan 14 — Okunan yeri kaçırma: kelime takibi, belirgin vurgu, "Okunan yere dön"

> **Ajanlar için:** Görevler TDD ile, görev görev uygulanır. Adımlar `- [x]` ile izlenir. Çalışma ağacı `.worktrees/takip`, dal `plan-14-okunan-yer` (main 0c04234'ten). main'e birleştirme ve push kullanıcının.

**Kullanıcı isteği (2026-11-12):** sesli okumada dinleyen "okuduğu yeri kaçırıyorsun" diyor: ses nerede, gözle izlemek zor.

**Kısıtlar:**
- Sayfa görünümünün görünüşü (PDF sayfa görüntüsü, kâğıt, çevirme) değişmez; yalnızca üstüne katman ve vurgu. Koyu temalarda çevre koyu kalır.
- Asıl cihaz eski WebKit'li iPad (iPadOS ≤ 18): iOS 18'den yeni API yok. `requestIdleCallback` yok; CSS Custom Highlight API (17.2+) yoksa yedek kutular.
- Kelime takibi saatle değil sesin kendi saatiyle (Piper: AudioContext `currentTime`) ilerler: duraklatma ve hız değişince kayma olmaz. Okuyucu her kelimede yeniden çizilmez (BookReader büyük): kelime vurgusu kendi küçük katmanında, React dışı bir depodan.
- Hızlı okuma ve kalemle odak aynı cümle oynatıcısını kullanır: yeni davranışlar (kelime, kenar çizgisi, nabız, "Okunan yere dön") yalnızca sesli okumada açılır. Daha belirgin cümle rengi her modda.

---

### Görev 1 — Kelime zamanlaması (saf, birim testli)
- [ ] Test (önce kırmızı) `tests/reader/wordTiming.test.ts`: kelimelere bölme (boşlukla), ağırlık = harf sayısı + 1, noktalama duraklaması (virgül, noktalı virgül, iki nokta < nokta, ünlem, soru, üç nokta); zamanın payından kelime (ağırlıklı, sınırlar 0 ve 1); `charIndex` → kelime (kelime arasındaki boşluk sonraki kelimeye; metnin sonu son kelimeye); süre tahmini hızla ölçeklenir.
- [ ] `src/reader/modes/wordTiming.ts`: `speechWords`, `wordWeights`, `wordAtFraction`, `wordAtChar`, `estimateSeconds`, `trimWord` (kelimenin baş ve sonundaki noktalama vurgulanmaz).
- [ ] `speakable` eşlemesi: `speakableMap(text)` → okunan metin ve her harfin cümle metnindeki yeri (dipnot imleri, görünmez karakterler, baştaki boşluk atlanınca da kelime doğru yere düşer). `speakable` bunu kullanır. Test.

### Görev 2 — Motorlardan kelime bilgisi; denetleyicinin `progress()`'i
- [ ] `SpeakHandlers`'a isteğe bağlı `boundary(charIndex)` (Web Speech `onboundary`, `name === 'word'` ya da adsız) ve `timing(duration, elapsed)` (Piper: sesin süresi ve AudioContext saatinden çalınan kısım).
- [ ] `webSpeech.ts`: `u.onboundary`. Test (`webSpeech.test.ts`): kelime sınırı bildirilir, cümle sınırı bildirilmez.
- [ ] `audio.ts` `play(clip, onStart(elapsed), onEnd)`: `elapsed` = `ctx.currentTime - başlangıç` (bağlam askıdaysa saat durur); `currentTime` yoksa `performance.now`. `piperEngine.ts` başlarken `timing(süre, elapsed)`. Test (`piperEngine.test.ts`).
- [ ] `readAloud.ts` `progress(): { index, offset } | null` (okunan metindeki konum): kelime sınırı geldiyse o; Piper'da sesin saatinden süre payı → ağırlıklı kelime; ikisi de yoksa tahmini süre (cümle bittikçe ölçülen hızla düzelir). Duraklatınca son kelimede durur; önceki/sonraki cümlede ilk kelime. Parçaların cümledeki yeri. Test (sahte saat).
- [ ] Commit.

### Görev 3 — Kelime vurgusu (iki görünüm) ve "Kelimeyi takip et"
- [ ] `wordStore` (useSyncExternalStore): okunan kelime (blok aralığı). `useWordTracker`: okurken her karede `progress()` okunur, kelime değişince depo güncellenir; metin görünümünde `::highlight(mypdfbook-word)` (API yoksa yedek kutular) doğrudan çizilir.
- [ ] Sayfa görünümü: `wordPageRange(part, text, start, end)` (saf, birim testli): kelimenin cümle metnindeki aralığı → sayfa harf haritasındaki aralık (`whole`, `head`, `tail` parçaları; parçada değilse null). `WordOverlay` cümlenin katmanının yanında, yalnızca kendisi yeniden çizilir (`charRects`).
- [ ] Tercih `followWord` (varsayılan açık), ses menüsünde "Okurken" bölümünde "Kelimeyi takip et".
- [ ] Commit.

### Görev 4 — Belirgin cümle vurgusu: renk ve kenar çizgisi
- [ ] Renk: açık, sepya, koyu, OLED'de biraz daha dolgun (göz yormaz). Kelime: aynı tonun koyusu.
- [ ] Kenar çizgisi: cümlenin ilk satırının solunda, kenar boşluğunda dikey çizgi (vurgu rengi). Sayfa görünümünde `TextMatch.lineLeft` (satırın ilk harfinin x'i) ile SVG'de; metin görünümünde sayfanın içinde, yazının arkasındaki katmanda (`.sentence-decor`). Yalnızca sesli okumada.
- [ ] Commit.

### Görev 5 — "Okunan yere dön" ve geri çekmeme
- [ ] `useSentencePlayer`: `away` (okunan cümle açık sayfada değil, okur kendisi gitti) ve `returnToReading()` (izlemeyi açar, okunan cümlenin sayfasına geçer). Okur kendisi dönerse (sayfa çevirince cümle açık sayfada) `away` söner, izleme sürer.
- [ ] Çubuğun üstünde yüzen hap "Okunan yere dön" (yerleşime girmez, yalnızca hap dokunulur).
- [ ] Commit.

### Görev 6 — Sayfa çevrilince nabız
- [ ] Okuma sayfayı çevirince (ya da "Okunan yere dön") yeni sayfadaki cümlenin vurgusu ~600 ms parlar (`.sentence-pulse`, çevirme bitince başlar). `prefers-reduced-motion`: yok.
- [ ] Commit.

### Görev 7 — "Diğer yazıları soldur"
- [ ] Tercih `dimOthers` (varsayılan kapalı): sesli okumada odak karartması (hızlı okumanın odağıyla aynı stiller: `.sentence-focus`, `.sentence-dim`).
- [ ] Commit.

### Görev 8 — e2e ve doğrulama
- [ ] `e2e/read-aloud-follow.spec.ts`: kelime vurgusu (sistem sesi: kelime sınırıyla ve tahminle; metin ve sayfa görünümü; Piper: sesin saatiyle ilerler), ayar kapalıyken kelime yok; "Okunan yere dön" görünür, dokununca okunan sayfa; göz atarken okuma geri çekmez, okur dönünce hap söner; soldurma ayarı; nabız.
- [ ] typecheck, lint, birim testleri, e2e (3 proje ayrı ayrı), kod incelemesi.

---

## Kararlar

### Kelime nereden?
| Motor | Kaynak | Not |
| --- | --- | --- |
| Sistem sesi, `boundary` geliyor (iOS, macOS, Chrome yerel sesleri) | `charIndex` → konuşmadaki kelime | En doğrusu. |
| Sistem sesi, `boundary` yok (Chrome ağ sesleri, bazı Android) | tahmini süre: ağırlık / (harf/sn × hız); cümle bitince gerçek süreden harf/sn düzeltilir | İlk cümlede kaba, sonra oturur. Kelime sınırı ilk kez gelince o konuşmada tahmin bırakılır. |
| Piper | `elapsed / süre` → ağırlıklı kelime | Ses saati (AudioContext) duraklayınca durur. Duraklatma ve hız değişince cümle baştan sentezlenip çalınır: saat de baştan. |

**Ağırlık:** kelime = harf/rakam sayısı + 1 (kısa kelimeler de zaman alır); ardından gelen virgül/noktalı virgül/iki nokta/tire +3, nokta/ünlem/soru/üç nokta +6 (duraklama kelimeden sonra: kelime o sırada vurgulu kalır).

### Neden kelime vurgusu React dışında?
BookReader binlerce satırlık bir ağaç; kelime saniyede 3–5 kez değişir. Denetleyicinin `onChange`'i gibi okuyucu durumuna yazılsa her kelimede okuyucu yeniden çizilirdi (iPad'de takılma). Bunun yerine kelime küçük bir depoda; metin görünümünde Highlight API'sine doğrudan yazılır, sayfa görünümünde yalnızca `WordOverlay` yeniden çizilir.

### "Okunan yere dön"
- Okur sayfayı kendisi çevirince (dokunma, tuş, kaydırıcı, içindekiler) okuma onu geri çekmez (Plan 6'dan beri); bu planla hap görünür.
- Hap: okunan cümle açık sayfada değilken (oynarken ya da duraklatılmışken). Dokununca okunan cümlenin sayfası açılır, izleme sürer, cümle parlar.
- Okur kendisi dönerse (okunan sayfayı açarsa) hap söner, izleme sürer. Okuma okurun göz attığı sayfaya kendisi gelirse de.
- Önceki/sonraki cümle düğmeleri ve dokunulan cümleden okuma izlemeyi yeniden açar (eskisi gibi).
