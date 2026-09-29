import { useEffect, useRef, useState, type RefObject } from 'react';
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

/** Metinsiz PDF sayfasını ekrana yaklaşınca çizer, uzaklaşınca bırakır: uzun taranmış kitapta da bellekte birkaç sayfa kalır. */
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
  // url yoksa sayfa çizilemedi
  const [image, setImage] = useState<{ url?: string }>();
  const sharp = useSharpImage(pdf, pageIndex, image?.url ? zoom : 1, width, ref);

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

  const wanted = near || eager;

  useEffect(() => {
    if (!pdf || !wanted) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    const cssWidth = width ?? (ref.current?.clientWidth || 600);
    const px = Math.min(1600, Math.round(cssWidth * Math.min(window.devicePixelRatio || 1, 2)));
    // Sırası gelmeden uzaklaşan sayfa hiç çizilmez
    enqueueRender(() => (cancelled ? Promise.resolve(null) : renderPageToBlob(pdf, pageIndex, px)))
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setImage({ url: objectUrl });
      })
      .catch(() => {
        if (!cancelled) setImage({});
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setImage(undefined); // uzaklaşınca görseli bırak
    };
  }, [pdf, wanted, pageIndex, width]);

  return (
    <div
      ref={ref}
      className={`page-image relative overflow-hidden rounded-sm bg-surface ${fill ? 'size-full' : 'aspect-[2/3] w-full shadow'}`}
    >
      {image?.url ? (
        <>
          <img
            src={image.url}
            alt={`Sayfa ${pageIndex + 1}`}
            className="size-full object-contain"
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
      ) : (
        <div className="grid size-full place-items-center text-sm text-muted">
          {image || failed
            ? `Sayfa ${pageIndex + 1} gösterilemedi.`
            : `Sayfa ${pageIndex + 1} yükleniyor…`}
        </div>
      )}
    </div>
  );
}
