/**
 * Metin öğesinin harf başına ilerlemeleri, fontun glif genişliklerinden (sayfa geometrisi: cümle vurgusunun harfe
 * oturması için). pdf.js fontu `fontExtraProperties` ile açılmışsa ana iş parçacığındaki font nesnesi genişlikleri
 * (`widths`, `defaultWidth`) ve karakter kodu → Unicode eşlemesini (`toUnicode`) taşır.
 */

/** pdf.js font nesnesinin kullandığımız alanları (worker'dan kopyalanmış düz nesne) */
export interface FontMetrics {
  /** karakter kodu (bileşik fontta CID) → genişlik (1000 birim) */
  widths?: Record<number, number> | ArrayLike<number | undefined>;
  defaultWidth?: number;
  /** ToUnicodeMap (`_map`) ya da IdentityToUnicodeMap (`firstChar`, `lastChar`) */
  toUnicode?: { _map?: ArrayLike<string | undefined>; firstChar?: number; lastChar?: number };
  composite?: boolean;
  /** bileşik fontun kod → CID eşlemesi (CMap ya da IdentityCMap: boş eşleme, 2 baytlık 0–FFFF aralığı) */
  cMap?: {
    name?: string;
    _map?: ArrayLike<unknown>;
    codespaceRanges?: ArrayLike<ArrayLike<number>>;
  } | null;
  vertical?: boolean;
  isType3Font?: boolean;
}

/** Bileşik fontun CMap'i kimlik eşlemesi mi (kod = CID) */
function identityCMap(cMap: FontMetrics['cMap']): boolean {
  if (!cMap) return false;
  if (/^Identity-[HV]$/.test(cMap.name ?? '')) return true;
  const two = cMap.codespaceRanges?.[1];
  return (cMap._map?.length ?? 0) === 0 && two?.length === 2 && two[0] === 0 && two[1] === 0xffff;
}

/** Unicode → karakter kodu (fontun ters eşlemesi); kullanılamıyorsa null */
export function unicodeToCode(font: FontMetrics): Map<string, number> | null {
  if (!font.widths || font.vertical || font.isType3Font) return null;
  // Bileşik fontta genişlikler CID'e göre: yalnızca kod = CID olan kimlik eşlemesinde güvenilir
  if (font.composite && !identityCMap(font.cMap)) return null;
  const map = new Map<string, number>();
  const tu = font.toUnicode;
  if (tu?._map) {
    const m = tu._map;
    for (let code = 0; code < m.length; code++) {
      const u = m[code];
      if (typeof u === 'string' && u !== '' && !map.has(u)) map.set(u, code);
    }
  } else if (tu && typeof tu.firstChar === 'number' && typeof tu.lastChar === 'number') {
    for (let code = tu.firstChar; code <= tu.lastChar; code++) {
      const u = String.fromCodePoint(code);
      if (!map.has(u)) map.set(u, code);
    }
  } else return null;
  return map.size ? map : null;
}

function glyphWidth(font: FontMetrics, code: number | undefined): number | null {
  if (code === undefined) return null;
  const w = (font.widths as Record<number, number | undefined>)[code];
  return typeof w === 'number' && w > 0 ? w : null;
}

const SPACE = /\s/u;

/**
 * `str`'nin kod noktası başına ilerlemeleri; toplamları `width`. `scaleX`: öğe dönüşümünün yatay ölçeği (punto ×
 * yatay ölçek). Fontta bulunmayan boşluklar (pdf.js'in eklediği) kalan genişliği paylaşır: iki yana yaslanmış
 * satırdaki sözcük aralığı boşluğa düşer. Genişlikler öğeyle tutarsızsa (yanlış eşleme) undefined: eşit bölünür.
 */
export function glyphAdvances(
  str: string,
  width: number,
  scaleX: number,
  font: FontMetrics,
  codes: Map<string, number>,
): number[] | undefined {
  const chars = Array.from(str);
  if (chars.length === 0 || !(width > 0) || !(scaleX > 0)) return undefined;
  const raw = chars.map((ch) => glyphWidth(font, codes.get(ch)));
  const known = raw.filter((w): w is number => w !== null);
  if (known.length === 0) return undefined;
  const avg = known.reduce((a, b) => a + b, 0) / known.length;
  // Fontta olmayan harf: varsayılan genişlik (yoksa ortalama); boşluk: kalan genişlik
  const fallback = font.defaultWidth && font.defaultWidth > 0 ? font.defaultWidth : avg;
  const units = raw.map((w, i) => w ?? (SPACE.test(chars[i]) ? null : fallback));
  const scale = scaleX / 1000;
  const fixed = units.reduce<number>((a, w) => a + (w ?? 0), 0) * scale;
  // Glifler öğeden belirgin genişse eşleme yanlıştır
  if (fixed > width * 1.08) return undefined;
  const gaps = units.filter((w) => w === null).length;
  const gap = gaps > 0 ? Math.max(0, width - fixed) / gaps : 0;
  const adv = units.map((w) => (w === null ? gap : w * scale));
  // Harf aralığı (Tc) ve yuvarlama: toplam öğenin genişliğine eşitlenir
  const sum = adv.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return undefined;
  const k = width / sum;
  return adv.map((a) => a * k);
}
