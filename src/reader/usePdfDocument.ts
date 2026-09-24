import { useEffect, useState } from 'react';
import { db } from '../db/db';
import { loadPdf, type PdfDocument } from '../pdf/pdfjs';

/** Kitabın saklanan PDF'ini açar; bileşen kapanınca kapatır. bookId null ise (kitap kaydı henüz yüklenmedi) bekler. */
export function usePdfDocument(bookId: string | null, password?: string): PdfDocument | null {
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    let loaded: PdfDocument | null = null;
    void (async () => {
      try {
        const file = await db.files.get(bookId);
        if (!file || cancelled) return;
        const pdf = await loadPdf(new Uint8Array(file.data), password);
        if (cancelled) {
          void pdf.loadingTask.destroy();
          return;
        }
        loaded = pdf;
        setDoc(pdf);
      } catch {
        // dosya bozuk ya da şifre değişmiş: orijinal sayfa ve görsel sayfalar devre dışı kalır
      }
    })();
    return () => {
      cancelled = true;
      void loaded?.loadingTask.destroy();
    };
  }, [bookId, password]);
  return doc;
}
