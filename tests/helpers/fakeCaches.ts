/**
 * Node'da Cache Storage yok: bellek içi en küçük uygulaması (yapay zekâ seslerinin saklanması için). `failPut`
 * yazmayı reddettirir (ör. yer kalmadı).
 */
export interface FakeCaches {
  caches: CacheStorage;
  /** önbellekteki adresler */
  urls(name?: string): string[];
  failPut: ((url: string) => Error | null) | null;
}

export function createFakeCaches(): FakeCaches {
  const stores = new Map<string, Map<string, { body: Blob; headers: [string, string][] }>>();
  const fake: FakeCaches = {
    failPut: null,
    urls: (name) =>
      name
        ? [...(stores.get(name)?.keys() ?? [])]
        : [...stores.values()].flatMap((s) => [...s.keys()]),
    caches: undefined as unknown as CacheStorage,
  };
  // Göreli adres sayfanın adresine göre (tarayıcıdaki gibi)
  const keyOf = (req: RequestInfo | URL) =>
    typeof req === 'string'
      ? new URL(req, globalThis.location?.href).href
      : req instanceof URL
        ? req.href
        : req.url;
  const open = (name: string): Cache => {
    let store = stores.get(name);
    if (!store) stores.set(name, (store = new Map()));
    const s = store;
    return {
      async match(req: RequestInfo | URL) {
        const hit = s.get(keyOf(req));
        return hit ? new Response(hit.body, { headers: hit.headers }) : undefined;
      },
      async put(req: RequestInfo | URL, res: Response) {
        const url = keyOf(req);
        const err = fake.failPut?.(url);
        if (err) throw err;
        s.set(url, { body: await res.blob(), headers: [...res.headers] });
      },
      async delete(req: RequestInfo | URL) {
        return s.delete(keyOf(req));
      },
      async keys() {
        return [...s.keys()].map((u) => new Request(u));
      },
    } as unknown as Cache;
  };
  fake.caches = {
    open: async (name: string) => open(name),
    delete: async (name: string) => stores.delete(name),
    has: async (name: string) => stores.has(name),
    keys: async () => [...stores.keys()],
    match: async () => undefined,
  } as unknown as CacheStorage;
  return fake;
}
