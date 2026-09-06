"use client";

import * as React from "react";
import {
  ESRI_MAX_ZOOM,
  GOOGLE_MAX_ZOOM,
  imageryZoom,
  tilesForView,
  type BasemapSource,
  type MapView,
  type Origin,
} from "@/lib/map-view";

/**
 * The imagery behind the panels: fetching it, holding it, and painting it.
 *
 * Its own module because the designer is already three and a half thousand
 * lines and none of this is about panels. What it owes the designer is one
 * function — draw the world into this context for this view — and everything
 * else here exists to make that function fast enough to call on every frame of
 * a drag.
 *
 * THE CACHE IS BOUNDED IN BYTES, NOT ENTRIES. A Google supertile decodes to
 * 1280x1280x4 = 6.5 MB; an Esri tile to a fortieth of that. A cache holding
 * "thirty tiles" therefore means 200 MB of one source and 8 MB of the other,
 * which is how a tab dies on a long afternoon of panning. Counting the actual
 * pixels keeps one number meaningful for both.
 */

/** Roughly what a browser holds for a decoded image, at 4 bytes a pixel. */
const BYTES_PER_PX = 4;

/**
 * How much decoded imagery to keep. Enough for several screens at two zooms —
 * a rep panning around a cul-de-sac and stepping in and out — and far short of
 * what makes a laptop swap.
 */
const CACHE_BUDGET_BYTES = 96 * 1024 * 1024;

type Entry = {
  img: HTMLImageElement;
  bytes: number;
  /** Bumped on every use, so the least recently drawn is the first evicted. */
  used: number;
};

export type Basemap = {
  /**
   * Paint the imagery for `view` into `ctx`. Everything already loaded is
   * drawn; anything missing is requested and will arrive on a later frame.
   */
  draw: (ctx: CanvasRenderingContext2D, view: MapView, source?: BasemapSource) => void;
  /**
   * Have every tile behind `view` in hand before drawing it.
   *
   * The customer's layout picture is rendered off-screen from a view the rep
   * has never looked at — framed on the array rather than on wherever they left
   * the map — so its imagery is very often NOT in the cache. Painting it
   * immediately produced a drawing of panels on a grey rectangle, and nothing
   * on screen would have said so.
   *
   * Resolves on a timeout as well as on success: a slow vendor must delay the
   * save, never block it. A picture with one tile missing beats no save.
   */
  preload: (view: MapView, source?: BasemapSource) => Promise<void>;
  /** Has anything at all arrived? Drives the "imagery unavailable" note. */
  ready: boolean;
  /** Did every tile we asked for fail? That is a broken key, not a slow one. */
  failed: boolean;
  /** Bumped whenever a tile arrives, so the designer knows to repaint. */
  version: number;
};

export function useBasemap(opts: {
  leadId: string;
  origin: Origin | null;
  source: BasemapSource;
}): Basemap {
  const { leadId, origin, source } = opts;
  const cache = React.useRef(new Map<string, Entry>());
  const failures = React.useRef(new Set<string>());
  const pending = React.useRef(new Set<string>());
  const clock = React.useRef(0);
  const [version, setVersion] = React.useState(0);
  const [ready, setReady] = React.useState(false);
  /**
   * WHICH source has been proved dead, not merely "something failed".
   *
   * A boolean needed an effect to clear it whenever the rep switched vendors,
   * and a `setState` in an effect is a cascading render for something that was
   * only ever derived. Holding the source itself makes the answer a comparison.
   */
  const [failedFor, setFailedFor] = React.useState<BasemapSource | null>(null);
  const failed = failedFor === source;

  /**
   * The zoom whose tiles were last drawn complete. Kept so a zoom change can
   * paint the old picture underneath the new one while it loads, rather than
   * flashing through the empty background — which on a screen a rep is
   * dragging on reads as the map breaking.
   */
  const backdropZoom = React.useRef<number | null>(null);

  /** The vendor the backdrop belongs to; its tiles are no use under another. */
  const backdropSource = React.useRef<BasemapSource>(source);

  const evict = React.useCallback(() => {
    let total = 0;
    for (const e of cache.current.values()) total += e.bytes;
    if (total <= CACHE_BUDGET_BYTES) return;
    const byAge = [...cache.current.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [key, entry] of byAge) {
      if (total <= CACHE_BUDGET_BYTES) break;
      cache.current.delete(key);
      total -= entry.bytes;
    }
  }, []);

  const request = React.useCallback(
    (key: string, url: string, cors: boolean) => {
      if (cache.current.has(key) || pending.current.has(key) || failures.current.has(key)) return;
      pending.current.add(key);
      const img = new Image();
      // Esri is cross-origin. Without this the draw succeeds and TAINTS the
      // canvas, and the failure surfaces much later as `toBlob` throwing on
      // save — costing the customer their layout picture for reasons nothing
      // on screen connects to the basemap they picked an hour earlier.
      if (cors) img.crossOrigin = "anonymous";
      img.onload = () => {
        pending.current.delete(key);
        cache.current.set(key, {
          img,
          bytes: (img.naturalWidth || 256) * (img.naturalHeight || 256) * BYTES_PER_PX,
          used: ++clock.current,
        });
        evict();
        setReady(true);
        setFailedFor(null);
        setVersion((v) => v + 1);
      };
      img.onerror = () => {
        pending.current.delete(key);
        // Remembered, so a dead tile is not re-requested on every repaint —
        // which at sixty frames a second is a request storm against a vendor
        // that has already said no.
        failures.current.add(key);
        setVersion((v) => v + 1);
      };
      img.src = url;
    },
    [evict]
  );

  /** How long the save will wait for imagery before going ahead without it. */
  const PRELOAD_TIMEOUT_MS = 6000;

  const preload = React.useCallback(
    (view: MapView, override?: BasemapSource) =>
      new Promise<void>((resolve) => {
        const src = override ?? source;
        if (!origin) return resolve();
        const wanted = tilesForView(view, origin, { leadId, source: src });
        const outstanding = wanted.filter(
          (t) => !cache.current.has(t.key) && !failures.current.has(t.key)
        );
        if (outstanding.length === 0) return resolve();

        let left = outstanding.length;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        const timer = setTimeout(finish, PRELOAD_TIMEOUT_MS);
        const settle = () => {
          if (--left <= 0) {
            clearTimeout(timer);
            finish();
          }
        };
        for (const t of outstanding) {
          const img = new Image();
          if (t.cors) img.crossOrigin = "anonymous";
          img.onload = () => {
            cache.current.set(t.key, {
              img,
              bytes: (img.naturalWidth || 256) * (img.naturalHeight || 256) * BYTES_PER_PX,
              used: ++clock.current,
            });
            evict();
            settle();
          };
          img.onerror = () => {
            failures.current.add(t.key);
            settle();
          };
          img.src = t.url;
        }
      }),
    [leadId, origin, source, evict]
  );

  const draw = React.useCallback(
    (ctx: CanvasRenderingContext2D, view: MapView, override?: BasemapSource) => {
      const src = override ?? source;
      ctx.fillStyle = "#1f2937";
      ctx.fillRect(0, 0, view.widthPx, view.heightPx);
      if (!origin) return;

      const wanted = tilesForView(view, origin, { leadId, source: src });
      const nativeZoom =
        src === "esri"
          ? imageryZoom(origin.lat, view.mpp, 1, ESRI_MAX_ZOOM)
          : imageryZoom(origin.lat, view.mpp, 2, GOOGLE_MAX_ZOOM);

      // The backdrop first, and only while the real thing is incomplete — and
      // never across a change of vendor, where the old tiles are a different
      // photograph of the same roof rather than a coarser one.
      const missing = wanted.filter((t) => !cache.current.has(t.key));
      const backdrop = backdropSource.current === src ? backdropZoom.current : null;
      if (missing.length > 0 && backdrop != null && backdrop !== nativeZoom && src !== "esri") {
        for (const t of tilesForView(view, origin, { leadId, source: src, zoom: backdrop })) {
          const hit = cache.current.get(t.key);
          if (hit) ctx.drawImage(hit.img, t.x, t.y, t.w, t.h);
        }
      }

      let drawn = 0;
      for (const t of wanted) {
        const hit = cache.current.get(t.key);
        if (hit) {
          hit.used = ++clock.current;
          // Rounding OUT by a pixel: adjacent tiles share an edge, and a
          // fractional destination rectangle lets the background show through
          // as a hairline seam across the roof.
          ctx.drawImage(hit.img, t.x, t.y, Math.ceil(t.w) + 1, Math.ceil(t.h) + 1);
          drawn++;
        } else {
          request(t.key, t.url, t.cors);
        }
      }

      if (wanted.length > 0 && drawn === wanted.length) {
        backdropZoom.current = nativeZoom;
        backdropSource.current = src;
      }
      // Every tile asked for has come back refused: the key, the API or the
      // vendor is the problem, and no amount of waiting will fix it.
      if (wanted.length > 0 && wanted.every((t) => failures.current.has(t.key))) setFailedFor(src);
    },
    [leadId, origin, source, request]
  );

  /**
   * Memoised because the designer's `paint` closes over it, and `paint` drives
   * the effect that repaints the canvas. A fresh object here would make that
   * effect fire on EVERY render of a three-thousand-line component — a full
   * redraw of the roof for a tooltip opening somewhere else.
   */
  return React.useMemo(
    () => ({ draw, preload, ready, failed, version }),
    [draw, preload, ready, failed, version]
  );
}

/**
 * The device pixel ratio, kept current.
 *
 * The canvas needs it for its backing store and it is NOT constant: dragging a
 * window from a retina laptop to an external monitor changes it, and a canvas
 * sized for the old one is a roof drawn at half resolution for the rest of the
 * session. `resolution:` media queries are the only thing that fires on the
 * change.
 */
export function useDevicePixelRatio(): number {
  /**
   * STARTS AT 1 EVEN IN THE BROWSER, and that is not an oversight.
   *
   * Reading `window.devicePixelRatio` in the initialiser looks right and is a
   * hydration mismatch: the server has no window and renders the canvas at
   * `width="1280"`, the client's first render reads 2 and wants `width={2560}`,
   * and React says the attributes "won't be patched up". The canvas then holds
   * whichever of the two won until something else happened to resize it.
   *
   * Both sides render 1, agree, and the effect below corrects it on the frame
   * after mount — which is also the path a monitor change takes, so there is
   * one behaviour rather than two.
   */
  const [dpr, setDpr] = React.useState(1);
  React.useEffect(() => {
    const sync = () => setDpr(window.devicePixelRatio || 1);
    sync();
    // `resolution:` is the only query that fires when a window is dragged to a
    // display with a different density. It matches the ratio it was made with,
    // so a new one is needed after every change — hence `dpr` in the deps.
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener("change", sync, { once: true });
    return () => mq.removeEventListener("change", sync);
  }, [dpr]);
  return dpr;
}
