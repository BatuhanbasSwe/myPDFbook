import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { createPdfSource } from '../../src/pdf/pdfSource';

// Elle yazılmış en küçük PDF: 200×400 sayfa, /Rotate 90, (10, 380) noktasında "Merhaba".
const ROTATED_PDF = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 400] /Rotate 90 /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 38 >> stream
BT /F1 12 Tf 10 380 Td (Merhaba) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R >>
%%EOF`;

describe('createPdfSource', () => {
  it('döndürülmüş sayfanın boyutunu metin koordinatlarıyla aynı (döndürülmemiş) uzayda verir', async () => {
    const doc = await getDocument({ data: new TextEncoder().encode(ROTATED_PDF) }).promise;
    try {
      const page = await createPdfSource(doc).getPageText(0);
      expect(page).toMatchObject({ width: 200, height: 400 });
      const item = page.items.find((it) => it.str.includes('Merhaba'));
      expect(item?.transform[5]).toBe(380);
    } finally {
      await doc.loadingTask.destroy();
    }
  });
});
