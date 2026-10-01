import { afterEach, describe, expect, it, vi } from 'vitest';
import { backupFile, shareFile } from '../../src/backup/deliver';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('yedeği paylaşma', () => {
  it('paylaşım sayfasına yalnızca dosya verilir (başlık ayrıca metin olarak eklenmesin)', async () => {
    const share = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { share });
    const file = backupFile(new Blob(['x']), 'mypdfbook-yedek-2026-10-01.mypdfbook');
    expect(await shareFile(file)).toBe('shared');
    expect(share).toHaveBeenCalledWith({ files: [file] });
  });

  it('vazgeçilirse "cancelled", başka hata fırlatılır', async () => {
    const file = backupFile(new Blob(['x']), 'y.mypdfbook');
    vi.stubGlobal('navigator', {
      share: async () => {
        throw new DOMException('vazgeçti', 'AbortError');
      },
    });
    expect(await shareFile(file)).toBe('cancelled');
    vi.stubGlobal('navigator', {
      share: async () => {
        throw new DOMException('izin yok', 'NotAllowedError');
      },
    });
    await expect(shareFile(file)).rejects.toMatchObject({ name: 'NotAllowedError' });
  });
});
