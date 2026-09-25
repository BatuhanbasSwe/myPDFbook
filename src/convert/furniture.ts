import type { PageLines } from './types';

// Sayfa numarası: 1–4 haneli sayı ya da ön sayfalardaki küçük Roma rakamı (i–xxxix).
// Roma rakamı i/v/x ile sınırlı: sayfa sonunda tek kalan "mi.", "dil" gibi kelimeler sayfa numarası sanılmasın.
const PAGE_NUMBER = /^[\s\-–—.([]*(\d{1,4}|(?=[ivx])x{0,3}(?:ix|iv|v?i{0,3}))[\s\-–—.)\]]*$/i;
const PAGE_LABEL = /^(sayfa|page|s\.)\s*\d{1,4}$/i;
// Dipnota benzeyen satır: işaretle başlar, metinle sürer, cümle gibi biter ("¹ A.g.e., s. 45.").
// Bunlar sayfalar arasında (rakamlar dışında) aynı olsa da tekrar kuralıyla silinmez.
const NOTE_LIKE = /^(?:[¹²³⁰⁴-⁹]+|\d{1,3}|[*†‡]+)\s*\p{L}.*[.!?…)"”»]$/u;
const TOP_ZONE = 0.12;
const BOTTOM_ZONE = 0.1;

/** Kitabın gövde puntosu: en çok karakterin yazıldığı punto (0,5 pt hassasiyetle). */
export function bodyFontSize(pages: PageLines[]): number {
  const chars = new Map<number, number>();
  for (const p of pages) {
    for (const l of p.lines) {
      const key = Math.round(l.size * 2) / 2;
      chars.set(key, (chars.get(key) ?? 0) + l.text.length);
    }
  }
  let best = 10;
  let bestCount = -1;
  for (const [size, count] of chars) {
    if (count > bestCount) {
      best = size;
      bestCount = count;
    }
  }
  return best;
}

function furnitureKey(text: string, isTop: boolean): string {
  const norm = text
    .toLocaleLowerCase('tr')
    .replace(/\d+/g, '#')
    .replace(/[^\p{L}#]+/gu, ' ')
    .trim();
  return `${isTop ? 'T' : 'B'}:${norm}`;
}

/** Sayfa numaralarını, 3+ sayfada tekrar eden üst/alt bilgileri (filigran dahil) ve küçük puntolu sayfa başlıklarını çıkarır. */
export function stripPageFurniture(pages: PageLines[], bodySize: number): PageLines[] {
  // Aday: sayfanın ilk/son iki satırından üst ya da alt bölgede olanlar
  const candidates = pages.map((p) => {
    const n = p.lines.length;
    return [...new Set([0, 1, n - 2, n - 1])].filter((i) => {
      const l = p.lines[i];
      return l !== undefined && (l.y >= p.height * (1 - TOP_ZONE) || l.y <= p.height * BOTTOM_ZONE);
    });
  });

  const counts = new Map<string, number>();
  pages.forEach((p, pi) => {
    for (const i of candidates[pi]) {
      const l = p.lines[i];
      const key = furnitureKey(l.text, l.y > p.height / 2);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  });

  // Sayfa numarası diziyi izler: "numara − sayfa sırası" farkı kitap boyunca (arada kayarak da olsa) tekrar eder.
  // Diziye uymayan tek başına sayı (ör. sayfanın ilk satırındaki bölüm numarası "11") sayfa numarası değildir.
  // Numara az sayfada görülüyorsa dizi kurulamaz; o zaman eskisi gibi hepsi silinir.
  const arabic = (text: string) => {
    const m = /\d{1,4}/.exec(text);
    return m ? Number(m[0]) : null;
  };
  const offsets = new Map<number, number>();
  let numbered = 0;
  pages.forEach((p, pi) => {
    for (const i of candidates[pi]) {
      const text = p.lines[i].text.trim();
      const n = PAGE_NUMBER.test(text) ? arabic(text) : null;
      if (n === null) continue;
      numbered++;
      offsets.set(n - p.pageIndex, (offsets.get(n - p.pageIndex) ?? 0) + 1);
    }
  });
  const inSequence = (text: string, pageIndex: number) => {
    const n = arabic(text);
    if (n === null || numbered < 5) return true; // Roma rakamı ya da dizi kurulamıyor
    return (offsets.get(n - pageIndex) ?? 0) >= 3;
  };

  return pages.map((p, pi) => {
    const remove = new Set<number>();
    for (const i of candidates[pi]) {
      const l = p.lines[i];
      const text = l.text.trim();
      const isTop = l.y > p.height / 2;
      const key = furnitureKey(text, isTop);
      // Diziye uymayan sayı yalnızca sayfanın en üstündeyse korunur (bölüm numarası olabilir); başka yerde
      // yanlış okunmuş sayfa numarasıdır (taranmış kitaplarda "27" yerine "21")
      const pageNumber =
        PAGE_NUMBER.test(text) && (inSequence(text, p.pageIndex) || !(isTop && i <= 1));
      if (pageNumber || PAGE_LABEL.test(text)) remove.add(i);
      else if ((counts.get(key) ?? 0) >= 3 && key.length > 7 && (isTop || !NOTE_LIKE.test(text)))
        remove.add(i);
      else if (isTop && i <= 1 && l.size <= bodySize * 0.92 && text.length <= 80) remove.add(i);
    }
    return remove.size ? { ...p, lines: p.lines.filter((_, i) => !remove.has(i)) } : p;
  });
}
