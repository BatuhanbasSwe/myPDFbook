import { describe, expect, it } from 'vitest';
import { isTopModal, modalOpen, pushModal } from '../../src/ui/modalStack';

describe('modalStack', () => {
  it('açık pencereler: en üstteki sonuncu; kapanınca bir alttaki üste çıkar', () => {
    expect(modalOpen()).toBe(false);
    const a = pushModal();
    const b = pushModal();
    expect(modalOpen()).toBe(true);
    expect(isTopModal(b.id)).toBe(true);
    expect(isTopModal(a.id)).toBe(false);
    b.pop();
    expect(isTopModal(a.id)).toBe(true);
    a.pop();
    a.pop(); // ikinci kez kapatmak bir şey yapmaz
    expect(modalOpen()).toBe(false);
  });
});
