"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft, ChevronDown, Compass, Crosshair, Eraser, Hand, Loader2, MapPin, Maximize2,
  Minus, MousePointer2, Move, Pentagon, Plus, Layers, RotateCcw, RotateCw, Ruler,
  Scissors, Search, Square, Sun, Trash2, Wand2, ZoomIn, ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  metresPerPixel,
  metresToImagePx,
  absorbPanel,
  blockPanelCount,
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
  DESIGNER_LAYOUT_FILENAME,
  type GrowSide,
  type LayoutBlock,
  type LayoutSetback,
  type ModuleMm,
  type Orientation,
} from "@/lib/solar-layout";
import { systemTotals } from "@/lib/solar-arrays";
import {
  BASEMAP_HINT,
  BASEMAP_LABEL,
  BASEMAP_SOURCES,
  ESRI_MAX_ZOOM,
  GOOGLE_MAX_ZOOM,
  MIN_ZOOM,
  SUPERTILE_RADIUS,
  SUPERTILE_PX,
  attribution,
  frameOn,
  isUpsampled,
  latLngToMetres,
  singleImageView,
  metresToLatLng,
  type BasemapSource,
  type MapView,
} from "@/lib/map-view";
import { useBasemap, useDevicePixelRatio } from "@/components/portal/solar-designer/use-basemap";
import {
  applyPlanes,
  assignPlanes,
  segmentHulls,
  type RoofPlanes,
} from "@/lib/solar-roof-planes";
import { autoFillRoof, pruneToCount, pruneToTarget } from "@/lib/solar-autofill";
import {
  DEFAULT_FACE_INSET_M,
  fillFace,
  polygonCentroid,
  splitPolygon,
  type RoofFace,
} from "@/lib/solar-face-fill";
import {
  compassLabel,
  optimalTiltDeg,
  orientationFactor,
  pitchToTiltDeg,
  COMMON_PITCHES,
} from "@/lib/solar-orientation";
import { withProductionMargin, type YieldAssumptions } from "@/lib/solar-money";
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

/**
 * The customer's layout picture, in pixels a side.
 *
 * FIXED, and square. The canvas is the size of the rep's window now, so
 * exporting "what is on screen" would hand the proposal a different aspect
 * ratio for every laptop in the company.
 */
const EXPORT_PX = 1280;

/**
 * How close to a traced setback point a click has to land to count as being ON
 * it, in SCREEN pixels — the dot is the target, and the dot is the same size on
 * screen however far the picture is zoomed.
 */
const SETBACK_SNAP_PX = 12;

/**
 * That radius in ground metres, which is what the trace is stored in.
 *
 * It used to divide by a separate view scale, because the canvas was a fixed
 * 1280 px picture stretched to fit the screen. The canvas is now the screen, so
 * its pixels ARE CSS pixels and `mpp` alone carries the whole conversion.
 */
function setbackSnapM(mpp: number) {
  return SETBACK_SNAP_PX * mpp;
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

/**
 * EVERY TOOL HAS A BUTTON, and the pointer can do all of them without one.
 *
 * These were collapsed to three on the theory that five of the six were the
 * same gesture wearing different hats, which is true of the CODE and beside the
 * point for the person using it. A rep who has learned where "Remove panels"
 * lives does not want to be told it is now Alt — they want the button. The
 * first thing back from the field was "I can't find things".
 *
 * So the palette is whole again, and the modifiers stay as accelerators on the
 * pointer for whoever wants them. Nothing is only reachable by holding a key.
 */
type Tool =
  | "select" | "draw" | "face" | "panel" | "movePanel" | "erase" | "setback"
  /** Drag the picture. Also space-held, middle-drag and two-finger scroll. */
  | "pan"
  /** Put the deal's own coordinate on the right roof. See `movePin`. */
  | "pin";

type Drag =
  | { kind: "new"; fromX: number; fromY: number; toX: number; toY: number }
  | {
      kind: "move";
      id: string;
      fromE: number;
      fromN: number;
      originE: number;
      originN: number;
      /** Where the press landed, so a click can be told from a drag. */
      startX: number;
      startY: number;
      moved: boolean;
    }
  /**
   * A panel pressed but not yet pulled out.
   *
   * THIS STATE IS THE FIX for panels falling out of arrays. Detaching used to
   * happen on pointer-DOWN: the panel left the grid before the pointer had
   * moved a single pixel, so a plain click — selecting an array, checking what
   * was under the cursor, a twitchy trackpad — permanently split a module out
   * of the bank it belonged to, leaving a 1x1 block sitting exactly where the
   * cell had been. Identical on screen. Priced the same. Separately asking to
   * be told which way it faced.
   *
   * Now the press only REMEMBERS which panel it was on. The detach happens on
   * the first move past `DETACH_TRAVEL_PX`, which is to say when the rep has
   * actually started dragging it somewhere.
   */
  | {
      kind: "pendingPanel";
      id: string;
      index: number;
      fromE: number;
      fromN: number;
      startX: number;
      startY: number;
    }
  | { kind: "rotate"; id: string }
  | { kind: "resize"; id: string }
  /** Swinging the facing arrow: which way this plane looks. */
  | { kind: "facing"; id: string }
  | null;

const uid = () => `b${Math.random().toString(36).slice(2, 10)}`;

/**
 * The letter that picks each tool.
 *
 * ONE table, read by both the palette and the keydown handler — a hint printed
 * on a button that does not match the key that fires is worse than no hint.
 */
const TOOL_KEYS: Record<Tool, string> = {
  select: "v",
  face: "r",
  draw: "a",
  panel: "d",
  movePanel: "g",
  erase: "e",
  setback: "s",
  pan: "h",
  pin: "k",
};

/** Nudge distances. A rail is 2 cm, so 5 cm is "just off" and 50 cm is "over a bit". */
const NUDGE_FINE_M = 0.05;
const NUDGE_COARSE_M = 0.5;

/**
 * How far a pointer must travel before a press counts as a drag, in SCREEN
 * pixels — the number that decides a click from a grab.
 *
 * Four is about the slop in a hand resting on a trackpad and well under a
 * deliberate movement. Screen pixels rather than ground metres because it is a
 * fact about hands, not about roofs: the same wobble must not detach a panel at
 * one zoom and select it at another.
 */
const DETACH_TRAVEL_PX = 4;

/**
 * How close to the arrowhead a press has to land to grab the facing, canvas px.
 *
 * The head itself is about nineteen pixels long and eight wide. Requiring a
 * press inside it makes the one control on this screen that is meant to be
 * grabbed the hardest thing on it to hit — so the target is a good deal bigger
 * than the drawing, the way a grip always should be.
 *
 * It cannot be much bigger than this: the head sits at the edge of its array,
 * and every pixel added is a pixel where a press meant for a panel swings the
 * facing instead. Twenty-five canvas pixels is about eighty centimetres of
 * roof — under a third of a module.
 */
const FACING_GRIP_PX = 22;

/**
 * The facing snaps to this, in degrees, unless Shift is held.
 *
 * Five, because a roof does not face 187 degrees to anybody who has to say it
 * out loud, and a figure with a decimal in it reads as a measurement rather
 * than the judgement it is.
 */
const FACING_SNAP_DEG = 5;

/** Within this of a compass point, the arrow takes the compass point. */
const COMPASS_PULL_DEG = 4;

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
  lng,
  moduleMm,
  moduleRatingW,
  catalogue,
  chosen,
  annualUsageKwh,
  measuredYields,
  initialBlocks,
  initialSetbacks,
  roofPlanes,
  groundMount,
  assumptions,
  canEdit,
  backHref,
}: {
  leadId: string;
  /** Shown in the top bar: the rep needs to know whose roof this is. */
  address: string;
  /** Null when the deal has no rooftop coordinate — the roof cannot be shown. */
  lat: number | null;
  /**
   * The other half of the coordinate. Needed now that the picture can be moved:
   * a pannable map has to know where it IS, not just how big a metre is there.
   */
  lng: number | null;
  moduleMm: ModuleMm;
  moduleRatingW: number | null;
  /** Everything this company sells, for the three pickers in the top bar. */
  catalogue: { module: EquipOption[]; inverter: EquipOption[]; battery: EquipOption[] };
  /** What this design already names. Null in a slot means nothing chosen. */
  chosen: {
    moduleId: string | null;
    inverterId: string | null;
    batteryId: string | null;
    /** How many batteries. 0 or absent reads as one, the way every reader does. */
    batteryQty: number;
  };
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
  /**
   * The building's own roof planes, when the cache already held them.
   *
   * Null is not "this roof has none" — it is "nobody has asked yet", and the
   * designer asks in the background rather than making the page wait on Google.
   */
  roofPlanes: RoofPlanes | null;
  /** A ground mount is racked in a yard, so the roof has nothing to say about it. */
  groundMount: boolean;
  /** The company's yield and derate, so the preview matches what the server saves. */
  assumptions: YieldAssumptions;
  canEdit: boolean;
  /** Where "Update proposal" and the back arrow return to. */
  backHref: string;
}) {
  const router = useRouter();
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
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
  /**
   * THE DESIGN AS THE SERVER LAST HANDED IT OVER, frozen at mount.
   *
   * The way back from a roof that has gone empty. Undo covers one slip, but a
   * rep who has clicked around for a minute and looked up to find their twenty
   * five panels gone does not want to guess how many times to press it — and if
   * the wipe happened before the first history entry there is nothing to press.
   *
   * A ref rather than the prop, because `router.refresh()` re-renders this
   * component with fresh props: after a save, `initialBlocks` becomes whatever
   * was just saved, and the escape hatch would quietly start pointing at the
   * damage instead of away from it.
   */
  const savedRef = React.useRef<LayoutBlock[]>(initialBlocks);

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

  /**
   * What the trace in progress will become when it closes.
   *
   * A ref as well as state for the same reason the layout keeps one: the click
   * that closes a shape and the code that turns it into something run in the
   * same task, before any re-render.
   */
  const [traceKind, setTraceKindState] = React.useState<"setback" | "face">("setback");
  const traceKindRef = React.useRef<"setback" | "face">("setback");
  const setTraceKind = React.useCallback((next: "setback" | "face") => {
    traceKindRef.current = next;
    setTraceKindState(next);
  }, []);

  /**
   * How far in from a traced edge panels have to stay, metres.
   *
   * A fire setback is a rule with a number, and the number differs by
   * jurisdiction — so it is a control rather than a constant. Three feet is
   * what most of them ask for and what `DEFAULT_SETBACK_M` already encodes.
   */
  const [faceInsetM, setFaceInsetMState] = React.useState(DEFAULT_FACE_INSET_M);
  const faceInsetRef = React.useRef(DEFAULT_FACE_INSET_M);
  const setFaceInsetM = React.useCallback((next: number) => {
    faceInsetRef.current = next;
    setFaceInsetMState(next);
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

  /**
   * Drop a trace nobody came back to.
   *
   * A HALF-DRAWN OUTLINE IS ARMED, and at two points in the corner of the
   * picture it is also nearly invisible. Reported as "the roof face keeps
   * making this", with a sky-blue polygon sprawling across three houses: the
   * rep had put two corners down, gone to Fill this roof, looked at what
   * landed, and clicked the roof again — and that click extended the outline
   * they had left behind rather than starting a new one. Two corners here, two
   * corners there, and the shape spans the street.
   *
   * Abandoned rather than closed. A tool change FINISHES a trace, because
   * reaching for another tool says the shape is done; pressing a button that
   * lays out the roof says the opposite, and turning the leftovers into an
   * array nobody asked for would be worse than losing three clicks.
   */
  const abandonTrace = React.useCallback(() => {
    if (!pendingRef.current) return;
    setPending(null);
    setGhostPoint(null);
  }, [setPending]);

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
  /**
   * THE POINTER IS THE DEFAULT, not a drawing tool.
   *
   * It used to open in Draw array, which meant the first press on a roof with
   * panels already on it dragged a rectangle over them rather than selecting
   * the array under the finger. A designer reopened to check a number should
   * not be one click away from drawing over the design.
   */
  const [tool, setTool] = React.useState<Tool>("select");

  /**
   * WHERE THE PICTURE IS, AND HOW BIG A METRE IS ON IT.
   *
   * These two replace the old `zoom: 20 | 21` and `viewScale`, and the change
   * is not cosmetic. The old pair could only describe one framing — the deal's
   * geocoded point, at one of two magnifications — because the imagery was a
   * single photograph centred there. A rep whose house sat outside that frame
   * had no move to make.
   *
   * `centre` is in ground metres from the deal's coordinate, the same units
   * every panel is stored in, so panning is arithmetic rather than a second
   * coordinate system. `mpp` is metres per CSS pixel, continuous rather than a
   * pair of steps, so zoom can rest wherever the roof reads best.
   */
  const [centre, setCentre] = React.useState<{ e: number; n: number }>({ e: 0, n: 0 });
  const [mpp, setMpp] = React.useState(() =>
    lat == null ? 0.03 : metresPerPixel(lat, GOOGLE_MAX_ZOOM, 2)
  );
  /** Which vendor's imagery is behind the panels. See BASEMAP_HINT. */
  const [source, setSource] = React.useState<BasemapSource>("satellite");

  /**
   * The deal's coordinate, which every stored panel is measured from — held as
   * STATE because the rep can correct it.
   *
   * Moving the pin re-bases the whole drawing so the panels stay on the roof
   * they were drawn on (see `movePin`), which means the origin after a
   * correction is genuinely a different point from the one the props carried.
   */
  const [originLat, setOriginLat] = React.useState<number | null>(lat);
  const [originLng, setOriginLng] = React.useState<number | null>(lng);
  const origin = React.useMemo(
    () => (originLat == null || originLng == null ? null : { lat: originLat, lng: originLng }),
    [originLat, originLng]
  );
  /** Has the rep moved it? Only then does the save carry a new coordinate. */
  const pinMoved = originLat !== lat || originLng !== lng;
  const [showPin, setShowPin] = React.useState(true);

  /**
   * A pan in progress, held as a ref because it updates on every pointer move
   * and a state round trip per frame is a stuttering map.
   */
  const panRef = React.useRef<{ x: number; y: number } | null>(null);
  const [panning, setPanning] = React.useState(false);
  /** Space turns any tool into the hand, the way every drawing tool does it. */
  const [spaceHeld, setSpaceHeld] = React.useState(false);

  /** The canvas, in CSS pixels — it is the size of the screen it is on. */
  const [canvas, setCanvas] = React.useState({ w: 1280, h: 720 });
  const canvasW = canvas.w;
  const canvasH = canvas.h;

  const [dirty, setDirty] = React.useState(false);
  const [shadeOpen, setShadeOpen] = React.useState(false);
  /** The tool rail sits ON the roof, so it has to be possible to get it off. */
  const [railOpen, setRailOpen] = React.useState(true);
  const [tiltOpen, setTiltOpen] = React.useState(false);
  const [showPlanes, setShowPlanes] = React.useState(false);

  /**
   * What the building itself says about its roof.
   *
   * `null` while nobody has asked, and while the asking is in flight. The whole
   * screen works without it — this only ever ADDS a facing to an array that had
   * none, so every state below, including the one where Google has never heard
   * of the address, leaves the designer exactly as it was before roof planes
   * existed.
   */
  const [planes, setPlanesState] = React.useState<RoofPlanes | null>(roofPlanes);
  const planesRef = React.useRef<RoofPlanes | null>(roofPlanes);
  const setPlanes = React.useCallback((next: RoofPlanes | null) => {
    // A ref as well as state, for the same reason the layout keeps one: the
    // pointer handlers that create an array run before any re-render, and an
    // array created from a stale copy is an array with no facing.
    planesRef.current = next;
    setPlanesState(next);
  }, []);
  const [roofState, setRoofState] = React.useState<"idle" | "looking" | "read" | "none">(() =>
    // Decided at the first render rather than pushed in by the effect below:
    // whether the roof is about to be looked up is knowable from the props, and
    // setting it from inside the effect is a second render to say so.
    roofPlanes ? "read" : groundMount || lat == null ? "idle" : "looking"
  );
  /** How many arrays gained a facing off the roof in THIS session, so the
   *  screen can ask for the save that would keep it. */
  const [justFilled, setJustFilled] = React.useState(0);

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
    // Picking a battery writes the company's standard quantity, so hold the
    // count the SERVER wrote on screen until the refresh carries it in. Without
    // this the box reads "1" for as long as the round trip takes, which is the
    // one number the rep is most likely to believe.
    setPendingEquip({ ...patch, batteryQty: res.batteryQty });
    router.refresh();
    setPendingEquip(null);
  }

  const [busy, setBusy] = React.useState(false);

  /**
   * The imagery, and everything about fetching it — see use-basemap.
   *
   * Note what is NOT here any more: the canvas no longer takes its size from
   * whatever picture happened to arrive. It used to, because the single Static
   * Maps image was silently clamped to a square and the only trustworthy
   * dimensions were the ones that came back. The canvas is now the size of the
   * screen and the imagery is fitted to IT, which is the right way round.
   */
  const basemap = useBasemap({ leadId, origin, source });
  const imageState: "loading" | "ready" | "failed" = basemap.failed
    ? "failed"
    : basemap.ready
      ? "ready"
      : "loading";

  /** Everything the projection needs, in one value. */
  const view: MapView = React.useMemo(
    () => ({ centreE: centre.e, centreN: centre.n, mpp, widthPx: canvasW, heightPx: canvasH }),
    [centre, mpp, canvasW, canvasH]
  );

  /**
   * How far the imagery reaches, in metres from the deal.
   *
   * The pan is bounded because the IMAGERY ROUTE is bounded: a supertile is
   * addressed as an offset from a lead so that it can never be asked for an
   * arbitrary coordinate. Stopping the view at the same edge means a rep hits a
   * limit rather than a wall of blank tiles.
   */
  const panLimitM = React.useMemo(
    () =>
      lat == null
        ? 0
        : (SUPERTILE_RADIUS + 0.5) * SUPERTILE_PX * metresPerPixel(lat, GOOGLE_MAX_ZOOM, 2),
    [lat]
  );
  /**
   * The point a click would land on right now, if any — so the cursor, the
   * rubber band and the click itself all agree about where the trace ends.
   *
   * BOTH TRACES, because both end the same way. This was computed for setbacks
   * only, while the instruction under a face read "click the first dot to
   * close" — so the one gesture the hint named was the one gesture with no
   * cursor, no ring and no rubber band snapping home to say it had been
   * understood. A rep aiming at that dot and missing it by four pixels got
   * another corner instead, silently, and went round again.
   */
  const traceSnap =
    tool === "setback" || tool === "face"
      ? setbackVertexAt(pending, ghostPoint, setbackSnapM(mpp))
      : null;
  const selected = blocks.find((b) => b.id === selectedId) ?? null;
  const count = panelCount(blocks);
  /**
   * What the roof held when this screen opened — see `savedRef`.
   *
   * Computed from the prop, not from the ref: a ref read during render is a
   * render that cannot be replayed, and this value is the same either way
   * because the ref is only ever the initial prop.
   */
  const savedPanels = React.useMemo(() => panelCount(initialBlocks), [initialBlocks]);

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

  /**
   * Every mutation goes through here, so undo has one place to record — and,
   * for the same reason, one place to let go of a trace nobody finished. The
   * trace that closes into an array has already cleared itself by the time it
   * gets here (see `finishTrace`), so this only ever catches the leftovers of
   * one the rep walked away from.
   */
  const commit = React.useCallback((next: LayoutBlock[]) => {
    abandonTrace();
    setHistory((h) => [...h.slice(-49), blocksRef.current]);
    setBlocks(next);
    setDirty(true);
  }, [abandonTrace, setBlocks]);

  const undo = React.useCallback(() => {
    abandonTrace();
    setHistory((h) => {
      if (h.length === 0) return h;
      setBlocks(h[h.length - 1]);
      setDirty(true);
      return h.slice(0, -1);
    });
  }, [abandonTrace, setBlocks]);

  // ── Filling the roof ──────────────────────────────────────────────────────
  /**
   * What ONE panel on a given array makes in a year.
   *
   * The ranking the fill and both prunes are ordered by, and deliberately the
   * same arithmetic `systemTotals` prices the system with — a measured plane on
   * its own simulated yield, an undescribed one on the market average scaled by
   * the clear-sky ratio. Ranking on anything else would take panels off in an
   * order that disagreed with the production figure right beside it.
   *
   * A freshly filled plane is usually NOT in `measuredYields` yet, because
   * nobody has saved this roof before, so the first fill ranks on the clear-sky
   * model and the save settles it on PVWatts. That is the designer's existing
   * bargain — an instant estimate while you draw, the real figure on save — and
   * the ORDER the two models put the planes in is the same either way.
   */
  const panelKwh = React.useCallback(
    (b: LayoutBlock): number => {
      if (!moduleRatingW) return 0;
      const kw = moduleRatingW / 1000;
      const shade = 1 - (b.shadePct ?? 0) / 100;
      const measured =
        b.tiltDeg == null || b.azimuthDeg == null
          ? null
          : (measuredYields[`${b.tiltDeg}|${b.azimuthDeg}`] ?? null);
      // Held back by the same margin `systemTotals` quotes with, so the panel
      // this ranks last is worth what the figure beside the roof says it is —
      // and so the prune-to-usage target is measured in the same kWh the
      // offset is.
      if (measured != null) return withProductionMargin(kw * measured * shade);
      const factor = orientationFactor({
        lat,
        tiltDeg: b.tiltDeg ?? null,
        azimuthDeg: b.azimuthDeg ?? null,
      });
      return withProductionMargin(
        kw * assumptions.kwhPerKwYear * assumptions.derateFactor * factor * shade
      );
    },
    [assumptions, lat, measuredYields, moduleRatingW]
  );

  /**
   * WHAT MAX ROOF FILLS FROM, in priority order.
   *
   * Google's own model of this building where there is one — a measurement, per
   * plane, with the pitch — and the roof faces the rep traced where there is
   * not. Today that is every house: the Solar API is switched off on this
   * account, every call comes back `SERVICE_DISABLED`, and the plane fill has
   * therefore never once run in production. The traced path is what a rep
   * actually has.
   *
   * Both end in the same place — blocks with cells knocked out — so everything
   * downstream, the prune included, cannot tell them apart.
   */
  const fillSource: "planes" | "faces" | "building" = planes
    ? "planes"
    : blocks.some((b) => b.face)
      ? "faces"
      : "building";

  /**
   * Areas a fill must keep off: the setback bands the rep has traced.
   *
   * The traced setbacks do NOT clip a rep's own drawing — see `LayoutSetback`,
   * which explains why a tool that silently deleted somebody's array because a
   * line moved would be worse than one that shows the conflict. A fill is the
   * other case: nobody drew those panels yet, so putting them in a keep-out
   * zone would be the tool inventing the conflict rather than showing one.
   */
  const keepOut = React.useMemo(
    () => setbacks.flatMap((sb) => setbackBands(sb)),
    [setbacks]
  );

  /**
   * Lay panels inside one traced roof face.
   *
   * Replaces the block that face already produced, if it has one, so re-tracing
   * or re-filling never leaves two arrays stacked on the same plane. New faces
   * get a new block and the selection, because the next thing a rep does is
   * always to look at what landed.
   */
  const fillTracedFace = React.useCallback(
    (face: RoofFace, existingId?: string) => {
      const prior = existingId ? blocksRef.current.find((b) => b.id === existingId) : undefined;
      const block = fillFace(face, {
        module: moduleMm,
        keepOut,
        id: existingId ?? uid(),
        // A facing the rep already settled survives a re-fill. Re-guessing it
        // from the shape would quietly undo the one thing they went out of
        // their way to state.
        azimuthDeg: prior?.facingSource === "traced" ? null : (prior?.azimuthDeg ?? null),
        tiltDeg: prior?.tiltDeg ?? null,
        shadePct: prior?.shadePct ?? null,
      });
      if (!block) {
        toast.error(
          "No panel fits inside that outline once the edge setback is taken off. Trace a larger face, or reduce the setback."
        );
        return null;
      }
      commit(
        existingId && prior
          ? blocksRef.current.map((b) => (b.id === existingId ? block : b))
          : [...blocksRef.current, block]
      );
      setSelectedId(block.id);
      setTool("select");
      return block;
    },
    [commit, keepOut, moduleMm]
  );

  /**
   * How many panels the last fill left on the roof, or null if none has run.
   *
   * Drives the plus and minus, and only that. It is a SIZE, not a copy of the
   * drawing: every nudge re-fills the roof at the new count, so there is no
   * stale snapshot to fall out of step with what is on screen.
   */
  const [fillCount, setFillCount] = React.useState<number | null>(null);

  /** True while Max roof is asking what shape the building is. */
  const [filling, setFilling] = React.useState(false);

  /**
   * Cover the roof with panels.
   *
   * MAXIMAL BY DEFAULT, and trimming is a separate button. That is the order a
   * rep works in — get everything the roof will hold on screen, look at it with
   * the homeowner, then take off what the house does not need — and it is the
   * order they asked for. A fill that quietly pruned itself to the usage figure
   * would be answering a question before it had been put.
   *
   * Replaces what the fill drew last time rather than adding to it, and it is
   * undoable like any other edit: a rep who wanted to keep what they had
   * presses undo and has it back.
   */
  /**
   * The building's own outline, once anybody has asked for it.
   *
   * Undefined means nobody has; null means asked and there is none. The
   * difference matters: the second is a house OpenStreetMap has never been told
   * about, and Max roof has to say so rather than ask again on every press.
   */
  const footprintRef = React.useRef<
    { points: { e: number; n: number }[]; ridgeDeg: number | null } | null | undefined
  >(undefined);

  /**
   * Roof faces for this house, without anybody drawing one.
   *
   * The building's outline, cut in two along the ridge its shape implies, so
   * each half carries the slope it is actually on. Filling the whole footprint
   * as one face would price the north slope as south, which on an ordinary
   * house overstates the year by about a fifth — and it would also defeat the
   * trim, whose whole job is to take the worst-facing panels off first.
   *
   * A footprint too square to have a ridge comes back as ONE face with no
   * facing, which is the honest answer: the shape genuinely does not say, and
   * the rep swings the arrow.
   */
  const facesFromBuilding = React.useCallback(
    (fp: { points: { e: number; n: number }[]; ridgeDeg: number | null }) => {
      const inset = faceInsetRef.current;
      const ridgeDeg = fp.ridgeDeg;
      if (ridgeDeg == null) {
        return [{ face: { points: fp.points, insetM: inset }, azimuthDeg: null }];
      }
      /**
       * THE RIDGE RUNS THROUGH THE MIDDLE OF THE BUILDING, not through the pin.
       *
       * The pin is a rooftop geocode, which puts it ON the roof but not at its
       * centre — on this company's own test address it sits four metres off,
       * and cutting there gave one slope nineteen columns and the other
       * sixteen. A roof's two faces are not that different, and the lopsided
       * pair prices the design wrong in both directions.
       */
      const centre = polygonCentroid(fp.points);
      const halves = splitPolygon(fp.points, centre, ridgeDeg);
      return halves
        .filter((half) => half.length >= 3)
        .map((half) => {
          // Each slope falls away from the ridge, so the facing is the
          // perpendicular pointing from the ridge toward that half.
          const mid = half.reduce(
            (t, q) => ({ e: t.e + q.e / half.length, n: t.n + q.n / half.length }),
            { e: 0, n: 0 }
          );
          const away = norm360(
            (Math.atan2(mid.e - centre.e, mid.n - centre.n) * 180) / Math.PI
          );
          /**
           * The perpendicular that points the same way this half lies from the
           * ridge — NEARER to `away`, not further from it.
           *
           * It was the wrong way round, and the wrong way round is invisible:
           * every array still got a plausible bearing, the arrows still pointed
           * somewhere sensible, and the south slope of this company's own test
           * house was priced as north. A facing is only ever wrong by 180°, and
           * 180° out is the difference between the best roof and the worst.
           */
          const perp = [norm360(ridgeDeg + 90), norm360(ridgeDeg - 90)];
          const off = (deg: number) => Math.abs(((deg - away + 540) % 360) - 180);
          const pick = off(perp[0]) <= off(perp[1]) ? perp[0] : perp[1];
          return { face: { points: half, insetM: inset }, azimuthDeg: pick };
        });
    },
    []
  );

  /**
   * Cover the roof with panels. ONE PRESS, and never a dead button.
   *
   * WHERE THE ROOF COMES FROM, in order of how much it actually knows:
   *   1. Google's model of this building — every plane, its pitch and its
   *      facing, measured photogrammetrically. Needs the Solar API switched on.
   *   2. The building's outline from OpenStreetMap, cut at the ridge its shape
   *      implies. Knows the walls, not the roof: no hips, no dormers, no pitch.
   *   3. Faces the rep traced by hand, which beat all of it when they disagree,
   *      because the rep can see the house.
   *
   * The first version of this only had the third, so on a house nobody had
   * traced the button told the rep to go and do some work — which is not a
   * button, and was the first thing said about it. Something is always tried.
   *
   * MAXIMAL BY DEFAULT, and trimming is its own button: get everything the roof
   * holds on screen, look at it with the homeowner, then take off what the
   * house does not need. A fill that quietly pruned itself would be answering a
   * question before it had been asked.
   */
  const maxRoof = React.useCallback(
    async (targetPanels?: number) => {
      const roofPlanesNow = planesRef.current;
      const current = blocksRef.current;

      let filled: LayoutBlock[] = [];
      let kept: LayoutBlock[] = [];
      let note = "";

      const traced = current.filter((b) => b.face);

      if (roofPlanesNow) {
        filled = autoFillRoof(roofPlanesNow, { module: moduleMm });
        // The plane fill claims the whole roof, so it replaces the drawing.
        kept = [];
      } else if (traced.length > 0) {
        filled = traced.flatMap((b) => {
          const block = fillFace(b.face!, {
            module: moduleMm,
            keepOut,
            id: b.id,
            azimuthDeg: b.facingSource === "traced" ? null : (b.azimuthDeg ?? null),
            facingSource: b.facingSource ?? null,
            tiltDeg: b.tiltDeg ?? null,
            shadePct: b.shadePct ?? null,
          });
          return block ? [block] : [];
        });
        // Arrays drawn by hand are not this control's to move.
        kept = current.filter((b) => !b.face);
      } else {
        setFilling(true);
        try {
          if (footprintRef.current === undefined) {
            const body = await fetch(
              `/api/property/footprint?leadId=${encodeURIComponent(leadId)}`
            )
              .then((r) => (r.ok ? r.json() : { footprint: null }))
              .catch(() => ({ footprint: null }));
            footprintRef.current = body.footprint
              ? { points: body.footprint.points, ridgeDeg: body.ridgeDeg ?? null }
              : null;
          }
        } finally {
          setFilling(false);
        }

        const fp = footprintRef.current;
        if (!fp) {
          setTraceKind("face");
          setTool("face");
          return toast.error(
            "Nothing knows the shape of this building — no roof model, and OpenStreetMap has not mapped it. Trace one plane of the roof and this will fill it."
          );
        }

        filled = facesFromBuilding(fp).flatMap(({ face, azimuthDeg }) => {
          const block = fillFace(face, {
            module: moduleMm,
            keepOut,
            id: uid(),
            azimuthDeg,
            // Inferred from an outline, and labelled as such — the proposal
            // has to keep being able to tell this from a measurement.
            facingSource: azimuthDeg == null ? null : "footprint",
          });
          return block ? [block] : [];
        });
        kept = [];
        note = " from the building outline";
      }

      if (filled.length === 0) {
        return toast.error(
          "No panel fits anywhere this tool can see a roof. Trace a plane by hand and it will fill that."
        );
      }

      const result =
        targetPanels != null
          ? pruneToCount(filled, panelKwh, targetPanels)
          : { blocks: filled, removed: 0, productionKwh: 0 };

      const live = result.blocks.filter((b) => blockPanelCount(b) > 0);
      const panels = live.reduce((n, b) => n + blockPanelCount(b), 0);

      /**
       * A FILL THAT FOUND NOTHING LEAVES THE ROOF ALONE.
       *
       * The plane and outline paths replace the drawing — that is the honest
       * move for a control claiming to lay out the whole roof. But a fill can
       * hand back blocks with every cell knocked out, and every one of those is
       * dropped by the filter above. If they all go, `kept` is empty too and
       * the commit is an empty layout: one press and a rep's design is gone,
       * with a success toast on top of it.
       *
       * There is no version of "cover the roof in panels" that ends with fewer
       * panels than it started, so it refuses instead.
       */
      if (live.length === 0) {
        return toast.error(
          "That fill came back empty, so nothing was changed — no plane here is big enough for a module."
        );
      }

      commit([...kept, ...live]);
      setSelectedId(live[0]?.id ?? null);
      setFillCount(panels);

      if (targetPanels == null) {
        toast.success(
          `Filled ${live.length} ${live.length === 1 ? "plane" : "planes"}${note} — ${panels} panels. Trim to usage takes off what the house does not need.`
        );
      }
    },
    [commit, facesFromBuilding, keepOut, leadId, moduleMm, panelKwh, setTraceKind]
  );

  /**
   * Take panels off, worst first, until the system only just covers the house.
   *
   * The step after Max Roof, and deliberately its own button. Which panels are
   * the weak ones is not something anybody can see on an aerial — it is the
   * north face, except when it is the shaded east face — so the order comes
   * from `panelKwh`, the same figure the production number beside it is built
   * from. It stops ABOVE the target, never below: a design that quietly
   * undershoots the offset it claims is worse than one with a panel too many.
   */
  const trimToUsage = React.useCallback(() => {
    if (!annualUsageKwh || annualUsageKwh <= 0) {
      return toast.error(
        "There is nothing to trim to yet — this deal has no annual usage on it. Fill in the bill on the Energy step and this will cut the system down to what the house actually uses."
      );
    }
    const result = pruneToTarget(blocksRef.current, panelKwh, annualUsageKwh);
    if (result.removed === 0) {
      return toast.success("Nothing to trim — this system does not clear the home's usage as it is.");
    }
    const live = result.blocks.filter((b) => blockPanelCount(b) > 0);
    const panels = live.reduce((n, b) => n + blockPanelCount(b), 0);
    commit(live);
    setFillCount(panels);
    toast.success(
      `Trimmed ${result.removed} ${result.removed === 1 ? "panel" : "panels"} — ${panels} left, still covering the home's usage.`
    );
  }, [annualUsageKwh, commit, panelKwh]);

  /** Patch the selected array. Every property control goes through one path. */
  const patchSelected = React.useCallback(
    (patch: Partial<LayoutBlock>) => {
      if (!selected) return;
      commit(blocks.map((b) => (b.id === selected.id ? { ...b, ...patch } : b)));
    },
    [blocks, commit, selected]
  );

  /**
   * What a newly drawn array faces.
   *
   * THE BUILDING ANSWERS FIRST. Where the roof planes are known, a new array
   * takes the plane it was drawn on — which matters most in exactly the case
   * inheritance gets wrong: the second array goes on the west face, and copying
   * the first one's south would be a confident, invisible error.
   *
   * Inheritance is the fallback, for a roof Google cannot see. The FIRST array
   * on such a deal inherits nothing, so it stays unoriented and the prompt fires
   * at least once — a rep who is never told the roof matters will never say
   * which way it faces. After that, arrays inherit from the last one drawn,
   * because the second and third are usually further up the same plane and
   * retyping the pitch three times is how people stop bothering. An inherited
   * angle is NOT marked as read from the roof: it is a guess about this array
   * made from a different one.
   *
   * Shade is deliberately NOT inherited: the whole reason to shade one array
   * and not another is that the tree is only over one of them.
   */
  const orientationFor = (
    b: LayoutBlock
  ): Pick<LayoutBlock, "azimuthDeg" | "tiltDeg" | "facingSource"> => {
    const roof = planesRef.current
      ? assignPlanes([b], planesRef.current, moduleMm).get(b.id)
      : undefined;
    if (roof) {
      return { azimuthDeg: roof.azimuthDeg, tiltDeg: roof.tiltDeg, facingSource: "roof" };
    }
    const source = selected ?? blocksRef.current[blocksRef.current.length - 1];
    if (!source) return { azimuthDeg: null, tiltDeg: null, facingSource: null };
    return {
      azimuthDeg: source.azimuthDeg ?? null,
      tiltDeg: source.tiltDeg ?? null,
      facingSource: null,
    };
  };

  // ── The roof itself ────────────────────────────────────────────────────
  /**
   * Ask the building which way its planes face, unless somebody already has.
   *
   * AFTER MOUNT, never during the render that draws the roof. The page hands
   * over whatever the cache held, so a house anybody has quoted before is
   * already answered here; this is the first-ever look, which costs a call to
   * Google and must not be a second of blank screen.
   */
  React.useEffect(() => {
    // A ground mount sits in a yard. The nearest roof plane has nothing to do
    // with how it was racked, and reading one onto it would be an invention.
    if (roofPlanes || groundMount || lat == null) return;
    let live = true;
    fetch(`/api/property/roof-planes?leadId=${encodeURIComponent(leadId)}`)
      .then((r) => (r.ok ? r.json() : { planes: null }))
      .then((body: { planes: RoofPlanes | null }) => {
        if (!live) return;
        setPlanes(body.planes ?? null);
        setRoofState(body.planes ? "read" : "none");
      })
      // Never fatal, like everything else that leaves this machine: the roof
      // simply stays unread and every array keeps the facing it already had.
      .catch(() => live && setRoofState("none"));
    return () => {
      live = false;
    };
  }, [leadId, lat, roofPlanes, groundMount, setPlanes]);

  /**
   * Fill in the arrays nobody has described, the moment the roof is known.
   *
   * NOT through `commit`. This is not an edit a rep made, so it earns no undo
   * step and must not raise the unsaved-work guard on a designer somebody only
   * opened to look at — it is the starting state, arriving a moment late. The
   * same function runs server-side inside `recomputeDesignFigures`, so what a
   * save stores is what was on screen rather than a second opinion about it.
   */
  React.useEffect(() => {
    if (!planes) return;
    const result = applyPlanes(blocksRef.current, planes, moduleMm);
    if (result.filled === 0) return;
    setBlocks(result.blocks);
    setJustFilled(result.filled);
  }, [planes, moduleMm, setBlocks]);

  /**
   * Which plane each array is on, live — so dragging one across a ridge says so
   * while it is being dragged rather than after a save.
   */
  const roofAssignments = React.useMemo(
    () => (planes ? assignPlanes(blocks, planes, moduleMm) : null),
    [blocks, planes, moduleMm]
  );
  const selectedStraddles = (roofAssignments?.get(selectedId ?? "")?.planesSpanned ?? 1) > 1;

  /** The planes drawn as outlines, only while the rep is checking our work. */
  const hulls = React.useMemo(
    () => (planes && showPlanes ? segmentHulls(planes) : []),
    [planes, showPlanes]
  );

  // ── The view ───────────────────────────────────────────────────────────
  /**
   * The canvas is the size of the space it is given, in CSS pixels.
   *
   * This replaces a fixed 1280 px square scaled to fit, and it is why the roof
   * fills the screen now rather than sitting letterboxed in the middle of it.
   * The backing store is multiplied by the device pixel ratio at paint time; the
   * GEOMETRY stays in CSS pixels so that a grab radius is the same size under a
   * finger on every display.
   */
  React.useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setCanvas((c) => (c.w === w && c.h === h ? c : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * How far in and out the view may go.
   *
   * The far end is a whole subdivision. The near end is deliberately PAST what
   * any vendor serves — a rep nudging a panel around a vent wants the pixels
   * bigger even when they are only bigger, not sharper, and the note on screen
   * says so rather than the control refusing.
   */
  const mppRange = React.useMemo(() => {
    if (lat == null) return { min: 0.005, max: 5 };
    return {
      min: metresPerPixel(lat, GOOGLE_MAX_ZOOM + 3, 2),
      max: metresPerPixel(lat, MIN_ZOOM, 2),
    };
  }, [lat]);

  /** Keep the view over ground the imagery route will actually serve. */
  const clampCentre = React.useCallback(
    (c: { e: number; n: number }) => ({
      e: Math.max(-panLimitM, Math.min(panLimitM, c.e)),
      n: Math.max(-panLimitM, Math.min(panLimitM, c.n)),
    }),
    [panLimitM]
  );

  const panBy = React.useCallback(
    (dxPx: number, dyPx: number) =>
      setCentre((c) => clampCentre({ e: c.e - dxPx * mpp, n: c.n + dyPx * mpp })),
    [mpp, clampCentre]
  );

  /**
   * Zoom, optionally holding one point of the picture still.
   *
   * Anchoring matters on a map: zooming towards the cursor is how every mapping
   * tool behaves, and without it a rep zooming into a vent watches the vent
   * slide off the screen and has to chase it.
   */
  const zoomBy = React.useCallback(
    (mul: number, anchor?: { x: number; y: number }) => {
      setMpp((m) => {
        const next = Math.max(mppRange.min, Math.min(mppRange.max, m / mul));
        if (anchor && next !== m) {
          // The ground point under the anchor must not move, so the centre
          // takes up the difference.
          const dx = anchor.x - canvasW / 2;
          const dy = anchor.y - canvasH / 2;
          setCentre((c) => clampCentre({ e: c.e + dx * (m - next), n: c.n - dy * (m - next) }));
        }
        return next;
      });
    },
    [mppRange, canvasW, canvasH, clampCentre]
  );

  /**
   * PUT THE DEAL'S COORDINATE ON THE RIGHT ROOF.
   *
   * The whole difficulty is in one sentence: every panel, every traced face,
   * every setback and every roof plane on this screen is stored in metres FROM
   * that coordinate. Move it naively and the drawing does not stay where it was
   * drawn — it slides by exactly the distance the pin travelled, off the roof
   * and onto the neighbour's.
   *
   * So moving the pin is a change of origin, and everything measured from the
   * old one is re-expressed against the new one in the same breath. Subtracting
   * the new origin from each stored point is all "stay where you are on the
   * ground" means, and doing it here — rather than leaving it to the save — is
   * what makes the correction visibly a no-op on screen. The picture does not
   * move. Only the question "where is this house" gets a new answer.
   *
   * The view is shifted too, so the roof the rep is looking at stays under
   * their eyes rather than jumping by the width of the correction.
   */
  const movePin = React.useCallback(
    (m: { e: number; n: number }) => {
      if (!origin) return;
      const shift = <T extends { e: number; n: number }>(pt: T): T => ({
        ...pt,
        e: pt.e - m.e,
        n: pt.n - m.n,
      });
      const shiftBlocks = (bs: LayoutBlock[]): LayoutBlock[] =>
        bs.map((b) => ({
          ...b,
          originE: b.originE - m.e,
          originN: b.originN - m.n,
          face: b.face ? { ...b.face, points: b.face.points.map(shift) } : b.face,
        }));

      setBlocks(shiftBlocks(blocksRef.current));

      /**
       * EVERY OTHER COPY OF THE LAYOUT MOVES TOO, and forgetting this is a bug
       * that only shows up on the second action.
       *
       * The undo stack and the "put the saved design back" snapshot are lists
       * of blocks in the frame they were captured in. Re-base the live drawing
       * and leave those behind, and the design sits correctly on the roof until
       * the rep presses undo — at which point the whole array jumps by exactly
       * the distance the pin was moved, for no reason they could ever connect
       * to the pin.
       */
      setHistory((h) => h.map(shiftBlocks));
      savedRef.current = shiftBlocks(savedRef.current);
      setSetbacks(setbacksRef.current.map((sb) => ({ ...sb, points: sb.points.map(shift) })));
      setPending(pendingRef.current ? pendingRef.current.map(shift) : null);
      // Google's roof model is measured from the old origin as well, and an
      // un-shifted one would hand every array it touches a facing read off the
      // wrong plane.
      const pl = planesRef.current;
      if (pl) {
        setPlanes({
          ...pl,
          segments: pl.segments.map((sg) => ({
            ...sg,
            centerE: sg.centerE - m.e,
            centerN: sg.centerN - m.n,
          })),
          panels: pl.panels.map((pn) => ({ ...pn, e: pn.e - m.e, n: pn.n - m.n })),
        });
      }
      setCentre((c) => ({ e: c.e - m.e, n: c.n - m.n }));
      const next = metresToLatLng(origin, m);
      setOriginLat(next.lat);
      setOriginLng(next.lng);
      setDirty(true);
      setTool("select");
    },
    [origin, setBlocks, setSetbacks, setPending, setPlanes]
  );

  /** Put the whole array (or the house, when there is none) on the screen. */
  const fitToArray = React.useCallback(() => {
    const pts = blocksRef.current.flatMap((b) =>
      panelCorners(b, moduleMm).flat().map((c) => ({ e: c.e, n: c.n }))
    );
    const framed = frameOn(pts, { widthPx: canvasW, heightPx: canvasH }, { marginM: 8 });
    setCentre(clampCentre({ e: framed.centreE, n: framed.centreN }));
    setMpp(Math.max(mppRange.min, Math.min(mppRange.max, framed.mpp)));
  }, [moduleMm, canvasW, canvasH, mppRange, clampCentre]);

  /**
   * Open framed on the array rather than on the geocoder's guess.
   *
   * Once, when the panels first arrive and the canvas has a size. A designer
   * reopened on a finished layout should show the layout; a fresh one falls
   * back to the house, which is what `frameOn` does with no points.
   */
  const framedOnce = React.useRef(false);
  React.useEffect(() => {
    if (framedOnce.current || lat == null || canvasW <= 1) return;
    framedOnce.current = true;
    if (initialBlocks.length > 0) fitToArray();
  }, [lat, canvasW, initialBlocks, fitToArray]);

  // ── Drawing ────────────────────────────────────────────────────────────
  const paint = React.useCallback(
    (
      ctx: CanvasRenderingContext2D,
      opts: {
        chrome: boolean;
        view?: MapView;
        dpr?: number;
        source?: BasemapSource;
        /** One image to use as the whole basemap — see `singleImageView`. */
        backdrop?: HTMLImageElement | null;
      }
    ) => {
      const v = opts.view ?? view;
      const dpr = opts.dpr ?? 1;
      // Everything below is authored in CSS pixels. One transform at the top
      // buys the whole file retina sharpness without a single size changing.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, v.widthPx, v.heightPx);

      // THE IMAGERY IS DRAWN IN SCREEN SPACE, before the pan transform: the
      // tile rectangles already account for where the view is looking, because
      // they were computed from it. Translating them again would move the
      // photograph out from under the panels drawn on it.
      if (opts.backdrop) ctx.drawImage(opts.backdrop, 0, 0, v.widthPx, v.heightPx);
      else basemap.draw(ctx, v, opts.source);

      // From here on the origin of the canvas is the deal's own coordinate,
      // which is the space every panel, face and setback is stored in. The pan
      // lives entirely in this one translate — that is why nothing else in this
      // function had to learn that the map can move.
      ctx.translate(-v.centreE / v.mpp, v.centreN / v.mpp);

      const img = { widthPx: v.widthPx, heightPx: v.heightPx };
      const toPx = (c: { e: number; n: number }) => metresToImagePx(c.e, c.n, v.mpp, img);
      const trace = (pts: { x: number; y: number }[]) => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
      };

      /**
       * The roof's own planes, when the rep has asked to see them.
       *
       * Underneath everything, and only on request. This is a check on the
       * tool's work — "does it think this face points the way I can see it
       * points" — and a check that is always on stops being read.
       */
      // `chrome: false` is the picture the customer is shown. Working overlays
      // stay out of it, exactly like the grips and the green ghosts.
      for (const hull of opts.chrome ? hulls : []) {
        if (hull.ring.length < 3) continue;
        const ring = hull.ring.map(toPx);
        trace(ring);
        ctx.fillStyle = "rgba(56, 189, 248, 0.12)";
        ctx.fill();
        ctx.setLineDash([7, 5]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(56, 189, 248, 0.9)";
        ctx.stroke();
        ctx.setLineDash([]);

        const cx = ring.reduce((t, p) => t + p.x, 0) / ring.length;
        const cy = ring.reduce((t, p) => t + p.y, 0) / ring.length;
        const label = `${compassLabel(hull.azimuthDeg)} · ${Math.round(hull.pitchDeg)}°`;
        ctx.font = "600 15px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // Stroked before filled, so the label survives a light roof and a dark
        // one — the two things this overlay is drawn on top of.
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(15, 23, 42, 0.85)";
        ctx.strokeText(label, cx, cy);
        ctx.fillStyle = "#e0f2fe";
        ctx.fillText(label, cx, cy);
      }

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

      /**
       * The roof faces a rep traced, as thin outlines under their panels.
       *
       * Only while working — a customer sees the array, not the working. It is
       * here so the outline that produced a fill stays visible and therefore
       * correctable: a face traced a metre wide of the eave is obvious the
       * moment its line is on the picture next to the roof it was meant to
       * follow, and invisible if the only evidence is where the panels landed.
       */
      for (const b of opts.chrome ? blocks : []) {
        if (!b.face || b.face.points.length < 3) continue;
        trace(b.face.points.map(toPx));
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = b.id === selectedId ? 2.5 : 1.5;
        ctx.strokeStyle =
          b.id === selectedId ? "rgba(56, 189, 248, 0.95)" : "rgba(56, 189, 248, 0.5)";
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (opts.chrome && pending && pending.length > 0) {
        // The rubber band snaps HOME when the pointer is over the dot that
        // would close the loop, so a rep can see the shape shut before they
        // commit to it rather than after.
        const tail =
          traceSnap === "close"
            ? pending[0]
            : traceSnap === "end"
              ? pending[pending.length - 1]
              : ghostPoint;
        const pts = [...pending, ...(tail ? [tail] : [])].map(toPx);
        // A face and a setback are the same gesture and must not look the same:
        // one becomes panels, the other becomes a keep-out band, and a rep
        // three corners into the wrong one wants to know before they close it.
        const traceColour = traceKind === "face" ? "#38bdf8" : "#fb923c";
        // A face closing shows the shape it is about to fill, so the area a rep
        // is committing to is visible before they commit to it.
        if (traceKind === "face" && pts.length >= 3) {
          trace(pts);
          ctx.fillStyle = "rgba(56, 189, 248, 0.15)";
          ctx.fill();
        }
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.setLineDash([8, 6]);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = traceColour;
        ctx.stroke();
        ctx.setLineDash([]);
        const target =
          traceSnap === "close" ? 0 : traceSnap === "end" ? pending.length - 1 : -1;
        pending.map(toPx).forEach((p, i) => {
          const isTarget = i === target;
          ctx.beginPath();
          ctx.arc(p.x, p.y, isTarget ? 9 : 5, 0, Math.PI * 2);
          ctx.fillStyle = traceKind === "face" ? "#38bdf8" : "#fb923c";
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

          drawFacing(ctx, b, moduleMm, v.mpp, img, {
            factorPct:
              b.azimuthDeg != null && b.tiltDeg != null
                ? Math.round(arrayFactor(totals, b.id) * 100)
                : null,
            active: drag?.kind === "facing" && drag.id === b.id,
          });
          const hp = handlePositions(b, moduleMm, v.mpp, img);
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

      /**
       * THE PIN: where this deal thinks the house is.
       *
       * Always at ground zero, because that IS the origin — moving it re-bases
       * everything else rather than moving the marker (see `movePin`).
       *
       * Drawn under `chrome` only, which is what keeps it out of the picture
       * the customer receives. That was the whole reason the old Static Maps
       * marker had to be switched off: it landed on the roof, over the array,
       * and got baked into the layout image.
       *
       * A ring rather than a teardrop. A pin with a point has to be drawn above
       * the thing it marks, hiding it; a ring sits around the spot and leaves
       * the roof inside it visible, which matters when the spot is where the
       * panels go.
       */
      if (opts.chrome && showPin) {
        const c = toPx({ e: 0, n: 0 });
        ctx.save();
        ctx.beginPath();
        ctx.arc(c.x, c.y, 11, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.strokeStyle = "#f4631e";
        ctx.lineWidth = 1.75;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = "#f4631e";
        ctx.fill();
        ctx.restore();
      }
    },
    [
      blocks,
      setbacks,
      hulls,
      pending,
      traceKind,
      ghostPoint,
      traceSnap,
      selectedId,
      drag,
      totals,
      moduleMm,
      view,
      basemap,
      showPin,
    ]
  );

  const dpr = useDevicePixelRatio();

  React.useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    // `basemap.version` is in the deps because a tile arriving is a reason to
    // repaint that nothing else on this screen knows about.
    if (ctx) paint(ctx, { chrome: true, dpr });
  }, [paint, dpr, basemap.version]);

  // ── Pointer maths ──────────────────────────────────────────────────────
  /**
   * Client coords → the space the drawing is done in.
   *
   * THE PAN IS FOLDED IN HERE, and only here. Everything downstream — hit
   * testing, the rubber band, the grab radius of the facing arrow, the ground
   * conversion below — was written against a canvas whose centre was the deal's
   * coordinate, and all of it still is. Adding the view's offset to the pointer
   * at the single point where a real event becomes a canvas position is what
   * let the map start moving without any of that code being touched.
   */
  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return {
      x: e.clientX - r.left + centre.e / mpp,
      y: e.clientY - r.top - centre.n / mpp,
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
    const b: LayoutBlock = {
      id: uid(),
      originE: m.e - off.e,
      originN: m.n - off.n,
      rotationDeg,
      cols: 1,
      rows: 1,
      orientation,
      omitted: [],
    };
    return { ...b, ...orientationFor(b) };
  };

  /**
   * Finish the setback being traced. Fewer than two points is not a line.
   *
   * `close` puts the first point back on the end, so the run's last segment is
   * the one home to where the trace started. setbackBands skips zero-length
   * segments, so a duplicate costs nothing if the click was already there.
   */
  /**
   * Finish the shape being traced — a setback run, or a roof face to fill.
   *
   * ONE tracing gesture for both, because it is one gesture to a rep: click the
   * corners, click the first dot to shut it. The only difference is what the
   * shape becomes, and a face has to actually be a shape — two points is a
   * line, and filling a line puts a row of modules in mid-air.
   *
   * `close` puts the first point back on the end of a setback run, so its last
   * segment is the one home to where the trace started. `setbackBands` skips
   * zero-length segments, so a duplicate costs nothing if the click was already
   * there. A face is a ring and never repeats its first point.
   */
  const finishTrace = React.useCallback(
    (opts?: { close?: boolean }) => {
      const pts = pendingRef.current;
      const kind = traceKindRef.current;
      setPending(null);
      setGhostPoint(null);
      if (!pts) return;

      if (kind === "face") {
        if (pts.length < 3) {
          return toast.error("A roof face needs at least three corners — click round the plane, then click the first dot.");
        }
        return fillTracedFace({ points: pts, insetM: faceInsetRef.current });
      }

      if (pts.length < 2) return;
      const points = opts?.close ? [...pts, pts[0]] : pts;
      setSetbacks([...setbacksRef.current, { id: uid(), points, widthM: DEFAULT_SETBACK_M }]);
      setDirty(true);
    },
    [setPending, setSetbacks, fillTracedFace]
  );

  /**
   * Choose a tool. One function, because a half-finished trace has to be dealt
   * with whichever control the rep reached for — leaving one dangling was how
   * a dashed line ended up following the pointer around forever.
   */
  const pickTool = React.useCallback(
    (id: Tool) => {
      if (pendingRef.current) finishTrace();
      setTraceKind(id === "face" ? "face" : "setback");
      setTool(id);
    },
    [finishTrace, setTraceKind]
  );

  /**
   * Has the pointer gone far enough for this to be a drag rather than a click?
   *
   * `DETACH_TRAVEL_PX` is a SCREEN distance, and `toCanvas` has already scaled
   * the press into canvas pixels — so the threshold has to be scaled the same
   * way or it would mean four canvas pixels, which at a zoomed-out view is a
   * finger's width of roof and at a zoomed-in one is nothing at all.
   */
  const travelled = (p: { x: number; y: number }, startX: number, startY: number) =>
    Math.hypot(p.x - startX, p.y - startY) > DETACH_TRAVEL_PX;

  /**
   * A swung bearing, rounded to something a person would say out loud.
   *
   * Five degrees ordinarily, and the eight compass points pull it in from four
   * degrees out — so an arrow aimed at south lands on south rather than on 184,
   * which is the number a homeowner would then be read.
   *
   * Shift turns both off, for the roof that really does face 187.
   */
  const snapFacing = (deg: number, free: boolean): number => {
    if (free) return norm360(deg);
    const compass = Math.round(deg / 45) * 45;
    if (Math.abs(norm360(deg) - norm360(compass)) <= COMPASS_PULL_DEG) return norm360(compass);
    return norm360(Math.round(deg / FACING_SNAP_DEG) * FACING_SNAP_DEG);
  };

  /**
   * Knock one panel out, and delete the array if that was its last.
   *
   * Shared by the Remove panels tool and Alt on the pointer, so the two cannot
   * drift. Erasing the LAST panel deletes the block whatever its grid says: it
   * used to be only a 1x1 that went, so an 8x1 rubbed out cell by cell left an
   * 8-cell grid holding nothing — invisible, still clickable, still showing its
   * ghosts, and counting zero modules. A deal reached the financing step with
   * three of those on it and no system size at all.
   */
  const removePanelAt = (target: { block: LayoutBlock; index: number }) => {
    const last = blockPanelCount(target.block) <= 1;
    commit(
      last
        ? blocksRef.current.filter((b) => b.id !== target.block.id)
        : blocksRef.current.map((b) =>
            b.id === target.block.id ? { ...b, omitted: [...b.omitted, target.index] } : b
          )
    );
    if (selectedId === target.block.id && last) setSelectedId(null);
  };

  /**
   * Put one module down, joining the nearest array if there is one to join.
   *
   * A press within a cell or two of an existing array lands on THAT array's
   * lattice — same bearing, same rows, same rail gaps — which is what makes
   * adding panels feel like laying tile rather than dropping confetti. Further
   * out and the rep is plainly starting something new, so they get a free panel
   * aligned to the last array's rotation.
   */
  const addPanelAt = (m: { e: number; n: number }, p: { x: number; y: number }) => {
    const host = nearestBlockFor(m);
    if (host) {
      const grown = addPanelAtCell(host.block, cellAt(host.block, moduleMm, m), moduleMm);
      // Where the new panel ended up, asked of the GROWN block: adding a column
      // on the left moves every cell along, so the index it had in the old grid
      // is not the one it has now.
      const landed = cellAt(grown, moduleMm, m);
      const index = landed.row * Math.max(1, grown.cols) + landed.col;
      if (
        wouldOverlap(cellCorners(grown, moduleMm, index), blocksRef.current, moduleMm, host.block.id)
      ) {
        return toast.error("There is already a panel there.");
      }
      commit(blocksRef.current.map((x) => (x.id === host.block.id ? grown : x)));
      return setSelectedId(host.block.id);
    }

    const near = selected ?? blocksRef.current[blocksRef.current.length - 1];
    const b = lonePanelAt(m, near?.rotationDeg ?? 0, near?.orientation ?? "portrait");
    // Nothing goes on top of anything. A design reached production with two
    // modules 18 cm apart — 82% of one panel on another — and the count, the
    // system size and the price were all built on panels that cannot both be
    // up there.
    if (wouldOverlap(cellCorners(b, moduleMm, 0), blocksRef.current, moduleMm)) {
      return toast.error("There is already a panel there.");
    }
    // No history entry here — pointerup records one for the whole gesture, so a
    // single undo takes back the panel AND the slide that positioned it.
    setBlocks([...blocksRef.current, b]);
    setSelectedId(b.id);
    setDirty(true);
    setDrag({
      kind: "move",
      id: b.id,
      fromE: m.e,
      fromN: m.n,
      originE: b.originE,
      originN: b.originN,
      startX: p.x,
      startY: p.y,
      moved: true,
    });
  };

  function onPointerDown(ev: React.PointerEvent) {
    if (lat == null) return;

    /**
     * PANNING BEATS EVERY OTHER GESTURE, and it is allowed to someone who
     * cannot edit — looking around a roof is not an edit. Three ways in,
     * because these are the three a map is expected to answer to: the hand
     * tool, space held over any tool, and the middle or right button.
     */
    if (tool === "pan" || spaceHeld || ev.button === 1 || ev.button === 2) {
      panRef.current = { x: ev.clientX, y: ev.clientY };
      setPanning(true);
      try {
        canvasRef.current?.setPointerCapture(ev.pointerId);
      } catch {
        /* capture is an optimisation, not a requirement */
      }
      return;
    }

    if (!canEdit) return;
    const p = toCanvas(ev);
    const m = toMetres(p);

    // Placing the pin is a mode, not a grab radius. The pin sits in the middle
    // of the roof, exactly where the panels are, so anything that made it
    // grabbable by proximity would steal presses meant for a module.
    if (tool === "pin") return movePin(m);
    // Synthetic pointers (and a pointer already released) throw here, and an
    // exception mid-handler leaves the tool dead for the rest of the gesture.
    try {
      canvasRef.current?.setPointerCapture(ev.pointerId);
    } catch {
      /* capture is an optimisation, not a requirement */
    }

    if (tool === "setback" || tool === "face") {
      // Landing on a point already down ends the trace rather than stacking
      // another point on it. Hit-tested against the click, not against the
      // hover, so this works on a touchscreen too — there is no hover there.
      const on = setbackVertexAt(pendingRef.current, m, setbackSnapM(mpp));
      if (on) return finishTrace({ close: on === "close" });
      setPending([...(pendingRef.current ?? []), m]);
      return;
    }

    // Everything this gesture is about to change, so pointerup can record one
    // undo step for the whole of it rather than one per stage.
    gestureBeforeRef.current = blocksRef.current;

    /**
     * ERASE: a press knocks out the panel under it.
     *
     * Its own tool again as well as Alt on the pointer. Tested before anything
     * that could move an array, since the whole gesture is aimed at one cell.
     */
    if (tool === "erase") {
      const target = hit(m);
      if (target) removePanelAt(target);
      gestureBeforeRef.current = null;
      return;
    }

    /** ADD PANEL: one module, on the nearest array's lattice if there is one. */
    if (tool === "panel") {
      gestureBeforeRef.current = null;
      return addPanelAt(m, p);
    }

    /**
     * MOVE PANEL: slide one module out of its bank.
     *
     * Nothing happens on the press — see `pendingPanel`. The detach waits for
     * the pointer to actually go somewhere, which is the whole of the fix for
     * a click splitting an array.
     */
    if (tool === "movePanel") {
      const target = hit(m);
      if (!target) {
        gestureBeforeRef.current = null;
        return setSelectedId(null);
      }
      setSelectedId(target.block.id);
      return setDrag({
        kind: "pendingPanel",
        id: target.block.id,
        index: target.index,
        fromE: m.e,
        fromN: m.n,
        startX: p.x,
        startY: p.y,
      });
    }

    /**
     * DRAW ARRAY DRAWS, WHATEVER IS UNDER THE POINTER.
     *
     * Before anything that could hit a panel, a ghost or a grip. A rep who has
     * deliberately picked the rectangle tool and pressed on a roof that already
     * has modules on it means to draw over it — and a press that silently
     * dragged the array beneath instead is the tool doing something other than
     * the one thing its name promises.
     *
     * It only lasts one rectangle: `onPointerUp` hands control back to the
     * pointer as soon as the array lands, so the ghosts and grips of the thing
     * just drawn are immediately live.
     */
    if (tool === "draw") {
      setSelectedId(null);
      return setDrag({ kind: "new", fromX: p.x, fromY: p.y, toX: p.x, toY: p.y });
    }

    const h = hit(m);

    /**
     * ALT KNOCKS A PANEL OUT. This was a tool of its own — Remove panels — and
     * it is the clearest case for a modifier: it is destructive, it acts on
     * exactly the panel under the pointer, and a rep who leaves the palette in
     * that mode and comes back to it later erases the panel they meant to drag.
     */
    if (h && (ev.altKey || ev.button === 2)) {
      removePanelAt(h);
      gestureBeforeRef.current = null;
      return;
    }

    /**
     * COMMAND SLIDES ONE PANEL. Nothing happens yet — see `pendingPanel`. The
     * press only records which panel is under the pointer; the detach waits
     * until the pointer has actually gone somewhere.
     */
    if (h && (ev.metaKey || ev.ctrlKey)) {
      setSelectedId(h.block.id);
      return setDrag({
        kind: "pendingPanel",
        id: h.block.id,
        index: h.index,
        fromE: m.e,
        fromN: m.n,
        startX: p.x,
        startY: p.y,
      });
    }

    // The facing arrow, and the rotate and resize grips. Tested before the
    // array itself, since all three sit over or beside it.
    if (selected) {
      const img = { widthPx: canvasW, heightPx: canvasH };
      const hp = handlePositions(selected, moduleMm, mpp, img);
      // A fixed CSS-pixel radius, now that the canvas is measured in them. It
      // used to be a fraction of a 1280 px picture, which meant the size of a
      // grab target depended on how big the window happened to be.
      const grab = 18;
      const head = facingArrow(selected, moduleMm, mpp, img).to;
      if (Math.hypot(p.x - head.x, p.y - head.y) < FACING_GRIP_PX) {
        return setDrag({ kind: "facing", id: selected.id });
      }
      if (Math.hypot(p.x - hp.rotate.x, p.y - hp.rotate.y) < grab) {
        return setDrag({ kind: "rotate", id: selected.id });
      }
      if (Math.hypot(p.x - hp.resize.x, p.y - hp.resize.y) < grab) {
        return setDrag({ kind: "resize", id: selected.id });
      }
    }

    /**
     * A click on a green ghost adds a whole row or column, which is the fastest
     * thing in the tool — so it is tested before anything that would move the
     * array instead. A hole puts a removed panel back.
     *
     * UNLESS THE ONE-MODULE MODIFIER IS HELD, and then it is one panel. The
     * ghosts sit exactly where the next panel goes, so a rep aiming a single
     * module at the end of a row lands on one and gets six. ⌘ means one module
     * everywhere else on this canvas; it has to mean one module here.
     */
    const g = ev.metaKey || ev.ctrlKey ? null : hitGhost(m);
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
      gestureBeforeRef.current = null;
      return;
    }

    // A press on a panel selects its array and starts moving it. Whether it
    // really was a move is settled on release — see `moved`.
    if (h) {
      setSelectedId(h.block.id);
      return setDrag({
        kind: "move",
        id: h.block.id,
        fromE: m.e,
        fromN: m.n,
        originE: h.block.originE,
        originN: h.block.originN,
        startX: p.x,
        startY: p.y,
        moved: false,
      });
    }

    /**
     * BARE ROOF BESIDE AN ARRAY IS ONE MORE PANEL.
     *
     * What the Add panel tool does, without having to be in it. Only when the
     * press is within a cell or two of an array — further out is empty roof,
     * and pressing empty roof deselects.
     */
    if (nearestBlockFor(m)) {
      addPanelAt(m, p);
      gestureBeforeRef.current = null;
      return;
    }

    /**
     * COMMAND ON BARE ROOF PUTS ONE PANEL THERE.
     *
     * The same modifier that slides a single panel out of an array places a
     * single panel on its own, so it means "one module" wherever the pointer
     * is. This is the only way onto a patch of roof no array is near without
     * changing tool — the first panel on an empty house, or one on a detached
     * garage — since a plain click that far out is a deselection.
     */
    if (ev.metaKey || ev.ctrlKey) {
      addPanelAt(m, p);
      gestureBeforeRef.current = null;
      return;
    }

    gestureBeforeRef.current = null;
    setSelectedId(null);
  }

  function onPointerMove(ev: React.PointerEvent) {
    if (panRef.current) {
      const dx = ev.clientX - panRef.current.x;
      const dy = ev.clientY - panRef.current.y;
      panRef.current = { x: ev.clientX, y: ev.clientY };
      return panBy(dx, dy);
    }
    if ((tool === "setback" || tool === "face") && pendingRef.current) {
      const m = toMetres(toCanvas(ev));
      return setGhostPoint(m);
    }
    // The ref, not the state — see the note where it is declared.
    const d = dragRef.current;
    if (!d || lat == null) return;
    const p = toCanvas(ev);
    const m = toMetres(p);

    if (d.kind === "new") return setDrag({ ...d, toX: p.x, toY: p.y });

    /**
     * THE PANEL LEAVES THE GRID HERE, not on the press.
     *
     * Detaching on grab is what makes "slide this one to the right" a single
     * gesture — the panel follows the pointer and the hole it came from stays
     * knocked out. Doing it on the PRESS is what made a plain click split an
     * array. The threshold is the whole difference, and it is measured in
     * screen pixels so the same wobble means the same thing at every zoom.
     */
    if (d.kind === "pendingPanel") {
      if (!travelled(p, d.startX, d.startY)) return;
      const res = detachPanel(blocksRef.current, d.id, d.index, moduleMm, uid());
      if (!res) return setDrag(null);
      setBlocks(res.blocks);
      setDirty(true);
      const loose = res.blocks.find((x) => x.id === res.detachedId)!;
      setSelectedId(loose.id);
      return setDrag({
        kind: "move",
        id: loose.id,
        fromE: d.fromE,
        fromN: d.fromN,
        originE: loose.originE,
        originN: loose.originN,
        startX: d.startX,
        startY: d.startY,
        moved: true,
      });
    }

    const b = blocksRef.current.find((x) => x.id === d.id);
    if (!b) return;

    if (d.kind === "move") {
      // A press that has not gone anywhere is a click. Moving the array by the
      // half-pixel a resting hand produces would leave an undo step for a
      // gesture nobody made.
      if (!d.moved && !travelled(p, d.startX, d.startY)) return;
      const next = { ...b, originE: d.originE + (m.e - d.fromE), originN: d.originN + (m.n - d.fromN) };
      if (!d.moved) setDrag({ ...d, moved: true });
      return setBlocks((bs) => bs.map((x) => (x.id === b.id ? next : x)));
    }

    /**
     * Swinging the facing arrow.
     *
     * The bearing is taken from the array's CENTRE to the pointer, so the arrow
     * points where the hand is rather than trailing behind it, and the pointer
     * does not have to stay on the head to keep turning it.
     */
    if (d.kind === "facing") {
      const { spanX, spanY } = blockSpanM(b, moduleMm);
      const centre = blockLocalToGround(b, spanX / 2, spanY / 2);
      const raw = (Math.atan2(m.e - centre.e, m.n - centre.n) * 180) / Math.PI;
      return setBlocks((bs) =>
        bs.map((x) =>
          x.id === b.id
            ? {
                ...x,
                azimuthDeg: snapFacing(raw, ev.shiftKey),
                // Swung by hand, so it is theirs now. Leaving the mark on would
                // credit the roof — or the trace — with a number a person
                // overruled it with.
                facingSource: null,
              }
            : x
        )
      );
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
    if (panRef.current) {
      panRef.current = null;
      setPanning(false);
      return;
    }
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
          `That is ${wM.toFixed(1)} m x ${hM.toFixed(1)} m — one panel needs ${need.toFixed(2)} m x ${Math.max(w, h).toFixed(2)} m. Drag a bigger area, or hold \u2318 and click to place one by hand.`
        );
      }
      const topLeft = toMetres({ x: Math.min(d.fromX, to.x), y: Math.min(d.fromY, to.y) });
      const drawn: LayoutBlock = {
        id: uid(),
        originE: topLeft.e,
        originN: topLeft.n,
        rotationDeg: 0,
        cols: fit.cols,
        rows: fit.rows,
        orientation: fit.orientation,
        omitted: [],
      };
      const b: LayoutBlock = { ...drawn, ...orientationFor(drawn) };
      commit([...blocksRef.current, b]);
      setSelectedId(b.id);
      setTool("select");
      return;
    }

    /**
     * A LONE PANEL DROPPED BACK ON ITS ARRAY REJOINS IT.
     *
     * The other half of not splitting arrays. Even with the travel threshold, a
     * rep who grabs a panel, moves it and thinks better of it would otherwise
     * be left with a 1x1 block sitting on the array's own lattice — the thing
     * that looks like a panel in the array and is not one.
     *
     * Any lone panel, not only one detached this gesture: dragging a stray
     * module onto the end of a row is the same intention and deserves the same
     * answer. `absorbPanel` refuses everything that is not plainly a rejoin —
     * another angle, a taken cell, more than a cell away.
     */
    if (d.kind === "move" && d.moved) {
      const moved = blocksRef.current.find((x) => x.id === d.id);
      if (moved && moved.cols === 1 && moved.rows === 1) {
        const back = absorbPanel(blocksRef.current, d.id, moduleMm);
        if (back) {
          setBlocks(back.blocks);
          setSelectedId(back.hostId);
        }
      }
    }

    // move/rotate/resize edited the layout live, so the undo step is the layout
    // as it was when the gesture STARTED — but only if the gesture changed
    // anything. A press that never moved is a selection, and a selection is not
    // an edit to undo.
    const changed = d.kind !== "move" || d.moved;
    if (before && changed) {
      setHistory((h) => [...h.slice(-49), before]);
      setDirty(true);
    }
  }

  /**
   * A cancelled gesture is not a drawn array — the browser takes the pointer
   * away for a scroll or a window switch, and finishing the rectangle there
   * would drop panels somewhere the rep never released the mouse.
   */
  /**
   * Double-click: flip the facing, or finish a trace.
   *
   * A roof faces one of two ways off its own rows and the aerial cannot say
   * which — so "no, the other way" is the single most common correction there
   * is, and it deserves to be one gesture on the thing itself rather than a
   * trip to a button at the bottom of the screen.
   */
  /**
   * ATTACHED BY HAND, and it has to be.
   *
   * React registers wheel listeners at the root as PASSIVE, so a
   * `preventDefault` inside an `onWheel` prop is ignored with a console
   * warning — and a pinch over the roof zooms the browser's own chrome
   * instead of the picture. A native listener with `passive: false` is the
   * only way to own the gesture.
   */
  React.useEffect(() => {
    const el = canvasRef.current;
    if (!el || lat == null) return;
    const handler = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      const at = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      if (ev.ctrlKey || ev.metaKey) return zoomBy(Math.exp(-ev.deltaY * 0.01), at);
      panBy(-ev.deltaX, -ev.deltaY);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [lat, zoomBy, panBy]);

  function onDoubleClick(ev: React.MouseEvent) {
    if (!canEdit || lat == null) return;
    if (pendingRef.current) return finishTrace();
    if (!selected) return;
    const r = canvasRef.current!.getBoundingClientRect();
    const p = {
      x: ((ev.clientX - r.left) / r.width) * canvasW,
      y: ((ev.clientY - r.top) / r.height) * canvasH,
    };
    const head = facingArrow(selected, moduleMm, mpp, { widthPx: canvasW, heightPx: canvasH }).to;
    if (Math.hypot(p.x - head.x, p.y - head.y) > FACING_GRIP_PX) return;
    patchSelected({
      azimuthDeg: norm360(facingBearing(selected) + 180),
      facingSource: null,
    });
  }

  function onPointerCancel() {
    panRef.current = null;
    setPanning(false);
    const d = dragRef.current;
    if (!d) return;
    setDrag(null);
    const before = gestureBeforeRef.current;
    gestureBeforeRef.current = null;
    if (d.kind !== "new" && before) setHistory((h) => [...h.slice(-49), before]);
  }

  // ── Keyboard ───────────────────────────────────────────────────────────
  /**
   * Space turns whatever tool is selected into the hand, for as long as it is
   * held. Separate from the shortcut table below because it is a MODIFIER
   * rather than a choice: a rep nudging a panel wants to shove the picture
   * aside and carry on, not to switch tools and switch back.
   */
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.code === "Space" && !e.repeat) {
        // Or the page scrolls under the designer while the rep pans.
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };
    // A window that loses focus mid-pan must not come back still holding it.
    const blur = () => setSpaceHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

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
        return finishTrace();
      }
      // The tools, by their first letter. Esc always comes back to the pointer,
      // which is also how a trace is abandoned — one key that always means
      // "stop what I am in the middle of".
      if (e.key === "Escape" && !pendingRef.current) {
        setTool("select");
        return;
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const typed = e.key.toLowerCase();
        const next = (Object.keys(TOOL_KEYS) as Tool[]).find((t) => TOOL_KEYS[t] === typed);
        if (next) {
          e.preventDefault();
          return pickTool(next);
        }
      }

      if (!selected) return;

      /**
       * Square brackets swing the facing five degrees.
       *
       * The arrow is for the coarse move — grab it and point it at the horizon
       * the roof falls toward. This is the fine one, for a rep who knows the
       * roof faces 215 and wants to land on it exactly rather than wrestle a
       * pointer into a four-degree window.
       */
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        const step = e.key === "[" ? -FACING_SNAP_DEG : FACING_SNAP_DEG;
        return patchSelected({
          azimuthDeg: norm360(facingBearing(selected) + step),
          facingSource: null,
        });
      }

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
  }, [selected, blocks, commit, undo, canEdit, patchSelected, finishTrace, setPending, pickTool]);

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
    const res = await saveSolarLayoutAction({
      leadId,
      blocks,
      setbacks,
      // Only when the rep has actually corrected it. The blocks above are
      // already measured from this point — `movePin` re-based them the moment
      // it moved — so the two travel together and land in one write.
      ...(pinMoved && origin ? { origin } : {}),
    });
    if (!res.ok) {
      setBusy(false);
      return toast.error(res.error);
    }

    // The count is what the quote depends on, so it is saved first and stands on
    // its own. The picture is the customer's copy of the same thing — worth
    // reporting separately if it fails, never worth losing the count over.
    const canvas = canvasRef.current;
    if (canvas) {
      /**
       * FRAMED ON THE ARRAY, not on whatever the rep left the map showing.
       *
       * This used to export the designer's own fixed frame, which was fine only
       * because the frame could not move. Now that it can, a rep who panned to
       * the real house — the whole point of the feature — would have sent the
       * customer a photograph of empty ground beside it. The picture is the
       * array, so the array decides where it points.
       *
       * The scale is floored at the vendor's own resolution: framing tightly on
       * six panels would otherwise produce a magnified blur, and nobody wants
       * their roof delivered out of focus.
       */
      const size = { widthPx: EXPORT_PX, heightPx: EXPORT_PX };
      const corners = blocks.flatMap((b) =>
        panelCorners(b, moduleMm).flat().map((c) => ({ e: c.e, n: c.n }))
      );
      const framed = frameOn(corners, size, {
        marginM: 8,
        fallback: { centreE: centre.e, centreN: centre.n, mpp, ...size },
      });
      const floorMpp = lat == null ? framed.mpp : metresPerPixel(lat, GOOGLE_MAX_ZOOM, 2);
      const wanted: MapView = { ...framed, mpp: Math.max(framed.mpp, floorMpp) };

      /**
       * The customer gets a PHOTOGRAPH. A rep who flipped to the street map to
       * find a lot in a new subdivision — which is exactly what that layer is
       * there for — must not thereby post a road diagram as the roof layout.
       */
      const exportSource: BasemapSource = source === "road" ? "satellite" : source;

      /**
       * ONE IMAGE, not the mosaic that is on screen.
       *
       * Each Static Maps square carries Google's logo and imagery credit in its
       * corners, so a picture built from four of them carries four — scattered
       * across the middle of a document sent to a homeowner. A single image
       * centred on the array carries exactly one, in the corner, which is where
       * attribution belongs and what this screen produced before it could pan.
       *
       * Esri has no such stamp and no single-image endpoint, so it keeps the
       * mosaic; its credit is rendered by the proposal instead.
       */
      const single =
        origin && exportSource !== "esri"
          ? singleImageView(wanted, origin, { leadId, source: exportSource })
          : null;
      const exportView = single?.view ?? wanted;

      let backdrop: HTMLImageElement | null = null;
      if (single) {
        backdrop = await new Promise<HTMLImageElement | null>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img);
          // A save must not be lost to a slow tile: fall through to the mosaic,
          // which is very likely already in the cache from the screen.
          img.onerror = () => resolve(null);
          setTimeout(() => resolve(null), 8000);
          img.src = single.url;
        });
      }
      if (!backdrop) await basemap.preload(exportView, exportSource);

      /**
       * SIZED FROM THE VIEW, not from EXPORT_PX.
       *
       * A single-image export takes its dimensions from the imagery it is drawn
       * on. The two happen to be the same number today; taking it from the view
       * means they cannot quietly stop being, which would show up as a picture
       * with the panels drawn at the wrong scale rather than as an error.
       */
      const off = document.createElement("canvas");
      off.width = exportView.widthPx;
      off.height = exportView.heightPx;
      const octx = off.getContext("2d");

      // Re-render WITHOUT selection handles, ghosts or the drag outline: this
      // image is what the homeowner sees.
      if (octx) {
        paint(octx, { chrome: false, view: exportView, dpr: 1, source: exportSource, backdrop });
      }
      const blob = await new Promise<Blob | null>((r) => off.toBlob(r, "image/jpeg", 0.9));
      if (blob) {
        const fd = new FormData();
        fd.set("leadId", leadId);
        // The name is how the server tells this auto-rendered copy apart from a
        // layout a rep uploaded by hand — see DESIGNER_LAYOUT_FILENAME. Only
        // ours is superseded on the next save.
        fd.set("file", new File([blob], DESIGNER_LAYOUT_FILENAME, { type: "image/jpeg" }));
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
      {/* ── Top bar ──────────────────────────────────────────────────────────
          WHOSE ROOF, AND WHAT IT IS BUILT FROM — in that order of prominence.

          It used to carry five dropdowns in a row: module, inverter, battery,
          quantity and imagery. Every one of them was a decision made once and
          then looked at for the rest of the session, competing for width with
          the only thing on this bar a rep reads constantly, which is the
          address. They are one button now. The bar says whose house this is and
          what the system is in a sentence; pressing it opens the pickers,
          unchanged.
      ─────────────────────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center gap-2 border-b border-white/10 bg-neutral-900 px-3 py-2">
        <Link
          href={backHref}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="size-4" /> Proposal
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-white/5 px-2.5 py-1.5">
          <MapPin className="size-4 shrink-0 text-solar" />
          <span className="truncate text-sm">{address || "No address on this deal"}</span>
        </div>

        {lat != null && (
          <AddressSearch
            onPick={(p) => {
              if (!origin) return;
              const m = latLngToMetres(origin, p);
              if (Math.hypot(m.e, m.n) > panLimitM) {
                return toast.error("That address is outside the picture this deal can show.");
              }
              setCentre(clampCentre(m));
            }}
          />
        )}

        {/* ONE BUTTON for the whole system. The label is what a rep would say
            out loud — "twelve seven six, twenty-nine Silfabs" — so the common
            case of glancing at it costs no click at all. */}
        <SystemPicker
          catalogue={catalogue}
          equip={equip}
          disabled={!canEdit || equipBusy}
          busy={equipBusy}
          summary={
            moduleRatingW
              ? `${totals.systemSizeKwDc.toFixed(2)} kW · ${count} × ${
                  catalogue.module.find((o) => o.id === equip.moduleId)?.label ?? "module"
                }`
              : "Choose a module"
          }
          onChange={(patch) => void pickEquipment(patch)}
        />
      </header>

      {/* ── The roof ─────────────────────────────────────────────────────── */}
      {/*
        Two layers, and they must not be the same element. The canvas fills the
        viewport and the controls float over it; putting a control inside the
        canvas's own box is how a toolbar ends up sliding away under a pan.

        THE SCROLL CONTAINER IS GONE. It used to be the panning mechanism — a
        fixed 1280 px photograph in an `overflow-auto` box — which is exactly
        why the map could not be moved anywhere the photograph did not already
        cover. The canvas is now the size of the screen and the VIEW moves
        instead, so there is nothing to scroll.
      */}
      <div className="relative flex-1 overflow-hidden bg-neutral-950">
        <div ref={viewportRef} className="absolute inset-0">
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
            /**
             * How many corners the shape in progress has, for the tests.
             *
             * A trace lives entirely on the canvas, so a spec that closes one
             * and gets nothing can only report "no panels" — which is the same
             * symptom whether the corners never registered, the shape never
             * closed, or the fill found no room. Three different bugs behind
             * one message is three afternoons.
             */
            data-trace-points={pending?.length ?? 0}
            /* The backing store is in DEVICE pixels; the drawing is done in CSS
               pixels and scaled up by one transform at the top of `paint`. */
            width={Math.round(canvasW * dpr)}
            height={Math.round(canvasH * dpr)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onDoubleClick={onDoubleClick}
            onContextMenu={(e) => e.preventDefault()}
            style={{ width: canvasW, height: canvasH, touchAction: "none" }}
            className={cn(
              "block max-w-none",
              canEdit &&
                (tool === "draw" || tool === "face" || tool === "setback" || tool === "panel") &&
                "cursor-crosshair",
              canEdit && tool === "movePanel" && "cursor-grab",
              canEdit && tool === "erase" && "cursor-cell",
              // Over the dot that ends the trace it stops being a crosshair,
              // because this click is not another corner.
              canEdit && traceSnap && "!cursor-pointer",
              canEdit && tool === "select" && "cursor-default",
              // The hand says what a press will do before it is pressed.
              (tool === "pan" || spaceHeld) && "cursor-grab",
              panning && "!cursor-grabbing"
            )}
          />
        )}
        </div>

        {/* ── Tools ────────────────────────────────────────────────────────
            FEWER THINGS, AND THE COMMON ONE FIRST.

            The palette used to be eleven flat rows of equal weight: seven
            tools, two fill actions, the plane outlines, and whatever the
            selection added. Every one of them looked as important as every
            other, so the thing a rep does on nine roofs out of ten — cover it
            with panels — was the eighth row down and looked like a footnote.

            Now: one obvious action at the top, the tools that draw by hand
            under it, and the occasional ones behind `More`. Nothing was taken
            away and every keyboard shortcut still fires, so a rep who knows
            where something lives has not lost it — see TOOL_KEYS.

            The whole rail collapses, because it sits ON the roof and sometimes
            the roof is what you need to see.
        ───────────────────────────────────────────────────────────────────── */}
        {canEdit && lat != null && (
          <div className="pointer-events-none absolute inset-0">
            <div className="pointer-events-auto absolute left-3 top-3 w-48 overflow-hidden rounded-lg border border-black/10 bg-white text-neutral-900 shadow-lg">
              <div className="flex items-center justify-between border-b border-neutral-200 px-2 py-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  Tools
                </span>
                <button
                  type="button"
                  aria-label={railOpen ? "Hide the tools" : "Show the tools"}
                  aria-expanded={railOpen}
                  onClick={() => setRailOpen((v) => !v)}
                  className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
                >
                  <ChevronDown
                    className={cn("size-4 transition-transform", !railOpen && "-rotate-90")}
                  />
                </button>
              </div>

              {railOpen && (
                <>
                  {/*
                    THE ONE-CLICK PATH, at the top and in the colour that means
                    "press this". It is always offered, even before there is
                    anything to fill from: hiding it until Google had modelled
                    the roof is what made it invisible on every house this
                    company sells to — the Solar API is off, so `planes` is null
                    everywhere and the button simply never existed.
                  */}
                  <button
                    type="button"
                    data-testid="max-roof"
                    disabled={filling}
                    title={
                      fillSource === "planes"
                        ? "Cover every roof plane Google modelled with panels. Replaces the fill — undo puts it back."
                        : fillSource === "faces"
                          ? "Cover every roof face you have traced with as many panels as it holds. Replaces the fill — undo puts it back."
                          : "Cover the roof with panels, working from the building's outline. Replaces the fill — undo puts it back."
                    }
                    onClick={() => void maxRoof()}
                    className="flex w-full items-center gap-2 bg-solar px-3 py-2.5 text-left text-sm font-semibold text-solar-foreground hover:brightness-95 disabled:opacity-60"
                  >
                    {filling ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Wand2 className="size-4" />
                    )}{" "}
                    {filling ? "Reading the building…" : "Fill this roof"}
                  </button>
                  {/*
                    NOT DISABLED WHEN THERE IS NO TARGET. It was greyed out on
                    any deal without an annual usage figure, with the reason
                    hidden in a tooltip — a control that looks broken to
                    everyone who does not hover. It presses, and it says what is
                    missing and where to fill it in.
                  */}
                  <button
                    type="button"
                    data-testid="trim-to-usage"
                    title={
                      annualUsageKwh && annualUsageKwh > 0
                        ? `Take the worst-facing panels off until the system just covers ${Math.round(annualUsageKwh).toLocaleString()} kWh a year.`
                        : "Needs the home's annual usage, which comes from the Energy step."
                    }
                    onClick={trimToUsage}
                    className="flex w-full items-center gap-2 border-b border-neutral-200 px-3 py-2 text-left text-sm font-medium hover:bg-neutral-100"
                  >
                    <Scissors className="size-4" /> Trim to usage
                  </button>

                  {(
                    [
                      ["select", "Pointer", MousePointer2],
                      ["face", "Roof face", Pentagon],
                      ["draw", "Draw array", Square],
                      ["panel", "Add panel", Plus],
                      ["erase", "Remove panels", Eraser],
                    ] as const
                  ).map(([id, label, Icon]) => (
                    <ToolButton
                      key={id}
                      id={id}
                      label={label}
                      Icon={Icon}
                      active={tool === id}
                      onPick={pickTool}
                    />
                  ))}

                  {/*
                    The rest. Not hidden — one press away, and named so that
                    somebody looking for "Setbacks" finds where it went.
                  */}
                  <details className="group border-t border-neutral-200">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-100">
                      <ChevronDown className="size-4 -rotate-90 transition-transform group-open:rotate-0" />
                      More
                    </summary>
                    {(
                      [
                        ["movePanel", "Move panel", Move],
                        ["setback", "Setbacks", Ruler],
                      ] as const
                    ).map(([id, label, Icon]) => (
                      <ToolButton
                        key={id}
                        id={id}
                        label={label}
                        Icon={Icon}
                        active={tool === id}
                        onPick={pickTool}
                      />
                    ))}
                    {planes && (
                      <button
                        type="button"
                        aria-pressed={showPlanes}
                        title="Outline the roof planes Google has modelled, with the way each one faces."
                        onClick={() => setShowPlanes((v) => !v)}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium",
                          showPlanes ? "bg-sky-600 text-white" : "hover:bg-neutral-100"
                        )}
                      >
                        <Layers className="size-4" /> Roof planes
                      </button>
                    )}
                  </details>

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
                </>
              )}
            </div>

            {/* The size of the fill, in the unit the conversation happens in.
                A homeowner asks "what does one more panel do to the payment",
                never "what does another 640 kWh do", so the control counts
                panels and the figures beside it move as they are added. */}
            {fillCount != null && (
              <div className="pointer-events-auto absolute left-3 top-[21rem] w-44 rounded-lg border border-black/10 bg-white p-2 text-neutral-900 shadow-lg">
                <div className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                  Fill size
                </div>
                <div className="flex items-center justify-between gap-1">
                  <button
                    type="button"
                    aria-label="One panel fewer"
                    disabled={fillCount <= 1}
                    onClick={() => void maxRoof(fillCount - 1)}
                    className="rounded border border-neutral-300 p-1.5 hover:bg-neutral-100 disabled:opacity-40"
                  >
                    <Minus className="size-3.5" />
                  </button>
                  <span className="text-sm font-semibold tabular-nums">
                    {fillCount} {fillCount === 1 ? "panel" : "panels"}
                  </span>
                  <button
                    type="button"
                    aria-label="One panel more"
                    onClick={() => void maxRoof(fillCount + 1)}
                    className="rounded border border-neutral-300 p-1.5 hover:bg-neutral-100"
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>
                {/* Says what it does, because it re-fills rather than editing
                    what is on screen — see `fillCount`. */}
                <p className="px-1 pt-1.5 text-[11px] leading-snug text-neutral-500">
                  Re-fills the roof at this size, worst-facing panels off first.
                </p>
              </div>
            )}

            {/*
              How far back from the traced line panels sit.
              
              Beside the tool that uses it, and in inches, because that is the
              unit the rule is written in — "three feet from the ridge" is a
              sentence a rep says to a homeowner. Changing it re-fills every
              traced face on the spot, so the effect on the panel count is
              visible while the number is being chosen rather than after.
            */}
            {tool === "face" && (
              <div className="pointer-events-auto absolute left-52 top-3 w-64 rounded-lg border border-black/10 bg-white p-3 text-neutral-900 shadow-lg">
                <Label className="text-xs font-medium text-neutral-600">Edge setback</Label>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={48}
                    step={6}
                    aria-label="Edge setback in inches"
                    value={Math.round(faceInsetM * 39.3701)}
                    onChange={(e) => {
                      const inches = Math.max(0, Math.min(48, Number(e.target.value) || 0));
                      setFaceInsetM(inches / 39.3701);
                    }}
                    className="h-8 w-20 rounded border border-neutral-300 px-2 text-sm"
                  />
                  <span className="text-xs text-neutral-500">inches from the traced edge</span>
                </div>
                <p className="mt-2 text-[11px] leading-snug text-neutral-600">
                  Click the corners of one roof plane, then click the first dot to close it. Panels
                  fill what is left inside.
                </p>
                {blocks.some((b) => b.face) && (
                  <button
                    type="button"
                    onClick={() => void maxRoof()}
                    className="mt-2 w-full rounded border border-neutral-300 px-2 py-1 text-xs font-medium hover:bg-neutral-100"
                  >
                    Re-fill traced faces at this setback
                  </button>
                )}
              </div>
            )}

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
                  onChange={(v) => patchSelected({ tiltDeg: v, facingSource: null })}
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {COMMON_PITCHES.slice(0, 6).map((rise) => (
                    <button
                      key={rise}
                      type="button"
                      onClick={() =>
                        patchSelected({ tiltDeg: pitchToTiltDeg(rise), facingSource: null })
                      }
                      className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] hover:bg-neutral-100"
                    >
                      {rise}/12
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => patchSelected({ tiltDeg: 0, facingSource: null })}
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
                    They earn the generic market yield — the same kWh a south roof would.{" "}
                    {/*
                      Say why the building did not answer, which is a different
                      sentence in each case — and while it is still being asked,
                      say nothing at all rather than blame a roof nobody has
                      looked at yet.
                    */}
                    {roofState === "looking" ? (
                      "Reading the roof now — this usually settles in a second."
                    ) : (
                      <>
                        {roofState === "none"
                          ? "This address has no roof model to read them off, so these are yours to say: "
                          : "The building has nothing to say about these — a ground mount, or panels past the modelled roof: "}
                        select the array and <strong>swing the grey arrow</strong> to the horizon
                        the roof falls toward. Double-click the arrowhead to flip it.
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {/*
              The other half of the story, and it needs saying out loud: angles
              that were read for the rep are still only on screen until the
              design is saved. Not amber — nothing is wrong here.
            */}
            {moduleRatingW && justFilled > 0 && (
              <div
                data-testid="roof-read-note"
                className="pointer-events-auto absolute right-3 top-20 max-w-sm rounded-lg border border-sky-300 bg-sky-50 p-2.5 text-xs text-sky-900 shadow-lg"
                style={totals.unorientedArrays > 0 ? { top: "10.5rem" } : undefined}
              >
                <strong>
                  {justFilled === 1
                    ? "One array took its facing"
                    : `${justFilled} arrays took their facing`}{" "}
                  off the roof.
                </strong>{" "}
                {planes?.imageryDate ? `Google's model of this building, ${planes.imageryDate}. ` : ""}
                Turn on <em>Roof planes</em> to see what it read, and <em>Save</em> to keep these
                figures on the deal.
              </div>
            )}

            {imageState === "failed" && (
              <div className="pointer-events-auto absolute bottom-3 left-3 max-w-sm rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 shadow-lg">
                <strong>No imagery is loading.</strong> Try another map — Esri needs no Google key
                at all, so if it works and the others do not, the key or its API allow-list is the
                problem. Panels you draw are still saved against the real coordinates either way.
              </div>
            )}

            {pending && (
              <div className="pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-neutral-900 px-4 py-2 text-xs text-white shadow-lg">
                {traceKind === "face"
                  ? "Click the corners of one roof plane · "
                  : "Click along the edge · "}
                <strong>click the first dot to close</strong> · double-click or Enter to finish ·
                Esc to cancel
              </div>
            )}

            {/*
              WHAT THE POINTER DOES, written down.
              
              Five tools became modifiers, and a modifier nobody is told about
              is a feature nobody has. It sits on the picture rather than in a
              help page because that is where the hand already is, and it goes
              away while a shape is being traced, when none of it applies.
            */}
            {!pending && tool === "select" && (
              <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-neutral-900/80 px-4 py-1.5 text-[11px] text-white/85 shadow-lg">
                Drag to move · <strong>⌘ drag</strong> one panel · <strong>⌥ click</strong> to
                remove · click beside an array to add · <strong>swing the arrow</strong> to set the
                facing · <strong>space-drag</strong> or two fingers to move the picture
              </div>
            )}

            {/* ── The map ────────────────────────────────────────────────────
                WHICH PICTURE, AND WHERE IT IS POINTED.

                All of this is new, and all of it exists for one report: houses
                that are not on the map. There turned out to be three different
                causes wearing that one sentence — the photo predates the house,
                the geocoder framed the wrong roof, or the vendor has nothing at
                that depth — and a rep cannot tell them apart without being able
                to change the vendor, move the picture, and move the pin.
            ─────────────────────────────────────────────────────────────── */}
            <div className="pointer-events-auto absolute bottom-3 right-3 w-44 overflow-hidden rounded-lg border border-black/10 bg-white text-neutral-900 shadow-lg">
              <div className="grid grid-cols-2">
                {BASEMAP_SOURCES.map((b, i) => (
                  <button
                    key={b}
                    type="button"
                    aria-pressed={source === b}
                    title={BASEMAP_HINT[b]}
                    onClick={() => setSource(b)}
                    className={cn(
                      "border-neutral-200 px-2 py-1.5 text-xs font-medium",
                      i >= 2 && "border-t",
                      i % 2 === 0 && "border-r",
                      source === b ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"
                    )}
                  >
                    {BASEMAP_LABEL[b]}
                  </button>
                ))}
              </div>

              <div className="flex border-t border-neutral-200">
                <button
                  type="button"
                  aria-label="Zoom out"
                  className="flex-1 border-r border-neutral-200 px-2 py-1.5 hover:bg-neutral-100"
                  onClick={() => zoomBy(1 / 1.4)}
                >
                  <ZoomOut className="mx-auto size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Zoom in"
                  className="flex-1 border-r border-neutral-200 px-2 py-1.5 hover:bg-neutral-100"
                  onClick={() => zoomBy(1.4)}
                >
                  <ZoomIn className="mx-auto size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Fit the array on screen"
                  title="Frame the whole array."
                  className="flex-1 px-2 py-1.5 hover:bg-neutral-100"
                  onClick={fitToArray}
                >
                  <Maximize2 className="mx-auto size-4" />
                </button>
              </div>

              <div className="flex border-t border-neutral-200">
                <button
                  type="button"
                  aria-pressed={tool === "pan"}
                  aria-label="Move the picture"
                  title="Drag the picture. Space, the middle button and two fingers do the same thing."
                  onClick={() => pickTool(tool === "pan" ? "select" : "pan")}
                  className={cn(
                    "flex-1 border-r border-neutral-200 px-2 py-1.5",
                    tool === "pan" ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"
                  )}
                >
                  <Hand className="mx-auto size-4" />
                </button>
                {canEdit && (
                  <button
                    type="button"
                    aria-pressed={tool === "pin"}
                    aria-label="Move the pin"
                    title="Click the roof this deal is actually about. The drawing stays where it is; only the address's coordinate moves."
                    onClick={() => pickTool(tool === "pin" ? "select" : "pin")}
                    className={cn(
                      "flex-1 border-r border-neutral-200 px-2 py-1.5",
                      tool === "pin" ? "bg-solar text-solar-foreground" : "hover:bg-neutral-100"
                    )}
                  >
                    <Crosshair className="mx-auto size-4" />
                  </button>
                )}
                <button
                  type="button"
                  aria-pressed={showPin}
                  aria-label="Show the pin"
                  title="Show or hide the marker on the deal's coordinate. It is never in the customer's picture either way."
                  onClick={() => setShowPin((v) => !v)}
                  className={cn(
                    "flex-1 px-2 py-1.5",
                    showPin ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"
                  )}
                >
                  <MapPin className="mx-auto size-4" />
                </button>
              </div>

              {/* The vendor's own credit line, which both require. */}
              <div className="border-t border-neutral-200 px-2 py-1 text-[10px] leading-tight text-neutral-500">
                {attribution(source)}
              </div>
            </div>

            {/* ── What the picture cannot do ─────────────────────────────────
                Said out loud, because every one of these reads as "the tool is
                broken" when it is not explained.
            ─────────────────────────────────────────────────────────────── */}
            {lat != null && (
              <div className="pointer-events-none absolute bottom-14 left-1/2 flex max-w-[90vw] -translate-x-1/2 flex-col items-center gap-1 text-center">
                {tool === "pin" && (
                  <div className="pointer-events-auto rounded-full bg-solar px-4 py-1.5 text-[11px] font-medium text-solar-foreground shadow-lg">
                    Click the roof this deal is about. The panels stay where they are.
                  </div>
                )}
                {pinMoved && (
                  <div className="pointer-events-auto rounded-full bg-neutral-900 px-4 py-1.5 text-[11px] text-white shadow-lg">
                    Pin moved. <strong>Save</strong> to keep it on the deal.
                  </div>
                )}
                {isUpsampled(source, lat, mpp) && (
                  <div className="rounded-full bg-neutral-900/80 px-4 py-1.5 text-[11px] text-white/85 shadow-lg">
                    {source === "esri"
                      ? `Magnified — Esri has no sharper picture than zoom ${ESRI_MAX_ZOOM} here.`
                      : `Magnified — Google serves nothing deeper than zoom ${GOOGLE_MAX_ZOOM}.`}{" "}
                    Panels are still drawn to true scale.
                  </div>
                )}
              </div>
            )}
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
                  patchSelected({
                    azimuthDeg: e.target.value === "" ? null : Number(e.target.value),
                    // Typed over, so it is theirs now. Leaving the mark on would
                    // credit the roof with a number a person overruled it with.
                    facingSource: null,
                  })
                }
                /* Wide enough for a bearing read off the building, which
                   arrives with a decimal on it: 179.7 was showing as "179.7(". */
                className="h-7 w-20 rounded border border-white/20 bg-white/10 px-1.5 text-sm text-white"
              />
              <span className="w-7 font-medium text-white">
                {selected.azimuthDeg == null ? "—" : compassLabel(selected.azimuthDeg)}
              </span>
            </label>

            {/* Where the number came from. A measurement and a guess must not
                look the same on a screen a price is read off. */}
            {selected.facingSource === "roof" && (
              <span
                data-testid="facing-source"
                title={`Read off this building's roof plane${planes?.imageryDate ? `, from Google's model of ${planes.imageryDate}` : ""}. Type over it to make it yours.`}
                className="inline-flex items-center gap-1 rounded-full bg-sky-500/20 px-2 py-0.5 text-[11px] font-medium text-sky-200"
              >
                <Layers className="size-3" /> from the roof
              </span>
            )}

            {/*
              A THIRD KIND OF CLAIM, and it must not wear the measurement's
              badge. "From the roof" is Google's photogrammetry of this
              building. This is square off the outer edge of a shape a person
              drew — better than a coin toss, worse than a measurement, and only
              ever as good as the trace. Swinging the arrow clears it, because
              from that moment the number is theirs.
            */}
            {selected.facingSource === "traced" && (
              <span
                data-testid="facing-source"
                title="Square off the eave of the roof face you traced — the edge of it farthest from the middle of the house. Swing the arrow to overrule it."
                className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-200"
              >
                <Pentagon className="size-3" /> from your trace
              </span>
            )}

            {selectedStraddles && (
              <span
                data-testid="straddle-warning"
                title="Two planes with different facings are being priced as one. Split the array at the ridge and each half gets its own."
                className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-200"
              >
                crosses 2 roof planes
              </span>
            )}

            {/*
              EIGHT POINTS, ONE CLICK EACH.
              
              The arrow is the precise control and the box is the exact one, and
              between them they still made the commonest answer on any roof —
              "it faces south-west" — a drag or a typed number. A rep says the
              compass point out loud to the homeowner; this is that sentence as
              a button.
              
              The one that is currently set is lit, so the row doubles as the
              readout: eight buttons where one is on say more, faster, than a
              number and a two-letter abbreviation beside it.
            */}
            <div
              className="flex overflow-hidden rounded border border-white/20"
              role="group"
              aria-label="Facing"
            >
              {COMPASS_POINTS.map(({ label, deg }) => {
                // The nearest point lights up, not only an exact match: a
                // facing of 182 read off the building is south, and a row of
                // eight buttons with none of them lit says nothing.
                const on =
                  selected.azimuthDeg != null &&
                  Math.abs(((norm360(selected.azimuthDeg) - deg + 540) % 360) - 180) < 22.5;
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    title={`Face ${deg}° — ${label}`}
                    onClick={() => patchSelected({ azimuthDeg: deg, facingSource: null })}
                    className={cn(
                      "px-1.5 py-1 text-[11px] font-semibold tabular-nums",
                      on ? "bg-solar text-solar-foreground" : "text-white/75 hover:bg-white/15"
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 border-white/20 bg-white/10 text-white hover:bg-white/20"
              title="Face square off the rows — the down-slope direction for an array aligned to the ridge."
              onClick={() =>
                patchSelected({
                  azimuthDeg: norm360(selected.rotationDeg + 90),
                  facingSource: null,
                })
              }
            >
              <Compass className="size-4" /> Off the rows
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 border-white/20 bg-white/10 text-white hover:bg-white/20"
              onClick={() =>
                patchSelected({
                  azimuthDeg: norm360((selected.azimuthDeg ?? facingBearing(selected)) + 180),
                  facingSource: null,
                })
              }
            >
              Flip 180°
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 border-white/20 bg-white/10 text-white hover:bg-white/20"
              title="Due south at this site's optimal tilt — for a ground mount or a tilt-up frame."
              onClick={() =>
                patchSelected({ azimuthDeg: 180, tiltDeg: bestTilt, facingSource: null })
              }
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

            {selected.face && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 border-white/20 bg-white/10 text-white hover:bg-white/20"
                title="Cover this traced face again with everything it holds — after changing the module, the edge setback, or a setback line."
                onClick={() => fillTracedFace(selected.face!, selected.id)}
              >
                <Wand2 className="size-4" /> Re-fill face
              </Button>
            )}

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
              PUT THE SAVED DESIGN BACK. Only offered when what is on screen is
              not what was opened, so it is invisible on a design nobody has
              touched — and it goes through `commit`, so pressing it by mistake
              is itself one undo away.
            */}
            {savedPanels > 0 && count !== savedPanels && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-testid="revert-saved"
                className="h-8 text-white/70 hover:bg-white/10 hover:text-white"
                title={`Put back the ${savedPanels} ${savedPanels === 1 ? "panel" : "panels"} this design was opened with. Undo brings your changes back.`}
                onClick={() => {
                  commit(savedRef.current);
                  setSelectedId(null);
                  toast.success(
                    `Back to the saved design — ${savedPanels} ${savedPanels === 1 ? "panel" : "panels"}.`
                  );
                }}
              >
                <RotateCw className="size-4" /> Back to saved ({savedPanels})
              </Button>
            )}
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
/**
 * One row of the palette.
 *
 * Extracted so the primary group and the `More` group cannot drift apart — the
 * shortcut hint in particular, which has to keep matching TOOL_KEYS or a button
 * is printing a lie about which key fires it.
 */
function ToolButton({
  id,
  label,
  Icon,
  active,
  onPick,
}: {
  id: Tool;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onPick: (id: Tool) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onPick(id)}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium",
        active ? "bg-solar text-solar-foreground" : "hover:bg-neutral-100"
      )}
    >
      <Icon className="size-4" /> {label}
      {/*
        Hidden from the accessibility tree on purpose. A shortcut hint is not
        part of what the button is called — leaving it in makes this control
        answer to "Pointer V", which is a name nobody would look for, by voice
        or otherwise.
      */}
      <kbd aria-hidden="true" className="ml-auto text-[10px] font-normal opacity-60">
        {TOOL_KEYS[id].toUpperCase()}
      </kbd>
    </button>
  );
}

/**
 * The whole system behind one button.
 *
 * The pickers inside are the ones that used to sit in a row across the top bar,
 * unchanged — this is a matter of WHERE they live, not what they do. What the
 * button itself shows is the answer they add up to, because that is the thing a
 * rep actually reads while drawing: the size, the count and the panel.
 *
 * `details`/`summary` rather than a popover library: it opens on click, closes
 * on Escape, is reachable by keyboard and needs no state to keep in step.
 */
function SystemPicker({
  catalogue,
  equip,
  disabled,
  busy,
  summary,
  onChange,
}: {
  catalogue: { module: EquipOption[]; inverter: EquipOption[]; battery: EquipOption[] };
  equip: { moduleId: string | null; inverterId: string | null; batteryId: string | null; batteryQty: number };
  disabled: boolean;
  busy: boolean;
  summary: string;
  onChange: (patch: Partial<{ moduleId: string | null; inverterId: string | null; batteryId: string | null; batteryQty: number }>) => void;
}) {
  return (
    <details className="group relative shrink-0">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-white hover:bg-white/10">
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sun className="size-3.5 text-solar" />}
        <span className="max-w-[18rem] truncate">{summary}</span>
        <ChevronDown className="size-3.5 opacity-60 transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-80 space-y-2 rounded-lg border border-white/15 bg-neutral-900 p-3 shadow-xl">
        {/* Chosen HERE, not on a settings page. The panel decides how many fit
            on the roof and what each one is worth, and both are questions you
            are looking at while you draw. The catalogue's starred default is
            the fallback it was always meant to be. */}
        <EquipPicker label="Module" options={catalogue.module} value={equip.moduleId} disabled={disabled} onChange={(id) => onChange({ moduleId: id })} />
        <EquipPicker label="Inverter" options={catalogue.inverter} value={equip.inverterId} disabled={disabled} onChange={(id) => onChange({ inverterId: id })} />
        <EquipPicker label="Battery" options={catalogue.battery} value={equip.batteryId} disabled={disabled} onChange={(id) => onChange({ batteryId: id })} />
        {/* HOW MANY OF THEM. Only once there is a battery to count — a
            quantity box beside an empty slot is a question with no meaning.
            It matters beyond the equipment list: the battery programme pays
            per battery, so a second Powerwall nobody could record was a second
            Powerwall nobody got paid for. */}
        {equip.batteryId && (
          <label className="flex items-center justify-between gap-1.5 rounded-md bg-white/5 px-2 py-1.5 text-xs text-white/45">
            <span>Batteries</span>
            <select
              className="rounded bg-transparent py-0.5 text-white outline-none disabled:opacity-50"
              value={Math.max(1, equip.batteryQty)}
              aria-label="How many batteries"
              disabled={disabled}
              onChange={(e) => onChange({ batteryQty: Number(e.target.value) })}
            >
              {/* Always long enough to contain the number actually on the
                  design: a company whose standard is eight would otherwise
                  land on a select with no matching option, which renders
                  blank and reads as "no batteries". */}
              {Array.from({ length: Math.max(6, Math.max(1, equip.batteryQty)) }, (_, i) => i + 1).map((n) => (
                <option className="text-black" key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        )}
      </div>
    </details>
  );
}

/**
 * Jump the picture to another address.
 *
 * IT MOVES THE VIEW AND NOTHING ELSE. Searching is how a rep finds the house
 * when the geocoder put the deal on the wrong street — a look, not a decision —
 * so it must never quietly rewrite the deal's own coordinate. Committing to
 * what was found is a separate, deliberate act: drop the pin.
 *
 * Rides the portal's existing address suggestion route, so it inherits the
 * Places-then-Geocoding-then-Nominatim chain and its billing session rather
 * than opening a second way to ask the same question.
 */
function AddressSearch({ onPick }: { onPick: (p: { lat: number; lng: number }) => void }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<{ label: string; placeId: string | null; lat: number | null; lng: number | null }[]>([]);
  const [looking, setLooking] = React.useState(false);
  // One token for the whole typing session is what makes Google bill a session
  // rather than a request per keystroke.
  const [session] = React.useState(() =>
    typeof crypto !== "undefined" ? crypto.randomUUID() : "designer-search"
  );

  React.useEffect(() => {
    let live = true;
    // Everything happens inside the debounce, including the clearing: a
    // `setState` in the body of an effect is a second render for a decision
    // that could just as well be made a quarter of a second later.
    const t = setTimeout(() => {
      if (!live) return;
      if (!open || q.trim().length < 4) return setHits([]);
      setLooking(true);
      fetch(`/api/geocode/autocomplete?q=${encodeURIComponent(q)}&session=${session}`)
        .then((r) => r.json())
        .then((b) => {
          if (!live) return;
          setHits(
            (b.results ?? []).slice(0, 6).map((r: { label?: string; placeId?: string | null; parts?: { lat?: number; lng?: number } }) => ({
              label: r.label ?? "",
              placeId: r.placeId ?? null,
              lat: r.parts?.lat ?? null,
              lng: r.parts?.lng ?? null,
            }))
          );
        })
        .catch(() => live && setHits([]))
        .finally(() => live && setLooking(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, open, session]);

  async function choose(h: { placeId: string | null; lat: number | null; lng: number | null }) {
    setOpen(false);
    setQ("");
    // Nominatim answers with the coordinate up front; Places deliberately does
    // not, and charges for the details call that carries it.
    if (h.lat != null && h.lng != null) return onPick({ lat: h.lat, lng: h.lng });
    if (!h.placeId) return;
    const r = await fetch(`/api/geocode/place?placeId=${encodeURIComponent(h.placeId)}&session=${session}`).then((r) => r.json()).catch(() => null);
    const p = r?.place;
    if (p?.lat != null && p?.lng != null) onPick({ lat: p.lat, lng: p.lng });
    else toast.error("That address could not be placed on the map.");
  }

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Find an address on the map"
        title="Move the picture to another address. It does not change the deal."
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-md border border-white/15 bg-white/5 p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
      >
        <Search className="size-4" />
      </button>
    );
  }

  return (
    <div className="relative shrink-0">
      <input
        autoFocus
        value={q}
        placeholder="Find an address…"
        aria-label="Find an address on the map"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && (setOpen(false), setQ(""))}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="h-8 w-56 rounded-md border border-white/15 bg-white/5 px-2 text-xs text-white outline-none placeholder:text-white/35"
      />
      {(hits.length > 0 || looking) && (
        <ul className="absolute right-0 z-20 mt-1 w-72 overflow-hidden rounded-lg border border-white/15 bg-neutral-900 shadow-xl">
          {looking && hits.length === 0 && <li className="px-3 py-2 text-xs text-white/50">Looking…</li>}
          {hits.map((h, i) => (
            <li key={`${h.placeId ?? h.label}-${i}`}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void choose(h)}
                className="block w-full px-3 py-2 text-left text-xs text-white hover:bg-white/10"
              >
                {h.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
    <div className="flex items-center justify-between gap-1.5 rounded-md bg-white/5 px-2 py-1.5 text-xs">
      <label htmlFor={id} className="shrink-0 text-white/45">
        {label}
      </label>
      <select
        id={id}
        className="min-w-0 max-w-[13rem] truncate rounded bg-transparent py-0.5 text-white outline-none disabled:opacity-60"
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

/**
 * The eight points of the compass, as a rep says them.
 *
 * Eight rather than sixteen: nobody looks at an aerial photograph and concludes
 * west-north-west. The arrow and the number box are there for the roof that
 * really does face 187.
 */
const COMPASS_POINTS = [
  { label: "N", deg: 0 },
  { label: "NE", deg: 45 },
  { label: "E", deg: 90 },
  { label: "SE", deg: 135 },
  { label: "S", deg: 180 },
  { label: "SW", deg: 225 },
  { label: "W", deg: 270 },
  { label: "NW", deg: 315 },
] as const;

/** 0..359, so a flip past north and a negative bearing both read normally. */
function norm360(deg: number): number {
  // Rounded FIRST, then wrapped. Wrapping first leaves 359.7 to round up to
  // 360 — a bearing that is really north, written as a number no compass has,
  // that a 0..359 input rejects and that misses the yield cache keyed on 0.
  return Math.round(((deg % 360) + 360) % 360) % 360;
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
 * Which way an array is TAKEN to face, for drawing purposes.
 *
 * An array nobody has described still gets an arrow, pointing square off its
 * own rows — the direction it would face if the grid were laid along a ridge,
 * which is the overwhelmingly common case and the same sum `Off the rows`
 * applies. The arrow is drawn grey to say the tool is guessing, and the
 * production model is NOT told: `azimuthDeg` stays null and the system keeps
 * pricing on the flat market yield until somebody actually says.
 *
 * That distinction is the whole point. Before this there was no arrow at all
 * until a facing had been typed, so the one control that makes the facing easy
 * to set only appeared once it had been set the hard way.
 */
function facingBearing(b: LayoutBlock): number {
  return b.azimuthDeg ?? norm360(b.rotationDeg + 90);
}

/**
 * The facing arrow in canvas pixels: where it starts, where its head is, and
 * whether the angle is a stated one or the tool's guess.
 *
 * ONE function for the painter and the hit test, like `handlePositions` and for
 * the same reason — an arrowhead drawn somewhere the press does not look for is
 * a control that silently does nothing, and this one is meant to be grabbed.
 */
function facingArrow(
  b: LayoutBlock,
  m: ModuleMm,
  mpp: number,
  img: { widthPx: number; heightPx: number }
): {
  from: { x: number; y: number };
  to: { x: number; y: number };
  bearing: number;
  stated: boolean;
} {
  const { spanX, spanY } = blockSpanM(b, m);
  const centre = blockLocalToGround(b, spanX / 2, spanY / 2);
  const from = metresToImagePx(centre.e, centre.n, mpp, img);

  const bearing = facingBearing(b);
  const rad = (bearing * Math.PI) / 180;

  /**
   * THE ARROW HAS TO CLEAR THE ARRAY'S GROW GHOSTS, not just the array.
   *
   * An array nobody has described faces square off its own rows, which for an
   * ordinary unrotated grid is due east — pointing straight at the green ghost
   * off its right-hand edge. The head is a grip and grips are tested before
   * ghosts, so the arrow sat on top of the ghost and swallowed every click
   * meant to add a column. The fastest thing in the tool, blocked by the
   * newest.
   *
   * So the head goes one whole module past wherever the ray leaves the array,
   * measured in the block's OWN frame — exact in every direction, and no longer
   * than it needs to be. `Math.min(spanX, spanY)` was neither: on a wide array
   * pointing along its length it stopped well short of the edge.
   */
  const { w: panelW, h: panelH } = panelSizeM(m, b.orientation);
  // The ray, in the block's frame: local +x lies at bearing `rotationDeg + 90`.
  const local = ((bearing - b.rotationDeg - 90) * Math.PI) / 180;
  const dx = Math.cos(local);
  const dy = Math.sin(local);
  const exitM = Math.min(
    Math.abs(dx) < 1e-6 ? Infinity : Math.abs(spanX / 2 / dx),
    Math.abs(dy) < 1e-6 ? Infinity : Math.abs(spanY / 2 / dy)
  );
  const clearM = (Number.isFinite(exitM) ? exitM : 0) + Math.max(panelW, panelH);
  // Never shorter than a grabbable stub, for a single panel on a wide picture.
  const len = Math.max(46, clearM / mpp + 18);
  // Screen y grows downward while north grows up, hence the negated cosine.
  const to = { x: from.x + Math.sin(rad) * len, y: from.y - Math.cos(rad) * len };
  return { from, to, bearing, stated: b.azimuthDeg != null };
}

/**
 * Paint the facing arrow, with the compass point and what the plane returns.
 *
 * Drawn because azimuth is the one property here that cannot be seen. A grid
 * rotated to sit square on the roof looks finished, and there is nothing in the
 * picture to say it is pointing at the wrong horizon.
 *
 * The readout rides on the head rather than sitting in a panel at the edge of
 * the screen, because the head is where the rep's eye and hand already are
 * while they are swinging it.
 */
function drawFacing(
  ctx: CanvasRenderingContext2D,
  b: LayoutBlock,
  m: ModuleMm,
  mpp: number,
  img: { widthPx: number; heightPx: number },
  opts: { factorPct: number | null; active: boolean }
) {
  const { from, to, bearing, stated } = facingArrow(b, m, mpp, img);
  const rad = (bearing * Math.PI) / 180;
  const colour = opts.active ? "#fb923c" : stated ? "#fbbf24" : "rgba(226, 232, 240, 0.75)";

  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = colour;
  // Dashed while it is only the tool's guess: a stated facing and an assumed
  // one must not look the same on a screen a price comes off.
  if (!stated) ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.save();
  ctx.translate(to.x, to.y);
  ctx.rotate(rad);
  ctx.beginPath();
  ctx.moveTo(0, -11);
  ctx.lineTo(8, 8);
  ctx.lineTo(-8, 8);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  // A white rim, so the head reads as a grip rather than as decoration.
  ctx.lineWidth = 2;
  ctx.strokeStyle = opts.active ? "#ffffff" : "rgba(255,255,255,0.85)";
  ctx.stroke();
  ctx.restore();

  // The label sits a little further out along the same bearing, so it never
  // covers the array the rep is judging.
  const lx = from.x + Math.sin(rad) * (Math.hypot(to.x - from.x, to.y - from.y) + 26);
  const ly = from.y - Math.cos(rad) * (Math.hypot(to.x - from.x, to.y - from.y) + 26);
  const label = stated
    ? `${norm360(bearing)}° ${compassLabel(bearing)}${opts.factorPct == null ? "" : ` · ${opts.factorPct}%`}`
    : "facing not set";
  ctx.font = "600 15px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(15, 23, 42, 0.85)";
  ctx.strokeText(label, lx, ly);
  ctx.fillStyle = stated ? "#fef3c7" : "#e2e8f0";
  ctx.fillText(label, lx, ly);
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
