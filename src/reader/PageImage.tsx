import { useEffect, useRef, useState } from 'react';
import type { PdfDocument } from '../pdf/pdfjs';
import { enqueueRender, renderPageToBlob } from '../pdf/renderPage';

/** Metinsiz PDF sayfasını ekrana yaklaşınca çizer, uzaklaşınca bırakır: uzun taranmış kitapta da bellekte birkaç sayfa kalır. */
export function PageImage({ pdf, pageIndex }: { pdf: PdfDocument | null; pageIndex: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  // url yoksa sayfa çizilemedi
  const [image, setImage] = useState<{ url?: string }>();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Bir ekran yukarısı ve aşağısı: kaydırırken sayfa hazır olsun
    const observer = new IntersectionObserver(([entry]) => setNear(entry?.isIntersecting ?? false), {
      rootMargin: '100% 0px',
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !near) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    const width = Math.min(1600, Math.round((ref.current?.clientWidth ?? 600) * Math.min(window.devicePixelRatio || 1, 2)));
    // Sırası gelmeden uzaklaşan sayfa hiç çizilmez
    enqueueRender(() => (cancelled ? Promise.resolve(null) : renderPageToBlob(pdf, pageIndex, width)))
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
  }, [pdf, near, pageIndex]);

  return (
    <div ref={ref} className="page-image aspect-[2/3] w-full overflow-hidden rounded-sm bg-surface shadow">
      {image?.url ? (
        <img src={image.url} alt={`Sayfa ${pageIndex + 1}`} className="size-full object-contain" />
      ) : (
        <div className="grid size-full place-items-center text-sm text-muted">
          {image ? `Sayfa ${pageIndex + 1} gösterilemedi.` : `Sayfa ${pageIndex + 1} yükleniyor…`}
        </div>
      )}
    </div>
  );
}
