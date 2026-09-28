/**
 * `ReadableStream` üzerinde `for await` (async iterator) eski WebKit'te yok (iPadOS/iOS 18 ve öncesi; iPad'deki Chrome
 * da WebKit'tir). pdf.js metni sayfadan okurken (`getTextContent`) ve worker'da bununla gezer: bu tarayıcılarda
 * "undefined is not a function (near '...e of t...')" hatası verir, kitap dönüştürülemez. Eksikse akışın okuyucusuyla
 * eklenir (WHATWG akış tanımındaki `values()` davranışı). Ana sayfada pdf.js'ten önce yüklenir.
 */
export function installStreamIteration(scope: typeof globalThis = globalThis): boolean {
  const RS = scope.ReadableStream as
    (typeof ReadableStream & { prototype: Record<PropertyKey, unknown> }) | undefined;
  if (!RS || typeof RS.prototype[Symbol.asyncIterator] === 'function') return false;

  function values(this: ReadableStream, { preventCancel = false } = {}) {
    const reader = this.getReader();
    let finished = false;
    const iterator: AsyncIterableIterator<unknown> = {
      async next() {
        if (finished) return { done: true, value: undefined };
        try {
          const result = await reader.read();
          if (result.done) {
            finished = true;
            reader.releaseLock();
          }
          return result;
        } catch (e) {
          finished = true;
          reader.releaseLock();
          throw e;
        }
      },
      async return(value?: unknown) {
        if (!finished) {
          finished = true;
          if (!preventCancel) {
            const cancelled = reader.cancel(value);
            reader.releaseLock();
            await cancelled;
          } else reader.releaseLock();
        }
        return { done: true, value };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
    return iterator;
  }

  Object.defineProperty(RS.prototype, 'values', {
    value: values,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(RS.prototype, Symbol.asyncIterator, {
    value: values,
    writable: true,
    configurable: true,
  });
  return true;
}

installStreamIteration();
