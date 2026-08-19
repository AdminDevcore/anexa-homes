"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2, MousePointer2, Square, Eraser, RotateCcw, Trash2, Save, ZoomIn, ZoomOut,
  Plus, Move, Compass,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  metresPerPixel,
  metresToImagePx,
  panelCorners,
  panelCount,
  panelSizeM,
  bestFitBlock,
  fitBlock,
  detachPanel,
  blockLocalToGround,
  groundToBlockLocal,
  blockSpanM,
  type LayoutBlock,
  type ModuleMm,
  type Orientation,
} from "@/lib/solar-layout";
import { systemTotals } from "@/lib/solar-arrays";
import {
  compassLabel,
  optimalTiltDeg,
  pitchToTiltDeg,
  COMMON_PITCHES,
} from "@/lib/solar-orientation";
import type { YieldAssumptions } from "@/lib/solar-money";
import { saveSolarLayoutAction } from "@/server/modules/solar/layout-actions";
import { uploadPanelLayoutAction } from "@/server/modules/solar/proposal-actions";

/**
 * Draw the array on the customer's own roof.
 *
 * The module count — and therefore the system size, the production and the
 * price — is the number of panels drawn here. It used to be typed, which is why
 * this exists: how many panels fit a roof is something you find out by putting
 * them on it, not by estimating.
 *
 * Panels are drawn at TRUE SCALE. The imagery is a Web Mercator tile at a known
 * zoom and latitude, so metres-per-pixel is exact; a panel that does not fit on
 * screen does not fit on the roof either. Positions are stored in ground metres
 * from the deal's coordinate, never pixels, so reopening at a different zoom
 * puts every panel back where it was.
 *
 * TWO THINGS ARE MODELLED HERE and they are easy to confuse:
 *   - `rotationDeg` turns the GRID in plan view, so its rows run along the
 *     ridge. It is a drawing concern and does not change output.
 *   - `azimuthDeg`/`tiltDeg` are which way the plane FACES and how steep it is.
 *     They are the only things here that change the kWh.
 * A rep can align an array beautifully and still have it pointing north, which
 * is why the orientation is asked for separately rather than inferred.
 *
 * A SINGLE PANEL IS A 1x1 BLOCK. That is the whole trick behind placing and
 * sliding individual modules: the same shape, the same maths and the same
 * count serve one panel and a forty-panel grid, so precision work needed no new
 * model, no migration and no second code path to keep in step.
 */

/** Google clamps each side of a Static Maps image to 640; scale=2 doubles it. */
const DEFAULT_CANVAS_PX = 1280;

type Tool = "draw" | "panel" | "select" | "movePanel" | "erase";
type Zoom = 20 | 21;

type Drag =
  | { kind: "new"; fromX: number; fromY: number; toX: number; toY: number }
  | { kind: "move"; id: string; fromE: number; fromN: number; originE: number; originN: number }
  | { kind: "rotate"; id: string }
  | { kind: "resize"; id: string }
  | null;

const uid = () => `b${Math.random().toString(36).slice(2, 10)}`;

/** Nudge distances. A rail is 2 cm, so 5 cm is "just off" and 50 cm is "over a bit". */
const NUDGE_FINE_M = 0.05;
const NUDGE_COARSE_M = 0.5;

/** Is a point inside this convex quad? Consistent winding means one sign. */
function insideQuad(p: { e: number; n: number }, q: { e: number; n: number }[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const cross = (b.e - a.e) * (p.n - a.n) - (b.n - a.n) * (p.e - a.e);
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export function SolarLayoutDesigner({
  leadId,
  lat,
  moduleMm,
  moduleRatingW,
  initialBlocks,
  assumptions,
  canEdit,
}: {
  leadId: string;
  /** Null when the deal has no rooftop coordinate — the roof cannot be shown. */
  lat: number | null;
  moduleMm: ModuleMm;
  moduleRatingW: number | null;
  initialBlocks: LayoutBlock[];
  /** The company's yield and derate, so the preview matches what the server saves. */
  assumptions: YieldAssumptions;
  canEdit: boolean;
}) {
  const router = useRouter();
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const imgRef = React.useRef<HTMLImageElement | null>(null);

  /**
   * THE GESTURE STATE LIVES IN A REF AS WELL AS IN STATE, and the ref is the
   * one the pointer handlers read.
   *
   * A browser can deliver the last `pointermove` and the `pointerup` of a drag
   * in the SAME task, and React does not re-render in between. A handler that
   * reads the `drag` it closed over at render time therefore sees the drag as
   * it was BEFORE the gesture: corner never moved, rectangle zero. That was
   * the whole of "That is 0.0 m x 0.0 m — one panel needs 1.13 m x 1.76 m" on
   * a rectangle drawn across half a roof. The drag was fine; the measurement
   * was taken from a stale copy. Anyone quick with a mouse hit it every time,
   * anyone slow enough for a repaint between the two events never did, which
   * is what made it look like the tool worked for some people and not others.
   *
   * Writing the ref synchronously means every event in a gesture sees what the
   * events before it did, whatever React has or has not committed yet. State
   * is still set, because state is what paints.
   */
  const [blocks, setBlocksState] = React.useState<LayoutBlock[]>(initialBlocks);
  const blocksRef = React.useRef<LayoutBlock[]>(initialBlocks);
  const setBlocks = React.useCallback(
    (next: LayoutBlock[] | ((prev: LayoutBlock[]) => LayoutBlock[])) => {
      const value = typeof next === "function" ? next(blocksRef.current) : next;
      blocksRef.current = value;
      setBlocksState(value);
    },
    []
  );

  const [drag, setDragState] = React.useState<Drag>(null);
  const dragRef = React.useRef<Drag>(null);
  const setDrag = React.useCallback((next: Drag) => {
    dragRef.current = next;
    setDragState(next);
  }, []);

  /**
   * The layout as it was when the current gesture began, so one drag is one
   * undo step — and undoing a move puts the array back where it started.
   * Recording the blocks at pointerup, as this used to, records them as they
   * already are: an undo that restores the drag you were trying to undo.
   */
  const gestureBeforeRef = React.useRef<LayoutBlock[] | null>(null);

  const [history, setHistory] = React.useState<LayoutBlock[][]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [tool, setTool] = React.useState<Tool>("draw");
  const [zoom, setZoom] = React.useState<Zoom>(21);
  const [viewScale, setViewScale] = React.useState(1);
  // Which zoom's imagery has resolved, how, and AT WHAT SIZE. The size is part
  // of the answer because the canvas and the metres-per-pixel are both derived
  // from it — Google clamps a Static Maps request to 640 a side and says
  // nothing, so the only trustworthy dimensions are the ones that arrived.
  const [loaded, setLoaded] = React.useState<{
    zoom: Zoom;
    ok: boolean;
    widthPx: number;
    heightPx: number;
  } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const imageState: "loading" | "ready" | "failed" =
    loaded?.zoom !== zoom ? "loading" : loaded.ok ? "ready" : "failed";

  // Square, and the size the picture actually is. The old constants said
  // 2560x1440 for an image Google returns as 1280x1280, which stretched every
  // roof 1.78x wide and put the panel scale out by 2x across and 1.13x down.
  const canvasW = loaded?.ok ? loaded.widthPx : DEFAULT_CANVAS_PX;
  const canvasH = loaded?.ok ? loaded.heightPx : DEFAULT_CANVAS_PX;

  const mpp = lat == null ? 0 : metresPerPixel(lat, zoom, 2);
  const selected = blocks.find((b) => b.id === selectedId) ?? null;
  const count = panelCount(blocks);

  const totals = React.useMemo(
    () => systemTotals(blocks, { lat, moduleRatingW, assumptions }),
    [blocks, lat, moduleRatingW, assumptions]
  );
  const bestTilt = React.useMemo(() => (lat == null ? 30 : optimalTiltDeg(lat)), [lat]);

  /** Every mutation goes through here, so undo has one place to record. */
  const commit = React.useCallback((next: LayoutBlock[]) => {
    setHistory((h) => [...h.slice(-49), blocksRef.current]);
    setBlocks(next);
  }, [setBlocks]);

  const undo = React.useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      setBlocks(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }, [setBlocks]);

  /** Patch the selected array. Every property control goes through one path. */
  const patchSelected = React.useCallback(
    (patch: Partial<LayoutBlock>) => {
      if (!selected) return;
      commit(blocks.map((b) => (b.id === selected.id ? { ...b, ...patch } : b)));
    },
    [blocks, commit, selected]
  );

  /**
   * What a newly drawn array should face.
   *
   * The FIRST array on a deal inherits nothing, so it stays unoriented and the
   * warning fires at least once — a rep who is never told the roof matters will
   * never say which way it faces. After that, arrays inherit from the last one
   * drawn, because the second and third arrays are usually further up the same
   * plane and retyping the pitch three times is how people stop bothering.
   */
  const inheritedOrientation = (): Pick<LayoutBlock, "azimuthDeg" | "tiltDeg"> => {
    const source = selected ?? blocksRef.current[blocksRef.current.length - 1];
    if (!source) return { azimuthDeg: null, tiltDeg: null };
    return { azimuthDeg: source.azimuthDeg ?? null, tiltDeg: source.tiltDeg ?? null };
  };

  // ── Imagery ────────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (lat == null) return;
    let live = true;
    const img = new Image();
    // Same-origin: the route proxies Google server-side so the API key never
    // reaches the browser. That is also what keeps the canvas untainted, which
    // is what makes `toBlob` on save possible at all.
    //
    // `square=1` because the geometry below assumes the picture is the shape it
    // asked for. See the route.
    img.src = `/api/property/satellite?leadId=${encodeURIComponent(leadId)}&zoom=${zoom}&pin=0&square=1`;
    img.onload = () => {
      if (!live) return;
      imgRef.current = img;
      setLoaded({
        zoom,
        ok: true,
        widthPx: img.naturalWidth || DEFAULT_CANVAS_PX,
        heightPx: img.naturalHeight || DEFAULT_CANVAS_PX,
      });
    };
    img.onerror = () => {
      if (!live) return;
      imgRef.current = null;
      setLoaded({ zoom, ok: false, widthPx: DEFAULT_CANVAS_PX, heightPx: DEFAULT_CANVAS_PX });
    };
    // A zoom switched mid-fetch must not have the old picture land on top of
    // the new one.
    return () => {
      live = false;
    };
  }, [leadId, zoom, lat]);

  // ── Drawing ────────────────────────────────────────────────────────────
  const paint = React.useCallback(
    (ctx: CanvasRenderingContext2D, opts: { chrome: boolean }) => {
      ctx.clearRect(0, 0, canvasW, canvasH);
      // 1:1 with the source. Any scaling here is a scaling bug waiting to
      // happen, which is exactly the one this component shipped with.
      if (imgRef.current) ctx.drawImage(imgRef.current, 0, 0, canvasW, canvasH);
      else {
        ctx.fillStyle = "#1f2937";
        ctx.fillRect(0, 0, canvasW, canvasH);
      }

      const img = { widthPx: canvasW, heightPx: canvasH };
      for (const b of blocks) {
        const isSel = opts.chrome && b.id === selectedId;
        const lone = b.cols === 1 && b.rows === 1;
        for (const quad of panelCorners(b, moduleMm)) {
          const pts = quad.map((c) => metresToImagePx(c.e, c.n, mpp, img));
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.closePath();
          ctx.fillStyle = "rgba(17, 32, 56, 0.82)";
          ctx.fill();
          ctx.lineWidth = isSel ? 2.5 : 1.5;
          ctx.strokeStyle = isSel
            ? "#f4631e"
            : lone
              ? "rgba(255, 214, 150, 0.95)"
              : "rgba(150, 190, 255, 0.85)";
          ctx.stroke();
        }

        if (isSel) {
          drawFacing(ctx, b, moduleMm, mpp, img);
          const h = handlePositions(b, moduleMm, mpp, img);
          for (const [pos, colour] of [
            [h.rotate, "#f4631e"],
            [h.resize, "#38bdf8"],
          ] as const) {
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 9, 0, Math.PI * 2);
            ctx.fillStyle = colour;
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = "#ffffff";
            ctx.stroke();
          }
        }
      }

      if (opts.chrome && drag?.kind === "new") {
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#f4631e";
        ctx.strokeRect(
          Math.min(drag.fromX, drag.toX),
          Math.min(drag.fromY, drag.toY),
          Math.abs(drag.toX - drag.fromX),
          Math.abs(drag.toY - drag.fromY)
        );
        ctx.setLineDash([]);
      }
    },
    [blocks, selectedId, drag, moduleMm, mpp, canvasW, canvasH]
  );

  React.useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) paint(ctx, { chrome: true });
  }, [paint, imageState]);

  // ── Pointer maths ──────────────────────────────────────────────────────
  /** Client coords → canvas pixels, whatever the element is scaled to. */
  const toCanvas = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * canvasW,
      y: ((e.clientY - r.top) / r.height) * canvasH,
    };
  };
  const toMetres = (p: { x: number; y: number }) => ({
    e: (p.x - canvasW / 2) * mpp,
    n: (canvasH / 2 - p.y) * mpp,
  });

  /** Which panel, if any, is under this point. */
  const hit = (m: { e: number; n: number }) => {
    const current = blocksRef.current;
    for (let bi = current.length - 1; bi >= 0; bi--) {
      const b = current[bi];
      const quads = panelCorners(b, moduleMm);
      // panelCorners skips omitted cells, so walk the grid to keep indices true.
      let q = 0;
      for (let row = 0; row < b.rows; row++) {
        for (let col = 0; col < b.cols; col++) {
          const idx = row * b.cols + col;
          if (b.omitted.includes(idx)) continue;
          if (insideQuad(m, quads[q])) return { block: b, index: idx };
          q++;
        }
      }
    }
    return null;
  };

  /** A lone panel centred on a ground point, rather than hung off its corner. */
  const lonePanelAt = (
    m: { e: number; n: number },
    rotationDeg: number,
    orientation: Orientation
  ): LayoutBlock => {
    const { w, h } = panelSizeM(moduleMm, orientation);
    // With a zero origin, blockLocalToGround is the pure rotation, so this is
    // the centre offset turned into ground axes.
    const off = blockLocalToGround({ originE: 0, originN: 0, rotationDeg }, w / 2, h / 2);
    return {
      id: uid(),
      originE: m.e - off.e,
      originN: m.n - off.n,
      rotationDeg,
      cols: 1,
      rows: 1,
      orientation,
      omitted: [],
      ...inheritedOrientation(),
    };
  };

  function onPointerDown(ev: React.PointerEvent) {
    if (!canEdit || lat == null) return;
    const p = toCanvas(ev);
    const m = toMetres(p);
    // Synthetic pointers (and a pointer already released) throw here, and an
    // exception mid-handler leaves the tool dead for the rest of the gesture.
    try {
      canvasRef.current?.setPointerCapture(ev.pointerId);
    } catch {
      /* capture is an optimisation, not a requirement */
    }

    // Everything this gesture is about to change, so pointerup can record one
    // undo step for the whole of it rather than one per stage.
    gestureBeforeRef.current = blocksRef.current;

    if (tool === "erase") {
      const h = hit(m);
      if (h) {
        // A lone panel is deleted outright: knocking out the only cell of a 1x1
        // leaves an empty block on the canvas that can still be clicked.
        commit(
          h.block.cols === 1 && h.block.rows === 1
            ? blocksRef.current.filter((b) => b.id !== h.block.id)
            : blocksRef.current.map((b) =>
                b.id === h.block.id ? { ...b, omitted: [...b.omitted, h.index] } : b
              )
        );
        if (selectedId === h.block.id) setSelectedId(null);
      }
      return;
    }

    if (tool === "panel") {
      // Match whatever is already up there, so a panel added to a rotated array
      // lands square with it instead of pointing north.
      const near = selected ?? blocksRef.current[blocksRef.current.length - 1];
      const b = lonePanelAt(m, near?.rotationDeg ?? 0, near?.orientation ?? "portrait");
      // No history entry here — pointerup records one for the whole gesture, so
      // a single undo takes back the panel AND the slide that positioned it.
      setBlocks([...blocksRef.current, b]);
      setSelectedId(b.id);
      return setDrag({
        kind: "move",
        id: b.id,
        fromE: m.e,
        fromN: m.n,
        originE: b.originE,
        originN: b.originN,
      });
    }

    if (tool === "movePanel") {
      const h = hit(m);
      if (!h) return setSelectedId(null);
      // Detaching on grab is what makes "slide this one to the right" a single
      // gesture: the panel leaves the grid and follows the pointer, and the
      // hole it came from stays knocked out.
      const res = detachPanel(blocksRef.current, h.block.id, h.index, moduleMm, uid());
      if (!res) return;
      // As above: the detach and the slide are one gesture, so one undo step.
      setBlocks(res.blocks);
      const loose = res.blocks.find((b) => b.id === res.detachedId)!;
      setSelectedId(loose.id);
      return setDrag({
        kind: "move",
        id: loose.id,
        fromE: m.e,
        fromN: m.n,
        originE: loose.originE,
        originN: loose.originN,
      });
    }

    if (selected) {
      const img = { widthPx: canvasW, heightPx: canvasH };
      const hp = handlePositions(selected, moduleMm, mpp, img);
      const grab = Math.max(18, canvasW / 70);
      if (Math.hypot(p.x - hp.rotate.x, p.y - hp.rotate.y) < grab) {
        return setDrag({ kind: "rotate", id: selected.id });
      }
      if (Math.hypot(p.x - hp.resize.x, p.y - hp.resize.y) < grab) {
        return setDrag({ kind: "resize", id: selected.id });
      }
    }

    const h = hit(m);
    if (h && tool === "select") {
      setSelectedId(h.block.id);
      return setDrag({
        kind: "move",
        id: h.block.id,
        fromE: m.e,
        fromN: m.n,
        originE: h.block.originE,
        originN: h.block.originN,
      });
    }

    if (tool === "draw") {
      setSelectedId(null);
      return setDrag({ kind: "new", fromX: p.x, fromY: p.y, toX: p.x, toY: p.y });
    }

    setSelectedId(h ? h.block.id : null);
  }

  function onPointerMove(ev: React.PointerEvent) {
    // The ref, not the state — see the note where it is declared.
    const d = dragRef.current;
    if (!d || lat == null) return;
    const p = toCanvas(ev);
    const m = toMetres(p);

    if (d.kind === "new") return setDrag({ ...d, toX: p.x, toY: p.y });

    const b = blocksRef.current.find((x) => x.id === d.id);
    if (!b) return;

    if (d.kind === "move") {
      const next = { ...b, originE: d.originE + (m.e - d.fromE), originN: d.originN + (m.n - d.fromN) };
      return setBlocks((bs) => bs.map((x) => (x.id === b.id ? next : x)));
    }

    if (d.kind === "rotate") {
      // Bearing from the block's origin to the pointer, clockwise from north.
      const deg = (Math.atan2(m.e - b.originE, m.n - b.originN) * 180) / Math.PI;
      const snapped = ev.shiftKey ? deg : Math.round(deg / 5) * 5;
      return setBlocks((bs) =>
        bs.map((x) => (x.id === b.id ? { ...x, rotationDeg: Math.round(snapped * 10) / 10 } : x))
      );
    }

    if (d.kind === "resize") {
      // Back into the block's own frame, so a rotated block grows along its own
      // rows rather than along north.
      const local = groundToBlockLocal(b, m.e, m.n);
      const fit = fitBlock(
        { widthM: Math.max(0, local.x), heightM: Math.max(0, local.y) },
        moduleMm,
        b.orientation
      );
      return setBlocks((bs) =>
        bs.map((x) => (x.id === b.id ? { ...x, cols: Math.max(1, fit.cols), rows: Math.max(1, fit.rows) } : x))
      );
    }
  }

  function onPointerUp(ev: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    setDrag(null);
    const before = gestureBeforeRef.current;
    gestureBeforeRef.current = null;

    if (d.kind === "new") {
      // THE RELEASE POINT COMES FROM THIS EVENT, not from whichever
      // `pointermove` we last had a render for. A drag whose move and release
      // arrive in one task has a perfectly good rectangle in the pointerup
      // itself; it was only ever the stale copy that measured zero. It also
      // covers the case where a fast flick delivers no `pointermove` at all.
      const to = toCanvas(ev);
      const wM = Math.abs(to.x - d.fromX) * mpp;
      const hM = Math.abs(to.y - d.fromY) * mpp;
      // Both ways round. Rejecting a shallow band because a PORTRAIT panel
      // would not fit in it — while a landscape one would have sat there
      // happily — is what "Too small for a panel" used to mean.
      const fit = bestFitBlock({ widthM: wM, heightM: hM }, moduleMm);
      if (fit.cols === 0 || fit.rows === 0) {
        const { w, h } = panelSizeM(moduleMm, "portrait");
        const need = Math.min(w, h);
        return toast.error(
          `That is ${wM.toFixed(1)} m x ${hM.toFixed(1)} m — one panel needs ${need.toFixed(2)} m x ${Math.max(w, h).toFixed(2)} m. Drag a bigger area, or use Add panel to place one by hand.`
        );
      }
      const topLeft = toMetres({ x: Math.min(d.fromX, to.x), y: Math.min(d.fromY, to.y) });
      const b: LayoutBlock = {
        id: uid(),
        originE: topLeft.e,
        originN: topLeft.n,
        rotationDeg: 0,
        cols: fit.cols,
        rows: fit.rows,
        orientation: fit.orientation,
        omitted: [],
        ...inheritedOrientation(),
      };
      commit([...blocksRef.current, b]);
      setSelectedId(b.id);
      setTool("select");
      return;
    }

    // move/rotate/resize edited the layout live, so the undo step is the
    // layout as it was when the gesture STARTED. Recording it here, as this
    // used to, records the finished drag as the thing to go back to.
    if (before) setHistory((h) => [...h.slice(-49), before]);
  }

  /**
   * A cancelled gesture is not a drawn array — the browser takes the pointer
   * away for a scroll or a window switch, and finishing the rectangle there
   * would drop panels somewhere the rep never released the mouse.
   */
  function onPointerCancel() {
    const d = dragRef.current;
    if (!d) return;
    setDrag(null);
    const before = gestureBeforeRef.current;
    gestureBeforeRef.current = null;
    if (d.kind !== "new" && before) setHistory((h) => [...h.slice(-49), before]);
  }

  // ── Keyboard ───────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        return undo();
      }
      if (!selected) return;

      // Arrow keys nudge. The reason this exists: a panel that has to clear a
      // vent by 30 cm cannot be placed by dragging a mouse across a picture
      // where 30 cm is six pixels.
      const step = e.shiftKey ? NUDGE_COARSE_M : NUDGE_FINE_M;
      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, step],
        ArrowDown: [0, -step],
      };
      const d = nudge[e.key];
      if (d) {
        e.preventDefault();
        return patchSelected({
          originE: selected.originE + d[0],
          originN: selected.originN + d[1],
        });
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        commit(blocks.filter((b) => b.id !== selected.id));
        setSelectedId(null);
      }
      if (e.key.toLowerCase() === "p") {
        patchSelected({
          orientation: selected.orientation === "portrait" ? "landscape" : "portrait",
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, blocks, commit, undo, canEdit, patchSelected]);

  // ── Save ───────────────────────────────────────────────────────────────
  async function save() {
    setBusy(true);
    const res = await saveSolarLayoutAction({ leadId, blocks });
    if (!res.ok) {
      setBusy(false);
      return toast.error(res.error);
    }

    // The count is what the quote depends on, so it is saved first and stands on
    // its own. The picture is the customer's copy of the same thing — worth
    // reporting separately if it fails, never worth losing the count over.
    const canvas = canvasRef.current;
    if (canvas) {
      const off = document.createElement("canvas");
      off.width = canvasW;
      off.height = canvasH;
      const octx = off.getContext("2d");
      // Re-render WITHOUT selection handles or the drag outline: this image is
      // what the homeowner sees.
      if (octx) paint(octx, { chrome: false });
      const blob = await new Promise<Blob | null>((r) => off.toBlob(r, "image/jpeg", 0.9));
      if (blob) {
        const fd = new FormData();
        fd.set("leadId", leadId);
        fd.set("file", new File([blob], "panel-layout.jpg", { type: "image/jpeg" }));
        fd.set("designProvider", "Anexa Designer");
        fd.set("designExternalRef", "");
        const up = await uploadPanelLayoutAction(fd);
        if (!up.ok) toast.error(`Layout saved, but the image did not attach: ${up.error}`);
      }
    }

    setBusy(false);
    toast.success(`${res.moduleQty} ${res.moduleQty === 1 ? "panel" : "panels"} saved`);
    router.refresh();
  }

  // ── Render ─────────────────────────────────────────────────────────────
  if (lat == null) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        This deal has no rooftop coordinate yet, so the roof cannot be shown. Fix the address on the
        deal, or attach a layout drawn elsewhere below.
      </p>
    );
  }

  const groundSpanM = canvasW * mpp;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {canEdit &&
          ([
            ["draw", "Draw array", Square],
            ["panel", "Add panel", Plus],
            ["select", "Move array", MousePointer2],
            ["movePanel", "Move panel", Move],
            ["erase", "Remove panels", Eraser],
          ] as const).map(([id, label, Icon]) => (
            <Button
              key={id}
              type="button"
              size="sm"
              variant={tool === id ? "default" : "outline"}
              aria-pressed={tool === id}
              onClick={() => setTool(id)}
            >
              <Icon className="size-4" /> {label}
            </Button>
          ))}

        <div className="ml-auto flex items-center gap-1">
          <Button type="button" size="sm" variant="outline" onClick={() => setViewScale((v) => Math.max(1, v - 0.5))} aria-label="Zoom out">
            <ZoomOut className="size-4" />
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setViewScale((v) => Math.min(6, v + 0.5))} aria-label="Zoom in">
            <ZoomIn className="size-4" />
          </Button>
          <select
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
            value={zoom}
            aria-label="Imagery detail"
            onChange={(e) => setZoom(Number(e.target.value) as Zoom)}
          >
            <option value={21}>Closest imagery</option>
            <option value={20}>Wider imagery</option>
          </select>
        </div>
      </div>

      <div className="overflow-auto rounded-lg border border-border bg-muted/30">
        <canvas
          ref={canvasRef}
          data-testid="layout-canvas"
          width={canvasW}
          height={canvasH}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          style={{ width: `${100 * viewScale}%`, height: "auto", touchAction: "none" }}
          className={cn(
            "block max-w-none",
            canEdit && (tool === "draw" || tool === "panel") && "cursor-crosshair",
            canEdit && tool === "movePanel" && "cursor-grab",
            canEdit && tool === "erase" && "cursor-cell"
          )}
        />
      </div>

      {imageState === "failed" && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
          The satellite image did not load — try the wider imagery, or check that the Maps key is
          configured. Panels you draw are still saved against the real coordinates.
        </p>
      )}

      {/* ── The numbers ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <div>
          <span data-testid="panel-count" className="font-display text-lg font-semibold">
            {count} {count === 1 ? "panel" : "panels"}
          </span>
          <span className="ml-2 text-xs text-muted-foreground">
            {moduleRatingW
              ? `${totals.systemSizeKwDc.toFixed(2)} kW-DC · ${totals.year1ProductionKwh.toLocaleString()} kWh yr-1`
              : "No default panel in the catalogue, so this cannot be sized"}
          </span>
          {/* Only once EVERY array has been described. An undescribed array
              weighs 1 in the maths — the pre-orientation answer — and printing
              that as "100% of ideal" turns a missing measurement into a claim
              of a perfect roof. The amber prompt below says what to do instead. */}
          {totals.blendedFactor != null && moduleRatingW && totals.unorientedArrays === 0 ? (
            <span
              data-testid="orientation-factor"
              className={cn(
                "ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium",
                totals.blendedFactor >= 0.9
                  ? "bg-emerald-100 text-emerald-800"
                  : totals.blendedFactor >= 0.75
                    ? "bg-amber-100 text-amber-800"
                    : "bg-rose-100 text-rose-800"
              )}
              title="Expected output as a share of what these panels would make on this site's best-oriented plane."
            >
              {(totals.blendedFactor * 100).toFixed(0)}% of ideal
            </span>
          ) : null}
        </div>

        {canEdit && (
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={history.length === 0} onClick={undo}>
              <RotateCcw className="size-4" /> Undo
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save layout
            </Button>
          </div>
        )}
      </div>

      {totals.unorientedArrays > 0 && canEdit && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
          <strong>
            {totals.unorientedArrays} {totals.unorientedArrays === 1 ? "array has" : "arrays have"} no
            facing or pitch set.
          </strong>{" "}
          Their production is the generic market yield — the same kWh a south-facing roof would get.
          Select an array and set which way it faces to price the roof this house actually has.
        </p>
      )}

      {/* ── The selected array ──────────────────────────────────────────── */}
      {selected && canEdit && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {selected.cols === 1 && selected.rows === 1
                ? "Selected panel"
                : `Selected array · ${selected.cols} x ${selected.rows}`}
            </h5>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                commit(blocks.filter((b) => b.id !== selected.id));
                setSelectedId(null);
              }}
            >
              <Trash2 className="size-4" />
              {selected.cols === 1 && selected.rows === 1 ? "Delete panel" : "Delete array"}
            </Button>
          </div>

          {/* Plan-view geometry: where it sits, not what it makes. */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="block-rotation" className="text-xs">
                Grid angle
              </Label>
              <input
                id="block-rotation"
                type="number"
                step="1"
                value={Math.round(selected.rotationDeg)}
                onChange={(e) => patchSelected({ rotationDeg: Number(e.target.value) || 0 })}
                className="h-8 w-20 rounded-md border border-input bg-transparent px-2 text-sm"
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                patchSelected({
                  orientation: selected.orientation === "portrait" ? "landscape" : "portrait",
                })
              }
            >
              {selected.orientation === "portrait" ? "Portrait" : "Landscape"}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Arrow keys nudge {NUDGE_FINE_M * 100} cm · hold shift for {NUDGE_COARSE_M} m
            </p>
          </div>

          {/* Production geometry: the only two fields here that change the kWh. */}
          <div className="space-y-2 rounded-md bg-muted/40 p-2.5">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="block-azimuth" className="text-xs">
                  Facing (azimuth)
                </Label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="block-azimuth"
                    type="number"
                    step="5"
                    min={0}
                    max={359}
                    placeholder="—"
                    value={selected.azimuthDeg ?? ""}
                    onChange={(e) =>
                      patchSelected({
                        azimuthDeg: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    className="h-8 w-20 rounded-md border border-input bg-transparent px-2 text-sm"
                  />
                  <span className="w-8 text-xs font-medium text-muted-foreground">
                    {selected.azimuthDeg == null ? "—" : compassLabel(selected.azimuthDeg)}
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="block-tilt" className="text-xs">
                  Pitch (tilt)
                </Label>
                <div className="flex items-center gap-1.5">
                  <input
                    id="block-tilt"
                    type="number"
                    step="0.5"
                    min={0}
                    max={90}
                    placeholder="—"
                    value={selected.tiltDeg ?? ""}
                    onChange={(e) =>
                      patchSelected({
                        tiltDeg: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    className="h-8 w-20 rounded-md border border-input bg-transparent px-2 text-sm"
                  />
                  <select
                    aria-label="Roof pitch"
                    className="h-8 rounded-md border border-input bg-transparent px-1.5 text-xs"
                    // Only names a pitch that the tilt EXACTLY is. A 31° tilt
                    // is nearest 7/12, but 7/12 is 30.3°, and a dropdown
                    // reading "7/12" beside a box reading 31 invites a rep to
                    // quote a pitch the roof does not have.
                    value={String(exactPitch(selected.tiltDeg) ?? "")}
                    onChange={(e) =>
                      e.target.value !== "" &&
                      patchSelected({ tiltDeg: pitchToTiltDeg(Number(e.target.value)) })
                    }
                  >
                    <option value="">pitch…</option>
                    {COMMON_PITCHES.map((rise) => (
                      <option key={rise} value={rise}>
                        {rise}/12 ({pitchToTiltDeg(rise)}°)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {/* An array is normally aligned to the ridge first, and then it
                    faces square off one side of it or the other. Two clicks
                    beat working the compass bearing out by hand on a ladder. */}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    patchSelected({ azimuthDeg: norm360(selected.rotationDeg + 90) })
                  }
                  title="Face square off the rows — the down-slope direction for an array aligned to the ridge."
                >
                  <Compass className="size-4" /> Off the rows
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    patchSelected({ azimuthDeg: norm360((selected.azimuthDeg ?? 0) + 180) })
                  }
                >
                  Flip 180°
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => patchSelected({ azimuthDeg: 180, tiltDeg: bestTilt })}
                  title="Due south at this site's optimal tilt — for a ground mount or a tilt-up frame."
                >
                  Best here (S {bestTilt}°)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => patchSelected({ tiltDeg: 0 })}
                >
                  Flat
                </Button>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              {selected.azimuthDeg == null || selected.tiltDeg == null ? (
                <>Set both to price this plane. Until then it earns the generic market yield.</>
              ) : (
                <>
                  Facing {compassLabel(selected.azimuthDeg)} ({Math.round(selected.azimuthDeg)}°) at{" "}
                  {selected.tiltDeg}° — this plane returns{" "}
                  <strong>
                    {(
                      (totals.blendedFactor != null
                        ? arrayFactor(totals, selected.id)
                        : 1) * 100
                    ).toFixed(0)}
                    %
                  </strong>{" "}
                  of what it would on this site&apos;s best plane.
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {canEdit && (
        <p className="text-[11px] text-muted-foreground">
          <strong>Draw array</strong> fills a rectangle with as many panels as truly fit.{" "}
          <strong>Add panel</strong> places one where you click, and <strong>Move panel</strong>{" "}
          pulls a single panel out of an array so you can slide it clear of a vent. Arrow keys nudge
          the selection. The picture is {groundSpanM.toFixed(0)} m across and panels are drawn to
          scale — if one does not fit here, it does not fit up there.
        </p>
      )}
    </div>
  );
}

/** The whole-inch pitch this tilt IS, or null when it falls between two. */
function exactPitch(tiltDeg: number | null | undefined): number | null {
  if (tiltDeg == null) return null;
  return COMMON_PITCHES.find((rise) => Math.abs(pitchToTiltDeg(rise) - tiltDeg) < 0.05) ?? null;
}

/** 0..359, so a flip past north and a negative bearing both read normally. */
function norm360(deg: number): number {
  return Math.round(((deg % 360) + 360) % 360);
}

/**
 * One array's orientation factor, read back out of the totals.
 *
 * The totals are already memoised for the whole system, so pulling a single
 * array's figure out of them is cheaper than a second irradiance sum — and,
 * more to the point, guarantees the per-array percentage and the system one
 * were computed the same way.
 */
function arrayFactor(totals: ReturnType<typeof systemTotals>, id: string): number {
  return totals.arrays.find((a) => a.id === id)?.factor ?? 1;
}

/**
 * The facing arrow for the selected array: which way these panels look.
 *
 * Drawn because azimuth is the one property here that cannot be seen. A grid
 * that has been rotated to sit square on the roof looks finished, and there is
 * nothing on the picture to say it is pointing at the wrong horizon.
 */
function drawFacing(
  ctx: CanvasRenderingContext2D,
  b: LayoutBlock,
  m: ModuleMm,
  mpp: number,
  img: { widthPx: number; heightPx: number }
) {
  if (b.azimuthDeg == null) return;
  const { spanX, spanY } = blockSpanM(b, m);
  const centre = blockLocalToGround(b, spanX / 2, spanY / 2);
  const from = metresToImagePx(centre.e, centre.n, mpp, img);

  const rad = (b.azimuthDeg * Math.PI) / 180;
  const len = Math.max(28, Math.min(spanX, spanY) / mpp / 2 + 22);
  // Screen y grows downward while north grows up, hence the negated cosine.
  const to = { x: from.x + Math.sin(rad) * len, y: from.y - Math.cos(rad) * len };

  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#fbbf24";
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();

  // Arrowhead
  ctx.beginPath();
  ctx.translate(to.x, to.y);
  ctx.rotate(rad);
  ctx.moveTo(0, -8);
  ctx.lineTo(6, 6);
  ctx.lineTo(-6, 6);
  ctx.closePath();
  ctx.fillStyle = "#fbbf24";
  ctx.fill();
  ctx.restore();
}

/**
 * Where the rotate and resize grips sit for a block, in canvas pixels.
 *
 * Module scope so the pointer handler and the painter agree by construction —
 * a grip drawn somewhere the hit test does not look for is a control that
 * silently does nothing.
 */
function handlePositions(
  b: LayoutBlock,
  m: ModuleMm,
  mpp: number,
  img: { widthPx: number; heightPx: number }
) {
  const { spanX, spanY } = blockSpanM(b, m);
  const at = (x: number, y: number) => {
    const g = blockLocalToGround(b, x, y);
    return metresToImagePx(g.e, g.n, mpp, img);
  };
  return {
    // Above the top edge, centred: the classic rotate grip.
    rotate: at(spanX / 2, -1.5),
    // Bottom-right corner: grows rows and columns.
    resize: at(spanX, spanY),
  };
}
