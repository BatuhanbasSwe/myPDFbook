import { db } from '../db/db';
import { openPdfInBrowser } from '../pdf/openPdf';
import { requestPassword } from '../ui/passwordRequests';
import type { ImportDeps } from './importBook';

export const appImportDeps: ImportDeps = {
  db,
  openPdf: openPdfInBrowser,
  // Uygulama içi pencere (window.prompt ana ekrana eklenmiş iOS uygulamasında çalışmayabilir)
  askPassword: (retry, title) => requestPassword({ retry, title }),
};
