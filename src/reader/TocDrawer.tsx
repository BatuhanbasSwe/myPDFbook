import type { Chapter } from '../convert/types';

/** İçindekiler: bölüme dokununca o bölümün sayfası açılır. */
export function TocDrawer({
  chapters,
  current,
  onSelect,
}: {
  chapters: Chapter[];
  /** okunan bölümün indeksi */
  current: number;
  onSelect(chapter: Chapter): void;
}) {
  if (chapters.length === 0) {
    return <p className="p-4 text-sm text-muted">Bu kitapta bölüm bulunamadı.</p>;
  }
  return (
    <nav aria-label="İçindekiler" className="max-h-[70dvh] overflow-y-auto py-2">
      <ol>
        {chapters.map((c, i) => (
          <li key={`${c.block}-${i}`}>
            <button
              type="button"
              aria-current={i === current ? 'true' : undefined}
              onClick={() => onSelect(c)}
              className={`block min-h-11 w-full px-4 py-2 text-left text-sm hover:bg-surface ${c.level > 1 ? 'pl-8 text-muted' : 'font-book'} ${i === current ? 'text-accent' : ''}`}
            >
              {c.title}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
