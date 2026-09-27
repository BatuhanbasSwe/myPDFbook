import { createLocalStore } from '../app/localStore';

/** Kalem kipindeki araç */
export type PenTool = 'highlight' | 'ink' | 'eraser' | 'note';

/** Çizen araçlar: kalem kipi kapalıyken Apple Pencil bunlardan biriyle çizer */
export type DrawTool = 'highlight' | 'ink';

export interface PenColor {
  value: string;
  label: string;
}

/** Fosforlu kalem renkleri: yarı saydam ve çarpma karışımıyla çizilir (yazı koyu kalır) */
export const HIGHLIGHT_COLORS: readonly PenColor[] = [
  { value: '#ffd400', label: 'Sarı' },
  { value: '#5fd35f', label: 'Yeşil' },
  { value: '#ff6fae', label: 'Pembe' },
  { value: '#56b4ff', label: 'Mavi' },
];

/** Kalem renkleri: ince ve opak */
export const INK_COLORS: readonly PenColor[] = [
  { value: '#1f1b16', label: 'Siyah' },
  { value: '#d32f2f', label: 'Kırmızı' },
  { value: '#1d4ed8', label: 'Mavi' },
];

/** Not iğnesinin rengi */
export const NOTE_COLOR = '#f2b705';

/** Çizgi kalınlığı, sayfa genişliğine oranla: fosforlu kalem bir satırı örter, kalem ince yazar */
export const STROKE_WIDTH: Record<DrawTool, number> = { highlight: 0.028, ink: 0.0035 };

/** Fosforlu kalemin saydamlığı */
export const HIGHLIGHT_OPACITY = 0.45;

export interface PenPrefs {
  tool: PenTool;
  /**
   * Son seçilen çizen araç: kip kapalıyken Apple Pencil bununla çizer (seçili araç silgi ya da not olsa da; kip
   * kapalıyken silmesi ya da not koyması beklenmez)
   */
  drawTool: DrawTool;
  highlightColor: string;
  inkColor: string;
  /** "Kalemle her zaman çiz": kalem kipi kapalıyken de Apple Pencil çizer, parmak sayfa çevirir */
  penAlways: boolean;
}

export const DEFAULT_PEN_PREFS: PenPrefs = {
  tool: 'highlight',
  drawTool: 'highlight',
  highlightColor: HIGHLIGHT_COLORS[0].value,
  inkColor: INK_COLORS[0].value,
  penAlways: true,
};

const isDrawTool = (tool: unknown): tool is DrawTool => tool === 'highlight' || tool === 'ink';

export function parsePenPrefs(raw: unknown): PenPrefs {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<
    Record<keyof PenPrefs, unknown>
  >;
  const tools: PenTool[] = ['highlight', 'ink', 'eraser', 'note'];
  const color = (v: unknown, list: readonly PenColor[], d: string) =>
    list.some((c) => c.value === v) ? (v as string) : d;
  const tool = tools.includes(o.tool as PenTool) ? (o.tool as PenTool) : DEFAULT_PEN_PREFS.tool;
  return {
    tool,
    // Eski kayıtta yok: seçili araç çizen araçsa odur
    drawTool: isDrawTool(o.drawTool)
      ? o.drawTool
      : isDrawTool(tool)
        ? tool
        : DEFAULT_PEN_PREFS.drawTool,
    highlightColor: color(o.highlightColor, HIGHLIGHT_COLORS, DEFAULT_PEN_PREFS.highlightColor),
    inkColor: color(o.inkColor, INK_COLORS, DEFAULT_PEN_PREFS.inkColor),
    penAlways: typeof o.penAlways === 'boolean' ? o.penAlways : DEFAULT_PEN_PREFS.penAlways,
  };
}

const store = createLocalStore('mypdfbook:pen', parsePenPrefs);
export const getPenPrefs = store.get;
export const setPenPrefs = store.set;
export const usePenPrefs = store.useValue;

/** Aracı seçer; çizen araçsa kip kapalıyken kalemin aracı da o olur */
export function choosePenTool(tool: PenTool): void {
  setPenPrefs(isDrawTool(tool) ? { tool, drawTool: tool } : { tool });
}

/** Seçili aracın rengi (silgi ve notta yok) */
export function toolColor(prefs: PenPrefs, tool: PenTool = prefs.tool): string | null {
  if (tool === 'highlight') return prefs.highlightColor;
  if (tool === 'ink') return prefs.inkColor;
  return null;
}
