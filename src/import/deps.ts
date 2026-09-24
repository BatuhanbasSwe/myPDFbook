import { db } from '../db/db';
import { openPdfInBrowser } from '../pdf/openPdf';
import type { ImportDeps } from './importBook';

export const appImportDeps: ImportDeps = {
  db,
  openPdf: openPdfInBrowser,
  // Not (Plan 3): window.prompt ana ekrana eklenmiş iOS uygulamasında çalışmaz; uygulama içi şifre penceresiyle değiştirilecek.
  askPassword: async (retry) =>
    window.prompt(retry ? 'Şifre yanlış. Tekrar dener misin?' : 'Bu PDF şifreli. Şifresini gir:'),
};
