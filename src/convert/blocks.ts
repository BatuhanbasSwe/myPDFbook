import { finalizeText, joinLines } from './text';
import type { Block, Line, PageLines } from './types';

/** subtitle: başlığın altındaki tek satır; 2. düzey ayrı başlık olur, önceki başlığa eklenmez ve zincirlenmez */
type Kind = 'heading1' | 'heading2' | 'subtitle' | 'break' | 'note' | 'body';

interface PageStats {
  left: number;
  right: number;
  /** tipik satır aralığı (taban çizgileri arası) */
  gap: number;
  /** kitaptaki tipik metin başı (dolu sayfaların ilk satırı); belirgin aşağıda başlayan sayfa bölüm açılışıdır */
  top: number;
}

interface LineContext {
  prevKind: Kind | undefined;
  prevLine: Line | undefined;
  nextLine: Line | undefined;
  /** üstteki satırdan aşağı iniş; sayfanın ilk satırında tipik metin başından (normal sayfada tam bir satır aralığı) */
  gapAbove: number;
  first: boolean;
  /** son blok tek başına bir bölüm numarası ("1"); bölüm adı sonraki sayfada da olabilir */
  afterNumber: boolean;
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
const BARE_NUMBER = /^\d{1,3}$/;
/** Başlık gibi biter: harf, rakam, soru işareti ya da kapanan parantezle (cümle noktalaması ya da tırnakla değil) */
const HEADING_END = /[\p{L}\p{N}?)]$/u;
/** Yeni bir cümle ya da birim başlangıcı */
const UNIT_START = /^[\p{Lu}\p{N}"“«'(—–-]/u;

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

  // Tipik metin başı: dolu sayfaların ilk satırının ortancası (dolu sayfa yoksa en yüksekteki ilk satır)
  const firsts = pages
    .map((p) => p.lines.filter(isBody))
    .flatMap((ls) => (ls.length >= 8 ? [ls[0].y] : []))
    .sort((a, b) => a - b);
  const top = firsts.length
    ? firsts[Math.floor(firsts.length / 2)]
    : Math.max(0, ...pages.map((p) => p.lines[0]?.y ?? 0));

  const stats = new Map<number, PageStats>();
  for (const p of pages) {
    const left = perPage.get(p.pageIndex) ?? fallbackLeft;
    stats.set(p.pageIndex, { left, right: left + width, gap, top });
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
  if (Math.abs(above.size - body) > body * 0.12 || p.lines[i].y > p.height * 0.6)
    return p.lines.length;
  return i;
}

function classify(l: Line, s: PageStats, body: number, c: LineContext): Kind {
  const text = l.text.trim();
  if (BREAK.test(text) && text.replace(/\s/g, '').length <= 12) return 'break';
  const width = s.right - s.left;
  const centered =
    Math.abs((l.x0 + l.x1) / 2 - (s.left + s.right) / 2) < width * 0.08 &&
    l.x0 > s.left + body * 1.5;
  if (text.length <= 120 && l.size >= body * 1.25) return 'heading1';
  if (text.length <= 60 && isChapterLike(text) && (centered || l.size > body * 1.05))
    return 'heading1';
  if (text.length <= 80 && centered && l.size >= body * 1.08) return 'heading2';
  const afterHeading = c.prevKind === 'heading1' || c.prevKind === 'heading2';
  if (
    text.length <= 80 &&
    centered &&
    afterHeading &&
    c.prevLine &&
    c.prevLine.y - l.y < s.gap * 3.5
  )
    return 'heading2';
  return sameSizeHeading(l, text, s, c) ?? 'body';
}

/**
 * Gövdeyle aynı puntolu, sola yaslı başlıklar (e-kitaptan dönüştürülmüş PDF'lerde sık). Bunları puntosu değil
 * konumu ve biçimi ele verir: üstündeki boşluk ya da aşağıdan başlayan sayfa, tek başına bölüm numarası,
 * tamamı büyük harf kısa satır, başlığın hemen altındaki tek kısa satır.
 */
function sameSizeHeading(l: Line, text: string, s: PageStats, c: LineContext): Kind | undefined {
  const width = s.right - s.left;
  const isolated = c.gapAbove > s.gap * 1.8; // üstünde boşluk var ya da sayfa aşağıdan başlıyor
  const headingEnd = HEADING_END.test(text) && !DIALOG.test(text);
  // Paragrafın ilk satırı değil: alttaki satır yeni bir cümleyle (büyük harf, rakam, tırnak) başlıyor ya da yok
  const standsAlone = !c.nextLine || UNIT_START.test(c.nextLine.text.trim());
  // "1": tek başına bölüm numarası. Üstünde boşluk var; ya da sayfanın ilk satırı ve altında bölüm adı var.
  if (BARE_NUMBER.test(text)) {
    const next = c.nextLine;
    const titleBelow =
      !next || (HEADING_END.test(next.text.trim()) && next.x1 - s.left < width * 0.9);
    if (isolated || (c.first && titleBelow)) return 'heading1';
  }
  if (c.afterNumber && headingEnd && text.length <= 100) return 'heading1'; // numaranın altındaki bölüm adı
  // Uzun bölüm adının taşan kısa devamı ("…İmkansız Hale" / "Getirme")
  if (
    c.prevKind === 'heading1' &&
    c.prevLine &&
    c.prevLine.x1 - s.left >= width * 0.75 &&
    headingEnd &&
    standsAlone &&
    l.x1 - s.left < width * 0.75
  )
    return 'heading1';
  if (isChapterLike(text) && isolated && text.length <= 60) return 'heading1';
  const afterHeading = c.prevKind === 'heading1' || c.prevKind === 'heading2';
  // Tireyle başlayan büyük harfli satır alıntının sahibidir ("-LAO TZU"), başlık değil
  if (text.length <= 80 && isAllCaps(text) && !/[.!,;]$/.test(text) && !/^[-–—]/.test(text)) {
    // Bölüm başında büyük harfle dizilmiş ilk kelime ("PSİKOLOG / GARY Klein bir keresinde…") başlık değil
    return afterHeading && !/\s/.test(text) ? 'body' : 'heading2';
  }
  // Sağı düzensiz metinde paragraf içi satırlar bu oranların altına pek inmez
  if (isolated && headingEnd && standsAlone && l.x1 - s.left < width * 0.65)
    return c.first ? 'heading1' : 'heading2';
  if (
    afterHeading &&
    headingEnd &&
    standsAlone &&
    l.x1 - s.left < width * 0.75 &&
    c.gapAbove < s.gap * 3.5
  )
    return 'subtitle';
  return undefined;
}

/** Harflerin hepsi büyük (en az 4 harf); rakam ve noktalama sayılmaz. */
function isAllCaps(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  return letters.length >= 4 && letters.every((ch) => ch !== ch.toLocaleLowerCase('tr'));
}

function startsParagraph(
  l: Line,
  s: PageStats,
  body: number,
  prev: BodyRef | null,
  page: number,
): boolean {
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
      const last = out.lastClosed();
      const afterNumber =
        last?.kind === 'heading' && last.level === 1 && BARE_NUMBER.test(last.text);
      const kind: Kind =
        i >= noteFrom
          ? 'note'
          : classify(l, s, body, {
              prevKind,
              prevLine,
              nextLine: p.lines[i + 1],
              gapAbove: prevLine ? prevLine.y - l.y : s.top + s.gap - l.y,
              first: i === 0,
              afterNumber,
            });

      if (kind === 'note') {
        const last = notes[notes.length - 1];
        if (last?.kind === 'note' && !NOTE_START.test(text)) last.text = joinLines(last.text, text);
        else notes.push({ kind: 'note', text, srcPage: p.pageIndex });
      } else if (kind === 'break') {
        out.push({ kind: 'break', srcPage: p.pageIndex });
        lastBody = null;
      } else if (kind === 'subtitle') {
        out.push({ kind: 'heading', level: 2, text, srcPage: p.pageIndex });
        lastBody = null;
      } else if (kind === 'heading1' || kind === 'heading2') {
        const level = kind === 'heading1' ? 1 : 2;
        // Alt alta başlık satırları birleşir; bölüm adı, bir önceki sayfada kalmış numarasıyla da birleşir
        const continues = prevKind === kind || (kind === 'heading1' && afterNumber);
        if (continues && last?.kind === 'heading' && last.level === level)
          last.text = `${last.text} ${text}`;
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
  // Paragraflar gibi başlık ve dipnotlarda da yumuşak tire ve fazla boşluk kalmasın (konumlar bu metne göre tutulur)
  for (const b of out.blocks) {
    if (b.kind === 'heading' || b.kind === 'note') b.text = finalizeText(b.text);
  }
  return out.blocks;
}
