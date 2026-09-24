import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { OutlineEntry, PdfSource, RawTextItem } from '../convert/types';

const IMAGE_OPS = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
  OPS.paintImageMaskXObjectRepeat,
  OPS.paintInlineImageXObjectGroup,
  OPS.paintImageMaskXObjectGroup,
]);

interface OutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items?: OutlineNode[];
}

/** pdf.js belgesini dönüştürücünün `PdfSource` arayüzüne uyarlar (Node'da ve tarayıcıda aynı). */
export function createPdfSource(doc: PDFDocumentProxy): PdfSource {
  return {
    numPages: doc.numPages,

    async getPageText(pageIndex) {
      const page = await doc.getPage(pageIndex + 1);
      // Metin koordinatları döndürülmemiş kullanıcı uzayında gelir; sayfa boyutu da aynı uzayda olmalı (/Rotate yok sayılır).
      const { width, height } = page.getViewport({ scale: 1, rotation: 0 });
      const content = await page.getTextContent();
      const items: RawTextItem[] = [];
      for (const it of content.items) {
        if ('str' in it) {
          items.push({
            str: it.str,
            transform: it.transform,
            width: it.width,
            height: it.height,
            fontName: it.fontName,
            hasEOL: it.hasEOL,
          });
        }
      }
      page.cleanup();
      return { width, height, items };
    },

    async hasImages(pageIndex) {
      const page = await doc.getPage(pageIndex + 1);
      const ops = await page.getOperatorList();
      page.cleanup();
      return ops.fnArray.some((fn) => IMAGE_OPS.has(fn));
    },

    async getOutline() {
      const outline = (await doc.getOutline()) as OutlineNode[] | null;
      const out: OutlineEntry[] = [];
      const walk = async (nodes: OutlineNode[], level: number) => {
        for (const node of nodes) {
          const pageIndex = await resolveDest(doc, node.dest);
          if (pageIndex !== null) out.push({ title: node.title.trim(), pageIndex, level });
          if (node.items?.length) await walk(node.items, level + 1);
        }
      };
      if (outline) await walk(outline, 1);
      return out;
    },

    async getMetadata() {
      const { info } = await doc.getMetadata();
      const rec = info as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
      return { title: str(rec.Title), author: str(rec.Author) };
    },
  };
}

async function resolveDest(
  doc: PDFDocumentProxy,
  dest: string | unknown[] | null,
): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0) return null;
    const ref = explicit[0];
    if (typeof ref === 'number') return ref;
    return await doc.getPageIndex(ref as { num: number; gen: number });
  } catch {
    return null;
  }
}
