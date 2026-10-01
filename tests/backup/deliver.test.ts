import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachDownloadUrl,
  backupFile,
  defaultIncludePdfs,
  DOWNLOAD_URL_TTL_MS,
  largePdfBytes,
  shareFile,
} from '../../src/backup/deliver';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
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

describe('büyük yedek', () => {
  it("iPad/iPhone'da PDF'ler 400 MB'ı aşınca \"PDF'leri de ekle\" varsayılan kapalı; başka cihazda açık", () => {
    expect(defaultIncludePdfs(399e6, true)).toBe(true);
    expect(defaultIncludePdfs(401e6, true)).toBe(false);
    expect(defaultIncludePdfs(2e9, false)).toBe(true);
  });

  it("bellek uyarısı: iOS'ta 400 MB, başka cihazda 500 MB", () => {
    expect(largePdfBytes(true)).toBe(400e6);
    expect(largePdfBytes(false)).toBe(500e6);
  });
});

describe('indirme bağlantısı', () => {
  it('adres dokunulunca bağlantıya verilir ve 60 sn sonra bırakılır (pencere kapansa da)', () => {
    vi.useFakeTimers();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const link = { href: '#' } as HTMLAnchorElement;
    attachDownloadUrl(link, new Blob(['yedek']));
    expect(link.href).toMatch(/^blob:/);
    vi.advanceTimersByTime(DOWNLOAD_URL_TTL_MS - 1);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledWith(link.href);

    // Her dokunuş yeni adres alır: önceki adresin süresi dolsa da bağlantı çalışır
    const first = link.href;
    attachDownloadUrl(link, new Blob(['yedek']));
    expect(link.href).not.toBe(first);
  });
});
