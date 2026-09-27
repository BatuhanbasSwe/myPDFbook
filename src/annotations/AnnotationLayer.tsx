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
import { acceptPointer } from './pointerGate';
import {
  addAnnotation,
  deleteAnnotation,
  onAnnotationsDeleted,
  usePageAnnotations,
  type SavedAnnotation,
} from './store';

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
/** İğnenin dokunma alanı (px) */
const PIN_TOUCH = 44;

/**
 * İğnenin gövdesinin uca göre yeri (px): gövde ucun sağ üstündedir; sayfanın sağ ya da üst kenarına sığmazsa
 * (sayfa taşanı keser) sola ya da aşağı döner. `width`, `height`: sayfanın boyutu.
 */
function pinBody(point: Point, width: number, height: number) {
  const flipX = point.x * width > width - PIN_SIZE;
  const flipY = point.y * height < PIN_SIZE;
  return { flipX, flipY, dx: flipX ? -PIN_SIZE : 0, dy: flipY ? 0 : -PIN_SIZE };
}

/**
 * Bu oturumda Apple Pencil (pointerType 'pen') görüldü: kalem kipinde parmak artık çizmez (avuç reddi, bkz.
 * pointerGate.ts). Sayfalar çevrildikçe katmanlar yeniden kurulur: bilgi modülde tutulur.
 */
let penSeen = false;

export function AnnotationLayer(props: { page: number; width: number; height: number }) {
  const annotator = useContext(AnnotatorContext);
  if (!annotator) return null;
  return <Layer annotator={annotator} {...props} />;
}

/** Kaydedilen ama veritabanından henüz okunmamış çizgi: bırakınca çizgi bir kare bile kaybolmasın */
interface Pending {
  key: number;
  /** kaydın anahtarı (kayıt bitince) */
  id?: number;
  kind: DrawTool;
  color: string;
  width: number;
  d: string;
}

/** Süren çizim ya da silme */
interface Session {
  pointerId: number;
  pointerType: string;
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
  // Fosforlu kalemle çizim sürüyor (çarpma karışımı gerekir)
  const [liveHighlight, setLiveHighlight] = useState(false);
  const yScale = height / width;
  // Olay dinleyicileri bir kez kurulur; en güncel değerleri buradan okur
  const latest = useRef({ annotator, annotations, page, width, height });
  useLayoutEffect(() => {
    latest.current = { annotator, annotations, page, width, height };
  });

  // Kaydı okunan çizginin bekleyen kopyası bırakılır: kayıt sonra silinirse (geri al, silgi, panel) kopya yeniden
  // görünüp hayalet olarak kalmasın
  const [seen, setSeen] = useState(annotations);
  if (seen !== annotations) {
    setSeen(annotations);
    const ids = new Set((annotations ?? []).map((a) => a.id));
    if (pending.some((x) => x.id !== undefined && ids.has(x.id)))
      setPending(pending.filter((x) => x.id === undefined || !ids.has(x.id)));
  }

  // Kaydı daha okunmadan silinen çizginin (hemen geri alınan) bekleyen kopyası da bırakılır
  useEffect(
    () =>
      onAnnotationsDeleted((ids) =>
        setPending((list) =>
          list.some((x) => x.id !== undefined && ids.includes(x.id))
            ? list.filter((x) => x.id === undefined || !ids.includes(x.id))
            : list,
        ),
      ),
    [],
  );

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
      // Kip kapalıyken kalem son seçilen çizen araçla çizer; parmak ve fare sayfa çevirir
      if (a.penAlways && e.pointerType === 'pen') return a.drawTool;
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
      setLiveHighlight(false);
    };

    /** Süren çizimi bırakır (kaydetmez); silgi o ana dek sildiklerini geri alınabilir bırakır */
    const cancel = () => {
      const s = session;
      if (!s) return;
      session = null;
      clearLive();
      try {
        if (el.hasPointerCapture(s.pointerId)) el.releasePointerCapture(s.pointerId);
      } catch {
        // bırakılmış işaretçi
      }
      if (s.erased.length) latest.current.annotator.record({ type: 'erase', records: s.erased });
    };

    /** Silgi [from, to] yolunda değdiği işaretleri bütün olarak siler */
    const erase = (s: Session, from: Point, to: Point) => {
      const { rect, yScale: ys } = s;
      const { annotations: known, width: w, height: h } = latest.current;
      for (const a of known ?? []) {
        if (s.erased.some((r) => r.id === a.id)) continue;
        let shape = a;
        if (a.kind === 'note') {
          // Silgi iğnenin gövdesine değince siler (gövde ucun yanında durur)
          const { dx, dy } = pinBody({ x: a.points[0], y: a.points[1] }, w, h);
          shape = {
            ...a,
            points: [
              a.points[0] + (dx + PIN_SIZE / 2) / rect.width,
              a.points[1] + (dy + PIN_SIZE / 2) / rect.height,
            ],
          };
        }
        const reach = (a.kind === 'note' ? PIN_REACH : ERASER_RADIUS) / rect.width;
        if (hitTestSegment(shape, from, to, reach, ys)) {
          s.erased.push(a);
          deleteAnnotation(db, a.id).catch(() => undefined);
        }
      }
    };

    const commit = (s: Session) => {
      const tool = s.tool as DrawTool;
      const { annotator: a, page: p } = latest.current;
      const lineWidth = STROKE_WIDTH[tool];
      const points = roundPoints(simplify(s.points, SIMPLIFY_PX / s.rect.width, s.yScale));
      const key = ++pendingKey;
      // Çizgi, kaydı okunana dek "bekleyen" olarak çizilir (canlı çizgi silinince boşluk olmasın)
      flushSync(() =>
        setPending((list) => [
          ...list,
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
      const saved = addAnnotation(db, {
        bookId: a.bookId,
        page: p,
        kind: tool,
        color: s.color,
        width: lineWidth,
        points,
      });
      // Geçmişe hemen girer: kayıt bitmeden basılan "Geri al" bu çizgiyi alır
      a.record({ type: 'add', saved });
      saved.then(
        (record) => {
          // Kayıt okunmuşsa kopya hemen bırakılır; yoksa okununca (bkz. yukarıda)
          const known = latest.current.annotations?.some((k) => k.id === record.id);
          setPending((list) =>
            known
              ? list.filter((x) => x.key !== key)
              : list.map((x) => (x.key === key ? { ...x, id: record.id } : x)),
          );
        },
        () => setPending((list) => list.filter((x) => x.key !== key)),
      );
    };

    const start = (e: PointerEvent, tool: PenTool, pin: HTMLElement | null) => {
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
        pointerType: e.pointerType,
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
        // Fosforlu kalem çarpma karışımıyla çizilir: karışım yalnızca boyama varken açıktır (bkz. strokes)
        if (tool === 'highlight') flushSync(() => setLiveHighlight(true));
        const path = live(s);
        path?.setAttribute('stroke', s.color);
        path?.setAttribute('stroke-width', String(STROKE_WIDTH[tool]));
        draw();
      }
    };

    const onDown = (e: PointerEvent) => {
      const pin = pinOf(e.target);
      if (e.pointerType === 'pen') penSeen = true;
      // Aynı işaretçi yeniden bastı: önceki çizimin bırakılışı kaçmış (sayfa çevrilirken vb.)
      if (session?.pointerId === e.pointerId) cancel();
      const tool = toolFor(e);
      const draws = tool !== null && !(pin && tool !== 'eraser');
      const decision = acceptPointer(
        { penSeen, active: session?.pointerType ?? null },
        { pointerType: e.pointerType, draws },
      );
      if (decision === 'pass') {
        // İğneye dokunma sayfa çevirmesin, menüyü açmasın: iğne kendi tıklamasıyla notu açar
        if (pin) e.stopPropagation();
        return;
      }
      // Çizim (ve çizim sürerken ya da kalemden sonra gelen avuç) sayfa çevirmez: kitap olayı görmez; uyumluluk
      // fare olayları ve metin seçimi de olmaz
      e.stopPropagation();
      e.preventDefault();
      if (decision === 'ignore' || !tool) return;
      // Parmakla süren çizime kalem geldi: parmağın çizgisi bırakılır
      if (decision === 'preempt') cancel();
      start(e, tool, pin);
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

    // İptal ve kaybolan yakalama (sayfa çizim sürerken çevrildi, katman gizlendi) çizimi bırakır
    const onCancel = (e: PointerEvent) => {
      if (session && e.pointerId === session.pointerId) cancel();
    };
    // Bırakılış katmana hiç gelmediyse (yakalama kurulamadı, katman gizlendi) çizim takılı kalmasın. Katman
    // bırakılışı kendisi alırsa çizim o anda biter: bu yalnızca kalanı temizler
    const onWindowUp = (e: PointerEvent) => {
      const s = session;
      if (!s || e.pointerId !== s.pointerId) return;
      setTimeout(() => {
        if (session === s) cancel();
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') cancel();
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
    el.addEventListener('lostpointercapture', onCancel);
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('pointerup', onWindowUp, true);
    window.addEventListener('pointercancel', onWindowUp, true);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      // Sayfa kaldırılınca süren çizim bırakılır
      cancel();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('lostpointercapture', onCancel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('pointerup', onWindowUp, true);
      window.removeEventListener('pointercancel', onWindowUp, true);
      document.removeEventListener('visibilitychange', onVisibility);
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
  // Çarpma karışımı yalnızca sayfada boyama varken: boş katman kıvrılırken iPad'de boşuna birleştirilmesin
  const blend =
    liveHighlight ||
    paths.some(({ a }) => a.kind === 'highlight') ||
    waiting.some((x) => x.kind === 'highlight');

  const strokes = (kind: DrawTool) => (
    <svg
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
      viewBox={`0 0 1 ${yScale}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      // Fosforlu kalem çarpma karışımıyla boyar: altındaki yazı koyu kalır
      style={kind === 'highlight' && blend ? { mixBlendMode: 'multiply' } : undefined}
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
        <NotePin
          key={n.id}
          note={n}
          annotator={annotator}
          page={page}
          pageWidth={width}
          pageHeight={height}
        />
      ))}
    </div>
  );
}

/** Kenara göre dönen iğnenin sivri köşesi (ucu): sol alt varsayılan (book.css → .note-pin) */
const PIN_CORNER = {
  'x-y': undefined,
  'X-y': '50% 50% 0 50%', // sağ alt
  'x-Y': '0 50% 50% 50%', // sol üst
  'X-Y': '50% 0 50% 50%', // sağ üst
} as const;

/** Not iğnesi: ucu notun konduğu noktada; dokununca not açılır */
function NotePin({
  note,
  annotator,
  page,
  pageWidth,
  pageHeight,
}: {
  note: SavedAnnotation;
  annotator: Annotator;
  page: number;
  pageWidth: number;
  pageHeight: number;
}) {
  const [x, y] = note.points;
  const excerpt = (note.text ?? '').trim().slice(0, 60);
  // Dokunma alanı 44 px; gövde (26 px) alanın ortasında, sivri köşesi notun noktasında
  const inset = (PIN_TOUCH - PIN_SIZE) / 2;
  const { flipX, flipY, dx, dy } = pinBody({ x, y }, pageWidth, pageHeight);
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
        transform: `translate(${dx - inset}px, ${dy - inset}px)`,
      }}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        annotator.openNote({
          page,
          point: { x, y },
          record: note,
          anchor: { x: r.left + inset - dx, y: r.top + inset - dy },
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
          borderRadius: PIN_CORNER[`${flipX ? 'X' : 'x'}-${flipY ? 'Y' : 'y'}`],
        }}
      >
        <AlignLeft className="size-3.5" strokeWidth={2.5} />
      </span>
    </button>
  );
}
