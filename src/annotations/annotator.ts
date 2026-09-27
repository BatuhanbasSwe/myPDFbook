import { createContext, useCallback, useMemo, useRef, useState } from 'react';
import { db } from '../db/db';
import { roundPoints, type Point } from './geometry';
import { NOTE_COLOR, usePenPrefs, type DrawTool, type PenTool } from './penPrefs';
import {
  addAnnotation,
  deleteAnnotation,
  deleteAnnotations,
  restoreAnnotation,
  restoreAnnotations,
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
  /** eklenen işaret: kaydı bitmeden de geri alınabilir (kayıt bitince silinir) */
  | { type: 'add'; saved: Promise<SavedAnnotation> }
  | { type: 'erase'; records: SavedAnnotation[] }
  | { type: 'edit'; before: SavedAnnotation };

/** Sayfa katmanlarının (AnnotationLayer) okuyucudan aldığı: kitap, kip, araç ve geri bildirimler */
export interface Annotator {
  bookId: string;
  /** kalem kipi: dokunma ve sürükleme çizer, sayfa çevrilmez */
  penMode: boolean;
  tool: PenTool;
  /** kip kapalıyken kalemin çizdiği araç (son seçilen çizen araç) */
  drawTool: DrawTool;
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
  // Geçmiş ref'te: art arda hızlı basılan "Geri al" her seferinde bir sonraki adımı alır (eski kapanış aynı adımı
  // iki kez almaz). Düğme için yalnızca uzunluğu çizilir
  const history = useRef<UndoEntry[]>([]);
  const [historySize, setHistorySize] = useState(0);

  const record = useCallback((entry: UndoEntry) => {
    history.current = [...history.current.slice(1 - UNDO_LIMIT), entry];
    setHistorySize(history.current.length);
    // Kaydedilemeyen ekleme geri alınacak bir şey bırakmaz
    if (entry.type === 'add')
      entry.saved.catch(() => {
        history.current = history.current.filter((e) => e !== entry);
        setHistorySize(history.current.length);
      });
  }, []);

  const undo = useCallback(() => {
    const last = history.current.pop();
    setHistorySize(history.current.length);
    if (!last) return;
    const done =
      last.type === 'add'
        ? last.saved.then((r) => deleteAnnotation(db, r.id))
        : last.type === 'erase'
          ? restoreAnnotations(db, last.records)
          : restoreAnnotation(db, last.before);
    done.catch(() => undefined);
  }, []);

  /** Var olan notun metnini değiştirir; geri alınabilir. Metin aynıysa ya da not silinmişse bir şey olmaz */
  const editNote = useCallback(
    async (note: SavedAnnotation, text: string) => {
      if ((note.text ?? '') === text) return;
      const changed = await updateAnnotation(db, note.id, { text });
      // Silinmiş not değişmez: geri alma onu yeniden koymasın
      if (changed) record({ type: 'edit', before: note });
    },
    [record],
  );

  /** Notu kaydeder: yeniyse ekler, varsa metnini değiştirir */
  const saveNote = useCallback(
    async (target: NoteTarget, text: string) => {
      if (target.record) return editNote(target.record, text);
      const saved = addAnnotation(db, {
        bookId,
        page: target.page,
        kind: 'note',
        color: NOTE_COLOR,
        width: 0,
        points: roundPoints([target.point.x, target.point.y]),
        text,
      });
      record({ type: 'add', saved });
      await saved;
    },
    [bookId, record, editNote],
  );

  /** İşaretleri (not, boyama, çizgi; paneldeki çizgi öbeği) siler; birlikte geri alınır */
  const remove = useCallback(
    async (targets: SavedAnnotation | readonly SavedAnnotation[]) => {
      const records = Array.isArray(targets) ? [...targets] : [targets as SavedAnnotation];
      if (!records.length) return;
      await deleteAnnotations(
        db,
        records.map((r) => r.id),
      );
      record({ type: 'erase', records });
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
            drawTool: prefs.drawTool,
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
    canUndo: historySize > 0,
    undo,
    saveNote,
    editNote,
    remove,
  };
}
