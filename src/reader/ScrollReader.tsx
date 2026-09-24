import { memo, useEffect, useMemo, useRef, type RefObject } from 'react';
import type { Block, Lang } from '../convert/types';
import { saveProgress } from '../db/books';
import { db } from '../db/db';
import type { PdfDocument } from '../pdf/pdfjs';
import { PageImage } from './PageImage';
import { blockStartFractions } from './progress';

interface Props {
  bookId: string;
  blocks: Block[];
  lang: Lang;
  initialBlock: number;
  pdf: PdfDocument | null;
  /** PDF açılamadı: görsel sayfalar gösterilemez */
  pdfFailed: boolean;
  /** Metnin üstünü örten yapışkan başlık çubuğu: kaldığı yer bunun altına getirilir; altında kalan blok okunuyor sayılmaz. */
  headerRef: RefObject<HTMLElement | null>;
  onVisiblePage(pageIndex: number): void;
}

/**
 * Geçici okuma görünümü (Plan 2'de kitap görünümüyle değişir). İlerlemeyi görünen ilk bloğa göre kaydeder.
 * memo: kaydırırken değişen sayfa numarası binlerce bloğu yeniden çizdirmesin.
 */
export const ScrollReader = memo(function ScrollReader({
  bookId,
  blocks,
  lang,
  initialBlock,
  pdf,
  pdfFailed,
  headerRef,
  onVisiblePage,
}: Props) {
  const containerRef = useRef<HTMLElement>(null);
  const fractions = useMemo(() => blockStartFractions(blocks), [blocks]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const topInset = () => headerRef.current?.getBoundingClientRect().bottom ?? 0;
    const elements = new Map<number, HTMLElement>();
    root
      .querySelectorAll<HTMLElement>('[data-block]')
      .forEach((el) => elements.set(Number(el.dataset.block), el));

    let lastSaved = initialBlock;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: (() => void) | undefined;
    const flush = () => {
      clearTimeout(timer);
      pending?.();
      pending = undefined;
    };

    const visible = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.block);
          if (entry.isIntersecting) visible.add(index);
          else visible.delete(index);
        }
        // Başlık çubuğunun altında kalan (ya da altından yalnızca birkaç piksel taşan) blok okunmuyor.
        // Pay, kaydırma konumunun piksele yuvarlanmasını karşılar: yoksa geri yüklemeden sonra bir önceki blok seçilir.
        const inset = topInset() + 8;
        const first = [...visible]
          .sort((a, b) => a - b)
          .find((i) => (elements.get(i)?.getBoundingClientRect().bottom ?? 0) > inset);
        if (first === undefined) return;
        onVisiblePage(blocks[first]?.srcPage ?? 0);
        clearTimeout(timer);
        pending = undefined;
        if (first === lastSaved) return; // yer değişmedi: gereksiz yazma yok
        pending = () => {
          lastSaved = first;
          saveProgress(db, bookId, { block: first, offset: 0 }, fractions[first] ?? 0).catch(
            () => undefined,
          );
        };
        timer = setTimeout(flush, 400);
      },
      { rootMargin: '0px 0px -70% 0px' },
    );

    // Uygulama değiştirilince ya da sayfa kapanınca bekleyen kaydı hemen yaz
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);

    // Önce kaldığı yere git (yazı tipi yüklenince; yoksa satırlar sonradan kayar), sonra izlemeye başla
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      const target = initialBlock > 0 ? elements.get(initialBlock) : undefined;
      if (target)
        window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - topInset() });
      elements.forEach((el) => observer.observe(el));
    });

    return () => {
      cancelled = true;
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [blocks, bookId, fractions, initialBlock, headerRef, onVisiblePage]);

  return (
    <main
      ref={containerRef}
      lang={lang === 'en' ? 'en' : 'tr'}
      className="book-text mx-auto max-w-[38rem] px-5 pb-32 pt-6"
    >
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} index={index} pdf={pdf} pdfFailed={pdfFailed} />
      ))}
    </main>
  );
});

function BlockView({
  block,
  index,
  pdf,
  pdfFailed,
}: {
  block: Block;
  index: number;
  pdf: PdfDocument | null;
  pdfFailed: boolean;
}) {
  switch (block.kind) {
    case 'heading':
      return block.level === 1 ? (
        <h2 data-block={index} className="mb-2 mt-16 text-center font-book text-2xl tracking-wide">
          {block.text}
        </h2>
      ) : (
        <h3 data-block={index} className="mb-10 text-center font-book text-lg italic text-muted">
          {block.text}
        </h3>
      );
    case 'para':
      return (
        <p data-block={index} className="book-para">
          {block.text}
        </p>
      );
    case 'note':
      return (
        <aside
          data-block={index}
          role="note"
          className="my-3 border-l-2 border-line pl-3 text-sm text-muted"
        >
          {block.text}
        </aside>
      );
    case 'break':
      return (
        <div data-block={index} className="book-break my-6 text-center text-muted" aria-hidden>
          ⁂
        </div>
      );
    case 'pageImage':
      return (
        <div data-block={index} className="my-6">
          <PageImage pdf={pdf} failed={pdfFailed} pageIndex={block.srcPage} />
        </div>
      );
  }
}
