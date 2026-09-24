import { useEffect, useId, useRef, useState } from 'react';
import type { PdfDocument } from '../pdf/pdfjs';
import { enqueueRender, renderPageToBlob } from '../pdf/renderPage';

interface Props {
  /** null: PDF henüz açılıyor (ya da açılamadı, bkz. failed) */
  pdf: PdfDocument | null;
  failed: boolean;
  pageIndex: number;
  pageCount: number;
  onChange(pageIndex: number): void;
  onClose(): void;
}

/** PDF'in aslını gösterir (dönüştürmede kaybolan tablo/resim için). */
export function OriginalPageDialog({ pdf, failed, pageIndex, pageCount, onChange, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // Hangi sayfanın görseli olduğu da tutulur: sayfa değişince eski (bırakılmış) görsel gösterilmesin. url yoksa çizilemedi.
  const [image, setImage] = useState<{ page: number; url?: string }>();

  useEffect(() => {
    // StrictMode'da efekt iki kez çalışır; açık pencereyi yeniden açmaya çalışma
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    const width = Math.min(1400, Math.round(window.innerWidth * Math.min(window.devicePixelRatio || 1, 2)));
    enqueueRender(() => (cancelled ? Promise.resolve(null) : renderPageToBlob(pdf, pageIndex, width)))
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setImage({ page: pageIndex, url: objectUrl });
      })
      .catch(() => {
        if (!cancelled) setImage({ page: pageIndex });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pdf, pageIndex]);

  const current = image?.page === pageIndex ? image : undefined;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-black/95 p-0 text-white backdrop:bg-black/60"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <span id={titleId} className="text-sm">
            Orijinal sayfa {pageIndex + 1} / {pageCount}
          </span>
          <button type="button" onClick={() => ref.current?.close()} className="rounded-full bg-white/10 px-3 py-1 text-sm">
            Kapat
          </button>
        </div>
        <div className="page-image flex-1 overflow-auto overscroll-contain px-2">
          {current?.url ? (
            <img src={current.url} alt={`Orijinal sayfa ${pageIndex + 1}`} className="mx-auto h-auto max-w-full bg-white" />
          ) : (
            <p className="p-8 text-center">
              {failed ? 'Orijinal PDF açılamadı.' : current ? 'Bu sayfa gösterilemedi.' : 'Yükleniyor…'}
            </p>
          )}
        </div>
        <div className="flex justify-center gap-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <button
            type="button"
            disabled={pageIndex === 0}
            onClick={() => onChange(pageIndex - 1)}
            className="rounded-full bg-white/10 px-4 py-2 disabled:opacity-40"
          >
            ‹ Önceki
          </button>
          <button
            type="button"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => onChange(pageIndex + 1)}
            className="rounded-full bg-white/10 px-4 py-2 disabled:opacity-40"
          >
            Sonraki ›
          </button>
        </div>
      </div>
    </dialog>
  );
}
