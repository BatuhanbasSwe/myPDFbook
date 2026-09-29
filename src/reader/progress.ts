import type { Block, Chapter, Locator } from '../convert/types';

/** Metinsiz bloklar (görsel sayfa, sahne arası) bu kadar karakter sayılır. */
const IMAGE_WEIGHT = 400;

/** Her bloğun kitap içindeki başlangıç oranı (0..1). */
export function blockStartFractions(blocks: Block[]): number[] {
  const weights = blocks.map((b) => ('text' in b ? b.text.length : IMAGE_WEIGHT));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  return weights.map((w) => {
    const start = acc / total;
    acc += w;
    return start;
  });
}

/** Kitabın `fraction` oranındaki blok: başlangıç oranı bunu geçmeyen son blok. */
export function blockAtFraction(fractions: number[], fraction: number): number {
  let i = 0;
  while (i + 1 < fractions.length && fractions[i + 1] <= fraction) i++;
  return i;
}

/** Konumun kitap içindeki oranı (0..1): bloğun başlangıç oranı + blok içindeki karakter payı. */
export function locatorFraction(blocks: Block[], fractions: number[], loc: Locator): number {
  const b = blocks[loc.block];
  if (!b) return 1;
  const start = fractions[loc.block] ?? 0;
  const next = fractions[loc.block + 1] ?? 1;
  const len = 'text' in b ? b.text.length : 0;
  return start + (next - start) * (len ? Math.min(1, loc.offset / len) : 0);
}

/** Oranın denk geldiği konum (blok ve blok içindeki karakter). */
export function locatorAtFraction(blocks: Block[], fractions: number[], fraction: number): Locator {
  if (blocks.length === 0) return { block: 0, offset: 0 };
  const i = blockAtFraction(fractions, fraction);
  const b = blocks[i];
  const start = fractions[i] ?? 0;
  const next = fractions[i + 1] ?? 1;
  const len = 'text' in b ? b.text.length : 0;
  const within = next > start ? Math.min(1, Math.max(0, (fraction - start) / (next - start))) : 0;
  return { block: i, offset: len ? Math.min(len - 1, Math.round(within * len)) : 0 };
}

/** Konumun bulunduğu bölüm: başlangıç bloğu konumdan sonra olmayan son bölüm (-1: ilk bölümden önce). */
export function currentChapter(chapters: Chapter[], loc: Locator): number {
  let found = -1;
  chapters.forEach((c, i) => {
    if (c.block <= loc.block && (found < 0 || c.block >= chapters[found].block)) found = i;
  });
  return found;
}

/** Metindeki konumun PDF sayfası (0'dan): konumun bloğunun başladığı sayfa. */
export function pdfPageOfLocator(blocks: Block[], loc: Locator): number {
  if (blocks.length === 0) return 0;
  return blocks[Math.min(Math.max(0, loc.block), blocks.length - 1)].srcPage;
}

/**
 * PDF sayfasının metindeki konumu: o sayfada başlayan ilk blok; sayfada blok başlamıyorsa (resim, boş sayfa ya da
 * önceki sayfadan süren paragraf) sonraki ilk blok; kitabın sonundaysa son blok.
 */
export function locatorOfPdfPage(blocks: Block[], page: number): Locator {
  const i = blocks.findIndex((b) => b.srcPage >= page);
  return { block: i >= 0 ? i : Math.max(0, blocks.length - 1), offset: 0 };
}

/**
 * PDF sayfasına bağlı kaydın (yer imi) metindeki konumu: saklanan konum hâlâ o sayfadaysa o (metin görünümünde
 * sayfanın başı), değilse sayfanın konumu. Kitap yeniden dönüştürülünce bloklar yeniden numaralanır: eski konum
 * başka bir yeri gösterebilir, PDF sayfası ise değişmez.
 */
export function locatorOnPdfPage(blocks: Block[], pdfPage: number, locator?: Locator): Locator {
  return locator &&
    locator.block >= 0 &&
    locator.block < blocks.length &&
    pdfPageOfLocator(blocks, locator) === pdfPage
    ? locator
    : locatorOfPdfPage(blocks, pdfPage);
}

interface SavedPosition {
  locator: Locator;
  percent: number;
  contentVersion?: number;
  /** sayfa görünümünde açık PDF sayfası */
  pdfPage?: number;
}

/**
 * Açılışta başlanacak konum. Kayıt bu içerik sürümüne aitse kayıtlı konum (blok içindeki yer dahil); kitap sonradan
 * yeniden dönüştürüldüyse (bloklar değişti) kayıtlı okuma oranına denk gelen konum.
 */
export function startLocator(
  saved: SavedPosition | null | undefined,
  blocks: Block[],
  version: number,
): Locator {
  if (!saved || blocks.length === 0) return { block: 0, offset: 0 };
  // Sürümsüz kayıtlar ilk sürüm okuyucusundan kalmadır
  if ((saved.contentVersion ?? 1) === version) {
    const block = Math.min(saved.locator.block, blocks.length - 1);
    const b = blocks[block];
    const len = 'text' in b ? b.text.length : 0;
    return {
      block,
      offset: block === saved.locator.block ? Math.min(saved.locator.offset, len) : 0,
    };
  }
  return locatorAtFraction(blocks, blockStartFractions(blocks), saved.percent);
}

/** Okuma yeri iki görünümde birden: metindeki konum ve PDF sayfası (biri değişince öteki ondan hesaplanır) */
export interface ReadingPosition {
  locator: Locator;
  pdfPage: number;
}

/**
 * Açılışta başlanacak yer. PDF sayfası kayıtlıysa o (metinsiz sayfada da tam yerinde açılır; kitap yeniden
 * dönüştürülse de geçerli kalır), yoksa metindeki konumun sayfası.
 */
export function startPosition(
  saved: SavedPosition | null | undefined,
  blocks: Block[],
  version: number,
  pageCount: number,
): ReadingPosition {
  const locator = startLocator(saved, blocks, version);
  const stored = saved?.pdfPage;
  const page =
    typeof stored === 'number' && Number.isInteger(stored)
      ? stored
      : pdfPageOfLocator(blocks, locator);
  return { locator, pdfPage: Math.max(0, Math.min(pageCount - 1, page)) };
}
