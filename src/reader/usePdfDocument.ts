import { useEffect, useState } from 'react';
import { db } from '../db/db';
import { appImportDeps } from '../import/deps';
import { requeueAfterPassword } from '../import/importBook';
import { closePdf, loadPdf, type PdfDocument } from '../pdf/pdfjs';
import { requestPassword } from '../ui/passwordRequests';
import { openStoredPdf } from './openStoredPdf';

export interface PdfState {
  doc: PdfDocument | null;
  /** Dosya yok, bozuk ya da şifre girilmedi: orijinal sayfa ve görsel sayfalar gösterilemez. */
  failed: boolean;
}

/**
 * Kitabın saklanan PDF'ini açar; bileşen kapanınca kapatır. bookId null ise (kitap yüklenmedi, okunabilir değil ya da
 * PDF henüz gerekmiyor) bekler. Şifre kitabın kaydından okunur; kayıtlı değilse ya da yanlışsa sorulur (bkz.
 * openStoredPdf). Kitap değişince çağıran bileşen yeniden kurulmalıdır (ReaderRoute'taki key): belge önceki kitaptan
 * kalmasın.
 */
export function usePdfDocument(bookId: string | null): PdfState {
  const [state, setState] = useState<PdfState>({ doc: null, failed: false });
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    let loaded: PdfDocument | null = null;
    // Okuyucu kapanınca açık şifre sorusu da kapanır (kütüphanede sahipsiz pencere kalmasın)
    const asking = new AbortController();
    void (async () => {
      try {
        const pdf = await openStoredPdf(bookId, {
          db,
          load: (data, password) =>
            loadPdf(data, password, {
              fontExtraProperties: true, // cümle vurgusu için glif genişlikleri
            }),
          askPassword: (retry, title) => requestPassword({ retry, title }, asking.signal),
          onPasswordSaved: (id) => void requeueAfterPassword(appImportDeps, id),
          cancelled: () => cancelled,
        });
        if (!pdf) return;
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
      asking.abort();
      if (loaded) void closePdf(loaded);
    };
  }, [bookId]);
  return state;
}
