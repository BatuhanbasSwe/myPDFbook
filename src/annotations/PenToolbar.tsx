import { Eraser, Highlighter, PenLine, StickyNote, Undo2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { IconButton } from '../ui/IconButton';
import {
  choosePenTool,
  HIGHLIGHT_COLORS,
  INK_COLORS,
  setPenPrefs,
  toolColor,
  usePenPrefs,
  type PenTool,
} from './penPrefs';

const TOOLS: { tool: PenTool; label: string; Icon: LucideIcon }[] = [
  { tool: 'highlight', label: 'Fosforlu kalem', Icon: Highlighter },
  { tool: 'ink', label: 'Kalem', Icon: PenLine },
  { tool: 'eraser', label: 'Silgi', Icon: Eraser },
  { tool: 'note', label: 'Not', Icon: StickyNote },
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
      className={`absolute left-1/2 ${belowHeader ? 'top-[calc(4rem+env(safe-area-inset-top))]' : 'top-[max(0.5rem,env(safe-area-inset-top))]'} material z-(--ui-z-panel) flex w-max max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-0.5 rounded-panel p-1 text-ink`}
    >
      <div className="flex items-center gap-0.5">
        {TOOLS.map(({ tool, label, Icon }) => (
          <IconButton
            key={tool}
            label={label}
            Icon={Icon}
            aria-pressed={prefs.tool === tool}
            testId={`pen-tool-${tool}`}
            onClick={() => choosePenTool(tool)}
          />
        ))}
      </div>
      {colors && (
        <div className="order-last flex basis-full items-center justify-center gap-0.5 border-t border-hairline pt-1 sm:order-none sm:ml-1 sm:basis-auto sm:border-t-0 sm:border-l sm:pt-0 sm:pl-1">
          {colors.map((c) => (
            <IconButton
              key={c.value}
              label={c.label}
              aria-pressed={current === c.value}
              // Seçili renk halkayla gösterilir (düğmenin vurgu zemini yok)
              active={false}
              testId="pen-color"
              onClick={() =>
                setPenPrefs(
                  prefs.tool === 'highlight' ? { highlightColor: c.value } : { inkColor: c.value },
                )
              }
            >
              <span
                className={`size-6 rounded-full shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.2)] ${current === c.value ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface' : ''}`}
                style={{ background: c.value }}
              />
            </IconButton>
          ))}
        </div>
      )}
      <div className="ml-1 flex items-center gap-1 border-l border-hairline pl-1">
        <IconButton
          label="Geri al"
          testId="pen-undo"
          Icon={Undo2}
          disabled={!canUndo}
          onClick={onUndo}
        />
        <button
          type="button"
          data-testid="pen-done"
          onClick={onDone}
          className="ui-press min-h-11 rounded-full bg-accent px-4 text-[15px] font-semibold text-paper hover:opacity-90"
        >
          Bitti
        </button>
      </div>
    </div>
  );
}
