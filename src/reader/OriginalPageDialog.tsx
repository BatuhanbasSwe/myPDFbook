import { useEffect, useRef, useState } from 'react';
import type { PdfDocument } from '../pdf/pdfjs';
import { renderPageToBlob } from '../pdf/renderPage';

interface Props {
  pdf: PdfDocument;
  pageIndex: number;
  pageCount: number;
  onChange(pageIndex: number): void;
  onClose(): void;
}

/** PDF'in aslını gösterir (dönüştürmede kaybolan tablo/resim için). */
export function OriginalPageDialog({ pdf, pageIndex, pageCount, onChange, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    // StrictMode'da efekt iki kez çalışır; açık pencereyi yeniden açmaya çalışma
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    const width = Math.min(1400, Math.round(window.innerWidth * Math.min(window.devicePixelRatio || 1, 2)));
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
  }, [pdf, pageIndex]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-black/95 p-0 text-white backdrop:bg-black/60"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <span className="text-sm">
            Orijinal sayfa {pageIndex + 1} / {pageCount}
          </span>
          <button type="button" onClick={() => ref.current?.close()} className="rounded-full bg-white/10 px-3 py-1 text-sm">
            Kapat
          </button>
        </div>
        <div className="flex-1 overflow-auto px-2">
          {url ? (
            <img src={url} alt={`Orijinal sayfa ${pageIndex + 1}`} className="mx-auto h-auto max-w-full bg-white" />
          ) : (
            <p className="p-8 text-center">Yükleniyor…</p>
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
