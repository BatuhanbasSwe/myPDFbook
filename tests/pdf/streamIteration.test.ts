import { afterEach, describe, expect, it } from 'vitest';
import { installStreamIteration } from '../../src/pdf/streamIteration';

type Proto = Record<PropertyKey, unknown>;
const proto = ReadableStream.prototype as unknown as Proto;
const original = {
  iter: Object.getOwnPropertyDescriptor(proto, Symbol.asyncIterator),
  values: Object.getOwnPropertyDescriptor(proto, 'values'),
};

function strip() {
  delete proto[Symbol.asyncIterator];
  delete proto.values;
}

function streamOf<T>(chunks: T[], onCancel?: (reason: unknown) => void) {
  return new ReadableStream<T>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
    cancel: onCancel,
  });
}

afterEach(() => {
  strip();
  if (original.iter) Object.defineProperty(proto, Symbol.asyncIterator, original.iter);
  if (original.values) Object.defineProperty(proto, 'values', original.values);
});

describe('installStreamIteration', () => {
  it('özellik varsa dokunmaz', () => {
    expect(installStreamIteration()).toBe(false);
  });

  it('eksikse ekler: for await parçaları sırayla verir, sonunda kilit bırakılır', async () => {
    strip();
    expect(typeof proto[Symbol.asyncIterator]).toBe('undefined');
    expect(installStreamIteration()).toBe(true);
    const stream = streamOf([1, 2, 3]);
    const seen: number[] = [];
    for await (const n of stream as unknown as AsyncIterable<number>) seen.push(n);
    expect(seen).toEqual([1, 2, 3]);
    expect(stream.locked).toBe(false);
  });

  it('döngüden erken çıkınca akış iptal edilir (preventCancel yoksa)', async () => {
    strip();
    installStreamIteration();
    let cancelled = false;
    const stream = streamOf(['a', 'b', 'c'], () => (cancelled = true));
    for await (const s of stream as unknown as AsyncIterable<string>) {
      if (s === 'a') break;
    }
    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
  });

  it('akış hata verirse döngüye iletilir', async () => {
    strip();
    installStreamIteration();
    const stream = new ReadableStream({
      pull() {
        throw new Error('bozuk');
      },
    });
    await expect(async () => {
      for await (const _ of stream as unknown as AsyncIterable<unknown>) void _;
    }).rejects.toThrow('bozuk');
  });
});
