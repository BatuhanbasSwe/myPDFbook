import { useEffect, useRef, useState } from 'react';
import type { PdfDocument } from '../pdf/pdfjs';
import { renderPageToBlob } from '../pdf/renderPage';

/** Metinsiz PDF sayfasını görünür olunca çizer. */
export function PageImage({ pdf, pageIndex }: { pdf: PdfDocument | null; pageIndex: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '600px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !visible) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    const width = Math.min(1600, Math.round((ref.current?.clientWidth ?? 600) * Math.min(window.devicePixelRatio || 1, 2)));
    renderPageToBlob(pdf, pageIndex, width)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pdf, visible, pageIndex]);

  return (
    <div ref={ref} className="page-image aspect-[2/3] w-full overflow-hidden rounded-sm bg-surface shadow">
      {url ? (
        <img src={url} alt={`Sayfa ${pageIndex + 1}`} className="size-full object-contain" />
      ) : (
        <div className="grid size-full place-items-center text-sm text-muted">Sayfa {pageIndex + 1} yükleniyor…</div>
      )}
    </div>
  );
}
