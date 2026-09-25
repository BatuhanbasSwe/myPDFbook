import type { Block, Locator } from '../convert/types';

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

interface SavedPosition {
  locator: Locator;
  percent: number;
  contentVersion?: number;
}

/**
 * Açılışta başlanacak blok. Kayıt bu içerik sürümüne aitse kayıtlı blok; kitap sonradan yeniden
 * dönüştürüldüyse (bloklar değişti) kayıtlı okuma oranına denk gelen blok.
 */
export function startBlock(
  saved: SavedPosition | null | undefined,
  blocks: Block[],
  version: number,
): number {
  if (!saved || blocks.length === 0) return 0;
  // Sürümsüz kayıtlar ilk sürüm okuyucusundan kalmadır
  if ((saved.contentVersion ?? 1) === version)
    return Math.min(saved.locator.block, blocks.length - 1);
  return blockAtFraction(blockStartFractions(blocks), saved.percent);
}
