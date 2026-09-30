import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  createTooltipController,
  placeTooltip,
  tooltipText,
  type TooltipSide,
} from './tooltipTiming';

/** Aynı anda tek ipucu: yenisi açılınca öncekini kapatır */
let hideCurrent: (() => void) | null = null;

export interface TooltipOptions {
  /** düğmenin adı (aria-label ile aynı) */
  label: string;
  /** klavye kısayolu ("L", "Esc") */
  shortcut?: string;
  /** tercih edilen yan (sığmazsa öteki yana açılır) */
  side?: TooltipSide;
  /** ipucu gösterilmez (ör. düğmenin yazısı zaten görünüyor) */
  disabled?: boolean;
}

/** Düğmeye bağlanan olaylar */
export interface TooltipHandlers {
  onPointerEnter(e: PointerEvent<HTMLElement>): void;
  onPointerLeave(e: PointerEvent<HTMLElement>): void;
  onPointerDown(e: PointerEvent<HTMLElement>): void;
  onPointerMove(e: PointerEvent<HTMLElement>): void;
  onPointerUp(e: PointerEvent<HTMLElement>): void;
  onPointerCancel(e: PointerEvent<HTMLElement>): void;
  onFocus(e: FocusEvent<HTMLElement>): void;
  onBlur(e: FocusEvent<HTMLElement>): void;
  onClickCapture(e: MouseEvent<HTMLElement>): void;
  onContextMenu(e: MouseEvent<HTMLElement>): void;
}

/**
 * Kabuk düğmesinin araç ipucu (zamanlama: tooltipTiming.ts). Düğmeye `handlers` bağlanır, `tip` düğmenin yanına konur
 * (belgenin gövdesine çizilir, dokunmayı engellemez). Yalnızca kabuk düğmelerine bağlanır: kitabın üstündeki
 * dokunma, kalem ve basılı tutma hareketlerine karışmaz.
 */
export function useTooltip({ label, shortcut, side = 'below', disabled }: TooltipOptions): {
  handlers: TooltipHandlers;
  tip: ReactNode;
} {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [controller] = useState(() =>
    createTooltipController({
      onShow: () => setOpen(true),
      onHide: () => setOpen(false),
    }),
  );

  // Açılınca öteki ipucu kapanır; kaydırma, pencere boyutu ve tuşa basma ipucunu kaldırır
  useEffect(() => {
    if (!open) return;
    const hide = () => controller.hide();
    if (hideCurrent && hideCurrent !== hide) hideCurrent();
    hideCurrent = hide;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' && e.key !== 'Tab') hide();
    };
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('keydown', onKey, true);
    return () => {
      if (hideCurrent === hide) hideCurrent = null;
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, controller]);
  useEffect(() => () => controller.dispose(), [controller]);
  // Devre dışı kalan (ya da adı değişen) düğmenin ipucu kalmaz
  useEffect(() => {
    if (disabled) controller.hide();
  }, [disabled, controller]);

  // Düğmenin yanına yerleşir, ekranın dışına taşmaz
  useLayoutEffect(() => {
    const el = tipRef.current;
    const at = anchor.current;
    if (!open || !el || !at) return;
    const r = at.getBoundingClientRect();
    // Düğme görünmüyorsa (gizlenen çubuk) ipucu da yok
    if (r.width === 0 && r.height === 0) {
      controller.hide();
      return;
    }
    const vv = window.visualViewport;
    const {
      left,
      top,
      side: placed,
    } = placeTooltip(
      { left: r.left, top: r.top, width: r.width, height: r.height },
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight },
      side,
    );
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.dataset.side = placed;
    el.style.visibility = 'visible';
  }, [open, side, controller, label, shortcut]);

  const off = disabled === true;
  const handlers: TooltipHandlers = {
    onPointerEnter: (e) => {
      if (off) return;
      anchor.current = e.currentTarget;
      controller.enter(e.pointerType);
    },
    onPointerLeave: (e) => controller.leave(e.pointerType),
    onPointerDown: (e) => {
      anchor.current = e.currentTarget;
      if (off) return controller.hide();
      controller.down(e.pointerType, e.clientX, e.clientY);
    },
    onPointerMove: (e) => {
      if (e.pointerType === 'touch') controller.move(e.clientX, e.clientY);
    },
    onPointerUp: () => controller.up(),
    onPointerCancel: () => controller.cancel(),
    onFocus: (e) => {
      if (off) return;
      anchor.current = e.currentTarget;
      controller.focus(focusVisible(e.currentTarget));
    },
    onBlur: () => controller.blur(),
    // Basılı tutma ipucu gösterdi: ardından gelen tıklama düğmeyi çalıştırmaz
    onClickCapture: (e) => {
      if (!controller.consumeClick()) return;
      e.preventDefault();
      e.stopPropagation();
    },
    // Dokunarak basılı tutunca tarayıcının bağlam menüsü açılmaz
    onContextMenu: (e) => {
      if (controller.longPressing()) e.preventDefault();
    },
  };

  const tip =
    open && !off
      ? createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            data-testid="tooltip"
            className="ui-tooltip"
            style={{ left: 0, top: 0, visibility: 'hidden' }}
          >
            {tooltipText(label, shortcut)}
          </div>,
          document.body,
        )
      : null;
  return { handlers, tip };
}

/** Odak klavyeyle mi geldi (görünür odak); eski tarayıcıda bilinemezse hayır */
function focusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

/** Birden çok olay işleyicisini tek işleyicide birleştirir (sırayla) */
export function chain<E>(...fns: (((e: E) => void) | undefined)[]): (e: E) => void {
  return (e) => {
    for (const fn of fns) fn?.(e);
  };
}
