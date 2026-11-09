import { useEffect, useRef } from 'react';
import type { Block } from '../convert/types';
import { db } from '../db/db';
import { SessionTracker } from './sessionTracker';

/** Kalem havada gezinirken (odak modu) ya da fare oynarken etkinlik en çok bu aralıkla yazılır (ms) */
const MOVE_THROTTLE_MS = 5_000;

/**
 * Okuyucunun okuma oturumlarını izler (bkz. sessionTracker). Dinleyiciler pasiftir ve yalnızca bir zaman yazar;
 * okuyucu yeniden çizilmez. `pages`: açık PDF sayfaları (çift sayfada ikisi); `playing`: sesli ya da hızlı okuma
 * sürüyor.
 */
export function useSessionTracker({
  bookId,
  blocks,
  pages,
  playing,
}: {
  bookId: string;
  blocks: readonly Block[];
  pages: readonly number[];
  playing: boolean;
}): void {
  const ref = useRef<SessionTracker | null>(null);

  useEffect(() => {
    const tracker = new SessionTracker({
      bookId,
      save: (s) => void db.sessions.put(s).catch(() => undefined),
    });
    ref.current = tracker;
    // Kitabı açmak okumaya başlamaktır (30 sn'den kısa göz atma yazılmaz)
    tracker.setVisible(document.visibilityState !== 'hidden');
    tracker.activity();

    let lastMove = 0;
    const onActivity = (e: Event) => {
      if (reading(e)) tracker.activity();
    };
    const onMove = (e: PointerEvent | WheelEvent) => {
      if (e.timeStamp - lastMove < MOVE_THROTTLE_MS || !reading(e)) return;
      lastMove = e.timeStamp;
      tracker.activity();
    };
    const onVisibility = () => tracker.setVisible(document.visibilityState !== 'hidden');
    // Sayfa kapanıyor (iOS'ta uygulamadan çıkış da olabilir): oturum o an yazılır
    const onHide = () => tracker.stop();
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    window.addEventListener('pointerdown', onActivity, opts);
    window.addEventListener('keydown', onActivity, opts);
    window.addEventListener('pointermove', onMove, opts);
    window.addEventListener('wheel', onMove, opts);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pointerdown', onActivity, opts);
      window.removeEventListener('keydown', onActivity, opts);
      window.removeEventListener('pointermove', onMove, opts);
      window.removeEventListener('wheel', onMove, opts);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
      tracker.dispose();
      ref.current = null;
    };
  }, [bookId]);

  // Sayfanın kelimeleri: kitap başına bir kez sayılır
  useEffect(() => {
    const counts = pageWordCounts(blocks);
    ref.current?.setWords((p) => counts.get(p) ?? 0);
  }, [blocks, bookId]);

  const key = pages.join(',');
  useEffect(() => {
    if (key) ref.current?.pages(key.split(',').map(Number));
  }, [key, bookId]);

  useEffect(() => {
    ref.current?.setPlaying(playing);
  }, [playing, bookId]);
}

/**
 * Pencerede (kitap günlüğü, paneller), yazı kutusunda ya da seçim kutusunda yapılan iş okuma sayılmaz: yalnızca
 * kitabın ve çubukların üstündeki etkinlik süreyi işletir (sayfa değişimi ayrıca sayılır).
 */
const NOT_READING =
  'dialog, [role="dialog"], [aria-modal="true"], input, textarea, select, [contenteditable]';

function reading(e: Event): boolean {
  const t = e.target;
  return !(t instanceof Element && t.closest(NOT_READING));
}

/** PDF sayfası başına kelime sayısı (blokların kaynak sayfasına göre; yaklaşık) */
export function pageWordCounts(blocks: readonly Block[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const b of blocks) {
    if (!('text' in b)) continue;
    counts.set(b.srcPage, (counts.get(b.srcPage) ?? 0) + countWords(b.text));
  }
  return counts;
}

function countWords(text: string): number {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const space = text.charCodeAt(i) <= 32;
    if (!space && !inWord) n++;
    inWord = !space;
  }
  return n;
}
