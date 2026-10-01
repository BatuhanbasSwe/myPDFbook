import type { BookDB } from '../db/db';
import { isPasswordError } from '../import/importBook';

export interface OpenStoredPdfDeps<Doc> {
  db: BookDB;
  /** PDF'i açar (pdf.js veriyi worker'a devreder: her denemede taze okuma verilir) */
  load(data: Uint8Array, password?: string): Promise<Doc>;
  /** Şifre sorar (`title`: kitabın adı); kullanıcı vazgeçerse null */
  askPassword?(retry: boolean, title: string): Promise<string | null>;
  /** Doğru şifre kitaba kaydedildi (dönüştürmesi şifre yüzünden olmadıysa yeniden sıraya girsin) */
  onPasswordSaved?(bookId: string): void;
  /** Okuyucu kapandı: soru sorulmaz, şifre kaydedilmez */
  cancelled(): boolean;
}

/**
 * Kitabın saklanan PDF'ini kayıtlı şifresiyle açar. Şifreli PDF'in şifresi kayıtlı değilse ya da yanlışsa (ör.
 * şifresiz yedekten gelen kitap) şifre sorulur; her cevap PDF açılarak denenir, yanlışsa yeniden sorulur. Yalnızca
 * PDF'i açan şifre kitaba kaydedilir; vazgeçilirse hiçbir şey kaydedilmez ve hata fırlatılır.
 * Okuyucu bu arada kapandıysa null döner.
 */
export async function openStoredPdf<Doc>(
  bookId: string,
  { db, load, askPassword, onPasswordSaved, cancelled }: OpenStoredPdfDeps<Doc>,
): Promise<Doc | null> {
  const book = await db.books.get(bookId);
  if (!book) throw new Error('Kitap bulunamadı');
  let password = book.password;
  for (let attempt = 0; ; attempt++) {
    const file = await db.files.get(bookId);
    if (cancelled()) return null;
    if (!file) throw new Error('PDF bulunamadı');
    let doc: Doc;
    try {
      doc = await load(new Uint8Array(file.data), password);
    } catch (e) {
      if (cancelled()) return null;
      if (!isPasswordError(e) || !askPassword) throw e;
      const answer = await askPassword(attempt > 0 || book.password !== undefined, book.title);
      if (cancelled()) return null;
      if (answer === null) throw e;
      password = answer;
      continue;
    }
    if (password !== book.password) {
      // PDF bu şifreyle açıldı: doğru. Kaydedilemezse belge yine gösterilir (sonraki açılışta yeniden sorulur).
      const saved = await db.books.update(bookId, { password }).catch(() => 0);
      if (saved) onPasswordSaved?.(bookId);
    }
    return doc;
  }
}
