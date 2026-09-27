import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SentencePages, SentencePart } from '../../text/sentencePages';
import type { Sentence } from '../../text/sentences';
import { DIMMED_PAGE, SentenceOverlay } from '../SentenceOverlay';

/** Sayfanın üstüne çizilen katman, PDF sayfasına göre (usePdfBook → overlays) */
export interface PageOverlays {
  get(page: number): ReactNode;
}

/**
 * Sayfa görünümünde cümlenin vurgu katmanları, PDF sayfasına göre (usePdfBook → overlays). Cümlenin yeri sayfa
 * metninden bulunur (eşzamansız, önbellekli; önceden bulunduysa hemen); bulunana dek vurgu yoktur, önceki cümlenin
 * vurgusu kalmaz. Odakta cümlenin olduğu sayfada cümle dışı, öteki sayfaların tamamı karartılır.
 */
export function useSentenceOverlays(
  pages: SentencePages | null,
  sentence: Sentence | null,
  focus = false,
): PageOverlays | undefined {
  const [found, setFound] = useState<{ sentence: Sentence; parts: SentencePart[] } | null>(null);

  useEffect(() => {
    if (!pages || !sentence || pages.known(sentence)) return;
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

  const parts =
    pages && sentence
      ? (pages.known(sentence) ?? (found?.sentence === sentence ? found.parts : null))
      : null;
  return useMemo(() => {
    if (!parts?.length) return undefined;
    const byPage = new Map<number, ReactNode>(
      parts.map((p) => [
        p.page,
        <SentenceOverlay
          key="sentence"
          rects={p.rects}
          pageWidth={p.pageWidth}
          pageHeight={p.pageHeight}
          focus={focus}
        />,
      ]),
    );
    return { get: (page) => byPage.get(page) ?? (focus ? DIMMED_PAGE : undefined) };
  }, [parts, focus]);
}
