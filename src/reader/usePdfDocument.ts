import { useEffect, useState } from 'react';
import { db } from '../db/db';
import { closePdf, loadPdf, type PdfDocument } from '../pdf/pdfjs';

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
          void closePdf(pdf);
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
      if (loaded) void closePdf(loaded);
    };
  }, [bookId, password]);
  return state;
}
