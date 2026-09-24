import { Check } from 'lucide-react';
import { setThemeSetting, THEMES, useThemeSetting, type ThemeSetting } from './theme';

const LABELS: Record<ThemeSetting, string> = {
  system: 'Sistem',
  light: 'Açık',
  sepia: 'Sepya',
  dark: 'Koyu',
  black: 'Siyah',
};

const SWATCHES: Record<ThemeSetting, string> = {
  system: 'linear-gradient(135deg, #f7f3ea 50%, #1b1a18 50%)',
  light: '#f7f3ea',
  sepia: '#f1e4c6',
  dark: '#1b1a18',
  black: '#000000',
};

export function ThemePicker() {
  const current = useThemeSetting();
  return (
    <div role="radiogroup" aria-label="Tema" className="flex flex-wrap gap-3">
      {THEMES.map((theme) => (
        <button
          key={theme}
          type="button"
          role="radio"
          aria-checked={current === theme}
          data-testid={`theme-${theme}`}
          onClick={() => setThemeSetting(theme)}
          className="flex flex-col items-center gap-1 text-xs text-muted"
        >
          <span
            className="grid size-10 place-items-center rounded-full border border-line"
            style={{ background: SWATCHES[theme] }}
          >
            {current === theme && <Check className="size-4 text-accent" strokeWidth={3} />}
          </span>
          {LABELS[theme]}
        </button>
      ))}
    </div>
  );
}
