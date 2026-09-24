import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

// Legacy build: güncellenmemiş iPad/iPhone Safari sürümlerinde de çalışır.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const assets = `${import.meta.env.BASE_URL}pdfjs/`;

export type PdfDocument = PDFDocumentProxy;

/** Kapanışta worker'ın yanıtı en fazla bu kadar beklenir; sonra worker zorla sonlandırılır. */
const CLOSE_TIMEOUT_MS = 3_000;

const workers = new WeakMap<PdfDocument, pdfjs.PDFWorker>();

/**
 * Tarayıcıda PDF açar. Not: pdf.js verinin sahipliğini worker'a devreder. Belge `closePdf` ile kapatılmalıdır.
 * Her belgenin kendi worker'ı vardır: `loadingTask.destroy()` worker'ın yanıtını bekler, yanıt vermeyen (ölmüş, takılmış)
 * worker ancak doğrudan sonlandırılabilir.
 */
export async function loadPdf(data: Uint8Array, password?: string): Promise<PdfDocument> {
  const worker = new pdfjs.PDFWorker();
  const task = pdfjs.getDocument({
    data,
    password,
    worker,
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
    iccUrl: `${assets}iccs/`,
  });
  try {
    const doc = await task.promise;
    workers.set(doc, worker);
    return doc;
  } catch (e) {
    // Açılamazsa (bozuk dosya, yanlış şifre) worker'ı ve devredilen PDF verisini bırak; şifre denemelerinde birikmesin.
    void terminate(task, worker);
    throw e;
  }
}

/** Belgeyi kapatır ve worker'ını sonlandırır; worker yanıt vermese de en geç CLOSE_TIMEOUT_MS sonra biter. Hiçbir zaman reddetmez. */
export function closePdf(doc: PdfDocument): Promise<void> {
  return terminate(doc.loadingTask, workers.get(doc));
}

async function terminate(
  task: ReturnType<typeof pdfjs.getDocument>,
  worker?: pdfjs.PDFWorker,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, CLOSE_TIMEOUT_MS)));
  await Promise.race([task.destroy().catch(() => undefined), timeout]);
  clearTimeout(timer);
  worker?.destroy();
}
