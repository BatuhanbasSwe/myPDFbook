import { useSyncExternalStore } from 'react';

export const THEMES = ['system', 'light', 'sepia', 'dark', 'black'] as const;
export type ThemeSetting = (typeof THEMES)[number];
export type ResolvedTheme = Exclude<ThemeSetting, 'system'>;

// Tema cihaza özel bir tercih olduğu için localStorage'da tutulur (index.html'deki betik ilk çizimden önce okur).
const KEY = 'mypdfbook:theme';
// index.html'deki ön boyama betiğindeki renklerle aynı tutulmalı.
const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: '#f7f3ea',
  sepia: '#f1e4c6',
  dark: '#1b1a18',
  black: '#000000',
};

export function resolveTheme(setting: ThemeSetting, prefersDark: boolean): ResolvedTheme {
  if (setting === 'system') return prefersDark ? 'dark' : 'light';
  return setting;
}

function readSetting(): ThemeSetting {
  try {
    const value = localStorage.getItem(KEY) ?? 'system';
    return (THEMES as readonly string[]).includes(value) ? (value as ThemeSetting) : 'system';
  } catch {
    return 'system';
  }
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(): void {
  const theme = resolveTheme(readSetting(), darkQuery().matches);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}

export function setThemeSetting(value: ThemeSetting): void {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // gizli sekme vb.: tema yalnızca bu oturumda geçerli olur
  }
  applyTheme();
  listeners.forEach((listener) => listener());
}

export function useThemeSetting(): ThemeSetting {
  return useSyncExternalStore(subscribe, readSetting, () => 'system');
}

/** Açılışta bir kez çağrılır; sistem teması değişince de günceller. */
export function initTheme(): void {
  applyTheme();
  darkQuery().addEventListener('change', applyTheme);
}
