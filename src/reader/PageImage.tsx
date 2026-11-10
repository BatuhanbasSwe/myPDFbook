import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { pagePixelWidth, pageRenderer } from '../pdf/pageRenderer';
import type { PdfDocument } from '../pdf/pdfjs';
import { enqueueRender, renderPageToBlob } from '../pdf/renderPage';
import { sharpPixelWidth } from './zoom/zoomMath';

/** Keskin çizimin uzun kenar sınırı (px): iPad ve bilgisayarda, telefonda (bellek) */
const SHARP_LONG_SIDE = 4096;
const SHARP_LONG_SIDE_PHONE = 2560;

/**
 * Yakınlaştırılmış sayfanın keskin görüntüsü (`zoom` > 1 iken): sayfa genişlik × yakınlaştırma × piksel oranıyla
 * yeniden çizilir. Yenisi gelene dek öncekisi (ya da asıl görüntü) görünür; yakınlaştırma 1'e dönünce, sayfa
 * değişince ya da kaldırılınca bırakılır. Asıl görüntünün çizimine dokunmaz (yakınlaştırınca sayfa boşalmaz).
 */
function useSharpImage(
  pdf: PdfDocument | null,
  pageIndex: number,
  zoom: number,
  width: number | undefined,
  ref: RefObject<HTMLDivElement | null>,
): string | null {
  const [sharp, setSharp] = useState<string | null>(null);
  const url = useRef<string | null>(null);
  const zoomed = zoom > 1;

  useEffect(() => {
    if (!pdf || !zoomed) return;
    let cancelled = false;
    const el = ref.current;
    const cssWidth = width ?? (el?.clientWidth || 600);
    const cssHeight = el?.clientHeight || cssWidth * 1.5;
    const phone = Math.min(window.screen?.width || 1024, window.screen?.height || 1024) < 600;
    const px = sharpPixelWidth(
      cssWidth,
      cssHeight,
      zoom,
      window.devicePixelRatio || 1,
      phone ? SHARP_LONG_SIDE_PHONE : SHARP_LONG_SIDE,
    );
    enqueueRender(() => (cancelled ? Promise.resolve(null) : renderPageToBlob(pdf, pageIndex, px)))
      .then((blob) => {
        if (cancelled || !blob) return;
        if (url.current) URL.revokeObjectURL(url.current);
        url.current = URL.createObjectURL(blob);
        setSharp(url.current);
      })
      .catch(() => undefined); // keskin çizilemezse asıl görüntü kalır
    return () => {
      cancelled = true;
    };
  }, [pdf, pageIndex, zoom, zoomed, width, ref]);

  // Yakınlaştırma bitince (kilit açıldı, 1×) ve sayfa değişince keskin görüntü bırakılır (bellek)
  useEffect(() => {
    if (!zoomed) return;
    return () => {
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = null;
      setSharp(null);
    };
  }, [zoomed, pdf, pageIndex]);

  return sharp;
}

const noSubscribe = () => () => undefined;
const zero = () => 0;

/**
 * PDF sayfasının görüntüsü. Görüntüler belgenin çizicisinden gelir (pdf/pageRenderer.ts): önceden çizilmişse ilk
 * çizimde görünür. Keskin görüntü yoksa küçük ölçekli önizleme aynı kutuda durur, keskin görüntü yüklenince kalkar
 * (sayfa sıçramaz). İkisi de yoksa boş sayfa; "Sayfa N yükleniyor…" yalnızca ekran okuyucu içindir. Ekrana yaklaşan
 * (ya da `eager`) sayfa çizilmesini ister; uzaklaşınca istek geri alınır, görüntüsü önbellekte kalır (bütçe dolunca
 * okuma yerine en uzak olan çıkar).
 */
export function PageImage({
  pdf,
  failed,
  pageIndex,
  fill = false,
  eager = false,
  width,
  zoom = 1,
}: {
  pdf: PdfDocument | null;
  failed: boolean;
  pageIndex: number;
  /** kitap sayfasını doldurur (sayfalı görünüm); yoksa 2/3 oranlı kutu */
  fill?: boolean;
  /**
   * Ekrana yaklaşmasa da çizilir: kitap görünümünde komşu sayfa kesilen ya da gizli bir kutuda durur, görünürlük
   * gözlemi onu çevrilene dek görmez
   */
  eager?: boolean;
  /** çizim genişliği (CSS px); verilmezse kutunun genişliği (gizli kutuda 0 olur) */
  width?: number;
  /**
   * Sayfa yakınlaştırılmış (kilitli sayfa, zoom/): 1'den büyükse sayfa bu kadar büyük yeniden çizilir, keskin görüntü
   * hazır olunca asıl görüntünün üstüne konur. 1'e dönünce bırakılır.
   */
  zoom?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  // Genişlik verilmediyse kutunun ölçülen genişliği
  const [measured, setMeasured] = useState<number | null>(null);
  const renderer = pdf ? pageRenderer(pdf) : null;
  // Çizici yeni görüntü sakladıkça yeniden bakılır
  useSyncExternalStore(renderer?.subscribe ?? noSubscribe, renderer?.getVersion ?? zero, zero);
  const cssWidth = width ?? measured;
  const px = cssWidth ? pagePixelWidth(cssWidth) : null;
  // Ekranda ya da hemen yanında (kitabın açık sayfasına en çok 2 sayfa): keskin görüntü gösterilir ve istenir.
  // Kitabın önceden kurduğu daha uzak sayfalar yalnızca küçük önizlemeyi gösterir: çözülmüş büyük görüntü bellekte
  // birikmesin (iPad)
  const wanted = near || eager;
  const shown = wanted && renderer && px ? renderer.best(pageIndex, px) : undefined;
  const sharpEntry = shown?.quality === 'sharp' ? shown.entry : undefined;
  const sharpUrl = sharpEntry?.url;
  const pageFailed =
    failed || (wanted && !!renderer && !!px && !shown && renderer.isFailed(pageIndex, px));
  // Keskin görüntü yüklendi mi: yüklenene dek altındaki önizleme görünür
  const [loaded, setLoaded] = useState<string | null>(null);
  // Alttaki önizleme: keskin görüntü yoksa ya da henüz yüklenmediyse
  const underlayEntry =
    sharpUrl && loaded === sharpUrl
      ? undefined
      : shown?.quality === 'preview'
        ? shown.entry
        : renderer?.preview(pageIndex);
  const underlay = underlayEntry?.url;
  const sharp = useSharpImage(pdf, pageIndex, sharpUrl ? zoom : 1, width, ref);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Bir ekran yukarısı ve aşağısı: kaydırırken sayfa hazır olsun
    const observer = new IntersectionObserver(
      ([entry]) => setNear(entry?.isIntersecting ?? false),
      {
        rootMargin: '100% 0px',
      },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Genişlik verilmediyse kutu ölçülür (gizli kutuda 0: varsayılan 600)
  useEffect(() => {
    if (width === undefined && wanted) setMeasured(ref.current?.clientWidth || 600);
  }, [width, wanted]);

  // Gösterilen görüntüler iğnelenir: ekrandayken önbellekten çıkmaz, adresi bırakılmaz (önizleme keskin görüntü
  // yüklenene dek)
  useEffect(() => {
    if (!renderer || !sharpEntry) return;
    renderer.pin(sharpEntry);
    return () => renderer.unpin(sharpEntry);
  }, [renderer, sharpEntry]);
  useEffect(() => {
    if (!renderer || !underlayEntry) return;
    renderer.pin(underlayEntry);
    return () => renderer.unpin(underlayEntry);
  }, [renderer, underlayEntry]);

  // Keskin görüntü yoksa çizilmesi istenir; uzaklaşınca istek geri alınır
  const needed = !!renderer && !!px && wanted && !sharpUrl && !pageFailed;
  useEffect(() => {
    if (!needed || !renderer || !px) return;
    return renderer.request(pageIndex, px);
  }, [needed, renderer, pageIndex, px]);

  const label = `Sayfa ${pageIndex + 1}`;
  return (
    <div
      ref={ref}
      data-state={sharpUrl ? 'sharp' : underlay ? 'preview' : pageFailed ? 'failed' : 'loading'}
      className={`page-image relative overflow-hidden rounded-sm bg-surface ${fill ? 'size-full' : 'aspect-[2/3] w-full shadow'}`}
    >
      {underlay && (
        <div
          aria-hidden="true"
          data-quality="preview"
          className="page-preview absolute inset-0 bg-contain bg-center bg-no-repeat"
          style={{ backgroundImage: `url("${underlay}")` }}
        />
      )}
      {sharpUrl ? (
        <>
          <img
            src={sharpUrl}
            alt={label}
            onLoad={() => setLoaded(sharpUrl)}
            className="relative size-full object-contain"
          />
          {sharp && (
            <img
              src={sharp}
              alt=""
              data-sharp
              className="absolute inset-0 size-full object-contain"
            />
          )}
        </>
      ) : pageFailed ? (
        <div className="grid size-full place-items-center text-sm text-muted">
          {`${label} gösterilemedi.`}
        </div>
      ) : (
        // Yüklenirken boş sayfa (ya da önizleme): yazı yalnızca ekran okuyucu için
        <span className="sr-only">{`${label} yükleniyor…`}</span>
      )}
    </div>
  );
}
