import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type BookDB } from '../../src/db/db';
import {
  importBook,
  resumeConversions,
  type ImportDeps,
  type OpenedPdf,
} from '../../src/import/importBook';
import { createPdfSource } from '../../src/pdf/pdfSource';

async function nodeOpenPdf(bytes: Uint8Array, password?: string): Promise<OpenedPdf> {
  const doc = await getDocument({ data: bytes, password }).promise;
  return {
    source: createPdfSource(doc),
    renderCover: async () => undefined,
    close: () => doc.loadingTask.destroy(),
  };
}

async function fixtureFile(name: string, as = name): Promise<File> {
  const bytes = await readFile(new URL(`../fixtures/${name}`, import.meta.url));
  return new File([bytes], as, { type: 'application/pdf' });
}

let db: BookDB;
let deps: ImportDeps;
beforeEach(async () => {
  db = createDb(`test-${crypto.randomUUID()}`);
  await db.open();
  deps = { db, openPdf: nodeOpenPdf };
});
afterEach(async () => {
  await db.delete();
});

describe('importBook', () => {
  it('kitabı ekler, dosyayı saklar ve dönüştürür', async () => {
    const res = await importBook(
      await fixtureFile('novel-tr.pdf', 'Deniz Aksoy - Kayıp Şehrin Işıkları.pdf'),
      deps,
    );
    expect(res.status).toBe('added');
    await res.done;
    const book = await db.books.get(res.bookId);
    expect(book).toMatchObject({
      title: 'Kayıp Şehrin Işıkları',
      author: 'Deniz Aksoy',
      pdfPageCount: 6,
      lang: 'tr',
      readingStatus: 'unread',
    });
    expect(book?.convert).toMatchObject({ state: 'done', progress: 1 });
    expect(await db.files.get(res.bookId)).toBeDefined();
    expect((await db.contents.get(res.bookId))?.blocks.length).toBeGreaterThan(10);
  });

  it('aynı dosyayı ikinci kez eklemez', async () => {
    const first = await importBook(await fixtureFile('novel-tr.pdf'), deps);
    await first.done;
    const second = await importBook(await fixtureFile('novel-tr.pdf', 'baska-ad.pdf'), deps);
    expect(second).toMatchObject({ status: 'exists', bookId: first.bookId });
    expect(await db.books.count()).toBe(1);
  });

  it('PDF olmayan dosyayı reddeder ve hiçbir şey kaydetmez', async () => {
    const bad = new File([new TextEncoder().encode('merhaba')], 'not.pdf');
    await expect(importBook(bad, deps)).rejects.toMatchObject({ code: 'invalid-pdf' });
    expect(await db.books.count()).toBe(0);
  });

  it('yarıda kalan dönüştürmeyi yeniden başlatır', async () => {
    const res = await importBook(await fixtureFile('novel-tr.pdf'), deps);
    await res.done;
    await db.books.update(res.bookId, { convert: { state: 'running', progress: 0.3, version: 1 } });
    await db.contents.clear();
    await resumeConversions(deps);
    expect((await db.books.get(res.bookId))?.convert.state).toBe('done');
    expect(await db.contents.get(res.bookId)).toBeDefined();
  });
});

import { deleteBook } from '../../src/db/books';

const passwordError = () =>
  Object.assign(new Error('Şifre gerekli'), { name: 'PasswordException' });

describe('importBook — inceleme düzeltmeleri', () => {
  it('şifreyi sorar, yanlışsa tekrar sorar, doğrusunu saklar; vazgeçilirse kaydetmez', async () => {
    const asked: boolean[] = [];
    const answers = ['yanlis', 'dogru'];
    const withPassword: ImportDeps = {
      db,
      openPdf: async (bytes, pw) => {
        if (pw !== 'dogru') throw passwordError();
        return nodeOpenPdf(bytes);
      },
      askPassword: async (retry) => {
        asked.push(retry);
        return answers.shift() ?? null;
      },
    };
    const res = await importBook(await fixtureFile('novel-tr.pdf'), withPassword);
    await res.done;
    expect(asked).toEqual([false, true]);
    expect(await db.books.get(res.bookId)).toMatchObject({
      password: 'dogru',
      convert: { state: 'done' },
    });

    const cancel: ImportDeps = {
      db,
      openPdf: async () => {
        throw passwordError();
      },
      askPassword: async () => null,
    };
    await expect(importBook(await fixtureFile('english.pdf'), cancel)).rejects.toMatchObject({
      code: 'password-cancelled',
    });
    expect(await db.books.count()).toBe(1);
  });

  it('dönüştürme hatasında kitap failed olur, done çözülür, açılan her belge bir kez kapanır', async () => {
    let opens = 0;
    let closes = 0;
    const failing: ImportDeps = {
      db,
      openPdf: async (bytes) => {
        opens++;
        const real = await nodeOpenPdf(bytes);
        let calls = 0;
        return {
          ...real,
          source: {
            ...real.source,
            getPageText: async (i) => {
              if (++calls > 1) throw new Error('bozuk sayfa');
              return real.source.getPageText(i);
            },
          },
          close: async () => {
            closes++;
            await real.close();
          },
        };
      },
    };
    const res = await importBook(await fixtureFile('novel-tr.pdf'), failing);
    await expect(res.done).resolves.toBeUndefined();
    expect((await db.books.get(res.bookId))?.convert).toMatchObject({
      state: 'failed',
      error: 'bozuk sayfa',
    });
    expect(await db.contents.count()).toBe(0);
    expect(opens).toBe(2); // içe aktarma + dönüştürme (dönüştürme belgeyi IndexedDB'den yeniden açar)
    expect(closes).toBe(opens);
  });

  it('dosyası kaybolmuş yarım kitabı failed yapar', async () => {
    const res = await importBook(await fixtureFile('novel-tr.pdf'), deps);
    await res.done;
    await db.books.update(res.bookId, { convert: { state: 'pending', progress: 0, version: 1 } });
    await db.files.clear();
    await resumeConversions(deps);
    expect((await db.books.get(res.bookId))?.convert.state).toBe('failed');
  });

  it('dönüştürme sürerken silinen kitap için sahipsiz içerik kalmaz', async () => {
    let reached!: () => void;
    const atGate = new Promise<void>((resolve) => (reached = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const gated: ImportDeps = {
      db,
      openPdf: async (bytes) => {
        const real = await nodeOpenPdf(bytes);
        // Dönüştürme 2. sayfada durur: kitap tam dönüştürme sürerken silinir
        const getPageText: typeof real.source.getPageText = async (i) => {
          if (i > 0) {
            reached();
            await gate;
          }
          return real.source.getPageText(i);
        };
        return { ...real, source: { ...real.source, getPageText } };
      },
    };
    const res = await importBook(await fixtureFile('novel-tr.pdf'), gated);
    try {
      await atGate;
      await deleteBook(db, res.bookId);
    } finally {
      release();
    }
    await res.done;
    expect(await db.contents.count()).toBe(0);
    expect(await db.books.count()).toBe(0);
  });

  it('üst üste çağrılan resumeConversions her kitabı bir kez açar', async () => {
    const first = await importBook(await fixtureFile('novel-tr.pdf'), deps);
    await first.done;
    const second = await importBook(await fixtureFile('english.pdf'), deps);
    await second.done;
    for (const id of [first.bookId, second.bookId]) {
      await db.books.update(id, { convert: { state: 'pending', progress: 0, version: 1 } });
    }
    let opens = 0;
    const counting: ImportDeps = {
      db,
      openPdf: async (bytes, pw) => {
        opens++;
        return nodeOpenPdf(bytes, pw);
      },
    };
    await Promise.all([resumeConversions(counting), resumeConversions(counting)]);
    expect(opens).toBe(2);
    expect((await db.books.toArray()).every((b) => b.convert.state === 'done')).toBe(true);
  });

  it('aynı dosya aynı anda iki kez bırakılırsa ikincisi "zaten var" döner', async () => {
    const fileA = await fixtureFile('english.pdf');
    const fileB = await fixtureFile('english.pdf');
    const [a, b] = await Promise.all([importBook(fileA, deps), importBook(fileB, deps)]);
    await Promise.all([a.done, b.done]);
    expect([a.status, b.status].sort()).toEqual(['added', 'exists']);
    expect(await db.books.count()).toBe(1);
  });

  it('metadata okunamazsa kitabı dosya adıyla yine ekler', async () => {
    const brokenMeta: ImportDeps = {
      db,
      openPdf: async (bytes) => {
        const real = await nodeOpenPdf(bytes);
        return {
          ...real,
          source: {
            ...real.source,
            getMetadata: async () => {
              throw new Error('bozuk metadata');
            },
          },
        };
      },
    };
    const res = await importBook(
      await fixtureFile('english.pdf', 'Yazar Adı - Kitap Adı.pdf'),
      brokenMeta,
    );
    await res.done;
    expect(await db.books.get(res.bookId)).toMatchObject({
      title: 'Kitap Adı',
      author: 'Yazar Adı',
    });
  });
});

describe('importBook — dosya saklama', () => {
  it('PDF verisini ArrayBuffer olarak saklar (Safari Blob sorunu)', async () => {
    const res = await importBook(await fixtureFile('english.pdf'), deps);
    await res.done;
    const stored = await db.files.get(res.bookId);
    expect(stored?.data).toBeInstanceOf(ArrayBuffer);
    expect(stored?.data.byteLength).toBeGreaterThan(1000);
  });
});

describe('importBook — dönüştürme kuyruğu', () => {
  it('dönüştürmeyi beklemeden kaydeder; kitaplar sırayla dönüştürülür', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const gated: ImportDeps = {
      db,
      openPdf: async (bytes, pw) => {
        const real = await nodeOpenPdf(bytes, pw);
        // İçe aktarma yalnızca 1. sayfayı okur; sonraki sayfalar (dönüştürme) kapı açılana kadar bekler
        const getPageText: typeof real.source.getPageText = async (i) => {
          if (i > 0) await gate;
          return real.source.getPageText(i);
        };
        return { ...real, source: { ...real.source, getPageText } };
      },
    };
    // Kuyruk modül genelinde: bir beklenti düşse de kapı açılsın, sonraki testler takılmasın
    try {
      const first = await importBook(await fixtureFile('novel-tr.pdf'), gated);
      const second = await importBook(await fixtureFile('english.pdf'), gated);
      expect(await db.books.count()).toBe(2); // ilk kitabın dönüştürmesi sürerken ikincisi de kaydedildi
      expect((await db.books.get(second.bookId))?.convert.state).toBe('pending'); // sırada bekliyor
      release();
      await Promise.all([first.done, second.done]);
      expect((await db.books.toArray()).map((b) => b.convert.state)).toEqual(['done', 'done']);
    } finally {
      release();
    }
  });

  it('takılan dönüştürme failed olur ve sıradaki kitabı bekletmez', async () => {
    const hanging: ImportDeps = {
      db,
      stallMs: 1000, // takılma sonsuz; arkadaki sağlam kitap yavaş makinede yanlışlıkla düşmesin
      openPdf: async (bytes, pw) => {
        const real = await nodeOpenPdf(bytes, pw);
        // novel-tr'nin 2. sayfası hiç gelmez (ölen worker gibi)
        const getPageText: typeof real.source.getPageText = (i) =>
          i > 0 && real.source.numPages === 6 ? new Promise(() => {}) : real.source.getPageText(i);
        return { ...real, source: { ...real.source, getPageText } };
      },
    };
    const stuck = await importBook(await fixtureFile('novel-tr.pdf'), hanging);
    const next = await importBook(await fixtureFile('english.pdf'), hanging);
    await Promise.all([stuck.done, next.done]);
    expect((await db.books.get(stuck.bookId))?.convert).toMatchObject({
      state: 'failed',
      error: 'Dönüştürme yanıt vermedi',
    });
    expect((await db.books.get(next.bookId))?.convert.state).toBe('done');
  });

  it('yarım kalanları eklenme sırasıyla sürdürür', async () => {
    const a = await importBook(await fixtureFile('novel-tr.pdf'), deps);
    const b = await importBook(await fixtureFile('english.pdf'), deps);
    await Promise.all([a.done, b.done]);
    // Özet sırası eklenme sırasının tersi olsun diye addedAt'ler elle verilir
    const [late, early] = [a.bookId, b.bookId].sort();
    await db.books.update(early, {
      addedAt: 1,
      convert: { state: 'pending', progress: 0, version: 1 },
    });
    await db.books.update(late, {
      addedAt: 2,
      convert: { state: 'pending', progress: 0, version: 1 },
    });
    const order: number[] = [];
    const recording: ImportDeps = {
      db,
      openPdf: async (bytes, pw) => {
        const real = await nodeOpenPdf(bytes, pw);
        order.push(real.source.numPages);
        return real;
      },
    };
    await resumeConversions(recording);
    const pages = async (id: string) => (await db.books.get(id))?.pdfPageCount;
    expect(order).toEqual([await pages(early), await pages(late)]);
  });
});
