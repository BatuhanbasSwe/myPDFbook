import type { PdfDocument } from './pdfjs';

/** iOS Safari canvas alan sınırı ~16,7 milyon piksel; aşılırsa hata vermeden boş görsel çıkar. */
const MAX_CANVAS_AREA = 16_000_000;

let renderTail: Promise<unknown> = Promise.resolve();
/** Sırada bekleyen (henüz başlamamış) çizim sayısı */
let waiting = 0;

/** Takılan bir çizim (ör. iOS belleği yüzünden ölen worker) sonraki çizimleri sonsuza dek bekletmesin. */
const RENDER_STALL_MS = 20_000;

/**
 * Çizimleri sıraya koyar (aynı anda tek çizim): hızlı kaydırmada onlarca sayfa birlikte çizilip iPad belleğini doldurmasın.
 * İş, sırası geldiğinde artık gerekmiyorsa çizmeden dönmelidir.
 */
export function enqueueRender<T>(job: () => Promise<T>): Promise<T> {
  waiting++;
  const run = renderTail.then(() => {
    waiting--;
    return job();
  });
  // Süre iş başlayınca başlar (sıradaki bekleyişler sayılmaz): yoksa uzun kuyrukta işler birlikte başlar
  renderTail = renderTail
    .then(() => Promise.race([run, new Promise((resolve) => setTimeout(resolve, RENDER_STALL_MS))]))
    .catch(() => undefined);
  return run;
}

/** Sırada başka çizim bekliyor mu: arka planda önceden çizen, sırayı onlara bırakır (bkz. pageRenderer.ts) */
export const renderWaiting = () => waiting > 0;

export interface RenderControl {
  /**
   * pdf.js çizimi parçalar halinde yürütür (her karede ~15 ms); her parçadan önce çağrılır, `next` çağrılınca çizim
   * sürer. Arka plan çizimi sayfa çevrilirken burada bekler.
   */
  onContinue?(next: () => void): void;
  /** iptal edilince çizim bırakılır (söz RenderingCancelledException ile reddeder) */
  signal?: AbortSignal;
}

/** PDF sayfasını verilen piksel genişliğinde JPEG olarak çizer (çok büyük sayfalarda alan sınırına göre küçültür). */
export async function renderPageToBlob(
  doc: PdfDocument,
  pageIndex: number,
  targetWidth: number,
  quality = 0.85,
  control: RenderControl = {},
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
  const { onContinue, signal } = control;
  const task = page.render({ canvas, viewport });
  const cancel = () => task.cancel();
  if (onContinue) task.onContinue = onContinue;
  try {
    // AbortSignal.throwIfAborted eski Safari'de yok
    if (signal?.aborted) cancel();
    signal?.addEventListener('abort', cancel);
    await task.promise;
    if (signal?.aborted) throw new DOMException('Çizim bırakıldı', 'AbortError');
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Sayfa görsele çevrilemedi'))),
        'image/jpeg',
        quality,
      ),
    );
  } finally {
    signal?.removeEventListener('abort', cancel);
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
