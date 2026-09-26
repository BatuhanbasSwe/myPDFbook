import { PageFlip } from 'page-flip/dist/js/page-flip.module.js';
import { useEffect, useImperativeHandle, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { FlipBookProps } from './FlipBook';

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
  const { count, index, spread, width, height, swipe, onIndexChange, onTap, renderPage, ref } =
    props;
  const hostRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<PageFlip | null>(null);
  const [pages, setPages] = useState<HTMLDivElement[]>([]);
  const pageWidth = spread ? Math.floor(width / 2) : width;
  // Kütüphanenin olay dinleyicisi en güncel değerleri görsün (kitap her çizimde yeniden kurulmasın)
  const latest = useRef({ index, onIndexChange });
  useEffect(() => {
    latest.current = { index, onIndexChange };
  });

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
  }, [index, spread, pages]);

  useImperativeHandle(ref, () => ({
    next: () => flipRef.current?.flipNext(),
    // Dikey görünümde geri çevirme kütüphanede yamalı (patches/page-flip@2.0.7.patch)
    prev: () => flipRef.current?.flipPrev(),
  }));

  // Dokunma (sürüklemesiz) okuyucuya bildirilir: sağ/sol üçte bir sayfa çevirir, ortası menüyü açar
  const down = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    down.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = down.current;
    down.current = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_MAX) return;
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
      data-ready={pages.length > 0 || undefined}
      className="curl-book select-none"
      style={{ width: spread ? pageWidth * 2 : pageWidth, height }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (down.current = null)}
    >
      {pages.map((el, i) =>
        Math.abs(i - index) <= FILLED ? createPortal(renderPage(i), el, `p${i}`) : null,
      )}
    </div>
  );
}
