import { AlignLeft } from 'lucide-react';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { db } from '../db/db';
import { AnnotatorContext, type Annotator } from './annotator';
import {
  hitTestSegment,
  roundPoints,
  simplify,
  smoothPath,
  toRelative,
  type Point,
  type Rect,
} from './geometry';
import { HIGHLIGHT_OPACITY, STROKE_WIDTH, type DrawTool, type PenTool } from './penPrefs';
import { addAnnotation, deleteAnnotation, usePageAnnotations, type SavedAnnotation } from './store';

/** Bundan az hareket dokunmadır (px): not aracında iğne yalnızca dokununca konur */
const TAP_MAX = 8;
/** Silginin yarıçapı (px) */
const ERASER_RADIUS = 10;
/** Silginin not iğnesine değme yarıçapı (px; iğnenin gövdesinin ortasından) */
const PIN_REACH = 16;
/** Bundan yakın ardışık noktalar atılır (px) */
const MIN_STEP = 0.75;
/**
 * Kaydedilirken çizgi bu kadar sapmayla sadeleşir (px; RDP): kayıt küçülür, tam piksele yuvarlanmış girdinin
 * merdiven basamakları da düzleşir
 */
const SIMPLIFY_PX = 0.6;
/** İğnenin gövdesi: ucu sol altta, işaretlenen noktada (px) */
const PIN_SIZE = 26;

/**
 * Sayfanın işaret katmanı: PDF sayfasının üstünde, o sayfanın boyamalarını, kalem çizgilerini ve not iğnelerini
 * çizer; kalem kipinde (ya da Apple Pencil ile) çizimi alır. Okuyucu bağlam vermezse (metin görünümü) boştur.
 */
export function AnnotationLayer(props: { page: number; width: number; height: number }) {
  const annotator = useContext(AnnotatorContext);
  if (!annotator) return null;
  return <Layer annotator={annotator} {...props} />;
}

/** Kaydedilen ama veritabanından henüz okunmamış çizgi: bırakınca çizgi bir kare bile kaybolmasın */
interface Pending {
  key: number;
  id?: number;
  kind: DrawTool;
  color: string;
  width: number;
  d: string;
}

/** Süren çizim ya da silme */
interface Session {
  pointerId: number;
  tool: PenTool;
  color: string;
  rect: Rect;
  yScale: number;
  /** x, y çiftleri (0–1) */
  points: number[];
  last: Point;
  start: { x: number; y: number };
  moved: boolean;
  erased: SavedAnnotation[];
}

let pendingKey = 0;

function Layer({
  annotator,
  page,
  width,
  height,
}: {
  annotator: Annotator;
  page: number;
  width: number;
  height: number;
}) {
  const annotations = usePageAnnotations(annotator.bookId, page);
  const layerRef = useRef<HTMLDivElement>(null);
  const liveRefs = useRef<Record<DrawTool, SVGPathElement | null>>({
    highlight: null,
    ink: null,
  });
  const [pending, setPending] = useState<Pending[]>([]);
  const yScale = height / width;
  // Olay dinleyicileri bir kez kurulur; en güncel değerleri buradan okur
  const latest = useRef({ annotator, annotations, page });
  useLayoutEffect(() => {
    latest.current = { annotator, annotations, page };
  });

  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    let session: Session | null = null;
    let frame = 0;

    const pinOf = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>('[data-note-pin]') : null;

    /** Bu dokunuşla hangi araç çalışır; null: çizim değil (sayfa çevirme, menü) */
    const toolFor = (e: PointerEvent): PenTool | null => {
      const { annotator: a } = latest.current;
      if (a.penMode) return e.pointerType === 'mouse' && e.button !== 0 ? null : a.tool;
      // Kip kapalıyken kalem son çizen araçla çizer; parmak ve fare sayfa çevirir
      if (a.penAlways && e.pointerType === 'pen') return a.tool === 'ink' ? 'ink' : 'highlight';
      return null;
    };

    const live = (s: Session) =>
      s.tool === 'highlight' || s.tool === 'ink' ? liveRefs.current[s.tool] : null;

    const draw = () => {
      frame = 0;
      if (session) live(session)?.setAttribute('d', smoothPath(session.points, session.yScale));
    };
    const clearLive = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      liveRefs.current.highlight?.setAttribute('d', '');
      liveRefs.current.ink?.setAttribute('d', '');
    };

    /** Silgi [from, to] yolunda değdiği işaretleri bütün olarak siler */
    const erase = (s: Session, from: Point, to: Point) => {
      const { rect, yScale: ys } = s;
      for (const a of latest.current.annotations ?? []) {
        if (s.erased.some((r) => r.id === a.id)) continue;
        // İğnenin gövdesi ucunun sağ üstünde durur: silgi gövdeye değince siler
        const shape =
          a.kind === 'note'
            ? {
                ...a,
                points: [
                  a.points[0] + PIN_SIZE / 2 / rect.width,
                  a.points[1] - PIN_SIZE / 2 / rect.height,
                ],
              }
            : a;
        const reach = (a.kind === 'note' ? PIN_REACH : ERASER_RADIUS) / rect.width;
        if (hitTestSegment(shape, from, to, reach, ys)) {
          s.erased.push(a);
          deleteAnnotation(db, a.id).catch(() => undefined);
        }
      }
    };

    const commit = (s: Session) => {
      const tool = s.tool as DrawTool;
      const { annotator: a, annotations: known, page: p } = latest.current;
      const lineWidth = STROKE_WIDTH[tool];
      const points = roundPoints(simplify(s.points, SIMPLIFY_PX / s.rect.width, s.yScale));
      const key = ++pendingKey;
      const saved = new Set((known ?? []).map((k) => k.id));
      // Çizgi, kaydı okunana dek "bekleyen" olarak çizilir (canlı çizgi silinince boşluk olmasın)
      flushSync(() =>
        setPending((list) => [
          ...list.filter((x) => x.id === undefined || !saved.has(x.id)),
          {
            key,
            kind: tool,
            color: s.color,
            width: lineWidth,
            d: smoothPath(points, s.yScale),
          },
        ]),
      );
      clearLive();
      addAnnotation(db, {
        bookId: a.bookId,
        page: p,
        kind: tool,
        color: s.color,
        width: lineWidth,
        points,
      }).then(
        (record) => {
          setPending((list) => list.map((x) => (x.key === key ? { ...x, id: record.id } : x)));
          a.record({ type: 'add', record });
        },
        () => setPending((list) => list.filter((x) => x.key !== key)),
      );
    };

    const onDown = (e: PointerEvent) => {
      const pin = pinOf(e.target);
      // Çizim sürerken başka parmak (avuç) yok sayılır
      if (session) return e.stopPropagation();
      const tool = toolFor(e);
      if (!tool || (pin && tool !== 'eraser')) {
        // İğneye dokunma sayfa çevirmesin, menüyü açmasın: iğne kendi tıklamasıyla notu açar
        if (pin) e.stopPropagation();
        return;
      }
      // Çizim sayfa çevirmez: kitap olayı görmez; uyumluluk fare olayları ve metin seçimi de olmaz
      e.stopPropagation();
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // yapay olay (sınama) ya da bırakılmış işaretçi
      }
      const r = el.getBoundingClientRect();
      const rect = { left: r.left, top: r.top, width: r.width, height: r.height };
      const p = toRelative({ x: e.clientX, y: e.clientY }, rect);
      const { annotator: a } = latest.current;
      const s: Session = {
        pointerId: e.pointerId,
        tool,
        color: tool === 'ink' ? a.inkColor : a.highlightColor,
        rect,
        yScale: rect.height / Math.max(1, rect.width),
        points: [p.x, p.y],
        last: p,
        start: { x: e.clientX, y: e.clientY },
        moved: false,
        erased: [],
      };
      session = s;
      if (tool === 'eraser') {
        const id = Number(pin?.dataset.noteId);
        const hit = pin && latest.current.annotations?.find((x) => x.id === id);
        if (hit) {
          s.erased.push(hit);
          deleteAnnotation(db, hit.id).catch(() => undefined);
        }
        erase(s, p, p);
      } else if (tool !== 'note') {
        const path = live(s);
        path?.setAttribute('stroke', s.color);
        path?.setAttribute('stroke-width', String(STROKE_WIDTH[tool]));
        draw();
      }
    };

    const onMove = (e: PointerEvent) => {
      const s = session;
      if (!s || e.pointerId !== s.pointerId) return;
      e.stopPropagation();
      if (Math.hypot(e.clientX - s.start.x, e.clientY - s.start.y) > TAP_MAX) s.moved = true;
      if (s.tool === 'note') return;
      // Hızlı harekette tarayıcının birleştirdiği ara noktalar da alınır: çizgi köşeli olmaz
      const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      for (const ev of coalesced.length ? coalesced : [e]) {
        const p = toRelative({ x: ev.clientX, y: ev.clientY }, s.rect);
        const step = Math.hypot((p.x - s.last.x) * s.rect.width, (p.y - s.last.y) * s.rect.height);
        if (step < MIN_STEP) continue;
        if (s.tool === 'eraser') erase(s, s.last, p);
        else s.points.push(p.x, p.y);
        s.last = p;
      }
      if (s.tool !== 'eraser' && !frame) frame = requestAnimationFrame(draw);
    };

    const onUp = (e: PointerEvent) => {
      const s = session;
      if (!s || e.pointerId !== s.pointerId) return;
      e.stopPropagation();
      session = null;
      const { annotator: a, page: p } = latest.current;
      if (s.tool === 'eraser') {
        if (s.erased.length) a.record({ type: 'erase', records: s.erased });
      } else if (s.tool === 'note') {
        if (!s.moved)
          a.openNote({
            page: p,
            point: { x: s.points[0], y: s.points[1] },
            anchor: { x: s.start.x, y: s.start.y },
          });
      } else commit(s);
    };

    const onCancel = (e: PointerEvent) => {
      const s = session;
      if (!s || e.pointerId !== s.pointerId) return;
      session = null;
      clearLive();
      if (s.erased.length) latest.current.annotator.record({ type: 'erase', records: s.erased });
    };

    // Kıvrılan sayfa kütüphanesi fare ve dokunma olaylarını dinler: çizim ve iğne onlara gitmez
    const onTouchStart = (e: TouchEvent) => {
      const pin = pinOf(e.target);
      const { annotator: a } = latest.current;
      const stylus = Array.from(e.changedTouches).some(
        (t) => (t as Touch & { touchType?: string }).touchType === 'stylus',
      );
      if (session || (stylus && (a.penAlways || a.penMode))) {
        e.stopPropagation();
        // Safari'de kalem sayfayı kaydırmasın, yakınlaştırmasın (iğnenin tıklaması ise kalsın)
        if (e.cancelable && !pin) e.preventDefault();
      } else if (pin) e.stopPropagation();
    };
    const onTouchMove = (e: TouchEvent) => {
      if (session && e.cancelable) e.preventDefault();
    };
    const onMouseDown = (e: MouseEvent) => {
      if (session || pinOf(e.target)) e.stopPropagation();
    };
    const onContextMenu = (e: Event) => {
      if (latest.current.annotator.penMode) e.preventDefault();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('contextmenu', onContextMenu);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

  const paths = useMemo(
    () =>
      (annotations ?? [])
        .filter((a) => a.kind !== 'note')
        .map((a) => ({ a, d: smoothPath(a.points, yScale) })),
    [annotations, yScale],
  );
  const notes = (annotations ?? []).filter((a) => a.kind === 'note');
  const savedIds = new Set((annotations ?? []).map((a) => a.id));
  const waiting = pending.filter((x) => x.id === undefined || !savedIds.has(x.id));

  const strokes = (kind: DrawTool) => (
    <svg
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
      viewBox={`0 0 1 ${yScale}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      // Fosforlu kalem çarpma karışımıyla boyar: altındaki yazı koyu kalır
      style={kind === 'highlight' ? { mixBlendMode: 'multiply' } : undefined}
    >
      <g
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity={kind === 'highlight' ? HIGHLIGHT_OPACITY : 1}
      >
        {paths
          .filter(({ a }) => a.kind === kind)
          .map(({ a, d }) => (
            <path
              key={a.id}
              data-annotation-id={a.id}
              data-kind={kind}
              d={d}
              stroke={a.color}
              strokeWidth={a.width}
            />
          ))}
        {waiting
          .filter((x) => x.kind === kind)
          .map((x) => (
            <path key={`p${x.key}`} d={x.d} stroke={x.color} strokeWidth={x.width} />
          ))}
        <path
          ref={(node) => {
            liveRefs.current[kind] = node;
          }}
          d=""
        />
      </g>
    </svg>
  );

  return (
    <div
      ref={layerRef}
      data-testid="annotation-layer"
      data-pen={annotator.penMode || undefined}
      className={`annotation-layer absolute inset-0 ${annotator.penMode ? 'touch-none cursor-crosshair' : ''}`}
    >
      {strokes('highlight')}
      {strokes('ink')}
      {notes.map((n) => (
        <NotePin key={n.id} note={n} annotator={annotator} page={page} />
      ))}
    </div>
  );
}

/** Not iğnesi: ucu notun konduğu noktada; dokununca not açılır */
function NotePin({
  note,
  annotator,
  page,
}: {
  note: SavedAnnotation;
  annotator: Annotator;
  page: number;
}) {
  const [x, y] = note.points;
  const excerpt = (note.text ?? '').trim().slice(0, 60);
  // Dokunma alanı 44 px; gövde (26 px) alanın sol altında, sivri köşesi notun noktasında
  const inset = (44 - PIN_SIZE) / 2;
  return (
    <button
      type="button"
      data-note-pin
      data-note-id={note.id}
      data-testid="note-pin"
      aria-label={excerpt ? `Not: ${excerpt}` : 'Not'}
      className="absolute size-11"
      style={{
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        transform: `translate(${-inset}px, ${-(44 - inset)}px)`,
      }}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        annotator.openNote({
          page,
          point: { x, y },
          record: note,
          anchor: { x: r.left + inset, y: r.bottom - inset },
        });
      }}
    >
      <span
        className="note-pin absolute grid place-items-center"
        style={{
          left: inset,
          top: inset,
          width: PIN_SIZE,
          height: PIN_SIZE,
          background: note.color,
        }}
      >
        <AlignLeft className="size-3.5" strokeWidth={2.5} />
      </span>
    </button>
  );
}
