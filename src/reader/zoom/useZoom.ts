import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import {
  doubleTapZoom,
  isZoomed,
  NO_ZOOM,
  panBy,
  pinchZoom,
  sharpZoomLevel,
  stepZoom,
  wheelZoom,
  type PinchStart,
  type Pt,
  type Size,
  type Zoom,
} from './zoomMath';

/** Yakınlaştırma bu kadar durulunca sayfa görüntüsü keskin çizilir (ms) */
const SETTLE_MS = 150;
/** Bundan az hareket dokunmadır (px) */
const TAP_MAX = 8;
/** Bundan uzun basış dokunma sayılmaz (ms) */
const TAP_MS = 500;
/** İki dokunma bu süre ve uzaklık içindeyse çift dokunmadır (ms, px) */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_REACH = 40;
/** Düğme, çift dokunma ve sıfırlamanın geçişi (ms) */
const ANIM_MS = 180;

/**
 * Yakınlaştırmanın durumu. Dönüşüm kitabın kutusuna React dışında yazılır: parmak hareketinde okuyucu yeniden
 * çizilmez. Yakınlaştırma çubuğu ölçeği, okuyucu yalnızca durulmuş keskinlik düzeyini izler.
 */
export interface ZoomStore {
  get(): Zoom;
  /** durulmuş yakınlaştırmanın keskin çizim düzeyi (1: yeniden çizilmez) */
  sharp(): number;
  set(z: Zoom, animate?: boolean): void;
  subscribe(listener: () => void): () => void;
  /** dönüşümün yazılacağı kutu (kitap) */
  attach(el: HTMLElement | null): void;
}

function createZoomStore(): ZoomStore {
  let zoom = NO_ZOOM;
  let sharp = 1;
  let el: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const apply = (animate: boolean) => {
    if (!el) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.style.transition = animate && !still ? `transform ${ANIM_MS}ms ease-out` : '';
    el.style.transform =
      isZoomed(zoom) || zoom.x || zoom.y
        ? `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`
        : '';
  };
  return {
    get: () => zoom,
    sharp: () => sharp,
    set(z, animate = false) {
      if (z.scale === zoom.scale && z.x === zoom.x && z.y === zoom.y) return;
      zoom = z;
      apply(animate);
      clearTimeout(timer);
      if (!isZoomed(z)) {
        // 1×'e dönünce keskin görüntüler hemen bırakılır (bellek)
        sharp = 1;
      } else {
        timer = setTimeout(() => {
          const level = sharpZoomLevel(zoom.scale);
          if (level === sharp) return;
          sharp = level;
          emit();
        }, SETTLE_MS);
      }
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attach(node) {
      if (node === el) return;
      el = node;
      apply(false);
    },
  };
}

/** Okuyucunun yakınlaştırma durumu (kitap kapanınca kendiliğinden gider) */
export function useZoomStore(): ZoomStore {
  const [store] = useState(createZoomStore);
  return store;
}

/** Durulmuş keskin çizim düzeyi: değişince yeniden çizilir */
export function useSharpZoom(store: ZoomStore): number {
  return useSyncExternalStore(store.subscribe, store.sharp);
}

/** Şu anki ölçek (yakınlaştırma çubuğu) */
export function useZoomScale(store: ZoomStore): number {
  return useSyncExternalStore(store.subscribe, () => store.get().scale);
}

interface Options {
  store: ZoomStore;
  /** okuma alanı: hareketler burada dinlenir, kitap bunun ortasında durur */
  rootRef: RefObject<HTMLElement | null>;
  /** dönüşümün yazıldığı kutu (kitap) */
  targetRef: RefObject<HTMLElement | null>;
  /** yakınlaştırma açık (sayfa kilitli); kapanınca 1×'e döner */
  active: boolean;
  /** kitabın büyütülmemiş boyutu */
  book: Size;
  /** değişince (görünüm) 1×'e dönülür */
  resetKey: string;
  /** kalem kipi: kalem ve fare çizer, parmak yakınlaştırır ve kaydırır */
  penOn: boolean;
  /** tek dokunma (çift dokunma değilse, bekleme süresinden sonra) */
  onTap(): void;
  /** kitabın süren dokunma hareketini bırakır (iki parmak yakınlaştırmaya geçti) */
  cancelGesture(): void;
}

/** Süren hareket: tek işaretçiyle kaydırma ya da dokunma, iki parmakla yakınlaştırma */
type Gesture =
  | {
      kind: 'one';
      id: number;
      start: Pt;
      zoom: Zoom;
      at: number;
      moved: boolean;
      /** kitabın içindeki denetimde (not iğnesi, yer imi köşesi) başladı: dokunma sayılmaz */
      control: boolean;
    }
  | { kind: 'two'; ids: [number, number]; start: PinchStart };

/**
 * Sayfa kilitliyken yakınlaştırma: iki parmakla kıstırma, çift dokunma (1× ↔ 2×), Ctrl/⌘ + tekerlek ya da
 * dokunmatik yüzeyde kıstırma; yakınken tek parmak, fare ya da tekerlek kaydırır. Olaylar okuma alanında yakalama
 * aşamasında alınır: kitap (sayfa çevirme) ve işaret katmanı (kalem kipinde parmak) onları görmez. Kalem (Apple
 * Pencil) hiç alınmaz: çizer ya da odağı taşır.
 */
export function useZoomGestures({
  store,
  rootRef,
  targetRef,
  active,
  book,
  resetKey,
  penOn,
  onTap,
  cancelGesture,
}: Options) {
  const latest = useRef({ book, penOn, onTap, cancelGesture });
  useLayoutEffect(() => {
    latest.current = { book, penOn, onTap, cancelGesture };
    // Kitabın kutusu değişebilir (görünüm, kitap açılışı): dönüşüm yenisine yazılır
    store.attach(targetRef.current);
  });

  // Kilit açılınca, görünüm ya da kitabın boyutu değişince 1×
  useEffect(() => {
    if (!active) store.set(NO_ZOOM, true);
  }, [store, active]);
  useEffect(() => {
    store.set(NO_ZOOM);
  }, [store, resetKey, book.width, book.height]);

  const view = useCallback((): Size => {
    const root = rootRef.current;
    return { width: root?.clientWidth ?? 0, height: root?.clientHeight ?? 0 };
  }, [rootRef]);

  const step = useCallback(
    (dir: 1 | -1) => store.set(stepZoom(store.get(), dir, latest.current.book, view()), true),
    [store, view],
  );
  const reset = useCallback(() => store.set(NO_ZOOM, true), [store]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !active) return;
    const points = new Map<number, Pt>();
    let gesture: Gesture | null = null;
    let lastTap: { x: number; y: number; at: number } | null = null;
    let tapTimer: ReturnType<typeof setTimeout> | undefined;

    /** Ekrandaki nokta okuma alanının ortasına göre */
    const rel = (p: Pt): Pt => {
      const r = root.getBoundingClientRect();
      return { x: p.x - (r.left + r.width / 2), y: p.y - (r.top + r.height / 2) };
    };
    const capture = (id: number) => {
      try {
        root.setPointerCapture(id);
      } catch {
        // yapay olay (sınama) ya da bırakılmış işaretçi
      }
    };
    const takes = (e: PointerEvent) => {
      if (e.pointerType === 'pen') return false;
      if (e.pointerType === 'mouse' && e.button !== 0) return false;
      // Kalem kipinde fare çizer; parmak yakınlaştırır ve kaydırır
      return !latest.current.penOn || e.pointerType === 'touch';
    };
    const startOne = (id: number, p: Pt, moved: boolean, control: boolean) => {
      gesture = {
        kind: 'one',
        id,
        start: p,
        zoom: store.get(),
        at: performance.now(),
        moved,
        control,
      };
    };

    const tap = (p: Pt) => {
      const now = performance.now();
      const prev = lastTap;
      if (
        prev &&
        now - prev.at < DOUBLE_TAP_MS &&
        Math.hypot(p.x - prev.x, p.y - prev.y) < DOUBLE_TAP_REACH
      ) {
        clearTimeout(tapTimer);
        lastTap = null;
        store.set(doubleTapZoom(store.get(), rel(p), latest.current.book, view()), true);
        return;
      }
      lastTap = { ...p, at: now };
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => {
        lastTap = null;
        latest.current.onTap();
      }, DOUBLE_TAP_MS);
    };

    const onDown = (e: PointerEvent) => {
      if (!takes(e)) return;
      e.stopPropagation();
      const p = { x: e.clientX, y: e.clientY };
      points.set(e.pointerId, p);
      if (points.size === 1) {
        const control =
          e.target instanceof Element && !!e.target.closest('button, a[href], input, textarea');
        startOne(e.pointerId, p, false, control);
      } else if (points.size === 2) {
        const [[a, pa], [b, pb]] = [...points.entries()];
        gesture = {
          kind: 'two',
          ids: [a, b],
          start: { zoom: store.get(), a: rel(pa), b: rel(pb) },
        };
        lastTap = null;
        clearTimeout(tapTimer);
        capture(a);
        capture(b);
        latest.current.cancelGesture();
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!points.has(e.pointerId)) return;
      e.stopPropagation();
      const p = { x: e.clientX, y: e.clientY };
      points.set(e.pointerId, p);
      const g = gesture;
      if (!g) return;
      const { book: b } = latest.current;
      if (g.kind === 'two') {
        const pa = points.get(g.ids[0]);
        const pb = points.get(g.ids[1]);
        if (pa && pb) store.set(pinchZoom(g.start, rel(pa), rel(pb), b, view()));
        return;
      }
      if (g.id !== e.pointerId) return;
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) > TAP_MAX) {
        g.moved = true;
        capture(e.pointerId);
      }
      // Kalemle odağın parmak sürüklemesi sürüyor (useFocusMode): kaydırılmaz
      if (!g.moved || 'focusPress' in root.dataset) return;
      if (isZoomed(g.zoom)) store.set(panBy(g.zoom, dx, dy, b, view()));
    };

    const onUp = (e: PointerEvent) => {
      if (!points.has(e.pointerId)) return;
      e.stopPropagation();
      points.delete(e.pointerId);
      const g = gesture;
      if (!g) return;
      if (g.kind === 'two') {
        // Bir parmak kalktı: kalan parmak kaydırmayı sürdürür (dokunma sayılmaz)
        const rest = [...points.entries()][0];
        if (rest) startOne(rest[0], rest[1], true, false);
        else gesture = null;
        return;
      }
      if (g.id !== e.pointerId) return;
      gesture = null;
      if (e.type === 'pointerup' && !g.moved && !g.control && performance.now() - g.at < TAP_MS)
        tap({ x: e.clientX, y: e.clientY });
    };

    // Ctrl/⌘ + tekerlek (dokunmatik yüzeyde kıstırma da böyle gelir) yakınlaştırır; yakınken tekerlek kaydırır
    const onWheel = (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? root.clientHeight : 1;
      const { book: b } = latest.current;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const focal = rel({ x: e.clientX, y: e.clientY });
        store.set(wheelZoom(store.get(), e.deltaY * unit, focal, b, view()));
      } else if (isZoomed(store.get())) {
        e.preventDefault();
        store.set(panBy(store.get(), -e.deltaX * unit, -e.deltaY * unit, b, view()));
      }
    };
    // Tarayıcı sayfayı kaydırmasın, kendisi yakınlaştırmasın (touch-action: none'ın yanında eski WebKit için)
    const onTouchMove = (e: TouchEvent) => {
      if (e.cancelable && (e.touches.length > 1 || points.size > 0)) e.preventDefault();
    };
    const noDefault = (e: Event) => e.preventDefault();

    root.addEventListener('pointerdown', onDown, true);
    root.addEventListener('pointermove', onMove, true);
    root.addEventListener('pointerup', onUp, true);
    root.addEventListener('pointercancel', onUp, true);
    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('touchmove', onTouchMove, { passive: false });
    // Safari'nin kendi kıstırma olayı (yalnızca Safari'de gelir; yakınlaştırma ona bağlı değil)
    root.addEventListener('gesturestart', noDefault);
    return () => {
      clearTimeout(tapTimer);
      root.removeEventListener('pointerdown', onDown, true);
      root.removeEventListener('pointermove', onMove, true);
      root.removeEventListener('pointerup', onUp, true);
      root.removeEventListener('pointercancel', onUp, true);
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('touchmove', onTouchMove);
      root.removeEventListener('gesturestart', noDefault);
    };
  }, [rootRef, active, store, view]);

  return { step, reset };
}
