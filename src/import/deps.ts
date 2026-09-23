import { db } from '../db/db';
import { openPdfInBrowser } from '../pdf/openPdf';
import type { ImportDeps } from './importBook';

export const appImportDeps: ImportDeps = {
  db,
  openPdf: openPdfInBrowser,
  askPassword: async (retry) =>
    window.prompt(retry ? 'Şifre yanlış. Tekrar dener misin?' : 'Bu PDF şifreli. Şifresini gir:'),
};
