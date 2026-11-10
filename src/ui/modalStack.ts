/**
 * Açık kipli pencereler (Modal.tsx), açılış sırasıyla: en üstteki son. Pencere açıkken sayfanın tuş dinleyicileri
 * (okuyucunun okuma modları, yakalama aşamasında dinler) tuşlara dokunmaz; Esc'i yalnızca en üstteki pencere işler.
 */
const stack: symbol[] = [];

/** Pencere açıldı: kapanınca çağrılacak işlevi döndürür */
export function pushModal(): { id: symbol; pop(): void } {
  const id = Symbol('modal');
  stack.push(id);
  return {
    id,
    pop() {
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
    },
  };
}

/** Kipli bir pencere açık mı (sayfanın kısayolları tuşları bırakır) */
export function modalOpen(): boolean {
  return stack.length > 0;
}

/** Bu pencere en üstte mi */
export function isTopModal(id: symbol): boolean {
  return stack[stack.length - 1] === id;
}
