import { useEffect, useRef, useState } from 'react';
import type { PdfDocument } from '../pdf/pdfjs';
import { enqueueRender, renderPageToBlob } from '../pdf/renderPage';

/** Metinsiz PDF sayfasını ekrana yaklaşınca çizer, uzaklaşınca bırakır: uzun taranmış kitapta da bellekte birkaç sayfa kalır. */
export function PageImage({
  pdf,
  failed,
  pageIndex,
  fill = false,
  eager = false,
  width,
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
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  // url yoksa sayfa çizilemedi
  const [image, setImage] = useState<{ url?: string }>();

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
      className={`page-image overflow-hidden rounded-sm bg-surface ${fill ? 'size-full' : 'aspect-[2/3] w-full shadow'}`}
    >
      {image?.url ? (
        <img src={image.url} alt={`Sayfa ${pageIndex + 1}`} className="size-full object-contain" />
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
