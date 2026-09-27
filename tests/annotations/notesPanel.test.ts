import { describe, expect, it } from 'vitest';
import { groupMarks } from '../../src/annotations/NotesPanel';
import type { SavedAnnotation } from '../../src/annotations/store';

let nextId = 1;
const mark = (page: number, kind: SavedAnnotation['kind']): SavedAnnotation => ({
  id: nextId++,
  bookId: 'a',
  page,
  kind,
  color: '#1f1b16',
  width: 0.0035,
  points: [0.1, 0.1, 0.2, 0.2],
  createdAt: 1,
  updatedAt: 1,
});

const shape = (all: SavedAnnotation[]) =>
  groupMarks(all).map(({ page, rows }) => [
    page,
    rows.map((r) => `${r.marks[0].kind}×${r.marks.length}`),
  ]);

describe('groupMarks (Notlar paneli satırları)', () => {
  it('sayfadaki ardışık kalem çizgileri tek satırdır; boyama ve not tek tek kalır', () => {
    const all = [
      mark(0, 'ink'),
      mark(0, 'ink'),
      mark(0, 'ink'),
      mark(0, 'highlight'),
      mark(0, 'ink'),
      mark(0, 'note'),
      mark(0, 'highlight'),
      mark(0, 'highlight'),
      mark(2, 'ink'),
      mark(3, 'ink'),
      mark(3, 'ink'),
    ];
    expect(shape(all)).toEqual([
      [0, ['ink×3', 'highlight×1', 'ink×1', 'note×1', 'highlight×1', 'highlight×1']],
      [2, ['ink×1']],
      [3, ['ink×2']],
    ]);
  });

  it('öbek işaretlerini eklenme sırasıyla taşır', () => {
    const all = [mark(1, 'ink'), mark(1, 'ink')];
    const [{ rows }] = groupMarks(all);
    expect(rows[0].marks.map((m) => m.id)).toEqual(all.map((m) => m.id));
  });
});
