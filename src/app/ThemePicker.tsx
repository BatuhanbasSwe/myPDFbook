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

/** Onay işaretinin rengi: örneğin üstünde okunsun */
const CHECK: Record<ThemeSetting, string> = {
  system: '#9a5b2a',
  light: '#9a5b2a',
  sepia: '#8a4f22',
  dark: '#d9a46c',
  black: '#d9a46c',
};

/** Tema seçici: iOS'taki gibi yuvarlak örnekler; seçili örneğin çevresinde vurgu halkası ve onay işareti */
export function ThemePicker() {
  const current = useThemeSetting();
  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className="flex flex-1 flex-wrap justify-between gap-2"
    >
      {THEMES.map((theme) => {
        const on = current === theme;
        return (
          <button
            key={theme}
            type="button"
            role="radio"
            aria-checked={on}
            data-testid={`theme-${theme}`}
            onClick={() => setThemeSetting(theme)}
            className="ui-press flex min-w-11 flex-col items-center gap-1.5 rounded-control text-xs"
          >
            <span
              className={`grid size-11 place-items-center rounded-full shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.18)] ${
                on ? 'ring-2 ring-accent ring-offset-2 ring-offset-group' : ''
              }`}
              style={{ background: SWATCHES[theme] }}
            >
              {on && <Check className="size-4" strokeWidth={3} style={{ color: CHECK[theme] }} />}
            </span>
            <span className={on ? 'font-semibold text-ink' : 'text-secondary'}>
              {LABELS[theme]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
