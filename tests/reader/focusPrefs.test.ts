import { describe, expect, it } from 'vitest';
import { parseFocusPrefs } from '../../src/reader/modes/focusPrefs';

const DEFAULTS = { dim: 'medium', keep: true, unit: 'word', words: 5 };

describe('parseFocusPrefs', () => {
  it('varsayılan: orta karartma, kalem kalkınca açık kalır, kalemin iki yanında 5 kelime', () => {
    expect(parseFocusPrefs(null)).toEqual(DEFAULTS);
    expect(parseFocusPrefs('bozuk')).toEqual(DEFAULTS);
    // eski kayıt (birim ve pencere boyu yok): kelime penceresine geçer, öteki ayarlar korunur
    expect(parseFocusPrefs({ dim: 'strong', keep: false })).toEqual({
      ...DEFAULTS,
      dim: 'strong',
      keep: false,
    });
  });

  it('geçerli değerler korunur, geçersizler varsayılana döner', () => {
    expect(parseFocusPrefs({ dim: 'blur', keep: false, unit: 'sentence', words: 12 })).toEqual({
      dim: 'blur',
      keep: false,
      unit: 'sentence',
      words: 12,
    });
    expect(parseFocusPrefs({ dim: 'strong', words: 3 })).toEqual({
      ...DEFAULTS,
      dim: 'strong',
      words: 3,
    });
    expect(parseFocusPrefs({ dim: 'çok', keep: 'evet', unit: 'harf', words: 7 })).toEqual(DEFAULTS);
    expect(parseFocusPrefs({ words: '8' })).toEqual(DEFAULTS);
  });
});
