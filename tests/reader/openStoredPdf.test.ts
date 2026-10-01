import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type BookDB, type BookRecord } from '../../src/db/db';
import { openStoredPdf, type OpenStoredPdfDeps } from '../../src/reader/openStoredPdf';

const ID = 'b'.repeat(64);

const book: BookRecord = {
  id: ID,
  title: 'Şifreli',
  author: '',
  fileName: 'sifreli.pdf',
  fileSize: 3,
  pdfPageCount: 1,
  lang: 'tr',
  addedAt: 1,
  convert: { state: 'done', progress: 1, version: 2 },
  readingStatus: 'reading',
  totalWords: 1,
};

const passwordError = () =>
  Object.assign(new Error('Şifre gerekli'), { name: 'PasswordException' });

let db: BookDB;
beforeEach(async () => {
  db = createDb(`test-${crypto.randomUUID()}`);
  await db.open();
  await db.books.add({ ...book });
  await db.files.add({ bookId: ID, data: new Uint8Array([1, 2, 3]).buffer });
});
afterEach(async () => {
  await db.delete();
});

/** "dogru" şifresiyle açılan PDF; sorulara verilen cevaplar sırayla */
function setup(answers: (string | null)[], overrides: Partial<OpenStoredPdfDeps<string>> = {}) {
  const asked: boolean[] = [];
  const tried: (string | undefined)[] = [];
  const onPasswordSaved = vi.fn();
  const deps: OpenStoredPdfDeps<string> = {
    db,
    load: async (data, password) => {
      expect(data.length).toBe(3);
      tried.push(password);
      if (password !== 'dogru') throw passwordError();
      return 'belge';
    },
    askPassword: async (retry) => {
      asked.push(retry);
      return answers.shift() ?? null;
    },
    onPasswordSaved,
    cancelled: () => false,
    ...overrides,
  };
  return { deps, asked, tried, onPasswordSaved };
}

describe("okuyucu: saklanan PDF'i açma (şifre)", () => {
  it('yanlış şifreden sonra vazgeçilirse hiçbir şey kaydedilmez', async () => {
    const { deps, asked, tried, onPasswordSaved } = setup(['yanlis', null]);
    await expect(openStoredPdf(ID, deps)).rejects.toMatchObject({ name: 'PasswordException' });
    expect(asked).toEqual([false, true]);
    expect(tried).toEqual([undefined, 'yanlis']);
    expect((await db.books.get(ID))?.password).toBeUndefined();
    expect(onPasswordSaved).not.toHaveBeenCalled();
  });

  it("yanlış şifre kaydedilmez, yeniden sorulur; PDF'i açan şifre kaydedilir", async () => {
    const { deps, asked, tried, onPasswordSaved } = setup(['yanlis', 'dogru']);
    expect(await openStoredPdf(ID, deps)).toBe('belge');
    expect(asked).toEqual([false, true]);
    expect(tried).toEqual([undefined, 'yanlis', 'dogru']);
    expect((await db.books.get(ID))?.password).toBe('dogru');
    expect(onPasswordSaved).toHaveBeenCalledExactlyOnceWith(ID);
  });

  it('kayıtlı şifre doğruysa sorulmaz, yeniden kaydedilmez; değişmişse "yanlış" diye sorulur', async () => {
    await db.books.update(ID, { password: 'dogru' });
    const first = setup([]);
    expect(await openStoredPdf(ID, first.deps)).toBe('belge');
    expect(first.asked).toEqual([]);
    expect(first.onPasswordSaved).not.toHaveBeenCalled();

    await db.books.update(ID, { password: 'eski' });
    const second = setup(['dogru']);
    expect(await openStoredPdf(ID, second.deps)).toBe('belge');
    expect(second.asked).toEqual([true]);
    expect((await db.books.get(ID))?.password).toBe('dogru');
  });

  it('okuyucu soru sırasında kapanırsa null döner, şifre kaydedilmez', async () => {
    let closed = false;
    const { deps } = setup([], {
      askPassword: async () => {
        closed = true;
        return 'dogru';
      },
      cancelled: () => closed,
    });
    expect(await openStoredPdf(ID, deps)).toBeNull();
    expect((await db.books.get(ID))?.password).toBeUndefined();
  });

  it('şifre dışındaki hata sorulmadan fırlatılır', async () => {
    const { deps, asked } = setup([], {
      load: async () => {
        throw new Error('bozuk PDF');
      },
    });
    await expect(openStoredPdf(ID, deps)).rejects.toThrow('bozuk PDF');
    expect(asked).toEqual([]);
  });
});
