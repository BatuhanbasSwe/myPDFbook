import { createContext, useContext, useEffect, useLayoutEffect, useRef } from 'react';
import { AnnotatorContext } from '../annotations/annotator';
import type { Locator } from '../convert/types';

/** Sayfaların köşelerinin okuyucudan aldığı: yer imli PDF sayfaları, ipucu ve açıp kapama */
export interface BookmarkCorners {
  /** yer imli PDF sayfaları (0'dan) */
  marked: ReadonlySet<number>;
  /** menü açık: yer imi olmayan köşe de hafifçe görünür */
  hint: boolean;
  /** kalem kipi: köşe dokunmayı almaz (köşede de çizilir, not konur); yer imi B tuşu ve listeyle */
  passive: boolean;
  toggle(pdfPage: number, locator?: Locator): void;
}

export const BookmarkContext = createContext<BookmarkCorners | null>(null);

/** Köşenin (kıvrılan üçgenin) sayfa genişliğine oranı ve sınırları (px) */
const EAR_RATIO = 0.05;
const EAR_MIN = 20;
const EAR_MAX = 32;

/** Köşenin dokunma alanı (px): kıvrık üçgenden büyük, sayfanın köşesine oturur */
const TOUCH = 44;

/** Dokunmatik ekran (fare yok): gizli köşe dokunmayı almaz (book.css → .dog-ear) */
const NO_HOVER = '(hover: none)';

/** Apple Pencil'in dokunuşu (Safari'de dokunma olayının touchType'ı) */
function isStylus(e: Event): boolean {
  return (
    typeof TouchEvent !== 'undefined' &&
    e instanceof TouchEvent &&
    Array.from(e.changedTouches).some(
      (t) => (t as Touch & { touchType?: string }).touchType === 'stylus',
    )
  );
}

/**
 * Kıvrılmış sayfa köşesi (yer imi): sayfanın dış üst köşesinde (tek sayfada ve sağ sayfada sağda, çift sayfanın sol
 * sayfasında solda). Yer imi varken köşe kâğıt renginde kıvrık bir üçgendir; yokken yalnızca menü açıkken ya da
 * fare üstündeyken hafifçe belirir. Dokununca yer imi eklenir ya da kalkar (kısa bir kıvrılma). Köşeye dokunma sayfa
 * çevirmez, menüyü açmaz: basış kitaba ve kıvrılan sayfa kütüphanesine ulaşmaz (not iğnesi gibi).
 *
 * Görünmeyen köşe dokunmayı almaz: dokunmatik ekranda yer imi olmayan köşe menü kapalıyken yoktur (sağ üstteki
 * dokunuş sayfayı çevirir, gizlice yer imi koymaz); yer imi başlıktaki "Yer imi" düğmesiyle, görünen köşeyle ya da B
 * tuşuyla konur. Kalem kipinde köşe dokunmayı almaz (çizim sayfanın her yerinde); "Kalemle her zaman çiz" açıkken
 * Apple Pencil köşeden geçer: köşe işaret katmanının içindedir (pdfBook), çizim köşeden de başlar. Not iğneleri
 * köşenin üstündedir.
 */
export function BookmarkCorner({
  pdfPage,
  locator,
  side,
  pageWidth,
}: {
  /** köşenin bağlı olduğu PDF sayfası (0'dan) */
  pdfPage: number;
  /** metin görünümünde sayfanın metindeki başı */
  locator?: Locator;
  side: 'left' | 'right' | 'single';
  pageWidth: number;
}) {
  const ctx = useContext(BookmarkContext);
  // Sayfa görünümünde işaretler açık: "Kalemle her zaman çiz" ile kalem köşeden geçip çizer
  const annotator = useContext(AnnotatorContext);
  const ref = useRef<HTMLButtonElement>(null);
  const shown = ctx !== null;
  const marked = ctx?.marked.has(pdfPage) ?? false;
  const hint = ctx?.hint ?? false;
  const penThrough = !!annotator?.penAlways;
  // Dinleyiciler bir kez kurulur; en güncel durumu buradan okur
  const latest = useRef({ marked, hint, penThrough });
  useLayoutEffect(() => {
    latest.current = { marked, hint, penThrough };
  });
  // Son basış kalemin geçişiydi: ardından gelen tıklama yer imini değiştirmez
  const penPassed = useRef(false);

  // Basış kitaba gitmesin: sayfa çevirme (dokunma bölgeleri, kaydırma) ve kıvrılan sayfanın köşeden çekmesi
  // başlamaz. Kütüphane kendi öğesinde dinlediği için React'ten önce, köşenin kendisinde durdurulur.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: Event) => {
      const now = latest.current;
      const pen = (e instanceof PointerEvent && e.pointerType === 'pen') || isStylus(e);
      if (e.type === 'pointerdown') penPassed.current = pen && now.penThrough;
      // Kalem işaret katmanına geçer (çizer); görünmeyen köşe dokunmatik ekranda yok sayılır
      if (pen && now.penThrough) return;
      if (!now.marked && !now.hint && matchMedia(NO_HOVER).matches) return;
      e.stopPropagation();
    };
    const events = ['pointerdown', 'mousedown', 'touchstart'] as const;
    for (const type of events) el.addEventListener(type, stop);
    return () => {
      for (const type of events) el.removeEventListener(type, stop);
    };
  }, [shown]);

  if (!ctx) return null;
  const ear = Math.round(Math.min(EAR_MAX, Math.max(EAR_MIN, pageWidth * EAR_RATIO)));
  return (
    <button
      ref={ref}
      type="button"
      data-testid="bookmark-corner"
      data-bookmark-page={pdfPage + 1}
      data-marked={marked || undefined}
      data-hint={ctx.hint || undefined}
      data-passive={ctx.passive || undefined}
      tabIndex={ctx.passive ? -1 : undefined}
      aria-pressed={marked}
      aria-label="Yer imi"
      className={`dog-ear ${side === 'left' ? 'dog-ear-left' : 'dog-ear-right'}`}
      style={{ width: TOUCH, height: TOUCH, ['--ear' as string]: `${ear}px` }}
      onClick={(e) => {
        // Kalemin çizdiği basışın tıklaması (klavyeyle basış detail 0: her zaman çalışır)
        if (penPassed.current && e.detail > 0) {
          penPassed.current = false;
          return;
        }
        ctx.toggle(pdfPage, locator);
      }}
    >
      <span className="dog-ear-fold" aria-hidden="true">
        <span className="dog-ear-under" />
        <span className="dog-ear-flap" />
      </span>
    </button>
  );
}
