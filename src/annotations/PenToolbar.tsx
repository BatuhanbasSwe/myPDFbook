import { Eraser, Highlighter, PenLine, StickyNote, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  choosePenTool,
  HIGHLIGHT_COLORS,
  INK_COLORS,
  setPenPrefs,
  toolColor,
  usePenPrefs,
  type PenTool,
} from './penPrefs';

const TOOLS: { tool: PenTool; label: string; icon: ReactNode }[] = [
  { tool: 'highlight', label: 'Fosforlu kalem', icon: <Highlighter className="size-5" /> },
  { tool: 'ink', label: 'Kalem', icon: <PenLine className="size-5" /> },
  { tool: 'eraser', label: 'Silgi', icon: <Eraser className="size-5" /> },
  { tool: 'note', label: 'Not', icon: <StickyNote className="size-5" /> },
];

/**
 * Kalem kipinin araç çubuğu: ekranın üstünde yüzer (altta sayfa çevirme düğmeleri durur). Araç ve renk seçimi
 * cihazda saklanır.
 */
export function PenToolbar({
  belowHeader,
  canUndo,
  onUndo,
  onDone,
}: {
  /** üst çubuk açık: çubuğun altında durur */
  belowHeader: boolean;
  canUndo: boolean;
  onUndo(): void;
  onDone(): void;
}) {
  const prefs = usePenPrefs();
  const colors =
    prefs.tool === 'highlight' ? HIGHLIGHT_COLORS : prefs.tool === 'ink' ? INK_COLORS : null;
  const current = toolColor(prefs);
  // Dar ekranda iki satır: üstte araçlar, geri al ve Bitti; altta renkler. Genişte tek satır: araçlar, renkler, eylemler
  return (
    <div
      role="toolbar"
      aria-label="Kalem araçları"
      data-testid="pen-toolbar"
      className={`absolute left-1/2 ${belowHeader ? 'top-[calc(4rem+env(safe-area-inset-top))]' : 'top-[max(0.5rem,env(safe-area-inset-top))]'} z-20 flex w-max max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center rounded-2xl border border-line bg-surface/95 p-1 text-ink shadow-lg backdrop-blur`}
    >
      <div className="flex items-center gap-0.5">
        {TOOLS.map(({ tool, label, icon }) => (
          <button
            key={tool}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={prefs.tool === tool}
            data-testid={`pen-tool-${tool}`}
            onClick={() => choosePenTool(tool)}
            className={`grid size-11 place-items-center rounded-xl ${prefs.tool === tool ? 'bg-accent/15 text-accent' : 'text-ink hover:bg-paper'}`}
          >
            {icon}
          </button>
        ))}
      </div>
      {colors && (
        <div className="order-last flex basis-full items-center justify-center gap-0.5 border-t border-line pt-1 sm:order-none sm:ml-1 sm:basis-auto sm:border-t-0 sm:border-l sm:pt-0 sm:pl-1">
          {colors.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-label={c.label}
              title={c.label}
              aria-pressed={current === c.value}
              data-testid="pen-color"
              onClick={() =>
                setPenPrefs(
                  prefs.tool === 'highlight' ? { highlightColor: c.value } : { inkColor: c.value },
                )
              }
              className="grid size-11 place-items-center rounded-xl hover:bg-paper"
            >
              <span
                className={`size-6 rounded-full border border-black/15 ${current === c.value ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface' : ''}`}
                style={{ background: c.value }}
              />
            </button>
          ))}
        </div>
      )}
      <div className="ml-1 flex items-center gap-1 border-l border-line pl-1">
        <button
          type="button"
          aria-label="Geri al"
          title="Geri al"
          data-testid="pen-undo"
          disabled={!canUndo}
          onClick={onUndo}
          className="grid size-11 place-items-center rounded-xl text-ink hover:bg-paper disabled:opacity-35 disabled:hover:bg-transparent"
        >
          <Undo2 className="size-5" />
        </button>
        <button
          type="button"
          data-testid="pen-done"
          onClick={onDone}
          className="min-h-11 rounded-xl bg-accent px-4 text-sm font-medium text-paper"
        >
          Bitti
        </button>
      </div>
    </div>
  );
}
