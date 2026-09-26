import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type PointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { flushSync } from 'react-dom';
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
  /**
   * Verilirse (üstte panel açık) kitaba dokunma ya da kaydırma sayfa çevirmez, yalnızca bunu çağırır. Kıvrılan
   * sayfada kaydırmayı kütüphane yönetir: orada sayfa çevrilir, okuyucu paneli sayfa değişince kapatır.
   */
  onDismiss?(): void;
  renderPage(index: number): ReactNode;
  ref?: Ref<FlipBookHandle>;
}

/** Kaydırma sayılmak için en az yatay hareket (px) */
const SWIPE_MIN = 40;
/** Bundan az hareket dokunmadır (px) */
const TAP_MAX = 8;
/** Slayt kayma süresi (ms) */
const SLIDE_MS = 260;
/** Geçiş bitti olayı gelmezse (sekme arka planda, geçiş hiç başlamadı) kayma bu süre sonra yine de biter (ms) */
const SLIDE_WATCHDOG = SLIDE_MS + 90;

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
  // Tek sayılı kitabın son çift sayfasında yalnız kalan sayfa solda durur (ortada değil)
  return (
    <div className="flex h-full">
      {renderPage(first)}
      {spread && first + 1 < count && renderPage(first + 1)}
    </div>
  );
}

interface Gestures {
  /** parmak/fare kitaba değdi */
  grab?(): void;
  /** yatay sürükleme sürüyor */
  drag(dx: number): void;
  /** yatay sürükleme bitti; vx: px/ms */
  release(dx: number, vx: number): void;
}

/** Dokunma ve kaydırma algılama; slayt motorunda sürükleme sayfayı taşır. */
function usePointer(props: FlipBookProps, gestures: Gestures) {
  const start = useRef<{ x: number; y: number; t: number; horizontal?: boolean } | null>(null);
  return {
    onPointerDown(e: PointerEvent<HTMLDivElement>) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      start.current = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (!props.onDismiss) gestures.grab?.();
    },
    onPointerMove(e: PointerEvent<HTMLDivElement>) {
      const s = start.current;
      if (!s || !props.swipe || props.onDismiss) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (s.horizontal === undefined && Math.hypot(dx, dy) > TAP_MAX) {
        s.horizontal = Math.abs(dx) > Math.abs(dy);
        if (s.horizontal) e.currentTarget.setPointerCapture(e.pointerId);
      }
      if (s.horizontal) gestures.drag(dx);
    },
    onPointerUp(e: PointerEvent<HTMLDivElement>) {
      const s = start.current;
      start.current = null;
      if (!s) return;
      // Panel açıkken dokunma da kaydırma da yalnızca paneli kapatır
      if (props.onDismiss) return props.onDismiss();
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (s.horizontal === undefined && Math.hypot(dx, dy) <= TAP_MAX) {
        const r = e.currentTarget.getBoundingClientRect();
        props.onTap((e.clientX - r.left) / r.width);
        return;
      }
      if (s.horizontal) gestures.release(dx, dx / Math.max(1, performance.now() - s.t));
    },
    onPointerCancel() {
      if (start.current?.horizontal) gestures.release(0, 0);
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
  const pointer = usePointer(props, {
    drag: () => undefined,
    release: (dx) => {
      if (Math.abs(dx) >= SWIPE_MIN) go(dx < 0 ? 1 : -1);
    },
  });
  return (
    <div
      data-testid="flipbook"
      data-index={index}
      data-count={count}
      data-spread={spread || undefined}
      data-ready
      className="h-full touch-pan-y select-none"
      style={{ width: props.width, height: props.height }}
      {...pointer}
    >
      {spreadPages(props, index)}
    </div>
  );
}

/** Süren kayma: hedef sayfa (null: yarım kalan sürükleme yerine dönüyor) ve bekçi zamanlayıcısı */
interface SlideAnim {
  target: number | null;
  timer: ReturnType<typeof setTimeout>;
}

/** Şeridi taşır; animated değilse anında */
function placeStrip(el: HTMLElement | null, x: number, animated: boolean) {
  if (!el) return;
  el.style.transition = animated ? `transform ${SLIDE_MS}ms ease-out` : 'none';
  el.style.transform = `translateX(${x}px)`;
}

function stopAnim(anim: RefObject<SlideAnim | null>) {
  if (anim.current) clearTimeout(anim.current.timer);
  anim.current = null;
}

/**
 * Slayt: önceki, görünen ve sonraki sayfa bir şeritte yan yana durur; sürükleme ve kayma şeridi taşır. Şerit React
 * dışında taşınır: sürüklemede her harekette yeniden çizim olmasın ve kaymanın bittiği kesin bilinsin.
 */
function SlideEngine(props: FlipBookProps) {
  const { index, count, spread, width, height, ref } = props;
  const step = spread ? 2 : 1;
  const stripRef = useRef<HTMLDivElement>(null);
  const anim = useRef<SlideAnim | null>(null);
  // Şeridin şu anki kayması (px)
  const shift = useRef(0);
  // Zamanlayıcı ve olay dinleyicisi en güncel değerleri görsün
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  const move = (x: number, animated: boolean) => {
    shift.current = x;
    placeStrip(stripRef.current, x, animated);
  };

  // Kaymayı bitirir: hedef varsa sayfa hemen değişir (eşzamanlı çizilir), şerit animasyonsuz ortaya döner
  const finish = () => {
    const a = anim.current;
    if (!a) return;
    stopAnim(anim);
    const target = a.target;
    if (target !== null) flushSync(() => latest.current.onIndexChange(target));
    move(0, false);
  };

  const animateTo = (x: number, target: number | null) => {
    const el = stripRef.current;
    if (!el) return;
    anim.current = { target, timer: setTimeout(finish, SLIDE_WATCHDOG) };
    // Şerit zaten oradaysa geçiş olmaz, geçiş bitti olayı da gelmez: hemen bitir
    if (x === shift.current) return finish();
    el.getBoundingClientRect(); // başlangıç konumu uygulansın (önceki kayma az önce anında bitirildiyse)
    move(x, true);
  };

  const slide = (dir: 1 | -1) => {
    // Süren kayma anında biter, yenisi hemen başlar: hızlı basışlar kaybolmaz
    finish();
    const cur = latest.current;
    const next = cur.index + dir * (cur.spread ? 2 : 1);
    if (next < 0 || next >= cur.count) animateTo(0, null);
    else animateTo(dir > 0 ? -cur.width : cur.width, next);
  };
  useImperativeHandle(ref, () => ({ next: () => slide(1), prev: () => slide(-1) }));

  // Sayfa, sayfa sayısı ya da boyut değişti (kayma bitti ya da içindekiler, kaydırıcı, yazı ayarı): süren kayma ve
  // sürükleme bırakılır, şerit yeni sayfayı ortada gösterir (çizimden önce: eski sayfa bir kare bile görünmez)
  useLayoutEffect(() => {
    stopAnim(anim);
    shift.current = 0;
    placeStrip(stripRef.current, 0, false);
  }, [index, count, width, step]);
  useEffect(() => () => stopAnim(anim), []);

  const pointer = usePointer(props, {
    // Yeniden tutunca süren kayma ya da geri dönüş hemen biter: sürükleme gecikmeden parmağı izler
    grab: finish,
    drag(dx) {
      if (anim.current) return;
      const cur = latest.current;
      const s = cur.spread ? 2 : 1;
      // Kitabın başında ya da sonunda sürükleme dirençle sınırlı
      const atEdge = (dx > 0 && cur.index - s < 0) || (dx < 0 && cur.index + s >= cur.count);
      move(atEdge ? dx / 4 : dx, false);
    },
    release(dx, vx) {
      if (anim.current) return;
      if (
        Math.abs(dx) > latest.current.width * 0.2 ||
        (Math.abs(dx) > SWIPE_MIN && Math.abs(vx) > 0.4)
      )
        slide(dx < 0 ? 1 : -1);
      else animateTo(0, null);
    },
  });

  // Yuvalar ilk sayfalarıyla anahtarlanır: çevirince React düğümleri taşır, görünen sayfalar yeniden kurulmaz
  const slots = [index - step, index, index + step];
  return (
    <div
      data-testid="flipbook"
      data-index={index}
      data-count={count}
      data-spread={spread || undefined}
      data-ready
      className="relative touch-pan-y overflow-hidden select-none"
      style={{ width, height }}
      {...pointer}
    >
      <div
        ref={stripRef}
        className="absolute inset-y-0 flex"
        style={{ left: -width, width: width * 3 }}
        onTransitionEnd={(e) => {
          // Sayfaların içindeki geçişler de buraya kabarır
          if (e.target === e.currentTarget && e.propertyName === 'transform') finish();
        }}
      >
        {slots.map((first) => (
          <div
            key={first}
            style={{ width }}
            // Yandaki yuvalar ekranda değil: ekran okuyucu ve klavye onları görmesin
            aria-hidden={first !== index || undefined}
            inert={first !== index}
          >
            {spreadPages(props, first)}
          </div>
        ))}
      </div>
    </div>
  );
}
