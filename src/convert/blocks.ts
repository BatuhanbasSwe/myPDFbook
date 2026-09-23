import { finalizeText, joinLines } from './text';
import type { Block, Line, PageLines } from './types';

type Kind = 'heading1' | 'heading2' | 'break' | 'note' | 'body';

interface PageStats {
  left: number;
  right: number;
  /** tipik satır aralığı (taban çizgileri arası) */
  gap: number;
}

interface BodyRef {
  line: Line;
  stats: PageStats;
  page: number;
}

const CHAPTER =
  /^(bölüm|kısım|chapter|part|önsöz|sonsöz|giriş|epilog|prolog|prologue|epilogue|introduction|preface)(?!\p{L})|^(?:(?:(?:on|yirmi|otuz|kırk|elli|altmış|yetmiş|seksen|doksan)\s*)?(?:birinci|ikinci|üçüncü|dördüncü|beşinci|altıncı|yedinci|sekizinci|dokuzuncu)|onuncu|yirminci|otuzuncu|kırkıncı|ellinci|altmışıncı|yetmişinci|sekseninci|doksanıncı|yüzüncü)\s+(bölüm|kısım)(?!\p{L})|^\d{1,3}\.?\s*(bölüm|kısım)(?!\p{L})|^[ivxlc]{1,6}\.?$/u;
const BREAK = /^[\s*•·⁂~✱❖◆◇#]+$/u;
const DIALOG = /^[—–]\s?|^-\s/u;
const TERMINAL = /[.!?…:;"'»”’)\]]$/u;
const NOTE_START = /^[\d¹²³⁴⁵⁶⁷⁸⁹⁰*†‡]/u;

function isChapterLike(text: string): boolean {
  return CHAPTER.test(text.toLocaleLowerCase('tr')) || CHAPTER.test(text.toLowerCase());
}

/** Sol kenar: en az iki kez görülen en küçük x0 (girintili satırlar değil, devam satırları). */
function leftMargin(lines: Line[]): number {
  const freq = new Map<number, number>();
  for (const l of lines) {
    const k = Math.round(l.x0);
    freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  const frequent = [...freq].filter(([, n]) => n >= 2).map(([k]) => k);
  const pool = frequent.length ? frequent : [...freq.keys()];
  return pool.length ? Math.min(...pool) : 0;
}

function computeStats(pages: PageLines[], body: number): Map<number, PageStats> {
  const isBody = (l: Line) => Math.abs(l.size - body) <= body * 0.12;
  const allBody = pages.flatMap((p) => p.lines.filter(isBody));
  const perPage = new Map<number, number>();
  for (const p of pages) {
    const ls = p.lines.filter(isBody);
    if (ls.length >= 3) perPage.set(p.pageIndex, leftMargin(ls));
  }
  const known = [...perPage.values()].sort((a, b) => a - b);
  const fallbackLeft = known.length
    ? known[Math.floor(known.length / 2)]
    : leftMargin(allBody.length ? allBody : pages.flatMap((p) => p.lines));

  const widths: number[] = [];
  const gaps: number[] = [];
  for (const p of pages) {
    const left = perPage.get(p.pageIndex) ?? fallbackLeft;
    const ls = p.lines.filter(isBody);
    ls.forEach((l, i) => {
      widths.push(l.x1 - left);
      const prev = ls[i - 1];
      if (prev) {
        const g = prev.y - l.y;
        if (g > 0 && g < body * 4) gaps.push(g);
      }
    });
  }
  widths.sort((a, b) => a - b);
  gaps.sort((a, b) => a - b);
  const width = widths.length ? widths[Math.floor(widths.length * 0.9)] : 300;
  const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : body * 1.45;

  const stats = new Map<number, PageStats>();
  for (const p of pages) {
    const left = perPage.get(p.pageIndex) ?? fallbackLeft;
    stats.set(p.pageIndex, { left, right: left + width, gap });
  }
  return stats;
}

/**
 * Dipnot bölgesi: sayfanın sonundaki kesintisiz küçük puntolu satırlar. Bölge sayfanın alt kısmında başlamalı ve hemen
 * üstünde gövde puntolu bir satır olmalı; küçük puntolu mektup/önsöz sayfaları dipnot sanılmasın, uzun dipnot bölünmesin.
 */
function footnoteStart(p: PageLines, body: number): number {
  let i = p.lines.length;
  while (i > 0 && p.lines[i - 1].size <= body * 0.85) i--;
  if (i === p.lines.length || i === 0) return p.lines.length;
  const above = p.lines[i - 1];
  if (Math.abs(above.size - body) > body * 0.12 || p.lines[i].y > p.height * 0.6) return p.lines.length;
  return i;
}

function classify(l: Line, s: PageStats, body: number, prevKind: Kind | undefined, prevLine: Line | undefined): Kind {
  const text = l.text.trim();
  if (BREAK.test(text) && text.replace(/\s/g, '').length <= 12) return 'break';
  const width = s.right - s.left;
  const centered =
    Math.abs((l.x0 + l.x1) / 2 - (s.left + s.right) / 2) < width * 0.08 && l.x0 > s.left + body * 1.5;
  if (text.length <= 120 && l.size >= body * 1.25) return 'heading1';
  if (text.length <= 60 && isChapterLike(text) && (centered || l.size > body * 1.05)) return 'heading1';
  if (text.length <= 80 && centered && l.size >= body * 1.08) return 'heading2';
  const afterHeading = prevKind === 'heading1' || prevKind === 'heading2';
  if (text.length <= 80 && centered && afterHeading && prevLine && prevLine.y - l.y < s.gap * 3.5) return 'heading2';
  return 'body';
}

function startsParagraph(l: Line, s: PageStats, body: number, prev: BodyRef | null, page: number): boolean {
  if (!prev) return true;
  if (DIALOG.test(l.text.trim())) return true;
  const indented = l.x0 > s.left + body * 0.8 && l.x0 < s.left + body * 6;
  if (indented) return true;
  if (prev.page === page && prev.line.y - l.y > s.gap * 1.6) return true;
  // önceki satır kısa kaldıysa ve cümle bittiyse paragraf bitmiştir (sayfa geçişinde de)
  const prevShort = prev.line.x1 < prev.stats.right - body * 2;
  return prevShort && TERMINAL.test(prev.line.text.trim());
}

class BlockBuilder {
  readonly blocks: Block[] = [];
  /** Paragraf satır parçaları olarak tutulur; birleştirme kararı yalnızca son satıra bakar (uzun paragrafta doğrusal süre). */
  private para: { parts: string[]; srcPage: number } | null = null;
  private notes: Block[] = [];

  get hasPara(): boolean {
    return this.para !== null;
  }
  startPara(text: string, srcPage: number): void {
    this.flush();
    this.para = { parts: [text], srcPage };
  }
  continuePara(text: string): void {
    if (!this.para) return;
    const parts = this.para.parts;
    // joinLines sonucu her zaman `text` ile biter; öncesi, önceki satırın yeni hâlidir (tire silinmiş ya da boşluk eklenmiş)
    const joined = joinLines(parts[parts.length - 1], text);
    parts[parts.length - 1] = joined.slice(0, joined.length - text.length);
    parts.push(text);
  }
  /** Dipnotlar, o an açık olan paragraf kapanınca eklenir (paragraf sonraki sayfaya taşabilir). */
  queueNotes(notes: Block[]): void {
    this.notes.push(...notes);
  }
  push(block: Block): void {
    this.flush();
    this.blocks.push(block);
  }
  /** Açık paragraf yoksa son bloğu döndürür (ardışık başlık satırlarını birleştirmek için). */
  lastClosed(): Block | undefined {
    return this.para ? undefined : this.blocks[this.blocks.length - 1];
  }
  flush(): void {
    if (this.para) {
      const text = finalizeText(this.para.parts.join(''));
      if (text) this.blocks.push({ kind: 'para', text, srcPage: this.para.srcPage });
      this.para = null;
    }
    if (this.notes.length) {
      this.blocks.push(...this.notes);
      this.notes = [];
    }
  }
}

/** Temizlenmiş sayfa satırlarını kitap bloklarına dönüştürür. */
export function buildBlocks(pages: PageLines[], body: number, textless: Set<number>): Block[] {
  const stats = computeStats(pages, body);
  const out = new BlockBuilder();
  let lastBody: BodyRef | null = null;

  for (const p of pages) {
    if (textless.has(p.pageIndex)) {
      out.push({ kind: 'pageImage', srcPage: p.pageIndex });
      lastBody = null;
      continue;
    }
    const s = stats.get(p.pageIndex)!;
    const noteFrom = footnoteStart(p, body);
    const notes: Block[] = [];
    let prevKind: Kind | undefined;
    let prevLine: Line | undefined;

    for (let i = 0; i < p.lines.length; i++) {
      const l = p.lines[i];
      const text = l.text.trim();
      const kind: Kind = i >= noteFrom ? 'note' : classify(l, s, body, prevKind, prevLine);

      if (kind === 'note') {
        const last = notes[notes.length - 1];
        if (last?.kind === 'note' && !NOTE_START.test(text)) last.text = joinLines(last.text, text);
        else notes.push({ kind: 'note', text, srcPage: p.pageIndex });
      } else if (kind === 'break') {
        out.push({ kind: 'break', srcPage: p.pageIndex });
        lastBody = null;
      } else if (kind === 'heading1' || kind === 'heading2') {
        const level = kind === 'heading1' ? 1 : 2;
        const last = out.lastClosed();
        if (prevKind === kind && last?.kind === 'heading' && last.level === level) last.text = `${last.text} ${text}`;
        else out.push({ kind: 'heading', level, text, srcPage: p.pageIndex });
        lastBody = null;
      } else {
        if (!out.hasPara || startsParagraph(l, s, body, lastBody, p.pageIndex)) {
          out.startPara(text, p.pageIndex);
        } else {
          out.continuePara(text);
        }
        lastBody = { line: l, stats: s, page: p.pageIndex };
      }
      prevKind = kind;
      prevLine = l;
    }
    out.queueNotes(notes);
  }
  out.flush();
  return out.blocks;
}
