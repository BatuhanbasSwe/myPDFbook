import { useEffect, useState } from 'react';
import { db } from '../db/db';
import { loadPdf, type PdfDocument } from '../pdf/pdfjs';

export interface PdfState {
  doc: PdfDocument | null;
  /** Dosya yok, bozuk ya da şifre değişmiş: orijinal sayfa ve görsel sayfalar gösterilemez. */
  failed: boolean;
}

/**
 * Kitabın saklanan PDF'ini açar; bileşen kapanınca kapatır. bookId null ise (kitap yüklenmedi ya da PDF henüz gerekmiyor) bekler.
 * Kitap değişince çağıran bileşen yeniden kurulmalıdır (ReaderRoute'taki key): belge önceki kitaptan kalmasın.
 */
export function usePdfDocument(bookId: string | null, password?: string): PdfState {
  const [state, setState] = useState<PdfState>({ doc: null, failed: false });
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    let loaded: PdfDocument | null = null;
    void (async () => {
      try {
        const file = await db.files.get(bookId);
        if (cancelled) return;
        if (!file) throw new Error('PDF bulunamadı');
        const pdf = await loadPdf(new Uint8Array(file.data), password);
        if (cancelled) {
          void pdf.loadingTask.destroy().catch(() => undefined);
          return;
        }
        loaded = pdf;
        setState({ doc: pdf, failed: false });
      } catch {
        if (!cancelled) setState({ doc: null, failed: true });
      }
    })();
    return () => {
      cancelled = true;
      void loaded?.loadingTask.destroy().catch(() => undefined);
    };
  }, [bookId, password]);
  return state;
}
