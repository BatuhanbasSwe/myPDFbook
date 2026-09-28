import { describe, expect, it } from 'vitest';
import { parseFocusPrefs } from '../../src/reader/modes/focusPrefs';

describe('parseFocusPrefs', () => {
  it('varsayılan: orta karartma, kalem kalkınca son cümle açık kalır', () => {
    expect(parseFocusPrefs(null)).toEqual({ dim: 'medium', keep: true });
    expect(parseFocusPrefs('bozuk')).toEqual({ dim: 'medium', keep: true });
  });

  it('geçerli değerler korunur, geçersizler varsayılana döner', () => {
    expect(parseFocusPrefs({ dim: 'blur', keep: false })).toEqual({ dim: 'blur', keep: false });
    expect(parseFocusPrefs({ dim: 'strong' })).toEqual({ dim: 'strong', keep: true });
    expect(parseFocusPrefs({ dim: 'çok', keep: 'evet' })).toEqual({ dim: 'medium', keep: true });
  });
});
