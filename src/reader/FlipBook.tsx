import {
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { CurlEngine } from './CurlEngine';
import type { FlipEffect } from './readerPrefs';

/** Sayfa çevirme motorlarının ortak arayüzü: okuyucu motoru bilmeden sayfa çevirir. */
export interface FlipBookHandle {
  next(): void;
  prev(): void;
}

export interface FlipBookProps {
  /** toplam sayfa */
  count: number;
  /** görünen (çift sayfada soldaki) sayfa */
  index: number;
  spread: boolean;
  effect: FlipEffect;
  /** kaydırarak çevirme açık mı */
  swipe: boolean;
  width: number;
  height: number;
  onIndexChange(index: number): void;
  /** sürükleme olmadan dokunma; x: 0 (sol kenar) … 1 (sağ kenar) */
  onTap(x: number): void;
  renderPage(index: number): ReactNode;
  ref?: Ref<FlipBookHandle>;
}

/** Kaydırma sayılmak için en az yatay hareket (px) */
const SWIPE_MIN = 40;
/** Bundan az hareket dokunmadır (px) */
const TAP_MAX = 8;

/**
 * Kitap: seçilen efektle sayfa çevirir. Motorlar aynı arayüzü uygular: kıvrılan sayfa (CurlEngine.tsx), slayt ve
 * anında değişim.
 */
export function FlipBook(props: FlipBookProps) {
  if (props.effect === 'none') return <InstantEngine {...props} />;
  if (props.effect === 'curl') return <CurlEngine {...props} />;
  return <SlideEngine {...props} />;
}

function spreadPages(props: FlipBookProps, first: number): ReactNode {
  const { spread, count, renderPage } = props;
  // Kitabın dışına düşen yuva (baştan önceki, sondan sonraki) boş kalır
  if (first < 0 || first >= count) return <div className="h-full" />;
  return (
    <div className="flex h-full justify-center">
      {renderPage(first)}
      {spread && first + 1 < count && renderPage(first + 1)}
    </div>
  );
}

/** Dokunma ve kaydırma algılama; slayt motorunda sürükleme sayfayı taşır. */
function usePointer(
  props: FlipBookProps,
  onDrag: (dx: number) => void,
  onRelease: (dx: number, vx: number) => void,
) {
  const start = useRef<{ x: number; y: number; t: number; horizontal?: boolean } | null>(null);
  return {
    onPointerDown(e: PointerEvent<HTMLDivElement>) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      start.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    },
    onPointerMove(e: PointerEvent<HTMLDivElement>) {
      const s = start.current;
      if (!s || !props.swipe) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (s.horizontal === undefined && Math.hypot(dx, dy) > TAP_MAX) {
        s.horizontal = Math.abs(dx) > Math.abs(dy);
        if (s.horizontal) e.currentTarget.setPointerCapture(e.pointerId);
      }
      if (s.horizontal) onDrag(dx);
    },
    onPointerUp(e: PointerEvent<HTMLDivElement>) {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (s.horizontal === undefined && Math.hypot(dx, dy) <= TAP_MAX) {
        const r = e.currentTarget.getBoundingClientRect();
        props.onTap((e.clientX - r.left) / r.width);
        return;
      }
      if (s.horizontal) onRelease(dx, dx / Math.max(1, performance.now() - s.t));
    },
    onPointerCancel() {
      if (start.current?.horizontal) onRelease(0, 0);
      start.current = null;
    },
  };
}

function InstantEngine(props: FlipBookProps) {
  const { index, count, spread, onIndexChange, ref } = props;
  const step = spread ? 2 : 1;
  const go = (dir: 1 | -1) => {
    const next = index + dir * step;
    if (next >= 0 && next < count) onIndexChange(next);
  };
  useImperativeHandle(ref, () => ({ next: () => go(1), prev: () => go(-1) }));
  const pointer = usePointer(
    props,
    () => undefined,
    (dx) => {
      if (Math.abs(dx) >= SWIPE_MIN) go(dx < 0 ? 1 : -1);
    },
  );
  return (
    <div
      data-testid="flipbook"
      data-index={index}
      data-count={count}
      data-ready
      className="h-full touch-pan-y select-none"
      style={{ width: props.width, height: props.height }}
      {...pointer}
    >
      {spreadPages(props, index)}
    </div>
  );
}

function SlideEngine(props: FlipBookProps) {
  const { index, count, spread, width, height, onIndexChange, ref } = props;
  const step = spread ? 2 : 1;
  const [drag, setDrag] = useState(0);
  // Kayma animasyonu sürerken hedef sayfa; bitince sayfa değişir ve şerit sıfırlanır
  const [target, setTarget] = useState<number | null>(null);
  // Yarım kalan sürükleme yerine dönüyor (animasyonlu); sayfa değişince şerit animasyonsuz sıfırlanır
  const [returning, setReturning] = useState(false);

  const slide = (dir: 1 | -1) => {
    if (target !== null) return;
    const next = index + dir * step;
    if (next < 0 || next >= count) {
      setReturning(drag !== 0);
      setDrag(0);
      return;
    }
    setTarget(next);
  };
  useImperativeHandle(ref, () => ({ next: () => slide(1), prev: () => slide(-1) }));

  const pointer = usePointer(
    props,
    (dx) => {
      if (target !== null) return;
      // Kitabın başında ya da sonunda sürükleme dirençle sınırlı
      const atEdge = (dx > 0 && index - step < 0) || (dx < 0 && index + step >= count);
      setDrag(atEdge ? dx / 4 : dx);
    },
    (dx, vx) => {
      if (Math.abs(dx) > width * 0.2 || (Math.abs(dx) > SWIPE_MIN && Math.abs(vx) > 0.4))
        slide(dx < 0 ? 1 : -1);
      else {
        setReturning(drag !== 0);
        setDrag(0);
      }
    },
  );

  const shift = target === null ? drag : target > index ? -width : width;
  const animate = target !== null || returning;
  return (
    <div
      data-testid="flipbook"
      data-index={index}
      data-count={count}
      data-ready
      className="relative touch-pan-y overflow-hidden select-none"
      style={{ width, height }}
      {...pointer}
    >
      <div
        className="absolute inset-y-0 flex"
        style={{
          left: -width,
          width: width * 3,
          transform: `translateX(${shift}px)`,
          transition: animate ? 'transform 260ms ease-out' : 'none',
        }}
        onTransitionEnd={() => {
          setReturning(false);
          if (target === null) return;
          onIndexChange(target);
          setTarget(null);
          setDrag(0);
        }}
      >
        <div style={{ width }}>{spreadPages(props, index - step)}</div>
        <div style={{ width }}>{spreadPages(props, index)}</div>
        <div style={{ width }}>{spreadPages(props, index + step)}</div>
      </div>
    </div>
  );
}
