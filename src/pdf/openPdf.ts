import type { OpenedPdf } from '../import/importBook';
import { createPdfSource } from './pdfSource';
import { loadPdf } from './pdfjs';
import { blobToDataUrl, renderPageToBlob } from './renderPage';

export async function openPdfInBrowser(bytes: Uint8Array, password?: string): Promise<OpenedPdf> {
  const doc = await loadPdf(bytes, password);
  return {
    source: createPdfSource(doc),
    renderCover: async (width) => blobToDataUrl(await renderPageToBlob(doc, 0, width, 0.8)),
    close: () => doc.loadingTask.destroy(),
  };
}
