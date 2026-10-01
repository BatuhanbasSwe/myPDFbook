/**
 * Araç ipucunun zamanlaması ve yeri (DOM'suz; Tooltip.tsx bunu kullanır, birim testleri de).
 *
 * - Fare: üzerine gelince HOVER_DELAY sonra görünür, çıkınca ya da basınca kaybolur.
 * - Dokunma: LONG_PRESS basılı tutunca görünür; bu basış düğmeyi çalıştırmaz (ardından gelen tıklama yutulur).
 *   Parmak kalkınca ipucu LINGER daha kalır. Parmak kayarsa (kaydırma) basılı tutma sayılmaz.
 * - Klavye: odak gelince hemen görünür, odak gidince kaybolur.
 * - Kalem (Apple Pencil): hiç görünmez; kalemin dokunuşu düğmeye olduğu gibi basar.
 */

/** Fareyle üzerinde bekleme (ms) */
export const HOVER_DELAY = 500;
/** Dokunarak basılı tutma (ms) */
export const LONG_PRESS = 450;
/** Basılı tutma bitince ipucunun kalma süresi (ms) */
export const LINGER = 1500;
/** Basılı tutarken bundan çok kayan parmak kaydırıyordur (px) */
export const MOVE_SLOP = 10;

/** İpucunun yazısı: düğmenin adı ve varsa kısayolu ("Sayfayı kilitle · L") */
export function tooltipText(label: string, shortcut?: string): string {
  return shortcut ? `${label} · ${shortcut}` : label;
}

export interface TooltipTimers {
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
}

/** Zamanlayıcılar çağrı anında alınır (testte sahte saat) */
const realTimers: TooltipTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export interface TooltipController {
  /** işaretçi düğmenin üstüne geldi */
  enter(pointerType: string): void;
  /** işaretçi düğmeden çıktı */
  leave(pointerType: string): void;
  down(pointerType: string, x: number, y: number): void;
  move(x: number, y: number): void;
  up(): void;
  /** tarayıcı dokunuşu devraldı (kaydırma) */
  cancel(): void;
  /** odak geldi; `keyboard`: klavyeyle (görünür odak) */
  focus(keyboard: boolean): void;
  blur(): void;
  /** Basılı tutmanın ardından gelen tıklama: true ise yutulmalı (düğme çalışmaz) */
  consumeClick(): boolean;
  /** son basış dokunmayla basılı tutma mı (bağlam menüsü açılmasın) */
  longPressing(): boolean;
  hide(): void;
  dispose(): void;
}

export function createTooltipController({
  onShow,
  onHide,
  timers = realTimers,
}: {
  onShow(): void;
  onHide(): void;
  timers?: TooltipTimers;
}): TooltipController {
  let visible = false;
  let timer: unknown = null;
  let start: { x: number; y: number } | null = null;
  let longPressed = false;

  const clear = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  const show = () => {
    clear();
    if (visible) return;
    visible = true;
    onShow();
  };
  const hide = () => {
    clear();
    if (!visible) return;
    visible = false;
    onHide();
  };
  const endLongPress = () => {
    longPressed = false;
    hide();
  };
  const later = (fn: () => void, ms: number) => {
    clear();
    timer = timers.set(() => {
      timer = null;
      fn();
    }, ms);
  };

  return {
    enter(pointerType) {
      if (pointerType !== 'mouse' || visible) return;
      later(show, HOVER_DELAY);
    },
    leave(pointerType) {
      if (pointerType === 'mouse') hide();
    },
    down(pointerType, x, y) {
      longPressed = false;
      start = null;
      if (pointerType === 'touch') {
        hide();
        start = { x, y };
        later(() => {
          longPressed = true;
          show();
        }, LONG_PRESS);
      } else hide(); // fare ve kalem: basınca ipucu kalkar
    },
    move(x, y) {
      if (!start || longPressed) return;
      if (Math.hypot(x - start.x, y - start.y) > MOVE_SLOP) {
        start = null;
        clear();
      }
    },
    up() {
      if (!start) return;
      start = null;
      // Ardından gelen tıklama yutulur; tıklama hiç gelmezse işaret ipucuyla birlikte kalkar
      if (longPressed) later(endLongPress, LINGER);
      else clear();
    },
    cancel() {
      if (!start) return;
      start = null;
      // Tarayıcı dokunuşu devraldı: tıklama gelmez, yutulacak bir şey yok
      if (longPressed) {
        longPressed = false;
        later(hide, LINGER);
      } else clear();
    },
    focus(keyboard) {
      if (keyboard) show();
    },
    blur() {
      if (!longPressed) hide();
    },
    consumeClick() {
      if (!longPressed) return false;
      longPressed = false;
      return true;
    },
    longPressing: () => longPressed || start !== null,
    hide,
    dispose() {
      clear();
      visible = false;
    },
  };
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type TooltipSide = 'below' | 'above';

/**
 * İpucunun yeri: düğmenin altında (ya da üstünde) ortalı. Tercih edilen yanda yer yoksa öteki yana geçer; yatayda
 * ekranın kenarından `margin` içeride kalır.
 */
export function placeTooltip(
  anchor: Rect,
  tip: { width: number; height: number },
  view: { width: number; height: number },
  prefer: TooltipSide = 'below',
  gap = 8,
  margin = 8,
): { left: number; top: number; side: TooltipSide } {
  const below = anchor.top + anchor.height + gap;
  const above = anchor.top - gap - tip.height;
  const fitsBelow = below + tip.height <= view.height - margin;
  const fitsAbove = above >= margin;
  const side: TooltipSide =
    prefer === 'below'
      ? fitsBelow || !fitsAbove
        ? 'below'
        : 'above'
      : fitsAbove || !fitsBelow
        ? 'above'
        : 'below';
  const maxLeft = Math.max(margin, view.width - margin - tip.width);
  const left = Math.min(Math.max(margin, anchor.left + anchor.width / 2 - tip.width / 2), maxLeft);
  const top = side === 'below' ? below : above;
  return { left, top: Math.max(margin, Math.min(top, view.height - margin - tip.height)), side };
}
