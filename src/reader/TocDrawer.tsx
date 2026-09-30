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
    return <p className="p-4 text-sm text-secondary">Bu kitapta bölüm bulunamadı.</p>;
  }
  return (
    <nav
      aria-label="İçindekiler"
      className="max-h-[70dvh] overflow-y-auto overscroll-contain px-1.5 py-1.5"
    >
      <ol>
        {chapters.map((c, i) => (
          <li key={`${c.block}-${i}`}>
            <button
              type="button"
              aria-current={i === current ? 'true' : undefined}
              onClick={() => onSelect(c)}
              className={`block min-h-11 w-full rounded-inner px-3 py-2.5 text-left text-[15px] leading-snug hover:bg-fill ${c.level > 1 ? 'pl-7 text-secondary' : 'font-medium'} ${i === current ? 'bg-tint text-accent' : ''}`}
            >
              {c.title}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
