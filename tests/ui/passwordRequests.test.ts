import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  answerPasswordRequest,
  currentPasswordRequest,
  requestPassword,
  resetPasswordRequests,
  subscribePasswordRequests,
} from '../../src/ui/passwordRequests';

// Sıra modül düzeyinde: her test boş sırayla başlar
afterEach(() => {
  resetPasswordRequests();
});

describe('şifre soruları (uygulama içi pencere)', () => {
  it('sorular sıraya girer: aynı anda tek soru gösterilir, cevaplanınca sıradaki gelir', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribePasswordRequests(listener);
    expect(currentPasswordRequest()).toBeNull();

    const first = requestPassword({ title: 'Roman', retry: false });
    const second = requestPassword({ title: 'Defter', retry: true });
    expect(currentPasswordRequest()).toMatchObject({ title: 'Roman', retry: false });
    // İkinci soru eklenince gösterilen değişmez: dinleyiciye yalnızca ilk soru bildirilir
    expect(listener).toHaveBeenCalledTimes(1);

    const shown = currentPasswordRequest()!;
    answerPasswordRequest(shown.id, 'gizli');
    expect(await first).toBe('gizli');
    expect(currentPasswordRequest()).toMatchObject({ title: 'Defter', retry: true });
    expect(listener).toHaveBeenCalledTimes(2);

    // Eski sorunun kimliğiyle gelen cevap (çift dokunuş) sıradakini cevaplamaz
    answerPasswordRequest(shown.id, 'yanlis');
    expect(currentPasswordRequest()).toMatchObject({ title: 'Defter' });

    answerPasswordRequest(currentPasswordRequest()!.id, null);
    expect(await second).toBeNull();
    expect(currentPasswordRequest()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it('soran vazgeçince (okuyucu kapandı) soru sıradan çıkar ve null döner; sıradaki gösterilir', async () => {
    const reader = new AbortController();
    const listener = vi.fn();
    const unsubscribe = subscribePasswordRequests(listener);
    const shown = requestPassword({ title: 'Roman', retry: false }, reader.signal);
    const waiting = new AbortController();
    const queued = requestPassword({ title: 'Defter', retry: false }, waiting.signal);
    const last = requestPassword({ title: 'Günlük', retry: false });

    // Sırada bekleyen soru çıkar: gösterilen değişmez
    waiting.abort();
    expect(await queued).toBeNull();
    expect(currentPasswordRequest()).toMatchObject({ title: 'Roman' });
    expect(listener).toHaveBeenCalledTimes(1);

    // Gösterilen soru çıkar: pencere sıradakine geçer
    reader.abort();
    expect(await shown).toBeNull();
    expect(currentPasswordRequest()).toMatchObject({ title: 'Günlük' });
    expect(listener).toHaveBeenCalledTimes(2);

    // Önceden vazgeçilmişse soru hiç sorulmaz
    const already = new AbortController();
    already.abort();
    expect(await requestPassword({ title: 'X', retry: false }, already.signal)).toBeNull();
    expect(currentPasswordRequest()).toMatchObject({ title: 'Günlük' });

    resetPasswordRequests();
    expect(await last).toBeNull();
    expect(currentPasswordRequest()).toBeNull();
    unsubscribe();
  });
});
