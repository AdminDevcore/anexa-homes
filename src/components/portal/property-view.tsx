"use client";

import * as React from "react";
import { Satellite, Map as MapIcon, ImageOff, Loader2, Sun, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ArrayMap } from "@/components/proposal/array-map";

type MapType = "satellite" | "roadmap";
/** The array drawn on the aerial, an uploaded drawing, or the bare imagery. */
type View = MapType | "array" | "layout";

/** The card's shape, kept whatever is inside it. Also what frames the array. */
const ASPECT = 16 / 9;

/**
 * Short, stable hash of the inputs that decide which house is in the picture.
 * Deterministic so the server and client agree on the URL and hydration is
 * quiet; djb2 rather than a crypto digest because this only has to differ when
 * the address does, not resist anyone.
 */
function fingerprint(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export type PropertyArray = {
  lat: number;
  /** Every panel as four ground-metre corners. Empty means nothing drawn. */
  panels: { e: number; n: number }[][];
  /** The design's size, for the caption. */
  sizeKwDc?: number | null;
};

/**
 * The property as seen from above.
 *
 * BEFORE A DESIGN EXISTS this is imagery and nothing else: a Satellite / Map
 * toggle over the roof, which is all a roofing deal ever wants and all a solar
 * deal has to show before somebody has laid an array on it.
 *
 * ONCE THE ROOF HAS BEEN DRAWN the same card leads with the design — the panels
 * projected onto the same aerial, zoomable and draggable, the identical
 * geometry the customer's proposal shows. It is the answer to "what did we sell
 * this house", asked from the deal rather than from inside the builder. The
 * plain imagery stays one click away, since the array is drawn over the roof it
 * is hiding.
 *
 * A design done in somebody else's tool leaves an uploaded drawing instead of
 * geometry; that gets its own view, below the drawn array and above the bare
 * photo.
 *
 * The images are served by our own route, never straight from Google, so the
 * API key stays on the server. Each view is fetched on first use and then kept
 * mounted, so toggling feels like flipping a layer rather than loading a page.
 */
export function PropertyView({
  leadId,
  address,
  geoStamp,
  array = null,
  layoutImageId = null,
  className,
}: {
  leadId: string;
  address: string | null;
  /** When this deal's coordinates were last resolved. Part of the cache key. */
  geoStamp?: string | null;
  /** The array as drawn, in ground metres. Null until a design exists. */
  array?: PropertyArray | null;
  /** A drawing uploaded from another design tool, if there is one. */
  layoutImageId?: string | null;
  className?: string;
}) {
  const hasArray = !!array && array.panels.length > 0;
  // An uploaded file can have gone from storage under a design that still
  // references it. That reads as a broken image, so the view removes itself.
  const [layoutGone, setLayoutGone] = React.useState(false);
  const hasLayout = !!layoutImageId && !layoutGone;

  const initial: View = hasArray ? "array" : hasLayout ? "layout" : "satellite";
  const [view, setView] = React.useState<View>(initial);
  // Losing the drawing while looking at it would leave a blank frame.
  const active: View = view === "layout" && !hasLayout ? "satellite" : view;
  /** Null on the two views that are not a proxied Static Map. */
  const imageType: MapType | null = active === "satellite" || active === "roadmap" ? active : null;

  // Tracked per view: a failed satellite fetch says nothing about the roadmap.
  const [failed, setFailed] = React.useState<Record<MapType, boolean>>({
    satellite: false,
    roadmap: false,
  });
  const [loaded, setLoaded] = React.useState<Record<MapType, boolean>>({
    satellite: false,
    roadmap: false,
  });
  // Only fetch a view once someone has actually asked for it: each one is a
  // billed Static Maps request, and a solar deal that opens on its array should
  // not buy two more pictures nobody looked at. Once bought, a view stays
  // mounted so toggling back to it is instant.
  const [seen, setSeen] = React.useState<Record<MapType, boolean>>({
    satellite: initial === "satellite",
    roadmap: false,
  });
  // `|| active === t` rather than state written on the way in, so the view a
  // failure FALLS BACK to still loads — a vanished uploaded drawing lands on
  // the satellite view without anyone having clicked it.
  const live = (t: MapType) => seen[t] || active === t;

  const show = (v: View) => {
    setView(v);
    if (v === "satellite" || v === "roadmap") setSeen((r) => (r[v] ? r : { ...r, [v]: true }));
  };

  /**
   * An image that finishes loading BEFORE React hydrates never fires `onLoad`
   * — the handler is attached after the fact — so `loaded` stayed false and the
   * spinner ran forever on top of a perfectly good, `opacity-0` image. A cached
   * response (this route sends max-age=86400) makes that the NORMAL case on
   * every repeat visit, not a race.
   *
   * So settle from the element itself on mount: `complete` with a non-zero
   * `naturalWidth` is a load, `complete` with zero is an error.
   */
  const settle = React.useCallback((t: MapType, el: HTMLImageElement | null) => {
    if (!el || !el.complete) return;
    if (el.naturalWidth > 0) setLoaded((l) => (l[t] ? l : { ...l, [t]: true }));
    else setFailed((f) => (f[t] ? f : { ...f, [t]: true }));
  }, []);

  // The URL has to change whenever the PICTURE would change, because this route
  // is cached in the browser for a day and the response body is not part of the
  // URL. Keyed on leadId alone, correcting a wrong address updated the caption
  // instantly and left the photo of the old house up until tomorrow — which is
  // exactly what "I fixed it and it still shows the wrong place" looked like.
  //
  // `address` covers an edit; `geoStamp` covers the coordinates moving without
  // the address changing, e.g. a rep dragging the pin on the Field Map. `v` stays
  // a manual lever for when the rendering itself changes meaning.
  const key = React.useMemo(() => fingerprint(`${address ?? ""}@${geoStamp ?? ""}`), [address, geoStamp]);
  const src = (t: MapType) =>
    `/api/property/satellite?leadId=${encodeURIComponent(leadId)}&type=${t}&v=3&k=${key}`;

  /**
   * The picture the array is drawn on: no pin, and SQUARE.
   *
   * Both matter to the geometry rather than to the look. The pin is planted on
   * the roof the panels go on, and would sit under them. The square is what the
   * projection assumes — Google clamps each side of a Static Map to 640
   * independently, so a 16:9 request comes back square with a 200 and no
   * warning, and an overlay that believed the request would be laid on a roof
   * of the wrong shape. Asking outright is the only way to be sure.
   */
  const arraySrc = React.useCallback(
    (zoom: number) =>
      `/api/property/satellite?leadId=${encodeURIComponent(leadId)}&type=satellite` +
      `&square=1&pin=0&zoom=${zoom}&v=3&k=${key}`,
    [leadId, key]
  );

  const options = (
    [
      hasArray ? { key: "array" as const, label: "Array", Icon: Sun } : null,
      hasLayout ? { key: "layout" as const, label: "Layout", Icon: ImageIcon } : null,
      { key: "satellite" as const, label: "Satellite", Icon: Satellite },
      { key: "roadmap" as const, label: "Map", Icon: MapIcon },
    ] as ({ key: View; label: string; Icon: typeof Satellite } | null)[]
  ).filter((o): o is { key: View; label: string; Icon: typeof Satellite } => o !== null);

  const caption =
    active === "array" && array
      ? `${array.panels.length} ${array.panels.length === 1 ? "panel" : "panels"} as designed${
          array.sizeKwDc ? ` · ${array.sizeKwDc.toFixed(2)} kW` : ""
        }`
      : active === "layout"
        ? "Panel layout from the design tool"
        : "Aerial view of the property";

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{address || "No address on this deal"}</p>
          <p className="text-xs text-muted-foreground">{caption}</p>
        </div>

        <div
          className="inline-flex shrink-0 rounded-lg border border-border p-0.5"
          role="group"
          aria-label="Map view"
        >
          {options.map(({ key: k, label, Icon }) => (
            <button
              key={k}
              type="button"
              onClick={() => show(k)}
              aria-pressed={active === k}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors",
                active === k
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {active === "array" && array ? (
        // The same component the customer's proposal draws its array with, at
        // this card's shape. One projection, one set of panel positions: a rep
        // checking the design here is looking at the homeowner's picture.
        <ArrayMap lat={array.lat} panels={array.panels} imageUrl={arraySrc} aspect={ASPECT} />
      ) : active === "layout" && layoutImageId ? (
        // `object-contain` on the uploaded drawing: it is somebody's export at
        // its own proportions, and cropping it would move panels on a picture
        // that is the only record of where they go.
        <div
          className="grid place-items-center overflow-hidden rounded-xl border border-border bg-muted"
          style={{ aspectRatio: ASPECT }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/portal/files/${layoutImageId}`}
            alt="Panel layout for this property"
            onError={() => setLayoutGone(true)}
            className="size-full object-contain"
          />
        </div>
      ) : (
        <div
          className="relative overflow-hidden rounded-xl border border-border bg-muted"
          style={{ aspectRatio: ASPECT }}
        >
          {(["satellite", "roadmap"] as const).map((t) =>
            live(t) && !failed[t] ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={t}
                ref={(el) => {
                  settle(t, el);
                }}
                src={src(t)}
                alt={t === "satellite" ? "Satellite view of the property" : "Map view of the property"}
                onLoad={() => setLoaded((l) => ({ ...l, [t]: true }))}
                onError={() => setFailed((f) => ({ ...f, [t]: true }))}
                className={cn(
                  "absolute inset-0 size-full object-cover transition-opacity",
                  imageType === t && loaded[t] ? "opacity-100" : "opacity-0"
                )}
              />
            ) : null
          )}

          {imageType && !failed[imageType] && !loaded[imageType] ? (
            <div className="absolute inset-0 grid place-items-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : null}

          {imageType && failed[imageType] ? (
            // Graceful, and specific about WHY rather than showing a broken image:
            // the two real causes are an unset key and an address that will not
            // geocode, and the fix differs.
            <div className="absolute inset-0 grid place-items-center p-6 text-center">
              <div className="space-y-1">
                <ImageOff className="mx-auto size-6 text-muted-foreground" />
                <p className="text-sm font-medium">No imagery available</p>
                <p className="text-xs text-muted-foreground">
                  {address
                    ? "This address could not be located, or property imagery isn't configured yet."
                    : "Add a street address to this deal to see the property."}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
