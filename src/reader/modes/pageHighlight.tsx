import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SentencePages, SentencePart } from '../../text/sentencePages';
import type { Sentence } from '../../text/sentences';
import { SentenceOverlay } from '../SentenceOverlay';

/**
 * Sayfa görünümünde cümlenin vurgu katmanları, PDF sayfasına göre (usePdfBook → overlays). Cümlenin yeri sayfa
 * metninden bulunur (eşzamansız, önbellekli); bulunana dek vurgu yoktur, önceki cümlenin vurgusu kalmaz.
 */
export function useSentenceOverlays(
  pages: SentencePages | null,
  sentence: Sentence | null,
): ReadonlyMap<number, ReactNode> | undefined {
  const [found, setFound] = useState<{ sentence: Sentence; parts: SentencePart[] } | null>(null);

  useEffect(() => {
    if (!pages || !sentence) return;
    let alive = true;
    pages.locate(sentence).then(
      (parts) => {
        if (alive) setFound({ sentence, parts });
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [pages, sentence]);

  const parts = found && found.sentence === sentence && pages ? found.parts : null;
  return useMemo(() => {
    if (!parts?.length) return undefined;
    return new Map(
      parts.map((p) => [
        p.page,
        <SentenceOverlay
          key="sentence"
          rects={p.rects}
          pageWidth={p.pageWidth}
          pageHeight={p.pageHeight}
        />,
      ]),
    );
  }, [parts]);
}
