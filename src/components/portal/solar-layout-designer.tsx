"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft, Compass, Eraser, Loader2, MapPin, Minus, MousePointer2, Move, Plus,
  RotateCcw, Ruler, Square, Sun, Trash2, Wand2, ZoomIn, ZoomOut,
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
  addPanelAtCell,
  cellAt,
  cellCorners,
  cellDistance,
  growBlock,
  growGhosts,
  holeQuads,
  setbackBands,
  tidyBlocks,
  wouldOverlap,
  DEFAULT_SETBACK_M,
  type GrowSide,
  type LayoutBlock,
  type LayoutSetback,
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
import { setSolarDesignEquipmentAction } from "@/server/modules/solar/equipment-actions";
import { uploadPanelLayoutAction } from "@/server/modules/solar/proposal-actions";

/**
 * Draw the array on the customer's own roof. Full screen, because a roof is.
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
 * EVERY FIGURE ON SCREEN IS LIVE. There is no Calculate button and there should
 * never be one: size, production and offset are pure functions of the geometry
 * and the company's assumptions, all of which are already in the browser. A
 * button would only be there to make a round trip nobody needs, and a rep who
 * has to press it is a rep quoting the last drawing they pressed it on.
 *
 * THREE THINGS ARE MODELLED HERE and they are easy to confuse:
 *   - `rotationDeg` turns the GRID in plan view, so its rows run along the
 *     ridge. It is a drawing concern and does not change output.
 *   - `azimuthDeg`/`tiltDeg` are which way the plane FACES and how steep it is.
 *   - `shadePct` is what the tree in front of it takes away.
 * The last two are the only things here that change the kWh. A rep can align an
 * array beautifully and still have it pointing north, which is why the facing
 * is asked for rather than inferred: an array drawn along a ridge faces square
 * off it, but off WHICH side is a coin toss the drawing cannot settle.
 *
 * A SINGLE PANEL IS A 1x1 BLOCK. That is the whole trick behind placing and
 * sliding individual modules: the same shape, the same maths and the same
 * count serve one panel and a forty-panel grid, so precision work needed no new
 * model, no migration and no second code path to keep in step.
 */

/** One catalogue item, as offered in the top bar. */
export type EquipOption = {
  id: string;
  label: string;
  /** Modules: watts per panel. Inverters: rated AC watts. Batteries: usable Wh. */
  ratingW: number | null;
  /** Modules only: whether it carries a physical size to draw at true scale. */
  sized?: boolean;
};

/** Google clamps each side of a Static Maps image to 640; scale=2 doubles it. */
const DEFAULT_CANVAS_PX = 1280;

/**
 * How close to a traced setback point a click has to land to count as being ON
 * it, in SCREEN pixels — the dot is the target, and the dot is the same size on
 * screen however far the picture is zoomed.
 */
const SETBACK_SNAP_PX = 12;

/** That radius in ground metres, which is what the trace is stored in. */
function setbackSnapM(viewScale: number, mpp: number) {
  return Math.max(8, SETBACK_SNAP_PX / viewScale) * mpp;
}

/**
 * Which end of a trace in progress a point lands on.
 *
 * This is how a setback ENDS. Finishing used to be a double-click or Enter and
 * nothing else, so a rep who came back round to the dot they started from — the
 * gesture every mapping tool closes a shape with — just dropped another point on
 * top of it, and the dashed line ran on forever.
 *
 * The first point closes the loop; the last one ends an open run, which is also
 * where the second click of a double-click lands.
 */
function setbackVertexAt(
  pts: { e: number; n: number }[] | null,
  m: { e: number; n: number } | null,
  snapM: number
): "close" | "end" | null {
  if (!pts || !m || pts.length === 0) return null;
  const near = (p: { e: number; n: number }) => Math.hypot(p.e - m.e, p.n - m.n) <= snapM;
  // A two-point line closed on itself is a line drawn twice, so a loop needs
  // three corners before the first dot becomes a target.
  if (pts.length >= 3 && near(pts[0])) return "close";
  if (pts.length >= 2 && near(pts[pts.length - 1])) return "end";
  return null;
}

type Tool = "draw" | "panel" | "select" | "movePanel" | "erase" | "setback";
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
  address,
  lat,
  moduleMm,
  moduleRatingW,
  catalogue,
  chosen,
  annualUsageKwh,
  measuredYields,
  initialBlocks,
  initialSetbacks,
  assumptions,
  canEdit,
  backHref,
}: {
  leadId: string;
  /** Shown in the top bar: the rep needs to know whose roof this is. */
  address: string;
  /** Null when the deal has no rooftop coordinate — the roof cannot be shown. */
  lat: number | null;
  moduleMm: ModuleMm;
  moduleRatingW: number | null;
  /** Everything this company sells, for the three pickers in the top bar. */
  catalogue: { module: EquipOption[]; inverter: EquipOption[]; battery: EquipOption[] };
  /** What this design already names. Null in a slot means nothing chosen. */
  chosen: { moduleId: string | null; inverterId: string | null; batteryId: string | null };
  /** What the house uses, so offset is live rather than a saved snapshot. */
  annualUsageKwh: number | null;
  /**
   * kWh per kW-year for planes PVWatts has already answered for on this site,
   * keyed `tilt|azimuth`.
   *
   * Keyed on just the two angles because everything else in a PVWatts request —
   * the coordinate, the loss assumption, roof or ground — is fixed for one
   * design, so within this screen the plane IS the key.
   *
   * It exists so the live preview and the saved figure agree. Drag a panel onto
   * a plane that has been priced before and the number on screen is the number
   * that will be stored; draw a plane nobody has asked about yet and it
   * previews on the market average until the save settles it.
   */
  measuredYields: Record<string, number>;
  initialBlocks: LayoutBlock[];
  initialSetbacks: LayoutSetback[];
  /** The company's yield and derate, so the preview matches what the server saves. */
  assumptions: YieldAssumptions;
  canEdit: boolean;
  /** Where "Update proposal" and the back arrow return to. */
  backHref: string;
}) {
  const router = useRouter();
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const viewportRef = React.useRef<HTMLDivElement>(null);

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

  const [setbacks, setSetbacksState] = React.useState<LayoutSetback[]>(initialSetbacks);
  const setbacksRef = React.useRef<LayoutSetback[]>(initialSetbacks);
  const setSetbacks = React.useCallback((next: LayoutSetback[]) => {
    setbacksRef.current = next;
    setSetbacksState(next);
  }, []);

  /** The setback being traced, point by point. Null when not tracing one. */
  const [pending, setPendingState] = React.useState<{ e: number; n: number }[] | null>(null);
  const pendingRef = React.useRef<{ e: number; n: number }[] | null>(null);
  const setPending = React.useCallback((next: { e: number; n: number }[] | null) => {
    pendingRef.current = next;
    setPendingState(next);
  }, []);
  /** Where the pointer is while tracing, so the next segment previews. */
  const [ghostPoint, setGhostPoint] = React.useState<{ e: number; n: number } | null>(null);

  const [drag, setDragState] = React.useState<Drag>(null);
  const dragRef = React.useRef<Drag>(null);
  const setDrag = React.useCallback((next: Drag) => {
    dragRef.current = next;
    setDragState(next);
  }, []);

  /**
   * The layout as it was when the current gesture began, so one drag is one
   * undo step — and undoing a move puts the array back where it started.
   */
  const gestureBeforeRef = React.useRef<LayoutBlock[] | null>(null);

  const [history, setHistory] = React.useState<LayoutBlock[][]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [tool, setTool] = React.useState<Tool>("draw");
  const [zoom, setZoom] = React.useState<Zoom>(21);
  const [viewScale, setViewScale] = React.useState(1);
  const [dirty, setDirty] = React.useState(false);
  const [shadeOpen, setShadeOpen] = React.useState(false);
  const [tiltOpen, setTiltOpen] = React.useState(false);

  /**
   * What this design is built from.
   *
   * DERIVED from the props with an in-flight override on top, rather than
   * copied into state and re-synced by an effect. Mirroring a prop into state
   * means two things claiming to know the same fact, and the effect that keeps
   * them together is a render that causes another render. The override exists
   * only while the request is out, so the select does not snap back to the old
   * value under the rep's finger.
   */
  const [pendingEquip, setPendingEquip] = React.useState<Partial<typeof chosen> | null>(null);
  const [equipBusy, setEquipBusy] = React.useState(false);
  const equip = { ...chosen, ...(pendingEquip ?? {}) };

  /**
   * Choosing a panel changes what every panel on the roof is worth, so the
   * server re-derives the size, the production and the offset, and the page is
   * refreshed to pick them up. The drawing itself is untouched.
   */
  async function pickEquipment(patch: Partial<typeof chosen>) {
    setPendingEquip(patch);
    setEquipBusy(true);
    const res = await setSolarDesignEquipmentAction({ leadId, ...patch });
    setEquipBusy(false);
    // Either way the override goes: on success the refreshed props carry the
    // new value, on failure the old one was never really replaced.
    if (!res.ok) {
      setPendingEquip(null);
      return toast.error(res.error);
    }
    router.refresh();
    setPendingEquip(null);
  }

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

  const canvasW = loaded?.ok ? loaded.widthPx : DEFAULT_CANVAS_PX;
  const canvasH = loaded?.ok ? loaded.heightPx : DEFAULT_CANVAS_PX;

  const mpp = lat == null ? 0 : metresPerPixel(lat, zoom, 2);
  /**
   * The point a click would land on right now, if any — so the cursor, the
   * rubber band and the click itself all agree about where the trace ends.
   */
  const setbackSnap =
    tool === "setback" ? setbackVertexAt(pending, ghostPoint, setbackSnapM(viewScale, mpp)) : null;
  const selected = blocks.find((b) => b.id === selectedId) ?? null;
  const count = panelCount(blocks);

  const totals = React.useMemo(
    () =>
      systemTotals(blocks, {
        lat,
        moduleRatingW,
        assumptions,
        planeYield: ({ tiltDeg, azimuthDeg }) =>
          tiltDeg == null || azimuthDeg == null
            ? null
            : (measuredYields[`${tiltDeg}|${azimuthDeg}`] ?? null),
      }),
    [blocks, lat, moduleRatingW, assumptions, measuredYields]
  );
  const bestTilt = React.useMemo(() => (lat == null ? 30 : optimalTiltDeg(lat)), [lat]);

  /**
   * Offset, live. The same division the server does on save — kept here so the
   * number a rep watches while drawing is the number that gets stored, rather
   * than a figure that only catches up after a save and a refresh.
   */
  const offsetPct =
    annualUsageKwh && annualUsageKwh > 0
      ? (totals.year1ProductionKwh / annualUsageKwh) * 100
      : null;

  /**
   * Array-to-inverter ratio. Blank without an inverter — 1.2 is not a default.
   *
   * A MICROINVERTER IS ONE PER MODULE, and the catalogue does not say which
   * kind an entry is: both are `kind: "inverter"` with a rated output. Dividing
   * a 26 kW array by a single 290 W Enphase gives 91, which is not a DC/AC
   * ratio, it is a unit error printed with two decimal places.
   *
   * The discriminator used is the one that actually separates them in the real
   * world: a module-level inverter is rated in the same order as the panel it
   * sits under (250–400 W), and the smallest string inverters on the market
   * start around 1.5 kW. So an inverter rated under twice the module is one per
   * module, and the system's AC capacity is its rating times the panel count.
   * Stated as an assumption because it is one — the honest fix is a flag on the
   * catalogue entry, and this is the seam it would replace.
   */
  const inverterRatingW =
    catalogue.inverter.find((i) => i.id === equip.inverterId)?.ratingW ?? null;
  const perModuleInverter =
    !!inverterRatingW && !!moduleRatingW && inverterRatingW < moduleRatingW * 2;
  const inverterKwAc =
    inverterRatingW == null
      ? null
      : perModuleInverter
        ? (inverterRatingW * count) / 1000
        : inverterRatingW / 1000;
  const dcAc =
    inverterKwAc && inverterKwAc > 0 && totals.systemSizeKwDc > 0
      ? totals.systemSizeKwDc / inverterKwAc
      : null;

  /** Every mutation goes through here, so undo has one place to record. */
  const commit = React.useCallback((next: LayoutBlock[]) => {
    setHistory((h) => [...h.slice(-49), blocksRef.current]);
    setBlocks(next);
    setDirty(true);
  }, [setBlocks]);

  const undo = React.useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      setBlocks(h[h.length - 1]);
      setDirty(true);
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
   * prompt fires at least once — a rep who is never told the roof matters will
   * never say which way it faces. After that, arrays inherit from the last one
   * drawn, because the second and third arrays are usually further up the same
   * plane and retyping the pitch three times is how people stop bothering.
   *
   * Shade is deliberately NOT inherited: the whole reason to shade one array
   * and not another is that the tree is only over one of them.
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
    return () => {
      live = false;
    };
  }, [leadId, zoom, lat]);

  /**
   * Open filling the viewport rather than at 1:1.
   *
   * A 1280px canvas inside an 900px-tall screen opens showing the middle
   * quarter of the roof, which is why the old embedded version read as "it
   * gives me the wrong thing" — the house was there, just outside the box.
   */
  const fitted = React.useRef(false);
  React.useEffect(() => {
    const el = viewportRef.current;
    // Deliberately NOT gated on the imagery having loaded. The canvas has a
    // size either way, and a failed tile is exactly when a rep least wants the
    // picture to also be three times the height of the screen.
    if (!el || !loaded) return;
    const fit = () => {
      const f = Math.min(el.clientWidth / canvasW, el.clientHeight / canvasH);
      if (Number.isFinite(f) && f > 0) setViewScale(Math.max(0.2, Math.min(2, f)));
    };
    fit();
    fitted.current = true;
    // A window resized, a laptop undocked, a browser zoom: the roof has to come
    // back to fitting rather than sit half off the bottom of the screen. Once a
    // rep has zoomed in deliberately this stops — refitting under someone who
    // is inspecting a vent is worse than leaving the picture where they put it.
    const ro = new ResizeObserver(() => {
      if (fitted.current) fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [loaded, canvasW, canvasH]);

  /** Any deliberate zoom hands control over: stop refitting behind their back. */
  const zoomBy = React.useCallback((mul: number) => {
    fitted.current = false;
    setViewScale((v) => Math.max(0.15, Math.min(6, v * mul)));
  }, []);

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
      const toPx = (c: { e: number; n: number }) => metresToImagePx(c.e, c.n, mpp, img);
      const trace = (pts: { x: number; y: number }[]) => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
      };

      // Setbacks go UNDER the panels: the point of the band is to show which
      // modules are sitting in it, and a band painted on top hides them.
      for (const s of setbacks) {
        for (const band of setbackBands(s)) {
          trace(band.map(toPx));
          ctx.fillStyle = "rgba(244, 99, 30, 0.28)";
          ctx.fill();
        }
        const line = s.points.map(toPx);
        ctx.beginPath();
        ctx.moveTo(line[0].x, line[0].y);
        for (let i = 1; i < line.length; i++) ctx.lineTo(line[i].x, line[i].y);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "#f4631e";
        ctx.stroke();
      }

      if (opts.chrome && pending && pending.length > 0) {
        // The rubber band snaps HOME when the pointer is over the dot that
        // would close the loop, so a rep can see the shape shut before they
        // commit to it rather than after.
        const tail =
          setbackSnap === "close"
            ? pending[0]
            : setbackSnap === "end"
              ? pending[pending.length - 1]
              : ghostPoint;
        const pts = [...pending, ...(tail ? [tail] : [])].map(toPx);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.setLineDash([8, 6]);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "#fb923c";
        ctx.stroke();
        ctx.setLineDash([]);
        const target =
          setbackSnap === "close" ? 0 : setbackSnap === "end" ? pending.length - 1 : -1;
        pending.map(toPx).forEach((p, i) => {
          const isTarget = i === target;
          ctx.beginPath();
          ctx.arc(p.x, p.y, isTarget ? 9 : 5, 0, Math.PI * 2);
          ctx.fillStyle = "#fb923c";
          ctx.fill();
          if (!isTarget) return;
          // A white ring around the dot a click would land on: the only signal
          // that this click ends the trace instead of extending it.
          ctx.lineWidth = 3;
          ctx.strokeStyle = "#ffffff";
          ctx.stroke();
        });
      }

      for (const b of blocks) {
        const isSel = opts.chrome && b.id === selectedId;
        const lone = b.cols === 1 && b.rows === 1;
        for (const quad of panelCorners(b, moduleMm)) {
          trace(quad.map(toPx));
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
          // The green ghosts: where one more row or column would go, and every
          // hole a removed panel left. Clicking one is how an array is built up
          // module by module without touching a resize grip.
          for (const g of growGhosts(b, moduleMm)) {
            trace(g.corners.map(toPx));
            ctx.fillStyle = "rgba(74, 222, 128, 0.35)";
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = "rgba(22, 163, 74, 0.9)";
            ctx.stroke();
          }
          for (const h of holeQuads(b, moduleMm)) {
            trace(h.corners.map(toPx));
            ctx.fillStyle = "rgba(74, 222, 128, 0.22)";
            ctx.fill();
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = "rgba(22, 163, 74, 0.8)";
            ctx.stroke();
            ctx.setLineDash([]);
          }

          drawFacing(ctx, b, moduleMm, mpp, img);
          const hp = handlePositions(b, moduleMm, mpp, img);
          for (const [pos, colour] of [
            [hp.rotate, "#f4631e"],
            [hp.resize, "#38bdf8"],
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
    [
      blocks,
      setbacks,
      pending,
      ghostPoint,
      setbackSnap,
      selectedId,
      drag,
      moduleMm,
      mpp,
      canvasW,
      canvasH,
    ]
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

  /** A ghost or a hole under this point, for the selected array only. */
  const hitGhost = (
    m: { e: number; n: number }
  ): { kind: "grow"; side: GrowSide } | { kind: "hole"; index: number } | null => {
    const b = blocksRef.current.find((x) => x.id === selectedId);
    if (!b) return null;
    for (const h of holeQuads(b, moduleMm)) {
      if (insideQuad(m, h.corners)) return { kind: "hole", index: h.index };
    }
    for (const g of growGhosts(b, moduleMm)) {
      if (insideQuad(m, g.corners)) return { kind: "grow", side: g.side };
    }
    return null;
  };

  /**
   * The array a click at this point should join, if any.
   *
   * "Nearest" is measured in CELLS of each array's own lattice, not in metres:
   * a click one cell off the end of a long row belongs to that row however far
   * away the array's origin happens to be, and a click a metre from a rotated
   * array may be nowhere near its lattice at all.
   *
   * Two cells is the reach. One is touching, two allows for an aimed click
   * landing in the rail gap, and by three the rep is starting a new array
   * somewhere else on the roof.
   */
  const JOIN_REACH_CELLS = 2;
  const nearestBlockFor = (point: { e: number; n: number }) => {
    let best: { block: LayoutBlock; distance: number } | null = null;
    for (const b of blocksRef.current) {
      const distance = cellDistance(b, cellAt(b, moduleMm, point));
      if (distance > JOIN_REACH_CELLS) continue;
      if (!best || distance < best.distance) best = { block: b, distance };
    }
    return best;
  };

  /** A lone panel centred on a ground point, rather than hung off its corner. */
  const lonePanelAt = (
    m: { e: number; n: number },
    rotationDeg: number,
    orientation: Orientation
  ): LayoutBlock => {
    const { w, h } = panelSizeM(moduleMm, orientation);
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

  /**
   * Finish the setback being traced. Fewer than two points is not a line.
   *
   * `close` puts the first point back on the end, so the run's last segment is
   * the one home to where the trace started. setbackBands skips zero-length
   * segments, so a duplicate costs nothing if the click was already there.
   */
  const finishSetback = React.useCallback(
    (opts?: { close?: boolean }) => {
      const pts = pendingRef.current;
      setPending(null);
      setGhostPoint(null);
      if (!pts || pts.length < 2) return;
      const points = opts?.close ? [...pts, pts[0]] : pts;
      setSetbacks([...setbacksRef.current, { id: uid(), points, widthM: DEFAULT_SETBACK_M }]);
      setDirty(true);
    },
    [setPending, setSetbacks]
  );

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

    if (tool === "setback") {
      // Landing on a point already down ends the trace rather than stacking
      // another point on it. Hit-tested against the click, not against the
      // hover, so this works on a touchscreen too — there is no hover there.
      const on = setbackVertexAt(pendingRef.current, m, setbackSnapM(viewScale, mpp));
      if (on) return finishSetback({ close: on === "close" });
      setPending([...(pendingRef.current ?? []), m]);
      return;
    }

    // Everything this gesture is about to change, so pointerup can record one
    // undo step for the whole of it rather than one per stage.
    gestureBeforeRef.current = blocksRef.current;

    /**
     * A click on a green ghost adds a whole row or column, which is the fastest
     * thing in the tool — so it is tested before the tools are.
     *
     * EXCEPT under Add panel, where it would be the opposite of what was asked
     * for. The ghosts sit exactly where the next panel goes, so a rep aiming a
     * single panel at the end of a row hits one, and gets six. Add panel means
     * one panel; the ghosts stay visible because they still show where the
     * lattice continues, and the click lands on that same cell either way — the
     * difference is only how much of the row comes with it.
     */
    if (tool !== "erase" && tool !== "panel") {
      const g = hitGhost(m);
      if (g) {
        const b = blocksRef.current.find((x) => x.id === selectedId)!;
        commit(
          blocksRef.current.map((x) =>
            x.id !== b.id
              ? x
              : g.kind === "grow"
                ? growBlock(x, g.side, moduleMm)
                : { ...x, omitted: x.omitted.filter((i) => i !== g.index) }
          )
        );
        return;
      }
    }

    if (tool === "erase") {
      const h = hit(m);
      if (h) {
        // A lone panel is deleted outright: knocking out the only cell of a 1x1
        // leaves an empty block on the canvas that can still be clicked.
        //
        // Anything bigger keeps its grid and loses one cell, so the modules
        // either side stay exactly where the rep put them. Re-flowing them to
        // close the gap is what "it doesn't put them all symmetric" describes.
        commit(
          h.block.cols === 1 && h.block.rows === 1
            ? blocksRef.current.filter((b) => b.id !== h.block.id)
            : blocksRef.current.map((b) =>
                b.id === h.block.id ? { ...b, omitted: [...b.omitted, h.index] } : b
              )
        );
        if (selectedId === h.block.id && h.block.cols === 1 && h.block.rows === 1) {
          setSelectedId(null);
        }
      }
      return;
    }

    if (tool === "panel") {
      /**
       * JOIN THE NEAREST ARRAY IF THERE IS ONE.
       *
       * Adding a panel used to drop a free-standing 1x1 wherever the pointer
       * was. Do that six times and the roof carries six independent arrays,
       * each a few centimetres out of line with the others and each showing its
       * own four green ghosts — which is what a scattered layout is, seen from
       * above.
       *
       * A click within a cell or two of an existing array now lands on that
       * array's own lattice: same bearing, same rows, same rail gaps. Further
       * out than that and the rep is plainly starting something new, so they
       * get a fresh panel — aligned to the last array's rotation, as before.
       */
      const host = nearestBlockFor(m);
      if (host) {
        const grown = addPanelAtCell(host.block, cellAt(host.block, moduleMm, m), moduleMm);
        // Where the new panel ended up, asked of the GROWN block: adding a
        // column on the left moves every cell along, so the index it had in the
        // old grid is not the one it has now.
        const landed = cellAt(grown, moduleMm, m);
        const index = landed.row * Math.max(1, grown.cols) + landed.col;
        // The cell was free on the host's own grid, but another array can cross
        // the same ground — nothing goes on top of anything.
        if (wouldOverlap(cellCorners(grown, moduleMm, index), blocksRef.current, moduleMm, host.block.id)) {
          return toast.error("There is already a panel there.");
        }
        commit(blocksRef.current.map((x) => (x.id === host.block.id ? grown : x)));
        setSelectedId(host.block.id);
        setDirty(true);
        return;
      }

      // Match whatever is already up there, so a panel added to a rotated array
      // lands square with it instead of pointing north.
      const near = selected ?? blocksRef.current[blocksRef.current.length - 1];
      const b = lonePanelAt(m, near?.rotationDeg ?? 0, near?.orientation ?? "portrait");
      // Nothing goes on top of anything. A design reached production with two
      // modules 18 cm apart — 82% of one panel on another — and the count, the
      // system size and the price were all built on panels that cannot both be
      // up there.
      if (wouldOverlap(cellCorners(b, moduleMm, 0), blocksRef.current, moduleMm)) {
        return toast.error("There is already a panel there.");
      }
      // No history entry here — pointerup records one for the whole gesture, so
      // a single undo takes back the panel AND the slide that positioned it.
      setBlocks([...blocksRef.current, b]);
      setSelectedId(b.id);
      setDirty(true);
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
      setBlocks(res.blocks);
      setDirty(true);
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
    if (tool === "setback" && pendingRef.current) {
      const m = toMetres(toCanvas(ev));
      return setGhostPoint(m);
    }
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
    // layout as it was when the gesture STARTED.
    if (before) {
      setHistory((h) => [...h.slice(-49), before]);
      setDirty(true);
    }
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
      if (pendingRef.current && (e.key === "Enter" || e.key === "Escape")) {
        e.preventDefault();
        if (e.key === "Escape") {
          setPending(null);
          setGhostPoint(null);
          return;
        }
        return finishSetback();
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
  }, [selected, blocks, commit, undo, canEdit, patchSelected, finishSetback, setPending]);

  /** Leaving with an unsaved array is the one way to lose work here. */
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ── Save ───────────────────────────────────────────────────────────────
  async function save(then?: () => void) {
    setBusy(true);
    const res = await saveSolarLayoutAction({ leadId, blocks, setbacks });
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
      // Re-render WITHOUT selection handles, ghosts or the drag outline: this
      // image is what the homeowner sees.
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
    setDirty(false);
    toast.success(`${res.moduleQty} ${res.moduleQty === 1 ? "panel" : "panels"} saved`);
    router.refresh();
    then?.();
  }

  // ── Render ─────────────────────────────────────────────────────────────
  const groundSpanM = canvasW * mpp;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950 text-white">
      {/* ── Top bar: whose roof, and what it is being built from ─────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 bg-neutral-900 px-3 py-2">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="size-4" /> Proposal
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-white/5 px-2.5 py-1.5">
          <MapPin className="size-4 shrink-0 text-solar" />
          <span className="truncate text-sm">{address || "No address on this deal"}</span>
        </div>
        {/* Equipment is read-only here on purpose: the approved-vendor list
            decides what this system is built from, and it is set on the deal's
            Operations card with the lender that gates it. Showing it is worth
            it — a rep drawing 93 panels needs to see which panel they are. */}
        {/* Chosen HERE, not on a settings page. The panel decides how many fit
            on the roof and what each one is worth, and both are questions you
            are looking at while you draw. The catalogue's starred default is
            the fallback it was always meant to be. */}
        <EquipPicker
          label="Module"
          options={catalogue.module}
          value={equip.moduleId}
          disabled={!canEdit || equipBusy}
          onChange={(id) => void pickEquipment({ moduleId: id })}
        />
        <EquipPicker
          label="Inverter"
          options={catalogue.inverter}
          value={equip.inverterId}
          disabled={!canEdit || equipBusy}
          onChange={(id) => void pickEquipment({ inverterId: id })}
        />
        <EquipPicker
          label="Battery"
          options={catalogue.battery}
          value={equip.batteryId}
          disabled={!canEdit || equipBusy}
          onChange={(id) => void pickEquipment({ batteryId: id })}
        />
        <select
          className="h-8 rounded-md border border-white/15 bg-white/5 px-2 text-xs text-white"
          value={zoom}
          aria-label="Imagery detail"
          onChange={(e) => setZoom(Number(e.target.value) as Zoom)}
        >
          <option className="text-black" value={21}>Closest imagery</option>
          <option className="text-black" value={20}>Wider imagery</option>
        </select>
      </header>

      {/* ── The roof ─────────────────────────────────────────────────────── */}
      {/*
        Two layers, and they must not be the same element. The picture scrolls
        and the controls do not: an `absolute` child of a scrolling box scrolls
        with its content, so a toolbar inside the scroller slides off the screen
        the moment a rep zooms in and pans — exactly when they need it most.
      */}
      <div className="relative flex-1 overflow-hidden bg-neutral-950">
        <div ref={viewportRef} className="absolute inset-0 overflow-auto">
        {/*
          Centred when it fits, scrollable when it does not. `min-w-full` on a
          `w-fit` wrapper is what gets both: zoomed out the wrapper is the size
          of the viewport and the picture sits in the middle of it, zoomed in
          the wrapper is the size of the picture and every edge stays reachable.
          Centring the scroll container itself makes the left overflow
          impossible to scroll back to.
        */}
        <div className="flex h-fit min-h-full w-fit min-w-full items-center justify-center">
        {lat == null ? (
          <div className="flex h-full items-center justify-center p-8">
            <p className="max-w-md rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
              This deal has no rooftop coordinate yet, so the roof cannot be shown. Fix the address
              on the deal and come back — the designer needs to know which house it is drawing on.
            </p>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            data-testid="layout-canvas"
            width={canvasW}
            height={canvasH}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onDoubleClick={() => tool === "setback" && finishSetback()}
            style={{
              width: canvasW * viewScale,
              height: canvasH * viewScale,
              touchAction: "none",
            }}
            className={cn(
              "block max-w-none",
              canEdit && (tool === "draw" || tool === "panel" || tool === "setback") && "cursor-crosshair",
              // Over the dot that ends the trace it stops being a crosshair,
              // because this click is not another corner.
              canEdit && setbackSnap && "!cursor-pointer",
              canEdit && tool === "movePanel" && "cursor-grab",
              canEdit && tool === "erase" && "cursor-cell"
            )}
          />
        )}
        </div>
        </div>

        {/* ── Tools ──────────────────────────────────────────────────────── */}
        {canEdit && lat != null && (
          <div className="pointer-events-none absolute inset-0">
            <div className="pointer-events-auto absolute left-3 top-3 w-44 overflow-hidden rounded-lg border border-black/10 bg-white text-neutral-900 shadow-lg">
              {(
                [
                  ["draw", "Draw array", Square],
                  ["panel", "Add panel", Plus],
                  ["select", "Move array", MousePointer2],
                  ["movePanel", "Move panel", Move],
                  ["erase", "Remove panels", Eraser],
                  ["setback", "Draw setbacks", Ruler],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={tool === id}
                  onClick={() => {
                    if (id !== "setback" && pendingRef.current) finishSetback();
                    setTool(id);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium",
                    tool === id ? "bg-solar text-solar-foreground" : "hover:bg-neutral-100"
                  )}
                >
                  <Icon className="size-4" /> {label}
                </button>
              ))}
              {selected && (
                <>
                  <div className="border-t border-neutral-200" />
                  <button
                    type="button"
                    onClick={() => { setTiltOpen((v) => !v); setShadeOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-neutral-100"
                  >
                    <Compass className="size-4" /> Set tilt
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShadeOpen((v) => !v); setTiltOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-neutral-100"
                  >
                    <Sun className="size-4" /> Set shading
                  </button>
                </>
              )}
            </div>

            {/* Tilt and shade sit beside the toolbar, not in a modal: both are
                things you judge by watching the production figure move, and a
                dialog over the roof hides the array you are judging. */}
            {selected && tiltOpen && (
              <div className="pointer-events-auto absolute left-52 top-3 w-64 rounded-lg border border-black/10 bg-white p-3 text-neutral-900 shadow-lg">
                <SliderRow
                  label="Pitch (tilt)"
                  hint={selected.tiltDeg == null ? "not set" : `${selected.tiltDeg}°`}
                  value={selected.tiltDeg ?? 0}
                  min={0}
                  max={60}
                  step={0.5}
                  onChange={(v) => patchSelected({ tiltDeg: v })}
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {COMMON_PITCHES.slice(0, 6).map((rise) => (
                    <button
                      key={rise}
                      type="button"
                      onClick={() => patchSelected({ tiltDeg: pitchToTiltDeg(rise) })}
                      className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] hover:bg-neutral-100"
                    >
                      {rise}/12
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => patchSelected({ tiltDeg: 0 })}
                    className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] hover:bg-neutral-100"
                  >
                    Flat
                  </button>
                </div>
              </div>
            )}

            {selected && shadeOpen && (
              <div className="pointer-events-auto absolute left-52 top-3 w-64 rounded-lg border border-black/10 bg-white p-3 text-neutral-900 shadow-lg">
                <SliderRow
                  label="Shading"
                  hint={`${selected.shadePct ?? 0}%`}
                  value={selected.shadePct ?? 0}
                  min={0}
                  max={100}
                  step={1}
                  onChange={(v) => patchSelected({ shadePct: v })}
                  stepper
                />
                <div className="mt-1 flex justify-between text-[10px] text-neutral-500">
                  <span>No shade</span>
                  <span>50%</span>
                  <span>Full shade</span>
                </div>
                <p className="mt-2 text-[11px] text-neutral-600">
                  What the trees and neighbouring roofs take off THIS array. The production figure
                  moves as you drag it.
                </p>
              </div>
            )}

            {/* ── The numbers, live ──────────────────────────────────────── */}
            <div className="pointer-events-auto absolute right-3 top-3 flex overflow-hidden rounded-lg border border-black/10 bg-white text-neutral-900 shadow-lg">
              <Metric label="Size" value={moduleRatingW ? `${totals.systemSizeKwDc.toFixed(2)} kW` : "—"} />
              <Metric
                label="Offset"
                value={offsetPct == null ? "—" : `${offsetPct.toFixed(0)}%`}
                tone={offsetPct == null ? undefined : offsetPct >= 90 ? "good" : "warn"}
                title={offsetPct == null ? "No annual usage on the Energy step yet" : undefined}
              />
              <Metric
                label={totals.measuredArrays > 0 ? "Production" : "Est. Production"}
                value={moduleRatingW ? `${totals.year1ProductionKwh.toLocaleString()} kWh` : "—"}
                title={
                  totals.measuredArrays > 0
                    ? `${totals.measuredArrays} of ${totals.arrays.filter((a) => a.panels > 0).length} arrays simulated against this site's own weather record (PVWatts). The rest use the company's market average.`
                    : "The company's market-average yield. Save the layout to simulate these planes against this site's own weather record."
                }
              />
              <Metric
                label="DC/AC"
                value={dcAc == null ? "—" : dcAc.toFixed(2)}
                title={
                  dcAc == null
                    ? "No inverter on this design yet"
                    : perModuleInverter
                      ? `Module-level inverters: ${count} × ${inverterRatingW} W AC`
                      : `String inverter: ${(inverterKwAc ?? 0).toFixed(2)} kW AC`
                }
              />
              <Metric label="Panels" value={String(count)} testId="panel-count" />
            </div>

            {/* One line, and only when something is actually wrong. */}
            {(totals.unorientedArrays > 0 || !moduleRatingW) && (
              <div className="pointer-events-auto absolute right-3 top-20 max-w-sm rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 shadow-lg">
                {!moduleRatingW ? (
                  <>
                    <strong>No default panel in the catalogue.</strong> Size, production and offset
                    stay at zero until there is one — a panel count without a wattage is not a
                    system size.{" "}
                    <Link href="/portal/settings/solar-equipment" className="font-medium underline">
                      Add a module in Settings
                    </Link>
                    .
                  </>
                ) : (
                  <>
                    <strong>
                      {totals.unorientedArrays}{" "}
                      {totals.unorientedArrays === 1 ? "array has" : "arrays have"} no facing or
                      pitch.
                    </strong>{" "}
                    They earn the generic market yield — the same kWh a south roof would.
                    An array drawn along a ridge faces square off it, but off which side is
                    something only you can see. Select it and press <em>Off the rows</em>, then
                    flip it if the arrow points the wrong way.
                  </>
                )}
              </div>
            )}

            {imageState === "failed" && (
              <div className="pointer-events-auto absolute bottom-3 left-3 max-w-sm rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 shadow-lg">
                The satellite image did not load — try the wider imagery, or check the Maps key.
                Panels you draw are still saved against the real coordinates.
              </div>
            )}

            {pending && (
              <div className="pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-neutral-900 px-4 py-2 text-xs text-white shadow-lg">
                Click along the edge · <strong>click the first dot to close</strong> · double-click
                or Enter to finish · Esc to cancel
              </div>
            )}

            {/* ── Zoom ───────────────────────────────────────────────────── */}
            <div className="pointer-events-auto absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-lg border border-black/10 bg-white text-neutral-900 shadow-lg">
              <button
                type="button"
                aria-label="Zoom in"
                className="px-2 py-1.5 hover:bg-neutral-100"
                onClick={() => zoomBy(1.25)}
              >
                <ZoomIn className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Zoom out"
                className="border-t border-neutral-200 px-2 py-1.5 hover:bg-neutral-100"
                onClick={() => zoomBy(1 / 1.25)}
              >
                <ZoomOut className="size-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── The selected array ───────────────────────────────────────────── */}
      {selected && canEdit && (
        <section className="shrink-0 border-t border-white/10 bg-neutral-900 px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="font-medium">
              {selected.cols === 1 && selected.rows === 1
                ? "Panel"
                : `Array · ${selected.cols} × ${selected.rows}`}
            </span>

            <label className="flex items-center gap-1.5 text-xs text-white/70">
              Grid angle
              <input
                type="number"
                step="1"
                aria-label="Grid angle"
                value={Math.round(selected.rotationDeg)}
                onChange={(e) => patchSelected({ rotationDeg: Number(e.target.value) || 0 })}
                className="h-7 w-16 rounded border border-white/20 bg-white/10 px-1.5 text-sm text-white"
              />
            </label>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 border-white/20 bg-white/10 text-white hover:bg-white/20"
              onClick={() =>
                patchSelected({
                  orientation: selected.orientation === "portrait" ? "landscape" : "portrait",
                })
              }
            >
              {selected.orientation === "portrait" ? "Portrait" : "Landscape"}
            </Button>

            <label className="flex items-center gap-1.5 text-xs text-white/70">
              Facing
              <input
                type="number"
                step="5"
                min={0}
                max={359}
                placeholder="—"
                aria-label="Facing (azimuth)"
                value={selected.azimuthDeg ?? ""}
                onChange={(e) =>
                  patchSelected({ azimuthDeg: e.target.value === "" ? null : Number(e.target.value) })
                }
                className="h-7 w-16 rounded border border-white/20 bg-white/10 px-1.5 text-sm text-white"
              />
              <span className="w-7 font-medium text-white">
                {selected.azimuthDeg == null ? "—" : compassLabel(selected.azimuthDeg)}
              </span>
            </label>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 border-white/20 bg-white/10 text-white hover:bg-white/20"
              title="Face square off the rows — the down-slope direction for an array aligned to the ridge."
              onClick={() => patchSelected({ azimuthDeg: norm360(selected.rotationDeg + 90) })}
            >
              <Compass className="size-4" /> Off the rows
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 border-white/20 bg-white/10 text-white hover:bg-white/20"
              onClick={() => patchSelected({ azimuthDeg: norm360((selected.azimuthDeg ?? 0) + 180) })}
            >
              Flip 180°
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 border-white/20 bg-white/10 text-white hover:bg-white/20"
              title="Due south at this site's optimal tilt — for a ground mount or a tilt-up frame."
              onClick={() => patchSelected({ azimuthDeg: 180, tiltDeg: bestTilt })}
            >
              Best here (S {bestTilt}°)
            </Button>

            <span className="text-xs text-white/60">
              Pitch {selected.tiltDeg == null ? "—" : `${selected.tiltDeg}°`} · Shade{" "}
              {selected.shadePct ?? 0}%
              {selected.azimuthDeg != null && selected.tiltDeg != null && (
                <>
                  {" "}
                  · this plane returns{" "}
                  <strong data-testid="orientation-factor" className="text-white">
                    {(arrayFactor(totals, selected.id) * 100).toFixed(0)}%
                  </strong>{" "}
                  of the site&apos;s best
                </>
              )}
            </span>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-auto h-7 text-white/70 hover:bg-white/10 hover:text-white"
              onClick={() => {
                commit(blocks.filter((b) => b.id !== selected.id));
                setSelectedId(null);
              }}
            >
              <Trash2 className="size-4" />
              {selected.cols === 1 && selected.rows === 1 ? "Delete panel" : "Delete array"}
            </Button>
          </div>
        </section>
      )}

      {/* ── Commit ───────────────────────────────────────────────────────── */}
      <footer className="flex shrink-0 items-center gap-2 border-t border-white/10 bg-neutral-900 px-3 py-2">
        <span className="text-xs text-white/50">
          {setbacks.length > 0 && `${setbacks.length} setback${setbacks.length === 1 ? "" : "s"} · `}
          {groundSpanM > 0 && `picture is ${groundSpanM.toFixed(0)} m across · panels drawn to scale`}
        </span>
        {canEdit && (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-auto h-8 text-white/70 hover:bg-white/10 hover:text-white"
              disabled={history.length === 0}
              onClick={undo}
            >
              <RotateCcw className="size-4" /> Undo
            </Button>
            {/*
              For a roof that has already accumulated strays. Adding panels used
              to drop a free-standing module wherever the pointer was, so a
              deliberate row plus a few aimed clicks became seven arrays — each
              asking separately for a facing and a pitch, some of them stacked
              on the row.

              A button rather than something the save does quietly: this moves a
              rep's panels, and rearranging somebody's roof without being asked
              is worse than leaving it untidy. It goes through the same undo as
              everything else.
            */}
            {blocks.length > 1 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 text-white/70 hover:bg-white/10 hover:text-white"
                title="Fold arrays that sit on the same grid into one, and remove panels stacked on top of others."
                onClick={() => {
                  const result = tidyBlocks(blocks, moduleMm);
                  if (result.merged === 0 && result.dropped === 0) {
                    return toast.success("Nothing to tidy — no stacked panels, no split arrays.");
                  }
                  commit(result.blocks);
                  setSelectedId(null);
                  toast.success(
                    [
                      result.merged > 0 &&
                        `${result.merged} ${result.merged === 1 ? "array" : "arrays"} folded in`,
                      result.dropped > 0 &&
                        `${result.dropped} stacked ${result.dropped === 1 ? "panel" : "panels"} removed`,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  );
                }}
              >
                <Wand2 className="size-4" /> Tidy layout
              </Button>
            )}
            {setbacks.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 text-white/70 hover:bg-white/10 hover:text-white"
                onClick={() => {
                  setSetbacks([]);
                  setDirty(true);
                }}
              >
                Clear setbacks
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 border-white/20 bg-white/10 text-white hover:bg-white/20"
              onClick={() => save()}
              disabled={busy}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Save
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8"
              disabled={busy}
              onClick={() => save(() => router.push(backHref))}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Update proposal
            </Button>
          </>
        )}
        {!canEdit && (
          <span className="ml-auto text-xs text-white/50">Read only — you cannot edit this deal.</span>
        )}
      </footer>
    </div>
  );
}

/** One live figure in the top-right strip. */
function Metric({
  label,
  value,
  tone,
  title,
  testId,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn";
  title?: string;
  testId?: string;
}) {
  return (
    <div className="border-r border-neutral-200 px-3 py-1.5 last:border-r-0" title={title}>
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div
        data-testid={testId}
        className={cn(
          "font-display text-sm font-semibold tabular-nums",
          tone === "good" && "text-emerald-600",
          tone === "warn" && "text-amber-600"
        )}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * One equipment slot in the top bar, as a picker.
 *
 * It used to be a read-only chip that said "not set" and pointed at another
 * screen. On a catalogue with fifty modules and none starred as the default,
 * that left a rep with no way to put a panel on the design at all — every
 * figure sat at zero behind a warning about Settings.
 *
 * A native select, deliberately: this list runs to dozens of items, it is
 * searched by typing, and the browser's own control does that on a phone in a
 * driveway better than anything rebuilt here.
 */
function EquipPicker({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  options: EquipOption[];
  value: string | null;
  disabled: boolean;
  onChange: (id: string | null) => void;
}) {
  const id = `equip-${label.toLowerCase()}`;
  const current = options.find((o) => o.id === value) ?? null;

  return (
    <div className="hidden items-center gap-1.5 rounded-md bg-white/5 px-2 py-1 text-xs lg:flex">
      <label htmlFor={id} className="text-white/45">
        {label}
      </label>
      <select
        id={id}
        className="max-w-[13rem] truncate rounded bg-transparent py-0.5 text-white outline-none disabled:opacity-60"
        value={value ?? ""}
        disabled={disabled || options.length === 0}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option className="text-black" value="">
          {options.length === 0 ? "none in the catalogue" : "not set"}
        </option>
        {options.map((o) => (
          <option key={o.id} className="text-black" value={o.id}>
            {o.label}
            {o.ratingW ? ` · ${o.ratingW} W` : ""}
          </option>
        ))}
      </select>
      {/* A module with no width and length is drawn at a generic size, so the
          count that comes off the roof is for a panel nobody sells. Worth
          saying on the spot rather than in a settings page nobody is on. */}
      {current && current.sized === false && (
        <span title="This panel has no width and length on file, so the roof is laid out with a generic module." className="text-amber-300">
          no size
        </span>
      )}
    </div>
  );
}

/** A labelled slider with an optional +/- stepper, for tilt and shade. */
function SliderRow({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  stepper,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  stepper?: boolean;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div>
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <span className="text-xs font-semibold tabular-nums">{hint}</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        {stepper && (
          <button
            type="button"
            aria-label={`Decrease ${label}`}
            className="rounded border border-neutral-300 p-1 hover:bg-neutral-100"
            onClick={() => onChange(clamp(value - step))}
          >
            <Minus className="size-3.5" />
          </button>
        )}
        <input
          type="range"
          aria-label={label}
          className="flex-1 accent-[#f4631e]"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
        />
        {stepper && (
          <button
            type="button"
            aria-label={`Increase ${label}`}
            className="rounded border border-neutral-300 p-1 hover:bg-neutral-100"
            onClick={() => onChange(clamp(value + step))}
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
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
