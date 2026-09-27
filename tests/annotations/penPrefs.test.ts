import { describe, expect, it } from 'vitest';
import { DEFAULT_PEN_PREFS, parsePenPrefs } from '../../src/annotations/penPrefs';

describe('parsePenPrefs', () => {
  it('bozuk ya da boş kayıt varsayılanlara döner', () => {
    expect(parsePenPrefs(null)).toEqual(DEFAULT_PEN_PREFS);
    expect(parsePenPrefs({ tool: 'kalem', drawTool: 'eraser', inkColor: 'red' })).toEqual(
      DEFAULT_PEN_PREFS,
    );
  });

  it('kip kapalıyken kalemin aracı son seçilen çizen araçtır (silgi ya da not seçiliyken de)', () => {
    expect(parsePenPrefs({ tool: 'eraser', drawTool: 'ink' })).toMatchObject({
      tool: 'eraser',
      drawTool: 'ink',
    });
    expect(parsePenPrefs({ tool: 'note', drawTool: 'highlight' }).drawTool).toBe('highlight');
  });

  it('eski kayıtta çizen araç yoksa seçili araçtan gelir', () => {
    expect(parsePenPrefs({ tool: 'ink' }).drawTool).toBe('ink');
    expect(parsePenPrefs({ tool: 'note' }).drawTool).toBe('highlight');
  });
});
