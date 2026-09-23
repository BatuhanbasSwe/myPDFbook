import type { PdfDocument } from './pdfjs';

/** PDF sayfasını verilen piksel genişliğinde JPEG olarak çizer. */
export async function renderPageToBlob(doc: PdfDocument, pageIndex: number, targetWidth: number, quality = 0.85): Promise<Blob> {
  const page = await doc.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: targetWidth / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Sayfa görsele çevrilemedi'))), 'image/jpeg', quality),
  );
  // iOS Safari'de canvas belleğini hemen bırak
  canvas.width = 0;
  canvas.height = 0;
  return blob;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
