const JUNK_TITLE =
  /^(microsoft word|untitled|adsız|document|belge)(?!\p{L})|\.(docx?|pdf|indd|rtf|odt)$/iu;
const JUNK_AUTHOR = /^(user|admin|administrator|pc|owner|kullanıcı|unknown|bilinmiyor)$/i;
/** Dosya adının sonundaki site etiketi: "(www.kitapindir.com)", "[ornekkitap.com]" */
const SITE_TAG = /\s*[([][^()[\]]*(?:www\.|\.(?:com|net|org|info|tr))[^()[\]]*[)\]]\s*$/i;

/** "Yazar - Kitap Adı.pdf" kalıbını ayırır (yalnızca tam iki parça varsa); yoksa dosya adını başlık yapar. */
export function parseFileName(fileName: string): { title: string; author?: string } {
  const base = fileName
    .replace(/\.pdf$/i, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(SITE_TAG, '')
    .trim();
  const parts = base.split(/\s+[-–—]\s+/);
  if (parts.length === 2 && parts[0] && parts[1]) {
    const first = parts[0].trim();
    const second = parts[1].trim();
    // "1984 - George Orwell": yalnızca sayıdan oluşan parça yazar olamaz
    if (/^\d+$/.test(first)) return { title: first, author: second };
    return { author: first, title: second };
  }
  return { title: base || 'Adsız kitap' };
}

/** PDF metadata'sı anlamlıysa onu, değilse dosya adını kullanır. */
export function chooseTitle(
  meta: { title?: string; author?: string },
  fileName: string,
): { title: string; author: string } {
  const parsed = parseFileName(fileName);
  const metaTitle = meta.title?.trim();
  const metaAuthor = meta.author?.trim();
  const title =
    metaTitle && metaTitle.length > 1 && !JUNK_TITLE.test(metaTitle) ? metaTitle : parsed.title;
  const author = metaAuthor && !JUNK_AUTHOR.test(metaAuthor) ? metaAuthor : (parsed.author ?? '');
  return { title, author };
}
