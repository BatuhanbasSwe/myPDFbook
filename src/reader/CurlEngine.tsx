import { PageFlip } from 'page-flip/dist/js/page-flip.module.js';
import { useEffect, useImperativeHandle, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { FlipBookProps } from './FlipBook';

/** Kütüphanenin (StPageFlip) dokunma durumu: yayımlanmış arayüzünde yok */
interface LibraryTouch {
  isUserTouch: boolean;
  isUserMove: boolean;
  /** `isSwipe`: çekmeyi bitirmeden yalnızca dokunmayı bırakır */
  userStop(pos: { x: number; y: number }, isSwipe: boolean): void;
}

/** Açık sayfanın bu kadar komşusu doldurulur; uzaktaki sayfalar boş kutudur (bellek) */
const FILLED = 4;
/** Bundan az hareket dokunmadır (px) */
const TAP_MAX = 8;

/**
 * Kıvrılan kitap sayfası (StPageFlip). Kütüphane sayfa öğelerini kendisi taşıyıp döndürdüğü için kutular React
 * dışında kurulur; sayfa içerikleri React ile bu kutulara (portal) çizilir. Böylece kütüphanenin DOM değişiklikleri
 * React'i bozmaz.
 */
export function CurlEngine(props: FlipBookProps) {
  const {
    count,
    index,
    spread,
    width,
    height,
    swipe,
    onIndexChange,
    onTap,
    onDismiss,
    gesturesDisabled = false,
    renderPage,
    ref,
  } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<PageFlip | null>(null);
  const [pages, setPages] = useState<HTMLDivElement[]>([]);
  const pageWidth = spread ? Math.floor(width / 2) : width;
  // Kütüphanenin olay dinleyicisi en güncel değerleri görsün (kitap her çizimde yeniden kurulmasın)
  const latest = useRef({ index, onIndexChange, gesturesDisabled });
  useEffect(() => {
    latest.current = { index, onIndexChange, gesturesDisabled };
  });

  // Kalem kipi: kütüphane sayfayı fare ve dokunmayla (mousedown/touchstart, kendi öğesinde) çevirir. Kip açıkken bu
  // olaylar kitabın kutusunda, yakalama aşamasında durdurulur: kütüphaneye ulaşmaz, kitap yeniden kurulmaz.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const block = (e: Event) => {
      if (latest.current.gesturesDisabled) e.stopPropagation();
    };
    host.addEventListener('mousedown', block, true);
    host.addEventListener('touchstart', block, true);
    return () => {
      host.removeEventListener('mousedown', block, true);
      host.removeEventListener('touchstart', block, true);
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || count === 0) return;
    const book = document.createElement('div');
    host.append(book);
    const els = Array.from({ length: count }, (_, i) => {
      const el = document.createElement('div');
      el.className = 'flip-page';
      el.dataset.page = String(i);
      Object.assign(el.style, { width: `${pageWidth}px`, height: `${height}px` });
      return el;
    });
    const pf = new PageFlip(book, {
      width: pageWidth,
      height,
      size: 'fixed',
      startPage: latest.current.index,
      usePortrait: !spread,
      showCover: false,
      drawShadow: true,
      maxShadowOpacity: 0.35,
      flippingTime: 650,
      mobileScrollSupport: false,
      useMouseEvents: swipe, // köşeden çekme ve kaydırma
      disableFlipByClick: true, // dokunmayı okuyucu yönetir
      showPageCorners: false,
      autoSize: false,
    });
    pf.loadFromHTML(els);
    pf.on('flip', (e) => {
      const i = Number(e.data);
      if (Number.isFinite(i) && i !== latest.current.index) latest.current.onIndexChange(i);
    });
    flipRef.current = pf;
    // Kutular kütüphaneye verildikten sonra içerikleri çizilebilir
    setPages(els);
    return () => {
      flipRef.current = null;
      setPages([]);
      pf.destroy();
      book.remove();
    };
  }, [count, pageWidth, height, spread, swipe]);

  // Dışarıdan gelen sayfa değişikliği (içindekiler, kaydırıcı, yazı ayarı): animasyonsuz
  useEffect(() => {
    const pf = flipRef.current;
    if (!pf) return;
    const cur = pf.getCurrentPageIndex();
    const same = spread ? Math.floor(cur / 2) === Math.floor(index / 2) : cur === index;
    if (!same) pf.turnToPage(index);
    // Kütüphane görünmeyen sayfaları gizler (display: none); yine de ekran okuyucu yalnızca açık sayfaları okusun
    pages.forEach((el, i) => {
      const shown = spread ? Math.floor(i / 2) === Math.floor(index / 2) : i === index;
      if (shown) el.removeAttribute('aria-hidden');
      else el.setAttribute('aria-hidden', 'true');
    });
  }, [index, spread, pages]);

  // Dokunma (sürüklemesiz) okuyucuya bildirilir: sağ/sol üçte bir sayfa çevirir, ortası menüyü açar
  const down = useRef<{ x: number; y: number } | null>(null);

  useImperativeHandle(ref, () => ({
    next: () => flipRef.current?.flipNext(),
    // Dikey görünümde geri çevirme kütüphanede yamalı (patches/page-flip@2.0.7.patch)
    prev: () => flipRef.current?.flipPrev(),
    cancelGesture: () => {
      down.current = null;
      // Kütüphanenin başlattığı dokunma: çekme başladıysa sayfa yerine döner, başlamadıysa yalnızca unutulur (bırakınca
      // köşeye dokunma sayılıp sayfa çevrilmesin)
      const pf = flipRef.current as unknown as LibraryTouch | null;
      if (pf?.isUserTouch) pf.userStop({ x: 0, y: 0 }, !pf.isUserMove);
    },
  }));
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.pointerType === 'mouse' && e.button !== 0) || gesturesDisabled) return;
    down.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = down.current;
    down.current = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_MAX) return;
    // Panel açıkken dokunma yalnızca paneli kapatır
    if (onDismiss) return onDismiss();
    const r = e.currentTarget.getBoundingClientRect();
    onTap((e.clientX - r.left) / r.width);
  };

  return (
    <div
      ref={hostRef}
      data-testid="flipbook"
      data-index={index}
      data-count={count}
      data-effect="curl"
      data-spread={spread || undefined}
      data-ready={pages.length > 0 || undefined}
      className="curl-book select-none"
      style={{ width: spread ? pageWidth * 2 : pageWidth, height }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (down.current = null)}
    >
      {/* Sayfa sayısı azaldığında kitap yeniden kurulana dek eski kutular durur: yalnızca var olan sayfalar çizilir */}
      {pages.map((el, i) =>
        i < count && Math.abs(i - index) <= FILLED
          ? createPortal(renderPage(i), el, `p${i}`)
          : null,
      )}
    </div>
  );
}
