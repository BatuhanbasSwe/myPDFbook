import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { OutlineEntry, PdfSource, RawTextItem } from '../convert/types';
import { glyphAdvances, unicodeToCode, type FontMetrics } from './glyphAdvances';

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

/** İçe aktarma ve dönüştürme için açılmış PDF (tarayıcıda openPdfInBrowser, testlerde Node sürümü). */
export interface OpenedPdf {
  source: PdfSource;
  /** 1. sayfayı kapak olarak çizer (data URL); ortam desteklemiyorsa undefined. */
  renderCover(width: number): Promise<string | undefined>;
  close(): Promise<void>;
}

export interface PdfSourceOptions {
  /**
   * Harf başına ilerlemeler (`RawTextItem.advances`, sayfa geometrisi için): belge `fontExtraProperties` ile
   * açılmış olmalıdır. Sayfanın fontu henüz ana iş parçacığında değilse (sayfa çizilmedi) işlem listesi bir kez
   * istenir; fontlar belge boyunca paylaşılır, bu yalnızca ilk sayfalarda olur.
   */
  glyphAdvances?: boolean;
}

/** Fontun ana iş parçacığına gelmesi en çok bu kadar beklenir (ms) */
const FONT_WAIT_MS = 1_000;

type PdfPage = Awaited<ReturnType<PDFDocumentProxy['getPage']>>;

/** Sayfadaki fontların ölçüleri (yüklenemeyen font yok sayılır) */
async function pageFonts(page: PdfPage, names: string[]): Promise<Map<string, FontMetrics>> {
  const missing = names.filter((n) => !page.commonObjs.has(n));
  if (missing.length) {
    // İşlem listesi fontları ana iş parçacığına gönderir (metin içeriği göndermez)
    await page.getOperatorList().catch(() => undefined);
    await Promise.all(
      missing.map(
        (n) =>
          new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, FONT_WAIT_MS);
            page.commonObjs.get(n, () => {
              clearTimeout(timer);
              resolve();
            });
          }),
      ),
    );
  }
  const fonts = new Map<string, FontMetrics>();
  for (const n of names) {
    if (!page.commonObjs.has(n)) continue;
    const font: unknown = page.commonObjs.get(n);
    if (font && typeof font === 'object') fonts.set(n, font as FontMetrics);
  }
  return fonts;
}

/** pdf.js belgesini dönüştürücünün `PdfSource` arayüzüne uyarlar (Node'da ve tarayıcıda aynı). */
export function createPdfSource(doc: PDFDocumentProxy, options: PdfSourceOptions = {}): PdfSource {
  /** font adı → Unicode → karakter kodu (null: kullanılamaz) */
  const codeMaps = new Map<string, Map<string, number> | null>();

  return {
    numPages: doc.numPages,

    async getPageText(pageIndex) {
      const page = await doc.getPage(pageIndex + 1);
      // Metin koordinatları döndürülmemiş kullanıcı uzayında gelir; sayfa boyutu da aynı uzayda olmalı (/Rotate yok sayılır).
      const { width, height } = page.getViewport({ scale: 1, rotation: 0 });
      const [x0 = 0, y0 = 0] = page.view;
      const content = await page.getTextContent();
      const items: RawTextItem[] = [];
      for (const it of content.items) {
        if ('str' in it) {
          const style = content.styles[it.fontName] as
            { ascent?: number; descent?: number } | undefined;
          items.push({
            str: it.str,
            transform: it.transform,
            width: it.width,
            height: it.height,
            fontName: it.fontName,
            hasEOL: it.hasEOL,
            ascent: style?.ascent || undefined,
            descent: style?.descent || undefined,
          });
        }
      }
      if (options.glyphAdvances) {
        const names = [...new Set(items.map((it) => it.fontName ?? ''))].filter(Boolean);
        const fonts = await pageFonts(page, names).catch(() => new Map<string, FontMetrics>());
        for (const it of items) {
          const font = it.fontName ? fonts.get(it.fontName) : undefined;
          if (!font || !it.fontName) continue;
          let codes = codeMaps.get(it.fontName);
          if (codes === undefined) codeMaps.set(it.fontName, (codes = unicodeToCode(font)));
          if (!codes) continue;
          const [a = 0, b = 0] = it.transform;
          it.advances = glyphAdvances(it.str, it.width, Math.hypot(a, b), font, codes);
        }
      }
      page.cleanup();
      return { width, height, origin: [x0, y0], items };
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
