import type { Lang } from './types';

const LINE_END_HYPHEN = /\p{L}[-\u2010]$/u;

/** İki satırı birleştirir; satır sonunda tireyle bölünmüş kelimeleri yeniden birleştirir. */
export function joinLines(prev: string, next: string): string {
  if (prev.endsWith('\u00AD')) return prev.slice(0, -1) + next;
  if (LINE_END_HYPHEN.test(prev)) {
    // küçük harfle devam ediyorsa heceleme tiresidir: "kita-" + "bı" → "kitabı"
    if (/^\p{Ll}/u.test(next)) return prev.slice(0, -1) + next;
    // büyük harf/rakamla devam ediyorsa gerçek tiredir: "Kuzey-" + "Güney" → "Kuzey-Güney"
    return prev + next;
  }
  return `${prev} ${next}`;
}

/** Blok metnini son haline getirir: yumuşak tireleri siler, boşlukları sadeleştirir. */
export function finalizeText(text: string): string {
  return text.replace(/\u00AD/g, '').replace(/\s+/g, ' ').trim();
}

const BROKEN_TR = /[ýþðÝÞÐ]/g;
const PROPER_TR = /[ışğİŞĞ]/g;
const TR_MAP: Record<string, string> = { ý: 'ı', þ: 'ş', ð: 'ğ', Ý: 'İ', Þ: 'Ş', Ð: 'Ğ' };

/** Yanlış kodlanmış Türkçe fontlarda ı/ş/ğ harfleri ý/þ/ð olarak çıkar. */
export function needsTurkishRepair(sample: string): boolean {
  const broken = sample.match(BROKEN_TR)?.length ?? 0;
  const proper = sample.match(PROPER_TR)?.length ?? 0;
  return broken >= 5 && broken > proper;
}

export function repairTurkish(text: string): string {
  return text.replace(BROKEN_TR, (c) => TR_MAP[c] ?? c);
}

const TR_WORDS = new Set(['ve', 'bir', 'bu', 'da', 'de', 'için', 'ile', 'çok', 'ama', 'gibi', 'daha', 'ne', 'ben', 'sen', 'değil', 'kadar', 'sonra', 'olarak', 'diye', 'şey']);
const EN_WORDS = new Set(['the', 'and', 'of', 'to', 'in', 'is', 'that', 'it', 'was', 'for', 'on', 'with', 'as', 'he', 'she', 'his', 'you', 'not', 'had', 'at']);

/** Sık geçen kelimelere bakarak kaba dil tahmini. */
export function detectLanguage(sample: string): Lang {
  const trWords = sample.toLocaleLowerCase('tr').match(/\p{L}+/gu) ?? [];
  const enWords = sample.toLowerCase().match(/\p{L}+/gu) ?? [];
  let tr = trWords.filter((w) => TR_WORDS.has(w)).length;
  const en = enWords.filter((w) => EN_WORDS.has(w)).length;
  if ((sample.match(/[ığşİĞŞ]/g)?.length ?? 0) > 3) tr += 5;
  if (tr + en < 3) return 'other';
  return tr >= en ? 'tr' : 'en';
}

export function countWords(text: string): number {
  return text.match(/\p{L}[\p{L}\p{N}'’-]*/gu)?.length ?? 0;
}
