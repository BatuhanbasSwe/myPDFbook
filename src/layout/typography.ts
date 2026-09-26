import { createLocalStore } from '../app/localStore';

export const FONTS = ['literata', 'source-serif', 'inter', 'atkinson'] as const;
export type BookFont = (typeof FONTS)[number];

export const FONT_LABELS: Record<BookFont, string> = {
  literata: 'Literata',
  'source-serif': 'Source Serif',
  inter: 'Inter',
  atkinson: 'Atkinson (okunaklı)',
};

/** CSS font-family değerleri; @fontsource paketlerinin tanımladığı adlar (src/main.tsx'te yüklenir). */
export const FONT_FAMILIES: Record<BookFont, string> = {
  literata: "'Literata Variable', Georgia, serif",
  'source-serif': "'Source Serif 4', Georgia, serif",
  inter: "'Inter Variable', system-ui, sans-serif",
  atkinson: "'Atkinson Hyperlegible', system-ui, sans-serif",
};

export type Margin = 'narrow' | 'normal' | 'wide';
export type Align = 'justify' | 'left';
/** auto: ekran yataysa ve genişse çift sayfa */
export type Spread = 'auto' | 'single';

export interface Typography {
  font: BookFont;
  /** px */
  size: number;
  lineHeight: number;
  margin: Margin;
  align: Align;
  hyphenate: boolean;
  spread: Spread;
}

export const DEFAULT_TYPOGRAPHY: Typography = {
  font: 'literata',
  size: 19,
  lineHeight: 1.6,
  margin: 'normal',
  align: 'justify',
  hyphenate: true,
  spread: 'auto',
};

export const SIZE_RANGE = { min: 14, max: 30, step: 1 } as const;
export const LINE_HEIGHT_RANGE = { min: 1.3, max: 2, step: 0.1 } as const;

/** Sayfa kenar boşluğu, punto katı olarak (satır uzunluğu da buna göre kısalır) */
export const MARGIN_EM: Record<Margin, number> = { narrow: 1, normal: 1.75, wide: 2.75 };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Saklanan (eski ya da bozuk olabilecek) değeri geçerli ayarlara çevirir. */
export function parseTypography(raw: unknown): Typography {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<
    Record<keyof Typography, unknown>
  >;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;
  const num = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback;
  const d = DEFAULT_TYPOGRAPHY;
  return {
    font: pick(o.font, FONTS, d.font),
    size: Math.round(num(o.size, d.size, SIZE_RANGE.min, SIZE_RANGE.max)),
    lineHeight:
      Math.round(
        num(o.lineHeight, d.lineHeight, LINE_HEIGHT_RANGE.min, LINE_HEIGHT_RANGE.max) * 10,
      ) / 10,
    margin: pick(o.margin, ['narrow', 'normal', 'wide'] as const, d.margin),
    align: pick(o.align, ['justify', 'left'] as const, d.align),
    hyphenate: typeof o.hyphenate === 'boolean' ? o.hyphenate : d.hyphenate,
    spread: pick(o.spread, ['auto', 'single'] as const, d.spread),
  };
}

/** Kitap sayfasının CSS değişkenleri (sayfa görünümü ve sayfalayıcının ölçüm kutusu aynı değerleri kullanır). */
export function typographyStyle(t: Typography): Record<string, string> {
  return {
    '--book-font': FONT_FAMILIES[t.font],
    '--book-size': `${t.size}px`,
    '--book-leading': String(t.lineHeight),
    '--book-align': t.align,
    '--book-hyphens': t.hyphenate ? 'auto' : 'manual',
  };
}

// Tema gibi cihaza özel: localStorage'da tutulur; ilk sayfalamada eşzamanlı okunabilmesi gerekir.
const store = createLocalStore('mypdfbook:typography', parseTypography);
export const getTypography = store.get;
export const setTypography = store.set;
export const useTypography = store.useValue;
