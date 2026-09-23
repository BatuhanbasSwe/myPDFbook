const JUNK_TITLE = /^(microsoft word|untitled|adsız|document|belge)(?!\p{L})|\.(docx?|pdf|indd|rtf|odt)$/iu;
const JUNK_AUTHOR = /^(user|admin|administrator|pc|owner|kullanıcı|unknown|bilinmiyor)$/i;

/** "Yazar - Kitap Adı.pdf" kalıbını ayırır; yoksa dosya adını başlık yapar. */
export function parseFileName(fileName: string): { title: string; author?: string } {
  const base = fileName.replace(/\.pdf$/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(base);
  if (m?.[1] && m[2]) return { author: m[1].trim(), title: m[2].trim() };
  return { title: base || 'Adsız kitap' };
}

/** PDF metadata'sı anlamlıysa onu, değilse dosya adını kullanır. */
export function chooseTitle(meta: { title?: string; author?: string }, fileName: string): { title: string; author: string } {
  const parsed = parseFileName(fileName);
  const metaTitle = meta.title?.trim();
  const metaAuthor = meta.author?.trim();
  const title = metaTitle && metaTitle.length > 1 && !JUNK_TITLE.test(metaTitle) ? metaTitle : parsed.title;
  const author = metaAuthor && !JUNK_AUTHOR.test(metaAuthor) ? metaAuthor : (parsed.author ?? '');
  return { title, author };
}
