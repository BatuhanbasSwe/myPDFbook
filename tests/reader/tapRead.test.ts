import { describe, expect, it } from 'vitest';
import {
  EDGE_STRIP,
  inEdgeStrip,
  LONG_TAP_MS,
  tapSeeksSentence,
} from '../../src/reader/modes/tapRead';

const tap = (duration = 80) => ({ clientX: 0, clientY: 0, duration });

describe('dokunduğun cümleden oku: kenar şeridi', () => {
  it("tek sayfada sayfa genişliğinin %12'si: dış şerit çevirir", () => {
    expect(EDGE_STRIP).toBe(0.12);
    expect(inEdgeStrip(0, false)).toBe(true);
    expect(inEdgeStrip(0.119, false)).toBe(true);
    expect(inEdgeStrip(0.12, false)).toBe(false);
    expect(inEdgeStrip(0.5, false)).toBe(false);
    expect(inEdgeStrip(0.88, false)).toBe(false);
    expect(inEdgeStrip(0.881, false)).toBe(true);
    expect(inEdgeStrip(1, false)).toBe(true);
  });

  it("çift sayfada her dış sayfanın %12'si (kitabın %6'sı); iç kenar (sayfa ortası) yazıdır", () => {
    expect(inEdgeStrip(0.05, true)).toBe(true);
    expect(inEdgeStrip(0.07, true)).toBe(false);
    expect(inEdgeStrip(0.5, true)).toBe(false);
    expect(inEdgeStrip(0.93, true)).toBe(false);
    expect(inEdgeStrip(0.95, true)).toBe(true);
  });
});

describe('tapSeeksSentence', () => {
  it('şerit dışındaki kısa dokunuş cümle arar', () => {
    expect(tapSeeksSentence(0.5, tap(), false, false)).toBe(true);
    expect(tapSeeksSentence(0.2, tap(), false, false)).toBe(true);
  });

  it('şeritteki dokunuş, uzun basma ve metin seçimi aramaz', () => {
    expect(tapSeeksSentence(0.05, tap(), false, false)).toBe(false);
    expect(tapSeeksSentence(0.5, tap(LONG_TAP_MS), false, false)).toBe(false);
    expect(tapSeeksSentence(0.5, tap(LONG_TAP_MS - 1), false, false)).toBe(true);
    expect(tapSeeksSentence(0.5, tap(), false, true)).toBe(false);
  });

  it('dokunuşun yeri bilinmiyorsa (eski çağrı) aramaz', () => {
    expect(tapSeeksSentence(0.5, undefined, false, false)).toBe(false);
  });
});
