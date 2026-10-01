import { inflateSync, strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { readEntry, readJsonEntry, readZipIndex } from '../../src/backup/zip';

// Açıcı izlenir: sahte boyda hiç çağrılmamalı (tampon ayrılmadan reddedilir)
vi.mock('fflate', async (importOriginal) => {
  const original = await importOriginal<typeof import('fflate')>();
  return { ...original, inflateSync: vi.fn(original.inflateSync) };
});

const CENTRAL_SIGNATURE = 0x02014b50;

/** Merkez dizinde adı verilen girdinin kaydının yeri */
function centralRecord(bytes: Uint8Array, name: string): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const needle = strToU8(name);
  for (let i = 0; i + 46 < bytes.length; i++) {
    if (v.getUint32(i, true) !== CENTRAL_SIGNATURE) continue;
    const nameLength = v.getUint16(i + 28, true);
    if (nameLength !== needle.length) continue;
    if (needle.every((c, k) => bytes[i + 46 + k] === c)) return i;
  }
  throw new Error(`${name} merkez dizinde yok`);
}

/** Merkez dizindeki açılmış boyu değiştirir (sahte boy) */
function forgeSize(bytes: Uint8Array, name: string, size: number): Uint8Array {
  const copy = bytes.slice();
  new DataView(copy.buffer).setUint32(centralRecord(copy, name) + 24, size, true);
  return copy;
}

const blobOf = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>]);

/** Sıkışmayan (rastgele) içerik: sıkıştırılmış boyu açılmış boyuna yakın */
function noise(length: number): Uint8Array {
  const out = new Uint8Array(length);
  let x = 0x12345678;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

describe('zip okuyucu', () => {
  it('0 baytlık dosya (iCloud yer tutucusu): "okunamadı", "yedek değil" değil', async () => {
    await expect(readZipIndex(new Blob([]))).rejects.toMatchObject({ code: 'unreadable' });
    // Kısa ama boş olmayan dosya yedek değildir
    await expect(readZipIndex(new Blob(['merhaba']))).rejects.toMatchObject({
      code: 'not-backup',
    });
  });

  it('merkez dizindeki sahte büyük boy: tampon ayrılmadan "bozuk"', async () => {
    const zip = zipSync({ 'data.json': strToU8(JSON.stringify({ a: 'b'.repeat(1000) })) });
    const forged = blobOf(forgeSize(zip, 'data.json', 0x7fffffff));
    const entry = (await readZipIndex(forged)).get('data.json')!;
    expect(entry.size).toBe(0x7fffffff);
    vi.mocked(inflateSync).mockClear();
    await expect(readEntry(forged, entry)).rejects.toMatchObject({ code: 'corrupt' });
    await expect(readJsonEntry(forged, entry)).rejects.toMatchObject({ code: 'corrupt' });
    expect(inflateSync).not.toHaveBeenCalled();
  });

  it('sıkıştırma oranı makul ama 256 MB\'tan büyük JSON girdisi: "bozuk"', async () => {
    const zip = zipSync({ 'data.json': noise(300 * 1024) });
    const index = await readZipIndex(blobOf(zip));
    expect(index.get('data.json')!.compressedSize).toBeGreaterThan(260 * 1024);
    const forged = blobOf(forgeSize(zip, 'data.json', 300 * 2 ** 20));
    const entry = (await readZipIndex(forged)).get('data.json')!;
    vi.mocked(inflateSync).mockClear();
    await expect(readJsonEntry(forged, entry)).rejects.toMatchObject({ code: 'corrupt' });
    expect(inflateSync).not.toHaveBeenCalled();
  });

  it('STORE girdide boy ile sıkıştırılmış boy farklıysa "bozuk"', async () => {
    const zip = zipSync({ 'pdf/x.pdf': [strToU8('%PDF-1.7 merhaba'), { level: 0 }] });
    const forged = blobOf(forgeSize(zip, 'pdf/x.pdf', 2 ** 30));
    const entry = (await readZipIndex(forged)).get('pdf/x.pdf')!;
    expect(entry.method).toBe(0);
    await expect(readEntry(forged, entry, { checkCrc: false })).rejects.toMatchObject({
      code: 'corrupt',
    });
  });

  it('sağlam girdiler okunur', async () => {
    const zip = blobOf(
      zipSync({
        'data.json': strToU8('{"merhaba":"dünya"}'),
        'pdf/x.pdf': [strToU8('%PDF-1.7'), { level: 0 }],
      }),
    );
    const index = await readZipIndex(zip);
    expect(await readJsonEntry(zip, index.get('data.json')!)).toEqual({ merhaba: 'dünya' });
    expect(new TextDecoder().decode(await readEntry(zip, index.get('pdf/x.pdf')!))).toBe(
      '%PDF-1.7',
    );
  });
});
