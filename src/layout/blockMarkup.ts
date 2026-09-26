import type { Block } from '../convert/types';

/**
 * Sayfadaki bir bloğun HTML etiketi ve sınıfları. Sayfalayıcının ölçüm kutusu ile sayfa görünümü aynı işaretlemeyi
 * buradan alır: ikisi farklılaşırsa satır kırılımları ve sayfa sonları kayar.
 */
export type BlockTag = 'p' | 'h2' | 'h3' | 'aside' | 'div';

export function blockTag(b: Block): BlockTag {
  switch (b.kind) {
    case 'heading':
      return b.level === 1 ? 'h2' : 'h3';
    case 'para':
      return 'p';
    case 'note':
      return 'aside';
    case 'break':
    case 'pageImage':
      return 'div';
  }
}

export interface Part {
  /** paragrafın devamı (önceki sayfada başladı): girinti yok */
  cont: boolean;
  /** paragraf bu sayfada bitmiyor: son satır da iki yana yaslanır */
  cut: boolean;
  /** kelimenin ortasından bölündü: sona tire eklenir */
  hyphen: boolean;
}

export const WHOLE: Part = { cont: false, cut: false, hyphen: false };

/**
 * Sınıflar blok dizisinden hesaplanır (CSS kardeş seçicisi değil): başlıktan sonraki paragraf girintisiz. Paragraf
 * sayfanın başına düşse de ölçümdeki ve çizimdeki girinti aynı kalır.
 */
export function blockClassName(blocks: Block[], index: number, part: Part = WHOLE): string {
  const b = blocks[index];
  const prev = blocks[index - 1];
  const classes: string[] = [`b-${b.kind}`];
  if (b.kind === 'heading' && b.level === 1) classes.push('chapter');
  if (b.kind === 'para') {
    if (part.cont || !prev || prev.kind === 'heading' || prev.kind === 'break')
      classes.push('noindent');
    if (part.cut) classes.push('cut');
    if (part.hyphen) classes.push('hyphen');
  }
  return classes.join(' ');
}

/** Blok metninin bu sayfadaki kısmı (görsel sayfa ve sahne arasında metin yok). */
export function blockText(b: Block, from = 0, to?: number): string {
  if (b.kind === 'break') return '⁂';
  if (!('text' in b)) return '';
  return b.text.slice(from, to);
}
