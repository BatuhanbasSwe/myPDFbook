import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

// Legacy build: güncellenmemiş iPad/iPhone Safari sürümlerinde de çalışır.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const assets = `${import.meta.env.BASE_URL}pdfjs/`;

export type PdfDocument = PDFDocumentProxy;

/** Tarayıcıda PDF açar. Not: pdf.js verinin sahipliğini worker'a devreder. */
export async function loadPdf(data: Uint8Array, password?: string): Promise<PdfDocument> {
  const task = pdfjs.getDocument({
    data,
    password,
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
    iccUrl: `${assets}iccs/`,
  });
  try {
    return await task.promise;
  } catch (e) {
    // Açılamazsa (bozuk dosya, yanlış şifre) worker'ı ve devredilen PDF verisini bırak; şifre denemelerinde birikmesin.
    task.destroy().catch(() => undefined);
    throw e;
  }
}
