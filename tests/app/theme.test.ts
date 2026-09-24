import { describe, expect, it } from 'vitest';
import { resolveTheme } from '../../src/app/theme';

describe('resolveTheme', () => {
  it('"sistem" ayarını cihaz tercihine göre çözer', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
  it('açık seçimleri olduğu gibi döndürür', () => {
    expect(resolveTheme('sepia', true)).toBe('sepia');
    expect(resolveTheme('black', false)).toBe('black');
  });
});
