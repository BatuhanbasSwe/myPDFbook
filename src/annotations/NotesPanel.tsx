import { Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NoteForm } from './NoteEditor';
import { HIGHLIGHT_COLORS, HIGHLIGHT_OPACITY, INK_COLORS } from './penPrefs';
import { useBookAnnotations, type SavedAnnotation } from './store';

/** Listedeki satır: tek işaret ya da sayfadaki ardışık kalem çizgileri (el yazısı yüzlerce çizgidir) */
interface Row {
  key: string;
  /** satırın işaretleri: eklenme sırasıyla; öbek değilse tek */
  marks: SavedAnnotation[];
}

/** Sayfaları ve satırları kurar: aynı sayfada art arda gelen kalem çizgileri tek satırda toplanır */
export function groupMarks(all: readonly SavedAnnotation[]) {
  const pages: { page: number; rows: Row[] }[] = [];
  for (const a of all) {
    let group = pages.at(-1);
    if (group?.page !== a.page) {
      group = { page: a.page, rows: [] };
      pages.push(group);
    }
    const last = group.rows.at(-1);
    if (a.kind === 'ink' && last?.marks[0].kind === 'ink') last.marks.push(a);
    else group.rows.push({ key: String(a.id), marks: [a] });
  }
  return pages;
}

/**
 * Notlar paneli: kitaptaki bütün notlar, boyamalar ve kalem çizgileri sayfa sırasıyla. İşarete dokununca o sayfa
 * açılır (metin görünümünden sayfa görünümüne geçilir); not metni burada da düzenlenir, işaret silinir. Sayfadaki
 * ardışık kalem çizgileri tek satırdır ("Kalem çizgileri · 5"): birlikte silinir, "Geri al" hepsini geri koyar.
 */
export function NotesPanel({
  bookId,
  textView,
  currentPages,
  onGo,
  onSaveNote,
  onDelete,
}: {
  bookId: string;
  /** metin görünümü açık: işarete dokununca sayfa görünümüne geçilir */
  textView: boolean;
  /** açık PDF sayfaları (0'dan) */
  currentPages: number[];
  onGo(page: number): void;
  onSaveNote(note: SavedAnnotation, text: string): void;
  /** satırın işaretlerini siler (öbekte hepsini) */
  onDelete(marks: SavedAnnotation[]): void;
}) {
  const all = useBookAnnotations(bookId);
  const [editing, setEditing] = useState<number | null>(null);
  const listRef = useRef<HTMLElement>(null);

  // Liste veritabanından gelince (panel açılışından sonra) odak açık sayfanın işaretine, yoksa ilk işarete geçer:
  // içindekilerdeki gibi
  const loaded = all !== undefined;
  useEffect(() => {
    const el = listRef.current;
    if (!loaded || !el) return;
    (
      el.querySelector<HTMLElement>('[aria-current="true"]') ??
      el.querySelector<HTMLElement>('button')
    )?.focus();
  }, [loaded]);

  // Düzenleyici kapanınca odak notun düzenle düğmesine döner (odak kaybolmasın)
  const closeEditor = (id: number) => {
    setEditing(null);
    requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLElement>(`[data-edit-id="${id}"]`)?.focus(),
    );
  };

  // Silinen satır odaklıysa odak komşu satıra geçer
  const remove = (marks: SavedAnnotation[]) => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-mark-id="${marks[0].id}"]`);
    if (row?.contains(document.activeElement)) {
      const items = [
        ...(listRef.current?.querySelectorAll<HTMLElement>('[data-testid="notes-item"]') ?? []),
      ];
      const i = items.indexOf(row);
      (items[i + 1] ?? items[i - 1])?.querySelector<HTMLElement>('button')?.focus();
    }
    setEditing(null);
    onDelete(marks);
  };

  if (!all) return <p className="p-4 text-sm text-secondary">Notlar okunuyor…</p>;
  if (all.length === 0)
    return (
      <div className="flex flex-col gap-1 p-4 text-sm" data-testid="notes-empty">
        <p>Henüz not yok.</p>
        <p className="text-xs text-secondary">
          Sayfa görünümünde üst çubuktaki kalem kipiyle sayfayı boyayabilir, not bırakabilirsin.
        </p>
      </div>
    );

  const pages = groupMarks(all);

  return (
    <nav ref={listRef} aria-label="Notlar" className="max-h-[70dvh] overflow-y-auto py-2">
      {textView && (
        <p className="px-4 pb-1 text-xs text-secondary">
          İşarete dokununca sayfa görünümünde o sayfa açılır.
        </p>
      )}
      <ol>
        {pages.map(({ page, rows }) => (
          <li key={page}>
            {/* Açık sayfanın başlığı vurgulanır (içindekilerdeki okunan bölüm gibi) */}
            <h3
              className={`px-4 pt-3 pb-1 text-[13px] font-medium ${currentPages.includes(page) ? 'text-accent' : 'text-secondary'}`}
            >
              Sayfa {page + 1}
            </h3>
            <ul>
              {rows.map(({ key, marks }) => {
                const a = marks[0];
                const count = marks.length;
                return (
                  <li
                    key={key}
                    data-testid="notes-item"
                    data-kind={a.kind}
                    data-page={a.page + 1}
                    data-mark-id={a.id}
                    data-count={count > 1 ? count : undefined}
                  >
                    <div className="flex items-center px-1.5">
                      <button
                        type="button"
                        data-testid="notes-go"
                        aria-current={currentPages.includes(a.page) ? 'true' : undefined}
                        onClick={() => onGo(a.page)}
                        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-inner px-3 py-2 text-left text-[15px] hover:bg-fill"
                      >
                        <MarkChip mark={a} />
                        <span
                          className={`line-clamp-2 min-w-0 flex-1 ${a.kind === 'note' ? 'font-book' : 'text-secondary'}`}
                        >
                          {count > 1 ? `Kalem çizgileri · ${count}` : describe(a)}
                        </span>
                      </button>
                      {a.kind === 'note' && (
                        <button
                          type="button"
                          aria-label="Notu düzenle"
                          aria-expanded={editing === a.id}
                          data-testid="notes-edit"
                          data-edit-id={a.id}
                          onClick={() => setEditing(editing === a.id ? null : a.id)}
                          className="grid size-11 shrink-0 place-items-center rounded-full text-secondary hover:bg-fill hover:text-ink"
                        >
                          <Pencil className="size-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={
                          a.kind === 'note'
                            ? 'Notu sil'
                            : count > 1
                              ? 'Çizgileri sil'
                              : 'İşareti sil'
                        }
                        data-testid="notes-delete"
                        onClick={() => remove(marks)}
                        className="grid size-11 shrink-0 place-items-center rounded-full text-secondary hover:bg-fill hover:text-danger"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                    {editing === a.id && (
                      <div className="px-4 pb-3">
                        <NoteForm
                          title={`Not · Sayfa ${a.page + 1}`}
                          initial={a.text ?? ''}
                          onSave={(text) => {
                            onSaveNote(a, text);
                            closeEditor(a.id);
                          }}
                          onDelete={() => remove(marks)}
                          onCancel={() => closeEditor(a.id)}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Listedeki satırın metni: notun kendisi ya da işaretin türü ve rengi */
function describe(a: SavedAnnotation): string {
  if (a.kind === 'note') return a.text?.trim() || 'Boş not';
  const list = a.kind === 'highlight' ? HIGHLIGHT_COLORS : INK_COLORS;
  const color = list.find((c) => c.value === a.color)?.label;
  const kind = a.kind === 'highlight' ? 'Fosforlu kalem' : 'Kalem çizgisi';
  return color ? `${kind} · ${color.toLocaleLowerCase('tr')}` : kind;
}

/** İşaretin küçük örneği: beyaz sayfa parçasının üstünde (PDF sayfası her temada beyaz) */
function MarkChip({ mark }: { mark: SavedAnnotation }) {
  return (
    <span
      aria-hidden="true"
      className="grid h-6 w-8 shrink-0 place-items-center rounded-[4px] bg-white shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.18)]"
    >
      {mark.kind === 'note' ? (
        <span className="note-pin size-3" style={{ background: mark.color }} />
      ) : (
        <span
          className={`w-5 rounded-full ${mark.kind === 'highlight' ? 'h-2' : 'h-0.5'}`}
          style={{
            background: mark.color,
            opacity: mark.kind === 'highlight' ? Math.min(1, HIGHLIGHT_OPACITY + 0.2) : 1,
          }}
        />
      )}
    </span>
  );
}
