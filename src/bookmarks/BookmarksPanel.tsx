import { Bookmark, Trash2 } from 'lucide-react';
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { SavedBookmark } from './store';

/** Eklenme tarihi: "29 Eylül 2026" */
const DATE = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Yer imleri listesi: sayfa sırasıyla; her satırda sayfa numarası, bölüm adı, eklenme tarihi ve silme düğmesi.
 * Satıra dokununca o sayfa açılır.
 */
export function BookmarksList({
  bookmarks,
  isCurrent,
  pageLabel,
  chapterOf,
  onGo,
  onDelete,
  textView = false,
}: {
  /** undefined: okunuyor */
  bookmarks: SavedBookmark[] | undefined;
  /** metin görünümü: boş listede yer imlerinin PDF sayfasına konduğu da söylenir */
  textView?: boolean;
  /** yer imi açık sayfada mı (vurgulanır) */
  isCurrent(b: SavedBookmark): boolean;
  /** açık görünümdeki sayfa numarası (1'den) */
  pageLabel(b: SavedBookmark): string;
  /** yer iminin bölümü ('' : bölüm yok) */
  chapterOf(b: SavedBookmark): string;
  onGo(b: SavedBookmark): void;
  onDelete(b: SavedBookmark): void;
}) {
  const listRef = useRef<HTMLUListElement>(null);

  if (!bookmarks) return <p className="p-4 text-sm text-secondary">Yer imleri okunuyor…</p>;
  if (bookmarks.length === 0)
    return (
      <div className="flex flex-col gap-1 p-4 text-sm" data-testid="bookmarks-empty">
        <p>Henüz yer imi yok.</p>
        <p className="text-xs text-secondary">
          Sayfanın köşesine dokunarak, ⋯ menüsündeki Yer imi ile ya da B tuşuyla sayfanın köşesini
          kıvırabilirsin.
        </p>
        {textView && (
          <p className="text-xs text-secondary" data-testid="bookmarks-pdf-hint">
            Yer imleri kitabın basılı (PDF) sayfalarına konur: metin görünümündeki sayfa, başladığı
            PDF sayfasıyla işaretlenir.
          </p>
        )}
      </div>
    );

  // Silinen satır odaklıysa odak komşu satıra geçer (odak kaybolmasın)
  const remove = (b: SavedBookmark) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('li') ?? [])];
    const i = items.findIndex((el) => el.dataset.bookmarkId === String(b.id));
    if (i >= 0 && items[i].contains(document.activeElement))
      (items[i + 1] ?? items[i - 1])?.querySelector<HTMLElement>('button')?.focus();
    onDelete(b);
  };

  return (
    <ul ref={listRef} aria-label="Yer imleri" className="py-1">
      {bookmarks.map((b) => {
        const current = isCurrent(b);
        const chapter = chapterOf(b);
        return (
          <li
            key={b.id}
            data-testid="bookmark-item"
            data-bookmark-id={b.id}
            data-page={b.pdfPage + 1}
            className="flex items-center px-1.5"
          >
            <button
              type="button"
              data-testid="bookmark-go"
              aria-current={current ? 'true' : undefined}
              onClick={() => onGo(b)}
              className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-inner px-3 py-2 text-left text-[15px] hover:bg-fill"
            >
              <Bookmark
                aria-hidden="true"
                className={`size-4 shrink-0 ${current ? 'fill-current text-accent' : 'text-secondary'}`}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={`font-book ${current ? 'text-accent' : ''}`}>
                  Sayfa {pageLabel(b)}
                  {chapter && <span className="text-secondary"> · {chapter}</span>}
                </span>
                <span className="text-xs text-secondary">{DATE.format(b.createdAt)}</span>
              </span>
            </button>
            <button
              type="button"
              aria-label={`Yer imini sil: sayfa ${pageLabel(b)}`}
              data-testid="bookmark-delete"
              onClick={() => remove(b)}
              className="grid size-11 shrink-0 place-items-center rounded-full text-secondary hover:bg-fill hover:text-danger"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export type NavTab = 'toc' | 'bookmarks';

/**
 * İçindekiler paneli iki sekmeli: bölümler ve yer imleri. ←/→ sekmeler arasında geçer.
 */
export function NavTabs({
  tab,
  onTab,
  bookmarkCount,
  toc,
  bookmarks,
}: {
  tab: NavTab;
  onTab(tab: NavTab): void;
  bookmarkCount: number;
  toc: ReactNode;
  bookmarks: ReactNode;
}) {
  const id = useId();
  const tabs: { key: NavTab; label: string; testId: string }[] = [
    { key: 'toc', label: 'İçindekiler', testId: 'tab-toc' },
    { key: 'bookmarks', label: 'Yer imleri', testId: 'tab-bookmarks' },
  ];
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next: NavTab = tab === 'toc' ? 'bookmarks' : 'toc';
    onTab(next);
    // React olayın currentTarget'ını işleyiciden sonra boşaltır: sekme listesi kareden önce alınır
    const list = e.currentTarget;
    requestAnimationFrame(() => list.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus());
  };
  return (
    <div className="flex max-h-[70dvh] flex-col">
      <div
        role="tablist"
        aria-label="Gezinme"
        onKeyDown={onKey}
        className="flex shrink-0 gap-1 p-2"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`${id}-${t.key}`}
            data-tab={t.key}
            data-testid={t.testId}
            aria-selected={tab === t.key}
            aria-controls={`${id}-panel`}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => onTab(t.key)}
            className={`ui-press flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-control px-3 text-[15px] ${tab === t.key ? 'bg-fill font-semibold text-ink' : 'text-secondary hover:text-ink'}`}
          >
            {t.label}
            {t.key === 'bookmarks' && bookmarkCount > 0 && (
              <span className="rounded-full bg-tint px-1.5 text-xs font-semibold text-accent tabular-nums">
                {bookmarkCount}
              </span>
            )}
          </button>
        ))}
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${tab}`}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {tab === 'toc' ? toc : bookmarks}
      </div>
    </div>
  );
}
