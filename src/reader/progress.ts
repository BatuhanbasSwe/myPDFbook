import type { Block } from '../convert/types';

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
