/**
 * page-flip 2.0.7 (StPageFlip) paketinin kullandığımız kısmının türleri: paket tür tanımı içermiyor.
 * Kaynak: https://github.com/Nodlik/StPageFlip (Settings ve PageFlip sınıfı).
 */
declare module 'page-flip/dist/js/page-flip.module.js' {
  export interface FlipSettings {
    width: number;
    height: number;
    size?: 'fixed' | 'stretch';
    startPage?: number;
    drawShadow?: boolean;
    flippingTime?: number;
    usePortrait?: boolean;
    startZIndex?: number;
    autoSize?: boolean;
    maxShadowOpacity?: number;
    showCover?: boolean;
    mobileScrollSupport?: boolean;
    swipeDistance?: number;
    clickEventForward?: boolean;
    useMouseEvents?: boolean;
    showPageCorners?: boolean;
    disableFlipByClick?: boolean;
  }

  export interface FlipEvent {
    data: unknown;
  }

  export class PageFlip {
    constructor(element: HTMLElement, settings: FlipSettings);
    loadFromHTML(items: NodeListOf<HTMLElement> | HTMLElement[]): void;
    updateFromHtml(items: NodeListOf<HTMLElement> | HTMLElement[]): void;
    on(
      event: 'flip' | 'changeOrientation' | 'changeState' | 'init' | 'update',
      callback: (e: FlipEvent) => void,
    ): this;
    off(event: string): void;
    flipNext(corner?: 'top' | 'bottom'): void;
    flipPrev(corner?: 'top' | 'bottom'): void;
    flip(page: number, corner?: 'top' | 'bottom'): void;
    turnToPage(page: number): void;
    getCurrentPageIndex(): number;
    getPageCount(): number;
    getOrientation(): 'portrait' | 'landscape';
    update(): void;
    destroy(): void;
  }
}
