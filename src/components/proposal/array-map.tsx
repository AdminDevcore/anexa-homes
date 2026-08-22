"use client";

import * as React from "react";
import { Minus, Plus, Maximize2 } from "lucide-react";
import { metresPerPixel, metresToImagePx, zoomForMetresPerPixel } from "@/lib/web-mercator";

/**
 * The homeowner's own roof, with their own array on it.
 *
 * This is the slide people screenshot and send to their partner. An uploaded
 * PNG of a design tool's export does the same job standing still; this one can
 * be zoomed into until the panels sit on individual shingles, which is what
 * turns "twenty-two kilowatts" into "that is my house".
 *
 * WHAT IT IS NOT: a map. There is no tile layer, no geocoder and no Maps
 * JavaScript API — which means no browser-side API key, which is the entire
 * reason this is built out of one proxied image per zoom level instead. Zooming
 * fetches a new picture of the same centre; panning moves the picture inside
 * its frame. The panel geometry is projected onto whichever image is showing.
 *
 * THE GEOMETRY IS FROZEN. `panels` came out of the snapshot: it is the array as
 * it was drawn on the day, in ground metres, and it does not move when somebody
 * redraws the roof next week.
 *
 * THE IMAGERY IS OPTIONAL. No API key, an address Google has no picture of, a
 * rate limit — all ordinary, all a 404, and none of them a reason to show the
 * homeowner nothing. The array is drawn either way; only the roof underneath it
 * goes missing, and the caption says so instead of leaving a black rectangle to
 * be interpreted.
 */

/** The device pixels the imagery route actually returns. See its `square` note. */
const IMAGE_PX = 1280;
const MIN_ZOOM = 17;
const MAX_ZOOM = 21;

export function ArrayMap({
  lat,
  panels,
  imageUrl,
  /** Preferred over the bare drawing when the imagery will not load. */
  fallback,
  aspect = 1,
}: {
  lat: number;
  panels: { e: number; n: number }[][];
  /** Builds the proxied image URL for a zoom level. */
  imageUrl: (zoom: number) => string;
  fallback?: React.ReactNode;
  /**
   * The frame's width ÷ height. 1 — square — is the proposal's own slide, where
   * a roof gets a whole screen to itself.
   *
   * The imagery is square whatever this is (see IMAGE_PX), so a wider frame
   * CROPS it rather than squashing it: the image is `object-cover` and the
   * overlay is a `slice`-fitted viewBox, which is the same transform, so the
   * panels stay on the shingles they were drawn on. The centring offsets and
   * the fitting zoom below both take it into account — without that, a 16:9
   * frame opens a tall array with its top row cut off and its middle nowhere
   * near the middle.
   */
  aspect?: number;
}) {
  const fit = React.useMemo(() => bestFitZoom(lat, panels, aspect), [lat, panels, aspect]);
  const home = React.useMemo(() => centroid(panels), [panels]);
  const [zoom, setZoom] = React.useState(fit);
  const [nudge, setNudge] = React.useState({ x: 0, y: 0 });
  const [imagery, setImagery] = React.useState<"pending" | "ok" | "failed">("pending");
  const [dragging, setDragging] = React.useState(false);
  const frame = React.useRef<HTMLDivElement | null>(null);
  const img = React.useRef<HTMLImageElement | null>(null);
  const drag = React.useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  /**
   * Whether the picture arrived, checked on mount as well as by the handlers.
   *
   * `onError` alone is not enough. The document is server-rendered, so the
   * browser starts — and often finishes — fetching this image before React
   * hydrates; a 404 that resolved first fires its error event into nothing, and
   * the component sits forever on "pending" showing a black rectangle. A
   * complete image with no intrinsic width is a failed one, and that is
   * knowable at any time.
   */
  React.useEffect(() => {
    const el = img.current;
    if (!el) return;
    if (el.complete) setImagery(el.naturalWidth > 0 ? "ok" : "failed");
  }, [zoom]);

  if (panels.length === 0) return <>{fallback ?? null}</>;
  // An uploaded drawing has a ROOF in it, which a bare panel diagram does not.
  // Where one exists it is the better picture, so it wins outright.
  if (imagery === "failed" && fallback) return <>{fallback}</>;

  const mpp = metresPerPixel(lat, zoom, 2);

  /**
   * Where the array sits, brought to the middle of the frame.
   *
   * The imagery is centred on the DEAL'S COORDINATE and cannot be re-centred
   * without buying a second picture — but the frame it sits in can be slid.
   * Detached garages and ground mounts are routinely thirty metres off the pin,
   * and without this they open in a corner with an acre of empty roof beside
   * them.
   *
   * As a PERCENTAGE of the frame, so it survives the element being any size.
   */
  const centre = metresToImagePx(home.e, home.n, mpp, {
    widthPx: IMAGE_PX,
    heightPx: IMAGE_PX,
  });
  // A `translate` percentage is a percentage of the ELEMENT, and the element is
  // the frame — while the offsets above are fractions of the IMAGE. Those are
  // the same thing only in a square frame. `object-cover` scales the square
  // picture by the frame's LONGER side, so on a 16:9 frame the image is as tall
  // as the frame is wide, and a vertical nudge has to be scaled up to match.
  const fx = Math.max(1, 1 / aspect);
  const fy = Math.max(1, aspect);
  const offset = {
    x: ((IMAGE_PX / 2 - centre.x) / IMAGE_PX) * 100 * fx + nudge.x,
    y: ((IMAGE_PX / 2 - centre.y) / IMAGE_PX) * 100 * fy + nudge.y,
  };

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: nudge.x, py: nudge.y };
    setDragging(true);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    const box = frame.current?.getBoundingClientRect();
    if (!d || !box || box.width === 0) return;
    // Pixels dragged, expressed as a percentage of the frame — the same unit
    // the centring offset is in, so the two simply add.
    setNudge({
      x: d.px + ((e.clientX - d.x) / box.width) * 100,
      y: d.py + ((e.clientY - d.y) / box.height) * 100,
    });
  }
  function endDrag() {
    drag.current = null;
    setDragging(false);
  }

  return (
    <div className="relative overflow-hidden rounded-2xl bg-neutral-900 ring-1 ring-white/10">
      <div
        ref={frame}
        className="relative w-full touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ aspectRatio: aspect, cursor: dragging ? "grabbing" : "grab" }}
      >
        <div
          className="absolute inset-0"
          style={{ transform: `translate(${offset.x}%, ${offset.y}%)` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={img}
            key={zoom}
            src={imageUrl(zoom)}
            alt="Aerial view of the property with the proposed array drawn on the roof"
            draggable={false}
            onLoad={(e) => setImagery(e.currentTarget.naturalWidth > 0 ? "ok" : "failed")}
            onError={() => setImagery("failed")}
            className="absolute inset-0 size-full object-cover [print-color-adjust:exact] [-webkit-print-color-adjust:exact]"
          />

          <svg
            viewBox={`0 0 ${IMAGE_PX} ${IMAGE_PX}`}
            // `slice` is `object-cover` for an SVG: fill the box and crop the
            // overflow. The default (`meet`) letterboxes instead, which on any
            // non-square frame would float the panels off the roof underneath.
            preserveAspectRatio="xMidYMid slice"
            className="absolute inset-0 size-full"
            aria-hidden
          >
            {panels.map((corners, i) => (
              <polygon
                key={i}
                points={corners
                  .map((c) => {
                    const p = metresToImagePx(c.e, c.n, mpp, {
                      widthPx: IMAGE_PX,
                      heightPx: IMAGE_PX,
                    });
                    return `${p.x},${p.y}`;
                  })
                  .join(" ")}
                className="fill-[#0b1220]/85 stroke-[#7dd3fc]"
                strokeWidth={1.5}
              />
            ))}
          </svg>
        </div>
      </div>

      {/* Controls. Hidden on paper, where there is nothing to press. */}
      <div className="absolute bottom-3 right-3 flex flex-col gap-1.5 print:hidden">
        <Ctl
          label="Zoom in"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 1))}
        >
          <Plus className="size-4" />
        </Ctl>
        <Ctl
          label="Zoom out"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 1))}
        >
          <Minus className="size-4" />
        </Ctl>
        <Ctl
          label="Fit the array"
          onClick={() => {
            setZoom(fit);
            setNudge({ x: 0, y: 0 });
          }}
        >
          <Maximize2 className="size-4" />
        </Ctl>
      </div>

      <p className="pointer-events-none absolute bottom-3 left-3 max-w-[60%] text-[11px] font-medium text-white/60 print:hidden">
        {imagery === "failed"
          ? `Your ${panels.length}-panel array, to scale. The aerial view of the roof could not be loaded.`
          : `Drag to move · ${panels.length} ${panels.length === 1 ? "panel" : "panels"}`}
      </p>
    </div>
  );
}

function Ctl({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex size-9 items-center justify-center rounded-lg bg-white/90 text-neutral-800 shadow-sm backdrop-blur transition hover:bg-white disabled:opacity-40 disabled:hover:bg-white/90"
    >
      {children}
    </button>
  );
}

/** The middle of the array, in ground metres. Null geometry gives the origin. */
export function centroid(panels: { e: number; n: number }[][]): { e: number; n: number } {
  let e = 0;
  let n = 0;
  let count = 0;
  for (const quad of panels) {
    for (const c of quad) {
      e += c.e;
      n += c.n;
      count++;
    }
  }
  return count === 0 ? { e: 0, n: 0 } : { e: e / count, n: n / count };
}

/**
 * The zoom that frames the array.
 *
 * Measured from the array's OWN CENTRE rather than from the deal's coordinate,
 * because the frame is slid to the array before anything is drawn — see the
 * centring note. Framing from the pin instead would zoom out far enough to hold
 * a detached garage AND the empty half of the lot between it and the house.
 *
 * Floored, never rounded: rounding up is one zoom level too deep, and a
 * homeowner opening the section to find the corner of their roof has been shown
 * nothing at all.
 */
export function bestFitZoom(
  lat: number,
  panels: { e: number; n: number }[][],
  /** The frame's width ÷ height. See ArrayMap's `aspect`. */
  aspect = 1
): number {
  const mid = centroid(panels);
  let reach = 0;
  for (const quad of panels) {
    for (const c of quad) {
      reach = Math.max(reach, Math.abs(c.e - mid.e), Math.abs(c.n - mid.n));
    }
  }
  if (reach <= 0) return MAX_ZOOM - 1;

  // Fill about 70% of the frame: enough that the array is the subject, with
  // enough roof around it to be recognisable as a house.
  // Divided by however far from square the frame is: `object-cover` crops the
  // square picture on its long axis, so the shortest thing a frame can show is
  // less than its width, and fitting to the width alone clips the array.
  const halfFramePx = ((IMAGE_PX / 2) * 0.7) / Math.max(1, aspect, 1 / aspect);
  const z = Math.floor(zoomForMetresPerPixel(lat, reach / halfFramePx, 2));
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}
