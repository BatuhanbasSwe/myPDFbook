import { describe, expect, it, vi } from 'vitest';
import {
  answerPasswordRequest,
  currentPasswordRequest,
  requestPassword,
  subscribePasswordRequests,
} from '../../src/ui/passwordRequests';

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
});
