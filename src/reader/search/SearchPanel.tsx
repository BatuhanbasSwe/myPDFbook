import { History, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Block, Chapter, Lang } from '../../convert/types';
import { SEARCH_LIMIT, searchBook, searchIndex, type SearchResult } from '../../text/search';
import { currentChapter } from '../progress';
import { rememberQuery, useSearchHistory } from './searchHistory';

/** Yazarken arama bu kadar bekler (ms) */
export const SEARCH_DEBOUNCE = 200;

interface Group {
  /** bölümün indeksi (-1: ilk bölümden önce) */
  chapter: number;
  title: string;
  items: { result: SearchResult; index: number }[];
}

/** Sonuçları bölümlere göre toplar (sonuçlar kitap sırasında: aynı bölümdekiler art arda gelir) */
export function groupByChapter(
  results: SearchResult[],
  chapters: Chapter[],
  bookTitle: string,
): Group[] {
  const groups: Group[] = [];
  results.forEach((result, index) => {
    const chapter = currentChapter(chapters, result.locator);
    let group = groups.at(-1);
    if (group?.chapter !== chapter) {
      group = { chapter, title: chapter >= 0 ? chapters[chapter].title : bookTitle, items: [] };
      groups.push(group);
    }
    group.items.push({ result, index });
  });
  return groups;
}

/**
 * Kitap içinde arama paneli: arama kutusu (yazarken 200 ms sonra arar), sonuç sayısı ve bölümlere göre sonuçlar.
 * Her sonuçta sayfa numarası ve eşleşmesi kalın bir metin parçası vardır. ↑/↓ sonuçlar arasında gezer, Enter
 * seçili (yoksa ilk) sonuca gider; Esc paneli kapatır (okuyucu). Kutu boşken son aramalar listelenir.
 */
export function SearchPanel({
  blocks,
  chapters,
  lang,
  bookTitle,
  pageLabel,
  onGo,
}: {
  blocks: Block[];
  chapters: Chapter[];
  lang: Lang;
  bookTitle: string;
  /** sonucun açık görünümdeki sayfa numarası (1'den) */
  pageLabel(result: SearchResult): string;
  onGo(result: SearchResult): void;
}) {
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [active, setActive] = useState(-1);
  const recent = useSearchHistory();
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  // Arama dizini panel açılınca, ilk çizimden sonra kurulur (büyük kitapta birkaç on ms): yazmaya başlayınca hazır
  useEffect(() => {
    const timer = setTimeout(() => searchIndex(blocks, lang), 0);
    return () => clearTimeout(timer);
  }, [blocks, lang]);

  // Yazarken 200 ms gecikmeyle arar
  useEffect(() => {
    if (query === searched) return;
    const timer = setTimeout(() => {
      setSearched(query);
      setActive(-1);
    }, SEARCH_DEBOUNCE);
    return () => clearTimeout(timer);
  }, [query, searched]);

  const outcome = useMemo(
    () => (searched.trim() ? searchBook(blocks, searched, { lang }) : null),
    [blocks, lang, searched],
  );
  const groups = useMemo(
    () => (outcome ? groupByChapter(outcome.results, chapters, bookTitle) : []),
    [outcome, chapters, bookTitle],
  );
  // Kutu boşken son aramalar
  const showRecent = query.trim() === '' && recent.length > 0;
  const count = showRecent ? recent.length : (outcome?.results.length ?? 0);

  // Seçili satır görünür kalsın
  useEffect(() => {
    if (active < 0) return;
    listRef.current
      ?.querySelector(`[data-option="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = (result: SearchResult) => {
    rememberQuery(searched);
    onGo(result);
  };
  const pickRecent = (q: string) => {
    setQuery(q);
    setSearched(q);
    setActive(-1);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (count === 0) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a < 0 ? (d > 0 ? 0 : count - 1) : (a + d + count) % count));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showRecent) {
        if (active >= 0 && recent[active]) pickRecent(recent[active]);
        return;
      }
      // Yazılan henüz aranmadıysa hemen aranır; seçili (yoksa ilk) sonuca gidilir
      const results =
        query === searched
          ? (outcome?.results ?? [])
          : searchBook(blocks, query, { lang, limit: 1 }).results;
      const target = results[query === searched && active >= 0 ? active : 0];
      if (query !== searched) setSearched(query);
      if (target) {
        rememberQuery(query);
        onGo(target);
      }
    }
  };

  const optionId = (i: number) => `${id}-o${i}`;
  let status = '';
  if (!showRecent && outcome) {
    const n = outcome.results.length;
    status =
      n === 0
        ? 'Sonuç yok'
        : outcome.more
          ? `${SEARCH_LIMIT}+ sonuç · ilk ${SEARCH_LIMIT} gösteriliyor, daha fazlası için aramayı daralt`
          : `${n} sonuç`;
  }

  return (
    <div className="flex max-h-[70dvh] flex-col" data-testid="search-panel">
      <div className="border-b border-line p-3">
        <label className="relative block">
          <span className="sr-only">Kitapta ara</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
          />
          <input
            autoFocus
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-testid="search-input"
            role="combobox"
            aria-expanded={count > 0}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            placeholder="Kitapta ara"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            className="min-h-11 w-full rounded-lg border border-line bg-paper pr-3 pl-9 text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-solid"
          />
        </label>
        <p
          role="status"
          data-testid="search-status"
          className={`px-1 pt-2 text-xs text-muted ${status ? '' : 'sr-only'}`}
        >
          {status}
        </p>
      </div>
      <div
        ref={listRef}
        id={`${id}-list`}
        role="listbox"
        aria-label={showRecent ? 'Son aramalar' : 'Arama sonuçları'}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"
      >
        {showRecent ? (
          <div role="group" aria-labelledby={`${id}-recent`}>
            <h3
              id={`${id}-recent`}
              className="px-4 pt-2 pb-1 text-xs tracking-wide text-muted uppercase"
            >
              Son aramalar
            </h3>
            {recent.map((q, i) => (
              <div
                key={q}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                data-option={i}
                data-testid="search-recent"
                onClick={() => pickRecent(q)}
                className={`flex min-h-11 cursor-pointer items-center gap-3 px-4 text-sm hover:bg-paper ${i === active ? 'bg-paper' : ''}`}
              >
                <History aria-hidden="true" className="size-4 shrink-0 text-muted" />
                <span className="truncate">{q}</span>
              </div>
            ))}
          </div>
        ) : (
          groups.map((g) => (
            <div key={`${g.chapter}-${g.items[0].index}`} role="group" aria-label={g.title}>
              <h3 className="sticky top-0 truncate bg-surface px-4 pt-2 pb-1 text-xs tracking-wide text-muted uppercase">
                {g.title}
              </h3>
              {g.items.map(({ result, index }) => (
                <div
                  key={index}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  data-option={index}
                  data-testid="search-result"
                  onClick={() => go(result)}
                  className={`flex cursor-pointer items-baseline gap-3 px-4 py-2 text-sm hover:bg-paper ${index === active ? 'bg-paper' : ''}`}
                >
                  <span className="w-10 shrink-0 text-xs text-muted tabular-nums">
                    s. {pageLabel(result)}
                  </span>
                  <span className="line-clamp-2 min-w-0 flex-1 font-book">
                    {result.snippet.before}
                    <mark className="bg-transparent font-bold text-ink">
                      {result.snippet.match}
                    </mark>
                    {result.snippet.after}
                  </span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
