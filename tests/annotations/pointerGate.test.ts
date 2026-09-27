import { describe, expect, it } from 'vitest';
import { acceptPointer } from '../../src/annotations/pointerGate';

const idle = { penSeen: false, active: null };

describe('acceptPointer (avuç reddi)', () => {
  it('kalem görülmeden parmak, fare ve kalem çizer', () => {
    for (const pointerType of ['touch', 'mouse', 'pen'])
      expect(acceptPointer(idle, { pointerType, draws: true })).toBe('start');
  });

  it('kalem görüldükten sonra parmak çizmez (sayfaya da gitmez); kalem ve fare çizer', () => {
    const seen = { penSeen: true, active: null };
    expect(acceptPointer(seen, { pointerType: 'touch', draws: true })).toBe('ignore');
    expect(acceptPointer(seen, { pointerType: 'pen', draws: true })).toBe('start');
    expect(acceptPointer(seen, { pointerType: 'mouse', draws: true })).toBe('start');
  });

  it('çizmeyen dokunuş kitaba gider (kip kapalıyken parmak sayfa çevirir)', () => {
    expect(acceptPointer(idle, { pointerType: 'touch', draws: false })).toBe('pass');
    expect(
      acceptPointer({ penSeen: true, active: null }, { pointerType: 'touch', draws: false }),
    ).toBe('pass');
  });

  it('parmakla süren çizime gelen kalem çizimi devralır', () => {
    expect(
      acceptPointer({ penSeen: false, active: 'touch' }, { pointerType: 'pen', draws: true }),
    ).toBe('preempt');
    expect(
      acceptPointer({ penSeen: true, active: 'touch' }, { pointerType: 'pen', draws: true }),
    ).toBe('preempt');
  });

  it('süren çizim varken başka parmak, ikinci kalem ya da çizmeyen kalem yok sayılır', () => {
    expect(
      acceptPointer({ penSeen: true, active: 'pen' }, { pointerType: 'touch', draws: true }),
    ).toBe('ignore');
    expect(
      acceptPointer({ penSeen: false, active: 'touch' }, { pointerType: 'touch', draws: true }),
    ).toBe('ignore');
    expect(
      acceptPointer({ penSeen: true, active: 'pen' }, { pointerType: 'pen', draws: true }),
    ).toBe('ignore');
    expect(
      acceptPointer({ penSeen: false, active: 'touch' }, { pointerType: 'pen', draws: false }),
    ).toBe('ignore');
    expect(
      acceptPointer({ penSeen: false, active: 'mouse' }, { pointerType: 'pen', draws: true }),
    ).toBe('ignore');
  });
});
