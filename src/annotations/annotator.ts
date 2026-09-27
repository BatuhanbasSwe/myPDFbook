import { createContext, useCallback, useMemo, useState } from 'react';
import { db } from '../db/db';
import { roundPoints, type Point } from './geometry';
import { NOTE_COLOR, usePenPrefs, type PenTool } from './penPrefs';
import {
  addAnnotation,
  deleteAnnotation,
  restoreAnnotation,
  updateAnnotation,
  type SavedAnnotation,
} from './store';

/** Açılacak not: yeni iğnenin yeri ya da var olan not */
export interface NoteTarget {
  page: number;
  /** iğnenin ucu (sayfaya göre 0–1) */
  point: Point;
  /** var olan not; yoksa kaydedilince eklenir */
  record?: SavedAnnotation;
  /** düzenleyicinin yanında açılacağı ekran noktası (clientX/Y) */
  anchor: Point;
}

/** Geri alınabilen değişiklik */
export type UndoEntry =
  | { type: 'add'; record: SavedAnnotation }
  | { type: 'erase'; records: SavedAnnotation[] }
  | { type: 'edit'; before: SavedAnnotation };

/** Sayfa katmanlarının (AnnotationLayer) okuyucudan aldığı: kitap, kip, araç ve geri bildirimler */
export interface Annotator {
  bookId: string;
  /** kalem kipi: dokunma ve sürükleme çizer, sayfa çevrilmez */
  penMode: boolean;
  tool: PenTool;
  highlightColor: string;
  inkColor: string;
  /** kip kapalıyken de kalem (pointerType 'pen') çizer */
  penAlways: boolean;
  /** yapılan değişiklik geri alınabilsin */
  record(entry: UndoEntry): void;
  openNote(target: NoteTarget): void;
}

export const AnnotatorContext = createContext<Annotator | null>(null);

/** Geri alma geçmişinde en çok bu kadar adım tutulur */
const UNDO_LIMIT = 50;

/**
 * Okuyucunun işaret durumu: kalem kipi, açık not, geri alma geçmişi. `active` değilse (metin görünümü) katmanlara
 * bağlam verilmez ve kip kapalı sayılır.
 */
export function useAnnotator(bookId: string, active: boolean) {
  const prefs = usePenPrefs();
  const [penMode, setPenMode] = useState(false);
  const [note, setNote] = useState<NoteTarget | null>(null);
  const [history, setHistory] = useState<UndoEntry[]>([]);

  const record = useCallback(
    (entry: UndoEntry) => setHistory((h) => [...h.slice(1 - UNDO_LIMIT), entry]),
    [],
  );

  const undo = useCallback(() => {
    const last = history.at(-1);
    if (!last) return;
    setHistory(history.slice(0, -1));
    const done =
      last.type === 'add'
        ? deleteAnnotation(db, last.record.id)
        : last.type === 'erase'
          ? Promise.all(last.records.map((r) => restoreAnnotation(db, r)))
          : restoreAnnotation(db, last.before);
    done.catch(() => undefined);
  }, [history]);

  /** Notu kaydeder: yeniyse ekler, varsa metnini değiştirir */
  const saveNote = useCallback(
    async (target: NoteTarget, text: string) => {
      if (target.record) {
        await updateAnnotation(db, target.record.id, { text });
        record({ type: 'edit', before: target.record });
      } else {
        const saved = await addAnnotation(db, {
          bookId,
          page: target.page,
          kind: 'note',
          color: NOTE_COLOR,
          width: 0,
          points: roundPoints([target.point.x, target.point.y]),
          text,
        });
        record({ type: 'add', record: saved });
      }
    },
    [bookId, record],
  );

  /** İşareti (not, boyama, çizgi) siler; geri alınabilir */
  const remove = useCallback(
    async (target: SavedAnnotation) => {
      await deleteAnnotation(db, target.id);
      record({ type: 'erase', records: [target] });
    },
    [record],
  );

  const penOn = penMode && active;
  const value = useMemo<Annotator | null>(
    () =>
      active
        ? {
            bookId,
            penMode: penOn,
            tool: prefs.tool,
            highlightColor: prefs.highlightColor,
            inkColor: prefs.inkColor,
            penAlways: prefs.penAlways,
            record,
            openNote: setNote,
          }
        : null,
    [active, bookId, penOn, prefs, record],
  );

  return {
    value,
    penOn,
    setPenMode,
    note,
    setNote,
    canUndo: history.length > 0,
    undo,
    saveNote,
    remove,
  };
}
