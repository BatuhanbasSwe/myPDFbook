import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { NoteTarget } from './annotator';

/** Kenarlardan bırakılan boşluk (px) */
const MARGIN = 12;
/** Düzenleyici iğnenin bu kadar altında (sığmazsa üstünde) açılır (px) */
const GAP = 14;

/**
 * Not düzenleyicisi: iğnenin yanında açılan küçük kart. Yeni not kaydedilince eklenir; "Sil" var olan notu siler,
 * yeni notta vazgeçer.
 */
export function NoteEditor({
  target,
  onSave,
  onDelete,
  onClose,
}: {
  target: NoteTarget;
  onSave(text: string): void;
  onDelete(): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // İğnenin altına (sığmazsa üstüne) yerleşir, ekranın dışına taşmaz. iPad'de klavye açılınca görünen alan küçülür:
  // kart klavyenin altında kalmasın diye yeniden yerleşir
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const { width, height } = el.getBoundingClientRect();
      const vv = window.visualViewport;
      const vw = vv?.width ?? window.innerWidth;
      const vh = vv?.height ?? window.innerHeight;
      // Görünen alan kaydırılmışsa (klavye açıkken iPad) sayfanın düzen alanına göre yeri
      const vTop = vv?.offsetTop ?? 0;
      const vLeft = vv?.offsetLeft ?? 0;
      const left = Math.min(
        Math.max(vLeft + MARGIN, target.anchor.x - width / 2),
        vLeft + vw - width - MARGIN,
      );
      const below = target.anchor.y + GAP;
      const wanted = below + height <= vTop + vh - MARGIN ? below : target.anchor.y - height - GAP;
      const top = Math.max(vTop + MARGIN, Math.min(wanted, vTop + vh - height - MARGIN));
      el.style.left = `${Math.max(vLeft + MARGIN, left)}px`;
      el.style.top = `${top}px`;
      el.style.visibility = 'visible';
    };
    place();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', place);
    vv?.addEventListener('scroll', place);
    return () => {
      vv?.removeEventListener('resize', place);
      vv?.removeEventListener('scroll', place);
    };
  }, [target]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={target.record ? 'Not' : 'Yeni not'}
      data-testid="note-editor"
      className="material ui-pop fixed z-(--ui-z-dialog) w-[min(20rem,calc(100vw-1.5rem))] rounded-panel p-3 text-ink"
      style={{ left: 0, top: 0, visibility: 'hidden' }}
    >
      <NoteForm
        key={target.record?.id ?? `${target.page}:${target.point.x}:${target.point.y}`}
        title={`${target.record ? 'Not' : 'Yeni not'} · Sayfa ${target.page + 1}`}
        initial={target.record?.text ?? ''}
        onSave={onSave}
        onDelete={onDelete}
        onCancel={onClose}
      />
    </div>
  );
}

/** Not metni, Kaydet ve Sil (Notlar panelinde de kullanılır) */
export function NoteForm({
  title,
  initial,
  onSave,
  onDelete,
  onCancel,
}: {
  title: string;
  initial: string;
  onSave(text: string): void;
  onDelete(): void;
  onCancel(): void;
}) {
  const [text, setText] = useState(initial);
  const id = useId();
  const empty = text.trim() === '';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!empty) onSave(text.trim());
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[13px] font-medium text-secondary">
        {title}
      </label>
      <textarea
        id={id}
        autoFocus // açılınca yazmaya başlanır
        data-testid="note-text"
        rows={4}
        value={text}
        placeholder="Notunu yaz…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault(); // okuyucunun menüsü açılıp kapanmasın
            onCancel();
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
        }}
        className="ui-focus w-full resize-none rounded-control bg-fill p-2.5 text-[15px] leading-relaxed text-ink placeholder:text-secondary"
      />
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-testid="note-delete"
          onClick={onDelete}
          className="ui-press min-h-11 rounded-full px-3 text-[15px] text-danger hover:bg-fill"
        >
          Sil
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="ui-press min-h-11 rounded-full px-3 text-[15px] text-secondary hover:bg-fill"
        >
          Vazgeç
        </button>
        <button
          type="submit"
          data-testid="note-save"
          disabled={empty}
          className="ui-press min-h-11 rounded-full bg-accent px-4 text-[15px] font-semibold text-paper disabled:opacity-40"
        >
          Kaydet
        </button>
      </div>
    </form>
  );
}
