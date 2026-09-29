import { createLocalStore } from '../../app/localStore';

/** Hatırlanan son arama sayısı */
export const HISTORY_SIZE = 5;

interface SearchHistory {
  /** en yenisi başta */
  queries: string[];
}

export function parseHistory(raw: unknown): SearchHistory {
  const list = (raw as Partial<SearchHistory> | null)?.queries;
  return {
    queries: Array.isArray(list)
      ? list
          .filter((q): q is string => typeof q === 'string' && q.trim() !== '')
          .slice(0, HISTORY_SIZE)
      : [],
  };
}

const store = createLocalStore('mypdfbook:search', parseHistory);

export const useSearchHistory = () => store.useValue().queries;

/** Aramayı en başa ekler (aynısı varsa, büyük/küçük harf farkı gözetmeden, yerinden alınır) */
export function rememberQuery(query: string): void {
  const q = query.trim().replace(/\s+/g, ' ');
  if (!q) return;
  const key = q.toLocaleLowerCase('tr');
  const rest = store.get().queries.filter((x) => x.toLocaleLowerCase('tr') !== key);
  store.set({ queries: [q, ...rest].slice(0, HISTORY_SIZE) });
}
