import type { PdfDocument } from './pdfjs';

/** iOS Safari canvas alan sınırı ~16,7 milyon piksel; aşılırsa hata vermeden boş görsel çıkar. */
const MAX_CANVAS_AREA = 16_000_000;

let renderTail: Promise<unknown> = Promise.resolve();

/** Takılan bir çizim (ör. iOS belleği yüzünden ölen worker) sonraki çizimleri sonsuza dek bekletmesin. */
const RENDER_STALL_MS = 20_000;

/**
 * Çizimleri sıraya koyar (aynı anda tek çizim): hızlı kaydırmada onlarca sayfa birlikte çizilip iPad belleğini doldurmasın.
 * İş, sırası geldiğinde artık gerekmiyorsa çizmeden dönmelidir.
 */
export function enqueueRender<T>(job: () => Promise<T>): Promise<T> {
  const run = renderTail.then(job);
  const stall = new Promise((resolve) => setTimeout(resolve, RENDER_STALL_MS));
  renderTail = Promise.race([run, stall]).catch(() => undefined);
  return run;
}

/** PDF sayfasını verilen piksel genişliğinde JPEG olarak çizer (çok büyük sayfalarda alan sınırına göre küçültür). */
export async function renderPageToBlob(
  doc: PdfDocument,
  pageIndex: number,
  targetWidth: number,
  quality = 0.85,
): Promise<Blob> {
  const page = await doc.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  let scale = targetWidth / base.width;
  const area = base.width * base.height * scale * scale;
  if (area > MAX_CANVAS_AREA) scale *= Math.sqrt(MAX_CANVAS_AREA / area);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  try {
    await page.render({ canvas, viewport }).promise;
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Sayfa görsele çevrilemedi'))),
        'image/jpeg',
        quality,
      ),
    );
  } finally {
    page.cleanup();
    // iOS Safari'de canvas belleğini hata olsa da hemen bırak
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
