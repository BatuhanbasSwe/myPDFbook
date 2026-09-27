import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { orpIndex } from './rsvp';
import type { SpeedReaderUi } from './useSpeedReader';

/** Odak harfinin kartta durduğu yer (genişliğin oranı): uzun kelimenin sonu da sığsın diye ortanın solunda */
const ANCHOR = 0.4;
/** Kelimenin kartın kenarına en çok yaklaşacağı pay (px) */
const EDGE = 8;
/** Bağlamda gösterilen kelime (gösterilen kelimeden önce ve sonra) */
const BEFORE = 6;
const AFTER = 8;

/**
 * RSVP kartı (Spritz tarzı hızlı okuma): kelimeler kitabın ortasında büyük bir kartta tek tek belirir. Her kelimenin
 * odak harfi vurgu renginde ve hep aynı yerde, iki küçük çentiğin arasında durur: göz kıpırdamaz. Kartın altında
 * cümlenin gösterilen kelimeye yakın kısmı soluk yazılır, gösterilen kelimenin altı çizilir. Kitap arkada kararmış
 * görünür (etkin cümle vurgulu). Karta dokunmak oynatır ya da duraklatır. Denetleyicinin anlık durumunu kendisi
 * izler: okuyucu her kelimede yeniden çizilmez.
 */
export function RsvpCard({
  sr,
  style,
}: {
  sr: SpeedReaderUi;
  /** kitabın alanı (kart onun ortasında, karartma onun üstünde) */
  style: CSSProperties;
}) {
  const state = sr.useLive();
  const words = state?.mode === 'rsvp' ? state.words : [];
  const index = state?.word ?? 0;
  const word = words[index] ?? '';
  const paused = state?.status !== 'playing';

  return (
    <div
      data-testid="rsvp"
      className="pointer-events-none absolute z-[5] grid place-items-center bg-black/45 px-3"
      style={style}
    >
      <div
        role="button"
        aria-label={paused ? 'Oynat' : 'Duraklat'}
        data-testid="rsvp-card"
        onClick={sr.toggle}
        className="pointer-events-auto w-full max-w-xl cursor-pointer select-none rounded-3xl border border-line bg-surface px-4 pb-4 pt-3 shadow-xl"
      >
        <RsvpWord word={word} />
        <p className="mt-1 min-h-4 text-center text-xs text-muted" aria-live="polite">
          {paused ? 'Duraklatıldı · sürdürmek için dokunun' : null}
        </p>
        <p
          data-testid="rsvp-context"
          className="mt-2 line-clamp-2 min-h-[2.5em] text-center text-sm leading-[1.25em] text-muted"
        >
          {words.length > 0 && <Context words={words} index={index} />}
        </p>
      </div>
    </div>
  );
}

/**
 * Kelime, odak harfi çentiklerin arasında kalacak biçimde: kelimenin odak harfine dek genişliği ölçülür, kelime o
 * kadar sola kaydırılır. Karta sığmayan uzun kelime küçültülür.
 */
function RsvpWord({ word }: { word: string }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLSpanElement>(null);
  const beforeRef = useRef<HTMLSpanElement>(null);
  const orpRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  const orp = Math.min(orpIndex(word), Math.max(0, word.length - 1));

  // Kartın genişliği değişince (döndürme) yeniden yerleşir
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const ro = new ResizeObserver(() => setWidth(row.clientWidth));
    ro.observe(row);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const w = wordRef.current;
    const before = beforeRef.current;
    const letter = orpRef.current;
    if (!row || !w || !before || !letter) return;
    w.style.fontSize = '';
    const box = row.clientWidth;
    const anchor = box * ANCHOR;
    const lead = before.getBoundingClientRect().width + letter.getBoundingClientRect().width / 2;
    const total = w.getBoundingClientRect().width;
    const scale = Math.min(
      1,
      (anchor - EDGE) / Math.max(1, lead),
      (box - anchor - EDGE) / Math.max(1, total - lead),
    );
    if (scale < 1) w.style.fontSize = `${scale}em`;
    w.style.transform = `translateX(${anchor - lead * scale}px)`;
  }, [word, width]);

  return (
    <div className="relative py-3">
      <div className="absolute inset-x-0 top-0 h-px bg-line" />
      <div
        className="absolute top-0 h-2.5 w-0.5 -translate-x-1/2 rounded-full bg-muted"
        style={{ left: `${ANCHOR * 100}%` }}
      />
      <div
        ref={rowRef}
        className="relative h-[1.35em] overflow-hidden font-book text-[clamp(2.25rem,9vw,3.25rem)] leading-[1.35em] text-ink"
      >
        <span
          ref={wordRef}
          data-testid="rsvp-word"
          className="absolute top-0 left-0 whitespace-pre"
        >
          <span ref={beforeRef}>{word.slice(0, orp)}</span>
          <span ref={orpRef} data-testid="rsvp-orp" className="text-accent">
            {word.slice(orp, orp + 1)}
          </span>
          <span>{word.slice(orp + 1)}</span>
        </span>
      </div>
      <div
        className="absolute bottom-0 h-2.5 w-0.5 -translate-x-1/2 rounded-full bg-muted"
        style={{ left: `${ANCHOR * 100}%` }}
      />
      <div className="absolute inset-x-0 bottom-0 h-px bg-line" />
    </div>
  );
}

/** Cümlenin gösterilen kelimeye yakın kısmı; gösterilen kelimenin altı çizili */
function Context({ words, index }: { words: string[]; index: number }) {
  const from = Math.max(0, index - BEFORE);
  const to = Math.min(words.length, index + AFTER + 1);
  return (
    <>
      {from > 0 && '… '}
      {words.slice(from, to).map((w, k) => (
        <Fragment key={from + k}>
          {k > 0 && ' '}
          {from + k === index ? (
            <span className="text-ink underline decoration-accent decoration-2 underline-offset-4">
              {w}
            </span>
          ) : (
            w
          )}
        </Fragment>
      ))}
      {to < words.length && ' …'}
    </>
  );
}
