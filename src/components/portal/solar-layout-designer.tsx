"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2, MousePointer2, Square, Eraser, RotateCcw, Trash2, Save, ZoomIn, ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  metresPerPixel,
  metresToImagePx,
  panelCorners,
  panelCount,
  fitBlock,
  blockLocalToGround,
  groundToBlockLocal,
  blockSpanM,
  type LayoutBlock,
  type ModuleMm,
  type Orientation,
} from "@/lib/solar-layout";
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
 */

/** The imagery route's logical frame. Device pixels are twice this (scale=2). */
const IMG_W = 1280;
const IMG_H = 720;
const CANVAS_W = IMG_W * 2;
const CANVAS_H = IMG_H * 2;

type Tool = "select" | "draw" | "erase";
type Zoom = 20 | 21;

type Drag =
  | { kind: "new"; fromX: number; fromY: number; toX: number; toY: number }
  | { kind: "move"; id: string; fromE: number; fromN: number; originE: number; originN: number }
  | { kind: "rotate"; id: string }
  | { kind: "resize"; id: string }
  | null;

const uid = () => `b${Math.random().toString(36).slice(2, 10)}`;

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
  targetPanels,
  canEdit,
}: {
  leadId: string;
  /** Null when the deal has no rooftop coordinate — the roof cannot be shown. */
  lat: number | null;
  moduleMm: ModuleMm;
  moduleRatingW: number | null;
  initialBlocks: LayoutBlock[];
  /** How many panels this house needs, from the Energy step. Null = unknown. */
  targetPanels: number | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const imgRef = React.useRef<HTMLImageElement | null>(null);

  const [blocks, setBlocks] = React.useState<LayoutBlock[]>(initialBlocks);
  const [history, setHistory] = React.useState<LayoutBlock[][]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [tool, setTool] = React.useState<Tool>("draw");
  const [zoom, setZoom] = React.useState<Zoom>(21);
  const [viewScale, setViewScale] = React.useState(1);
  const [drag, setDrag] = React.useState<Drag>(null);
  // Which zoom's imagery has resolved, and how. Derived rather than a
  // "loading" flag set inside the effect: changing zoom makes the previous
  // answer stale by construction, with no cascading render to reset it.
  const [loaded, setLoaded] = React.useState<{ zoom: Zoom; ok: boolean } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const imageState: "loading" | "ready" | "failed" =
    loaded?.zoom !== zoom ? "loading" : loaded.ok ? "ready" : "failed";
  const mpp = lat == null ? 0 : metresPerPixel(lat, zoom, 2);
  const selected = blocks.find((b) => b.id === selectedId) ?? null;
  const count = panelCount(blocks);
  const kwDc = moduleRatingW ? (count * moduleRatingW) / 1000 : 0;

  /** Every mutation goes through here, so undo has one place to record. */
  const commit = React.useCallback((next: LayoutBlock[]) => {
    setHistory((h) => [...h.slice(-49), blocks]);
    setBlocks(next);
  }, [blocks]);

  const undo = React.useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      setBlocks(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }, []);

  // ── Imagery ────────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (lat == null) return;
    let live = true;
    const img = new Image();
    // Same-origin: the route proxies Google server-side so the API key never
    // reaches the browser. That is also what keeps the canvas untainted, which
    // is what makes `toBlob` on save possible at all.
    img.src = `/api/property/satellite?leadId=${encodeURIComponent(leadId)}&zoom=${zoom}&pin=0`;
    img.onload = () => {
      if (!live) return;
      imgRef.current = img;
      setLoaded({ zoom, ok: true });
    };
    img.onerror = () => {
      if (!live) return;
      imgRef.current = null;
      setLoaded({ zoom, ok: false });
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
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      if (imgRef.current) ctx.drawImage(imgRef.current, 0, 0, CANVAS_W, CANVAS_H);
      else {
        ctx.fillStyle = "#1f2937";
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      }

      const img = { widthPx: CANVAS_W, heightPx: CANVAS_H };
      for (const b of blocks) {
        const isSel = opts.chrome && b.id === selectedId;
        for (const quad of panelCorners(b, moduleMm)) {
          const pts = quad.map((c) => metresToImagePx(c.e, c.n, mpp, img));
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.closePath();
          ctx.fillStyle = "rgba(17, 32, 56, 0.82)";
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = isSel ? "#f4631e" : "rgba(150, 190, 255, 0.85)";
          ctx.stroke();
        }

        if (isSel) {
          const h = handlePositions(b, moduleMm, mpp, img);
          for (const [pos, colour] of [
            [h.rotate, "#f4631e"],
            [h.resize, "#38bdf8"],
          ] as const) {
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 14, 0, Math.PI * 2);
            ctx.fillStyle = colour;
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = "#ffffff";
            ctx.stroke();
          }
        }
      }

      if (opts.chrome && drag?.kind === "new") {
        ctx.setLineDash([10, 8]);
        ctx.lineWidth = 3;
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
    [blocks, selectedId, drag, moduleMm, mpp]
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
      x: ((e.clientX - r.left) / r.width) * CANVAS_W,
      y: ((e.clientY - r.top) / r.height) * CANVAS_H,
    };
  };
  const toMetres = (p: { x: number; y: number }) => ({
    e: (p.x - CANVAS_W / 2) * mpp,
    n: (CANVAS_H / 2 - p.y) * mpp,
  });

  /** Which panel, if any, is under this point. */
  const hit = (m: { e: number; n: number }) => {
    for (let bi = blocks.length - 1; bi >= 0; bi--) {
      const b = blocks[bi];
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

  function onPointerDown(ev: React.PointerEvent) {
    if (!canEdit || lat == null) return;
    const p = toCanvas(ev);
    const m = toMetres(p);
    canvasRef.current?.setPointerCapture(ev.pointerId);

    if (tool === "erase") {
      const h = hit(m);
      if (h) {
        commit(
          blocks.map((b) =>
            b.id === h.block.id ? { ...b, omitted: [...b.omitted, h.index] } : b
          )
        );
      }
      return;
    }

    if (selected) {
      const img = { widthPx: CANVAS_W, heightPx: CANVAS_H };
      const hp = handlePositions(selected, moduleMm, mpp, img);
      if (Math.hypot(p.x - hp.rotate.x, p.y - hp.rotate.y) < 28) {
        return setDrag({ kind: "rotate", id: selected.id });
      }
      if (Math.hypot(p.x - hp.resize.x, p.y - hp.resize.y) < 28) {
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
    if (!drag || lat == null) return;
    const p = toCanvas(ev);
    const m = toMetres(p);

    if (drag.kind === "new") return setDrag({ ...drag, toX: p.x, toY: p.y });

    const b = blocks.find((x) => x.id === drag.id);
    if (!b) return;

    if (drag.kind === "move") {
      const next = { ...b, originE: drag.originE + (m.e - drag.fromE), originN: drag.originN + (m.n - drag.fromN) };
      return setBlocks((bs) => bs.map((x) => (x.id === b.id ? next : x)));
    }

    if (drag.kind === "rotate") {
      // Bearing from the block's origin to the pointer, clockwise from north.
      const deg = (Math.atan2(m.e - b.originE, m.n - b.originN) * 180) / Math.PI;
      const snapped = ev.shiftKey ? deg : Math.round(deg / 5) * 5;
      return setBlocks((bs) =>
        bs.map((x) => (x.id === b.id ? { ...x, rotationDeg: Math.round(snapped * 10) / 10 } : x))
      );
    }

    if (drag.kind === "resize") {
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

  function onPointerUp() {
    if (!drag) return;
    if (drag.kind === "new") {
      const wM = (Math.abs(drag.toX - drag.fromX)) * mpp;
      const hM = (Math.abs(drag.toY - drag.fromY)) * mpp;
      const fit = fitBlock({ widthM: wM, heightM: hM }, moduleMm, "portrait");
      if (fit.cols === 0 || fit.rows === 0) {
        setDrag(null);
        return toast.error("Too small for a panel — drag a bigger area.");
      }
      const topLeft = toMetres({ x: Math.min(drag.fromX, drag.toX), y: Math.min(drag.fromY, drag.toY) });
      const b: LayoutBlock = {
        id: uid(),
        originE: topLeft.e,
        originN: topLeft.n,
        rotationDeg: 0,
        cols: fit.cols,
        rows: fit.rows,
        orientation: "portrait",
        omitted: [],
      };
      commit([...blocks, b]);
      setSelectedId(b.id);
      setTool("select");
    } else {
      // move/rotate/resize edited `blocks` live; record one undo step for it.
      setHistory((h) => [...h.slice(-49), blocks]);
    }
    setDrag(null);
  }

  // ── Keyboard ───────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        return undo();
      }
      if (!selected) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        commit(blocks.filter((b) => b.id !== selected.id));
        setSelectedId(null);
      }
      if (e.key.toLowerCase() === "p") {
        const next: Orientation = selected.orientation === "portrait" ? "landscape" : "portrait";
        commit(blocks.map((b) => (b.id === selected.id ? { ...b, orientation: next } : b)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, blocks, commit, undo, canEdit]);

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
      off.width = CANVAS_W;
      off.height = CANVAS_H;
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {canEdit &&
          ([
            ["draw", "Draw array", Square],
            ["select", "Select", MousePointer2],
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
          <Button type="button" size="sm" variant="outline" onClick={() => setViewScale((v) => Math.min(4, v + 0.5))} aria-label="Zoom in">
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
          width={CANVAS_W}
          height={CANVAS_H}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ width: `${100 * viewScale}%`, height: "auto", touchAction: "none" }}
          className={cn(
            "block max-w-none",
            canEdit && tool === "draw" && "cursor-crosshair",
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

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <div>
          <span data-testid="panel-count" className="font-display text-lg font-semibold">
            {count} {count === 1 ? "panel" : "panels"}
          </span>
          {/* Kept OUT of the panel-count element on purpose: the e2e asserts
              that element's exact text, and folding the target in breaks it. */}
          {targetPanels ? (
            <span
              data-testid="panel-target"
              className={cn(
                "ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium",
                count >= targetPanels
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-amber-100 text-amber-800"
              )}
            >
              of ~{targetPanels} needed
            </span>
          ) : null}
          <span className="ml-2 text-xs text-muted-foreground">
            {moduleRatingW
              ? `${kwDc.toFixed(2)} kW-DC at ${moduleRatingW}W each`
              : "No default panel in the catalogue, so this cannot be sized"}
          </span>
        </div>

        {selected && canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="block-rotation" className="text-xs">Angle</Label>
              <input
                id="block-rotation"
                type="number"
                step="1"
                value={Math.round(selected.rotationDeg)}
                onChange={(e) =>
                  commit(
                    blocks.map((b) =>
                      b.id === selected.id ? { ...b, rotationDeg: Number(e.target.value) || 0 } : b
                    )
                  )
                }
                className="h-8 w-20 rounded-md border border-input bg-transparent px-2 text-sm"
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                commit(
                  blocks.map((b) =>
                    b.id === selected.id
                      ? { ...b, orientation: b.orientation === "portrait" ? "landscape" : "portrait" }
                      : b
                  )
                )
              }
            >
              {selected.orientation === "portrait" ? "Portrait" : "Landscape"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                commit(blocks.filter((b) => b.id !== selected.id));
                setSelectedId(null);
              }}
            >
              <Trash2 className="size-4" /> Delete block
            </Button>
          </div>
        )}

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

      {canEdit && (
        <p className="text-[11px] text-muted-foreground">
          Drag on the roof to lay an array, then drag its handles to turn it to the ridge or change
          its size. Use <strong>Remove panels</strong> to cut out a chimney or a vent. Panels are
          drawn to scale — if one does not fit here, it does not fit up there.
        </p>
      )}
    </div>
  );
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
