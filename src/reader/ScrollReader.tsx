import { useEffect, useMemo, useRef } from 'react';
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
  onVisiblePage(pageIndex: number): void;
}

/** Geçici okuma görünümü (Plan 2'de kitap görünümüyle değişir). İlerlemeyi görünen ilk bloğa göre kaydeder. */
export function ScrollReader({ bookId, blocks, lang, initialBlock, pdf, onVisiblePage }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fractions = useMemo(() => blockStartFractions(blocks), [blocks]);

  useEffect(() => {
    containerRef.current?.querySelector(`[data-block="${initialBlock}"]`)?.scrollIntoView({ block: 'start' });
  }, [initialBlock]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const visible = new Set<number>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.block);
          if (entry.isIntersecting) visible.add(index);
          else visible.delete(index);
        }
        if (visible.size === 0) return;
        const first = Math.min(...visible);
        onVisiblePage(blocks[first]?.srcPage ?? 0);
        clearTimeout(timer);
        timer = setTimeout(() => void saveProgress(db, bookId, { block: first, offset: 0 }, fractions[first] ?? 0), 400);
      },
      { rootMargin: '0px 0px -70% 0px' },
    );
    root.querySelectorAll('[data-block]').forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [blocks, bookId, fractions, onVisiblePage]);

  return (
    <div ref={containerRef} lang={lang === 'en' ? 'en' : 'tr'} className="book-text mx-auto max-w-[38rem] px-5 pb-32 pt-6">
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} index={index} pdf={pdf} />
      ))}
    </div>
  );
}

function BlockView({ block, index, pdf }: { block: Block; index: number; pdf: PdfDocument | null }) {
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
        <aside data-block={index} className="my-3 border-l-2 border-line pl-3 text-sm text-muted">
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
          <PageImage pdf={pdf} pageIndex={block.srcPage} />
        </div>
      );
  }
}
