import { countWords } from '../convert/text';
import type { Block, Lang, Locator } from '../convert/types';

/** Metin içinde cümle aralığı: [start, end), baştaki ve sondaki boşluklar hariç. */
export interface SentenceSpan {
  start: number;
  end: number;
}

/** Kitaptaki bir cümle: blok indeksi + blok metnindeki [start, end) aralığı. `id` kitap boyunca sıradır (dizideki indeks). */
export interface Sentence {
  id: number;
  block: number;
  start: number;
  end: number;
  words: number;
}

/** Arkasından büyük harf gelse de cümleyi bitirmeyen kısaltmalar (küçük harfle). */
const ABBREVIATIONS = new Set([
  'dr.',
  'prof.',
  'doç.',
  'av.',
  'vb.',
  'vs.',
  'bkz.',
  'örn.',
  'st.',
  'mr.',
  'mrs.',
  'e.g.',
  'i.e.',
  'hz.',
  'yrd.',
  'cad.',
  'mah.',
  'sok.',
  'vd.',
  'bşk.',
  'gen.',
  'alb.',
  'yzb.',
  'sn.',
]);
/** Yalnızca arkasından sayı gelince kısaltma sayılanlar: "s. 45", "No. 5" (ama "I said no. Then"). */
const NUMBER_ABBREVIATIONS = new Set(['s.', 'sf.', 'no.']);

/** Baş harfler: "A." ya da "J.R.R." */
const INITIALS = /^(?:\p{Lu}\.)+$/u;
/** Yalnızca sıra sayısından oluşan parça: "2." (2. Dünya Savaşı, 1. Bölüm, liste: "2. Özlem:"), "II." (II. Abdülhamit) */
const ORDINAL_ONLY = /^(?:\d{1,3}|[IVXLC]{1,7})\.$/;
/** Cümlenin içindeki Roma rakamlı sıra sayısı (tek harflisi baş harf sayılır): "Sonra II. Abdülhamit" */
const ROMAN_ORDINAL = /^[IVXLC]{2,7}\.$/;
/** Kelimenin önündeki açılış işaretleri: "(Dr." → "Dr." */
const LEADING_OPENERS = /^[\p{Ps}\p{Pi}"'«]+/u;
/** Parçanın başındaki kapanış işaretleri ve dipnot imleri önceki cümleye aittir: `.” Sonra`, `tutuyordu.¹ Ahmet` */
const LEADING_CLOSERS = /[\p{Pe}\p{Pf}¹²³⁰⁴-⁹†‡]+/uy;
/**
 * Segmenter'ın bölmediği cümle sonları (arkasından büyük harf gelirse bölünür):
 * - "…" (U+2026) cümle sonu sayılmaz ("..." sayılır);
 * - bitiş işaretinden sonra gelen uzun tire (SContinue) bölmeyi engeller: "dedi annesi. — Geliyorum."
 */
const EXTRA_BREAK = /…[\p{Pe}\p{Pf}"']*\s+|[.!?][\p{Pe}\p{Pf}"']*\s+(?=[—–])/gu;
const EXTRA_BREAK_HINT = /[…—–]/u;
/** Küçük harf aranırken atlanan işaretler: boşluk, tire, açılış tırnağı/parantezi */
const SKIPPED_BEFORE_LETTER = /[\s\p{Pd}\p{Ps}\p{Pi}"'«]/u;
const SPACE = /\s/u;
/** Önceki parçanın son kelimesi için bakılan en fazla karakter (uzun paragraflarda yeniden dilimlemeyi sınırlar) */
const LAST_WORD_WINDOW = 40;

const segmenters = new Map<Lang, Intl.Segmenter>();

function segmenterFor(lang: Lang): Intl.Segmenter {
  let seg = segmenters.get(lang);
  if (!seg) {
    seg = new Intl.Segmenter(lang === 'other' ? undefined : lang, { granularity: 'sentence' });
    segmenters.set(lang, seg);
  }
  return seg;
}

function lastWord(text: string, span: SentenceSpan): string {
  const tail = text.slice(Math.max(span.start, span.end - LAST_WORD_WINDOW), span.end).trimEnd();
  const word = /\S+$/u.exec(tail)?.[0] ?? '';
  return word.replace(LEADING_OPENERS, '');
}

/** [start, end) içindeki ilk boşluk olmayan karakterin konumu; hepsi boşluksa end. */
function firstNonSpace(text: string, start: number, end: number): number {
  while (start < end && SPACE.test(text[start])) start++;
  return start;
}

/** Parçanın ilk anlamlı karakteri (boşluk, tire ve açılış işaretleri atlanır); yoksa ''. */
function firstSignificant(text: string, start: number, end: number): string {
  for (let i = start; i < end; i++) {
    const ch = text[i];
    if (!SKIPPED_BEFORE_LETTER.test(ch)) return ch;
  }
  return '';
}

/** Cümlenin içindeki sıra sayısı: "2." (2. Dünya Savaşı), "II." */
const ORDINAL = /^(?:\d{1,3}|[IVXLC]{2,7})\.$/;

/**
 * Nokta cümleyi bitirmiyor mu: kelime kısaltma ("Dr.", "vb."), baş harf ("A.") ya da sıra sayısı ("2.", "II."); "s.",
 * "No." yalnızca arkasından sayı (`next`) gelince. Önündeki açılış işaretleri sayılmaz: "(Dr.". RSVP'de kelimenin
 * cümle sonu payı bununla atlanır (rsvp.ts).
 */
export function isAbbreviation(word: string, next = ''): boolean {
  const w = word.replace(LEADING_OPENERS, '');
  const lower = w.toLowerCase();
  if (ABBREVIATIONS.has(lower) || INITIALS.test(w) || ORDINAL.test(w)) return true;
  return NUMBER_ABBREVIATIONS.has(lower) && /^\p{N}/u.test(next.replace(LEADING_OPENERS, ''));
}

/**
 * Segmenter'ın yanlış böldüğü yer mi: önceki parça kısaltma, baş harf ya da Roma rakamlı sıra sayısıyla bitiyor,
 * yalnızca bir sıra sayısından ("2.", "II.") oluşuyor ya da bu parça küçük harfle başlıyor ("? dedi", "... ve",
 * "3. bölüm").
 */
function continuesSentence(text: string, prev: SentenceSpan, start: number, end: number): boolean {
  const word = lastWord(text, prev);
  const lower = word.toLowerCase();
  const next = firstSignificant(text, start, end);
  if (ABBREVIATIONS.has(lower) || INITIALS.test(word) || ROMAN_ORDINAL.test(word)) return true;
  if (ORDINAL_ONLY.test(text.slice(prev.start, prev.end).trim())) return true;
  if (NUMBER_ABBREVIATIONS.has(lower) && /\p{N}/u.test(next)) return true;
  return /\p{Ll}/u.test(next);
}

/** Segmenter parçaları; `EXTRA_BREAK` yerlerinden ayrıca bölünmüş. */
function* segments(text: string, lang: Lang): Generator<SentenceSpan> {
  for (const { segment, index } of segmenterFor(lang).segment(text)) {
    let start = index;
    const end = index + segment.length;
    if (EXTRA_BREAK_HINT.test(segment)) {
      for (const m of segment.matchAll(EXTRA_BREAK)) {
        const cut = index + m.index + m[0].length;
        if (cut < end && /\p{Lu}/u.test(firstSignificant(text, cut, end))) {
          yield { start, end: cut };
          start = cut;
        }
      }
    }
    yield { start, end };
  }
}

/**
 * Metni cümlelere böler (`Intl.Segmenter`) ve her cümlenin metindeki [start, end) aralığını döndürür.
 * Segmenter'ın yanlış böldüğü yerler birleştirilir: kısaltmalar (Dr., vb., e.g.), baş harfler (A. Yılmaz),
 * küçük harfle süren parçalar (sıra sayıları "3. bölüm", üç nokta sonrası, "— Nereye? dedi.").
 * Kapanış tırnağı/parantezi ya da dipnot imiyle başlayan parçanın o işaretleri önceki cümleye eklenir.
 * "…" ya da bitiş işareti + uzun tire arkasından büyük harf gelirse cümle biter ("Durdu… Yeni", "dedi. — Gel.").
 * Baştaki ve sondaki boşluklar cümleye dahil edilmez; boş cümle çıkmaz.
 */
export function splitSentences(text: string, lang: Lang): SentenceSpan[] {
  const raw: SentenceSpan[] = [];
  for (const seg of segments(text, lang)) {
    let start = seg.start;
    const end = seg.end;
    const prev = raw[raw.length - 1];
    if (prev) {
      LEADING_CLOSERS.lastIndex = start;
      const closers = LEADING_CLOSERS.exec(text);
      if (closers) {
        start = Math.min(end, start + closers[0].length);
        prev.end = start;
        if (firstNonSpace(text, start, end) === end) {
          prev.end = end;
          continue;
        }
      }
      if (continuesSentence(text, prev, start, end)) {
        prev.end = end;
        continue;
      }
    }
    raw.push({ start, end });
  }

  const out: SentenceSpan[] = [];
  for (const span of raw) {
    const start = firstNonSpace(text, span.start, span.end);
    let end = span.end;
    while (end > start && SPACE.test(text[end - 1])) end--;
    if (end > start) out.push({ start, end });
  }
  return out;
}

/** Metnin tamamı tek cümle (boşluklar hariç). */
function wholeText(text: string): SentenceSpan[] {
  const start = text.length - text.trimStart().length;
  const end = text.trimEnd().length;
  return end > start ? [{ start, end }] : [];
}

/**
 * Kitabın cümle dizini. Başlıklar tek cümledir; sahne arası ve görsel sayfa bloklarından cümle çıkmaz.
 * `id` kitap boyunca sıradır ve dizideki indekse eşittir.
 */
export function buildSentenceIndex(blocks: Block[], lang: Lang): Sentence[] {
  const out: Sentence[] = [];
  blocks.forEach((b, block) => {
    if (!('text' in b)) return;
    const spans = b.kind === 'heading' ? wholeText(b.text) : splitSentences(b.text, lang);
    for (const { start, end } of spans) {
      out.push({ id: out.length, block, start, end, words: countWords(b.text.slice(start, end)) });
    }
  });
  return out;
}

/** Konumu içeren ya da (cümle arasındaki boşluktaysa, cümlesiz bloktaysa) ondan sonra gelen ilk cümle; kitap bittiyse undefined. */
export function sentenceAt(index: Sentence[], loc: Locator): Sentence | undefined {
  // bitişi konumdan sonra olan ilk cümle (dizi blok ve konuma göre sıralı)
  let lo = 0;
  let hi = index.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const s = index[mid];
    if (s.block < loc.block || (s.block === loc.block && s.end <= loc.offset)) lo = mid + 1;
    else hi = mid;
  }
  return index[lo];
}
