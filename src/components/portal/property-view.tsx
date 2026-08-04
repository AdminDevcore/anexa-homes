"use client";

import * as React from "react";
import { Satellite, Map as MapIcon, ImageOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type MapType = "satellite" | "roadmap";

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

/**
 * The property as seen from above, with a Satellite / Map toggle.
 *
 * The image is served by our own route, never straight from Google, so the API
 * key stays on the server. Both views are prefetched on first switch and then
 * kept mounted, so toggling is instant rather than re-downloading — the toggle
 * is meant to feel like flipping a layer, not loading a page.
 *
 * This phase shows the ROOF ONLY. It deliberately does not draw the panel
 * layout; that arrives with the design phase.
 */
export function PropertyView({
  leadId,
  address,
  geoStamp,
  className,
}: {
  leadId: string;
  address: string | null;
  /** When this deal's coordinates were last resolved. Part of the cache key. */
  geoStamp?: string | null;
  className?: string;
}) {
  const [type, setType] = React.useState<MapType>("satellite");
  // Tracked per view: a failed satellite fetch says nothing about the roadmap.
  const [failed, setFailed] = React.useState<Record<MapType, boolean>>({
    satellite: false,
    roadmap: false,
  });
  const [loaded, setLoaded] = React.useState<Record<MapType, boolean>>({
    satellite: false,
    roadmap: false,
  });
  // Only render a view once it has been asked for, so the second image is not
  // fetched (and billed) unless someone actually toggles.
  const [requested, setRequested] = React.useState<Record<MapType, boolean>>({
    satellite: true,
    roadmap: false,
  });

  const show = (t: MapType) => {
    setType(t);
    setRequested((r) => (r[t] ? r : { ...r, [t]: true }));
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

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{address || "No address on this deal"}</p>
          <p className="text-xs text-muted-foreground">Aerial view of the property</p>
        </div>

        <div
          className="inline-flex shrink-0 rounded-lg border border-border p-0.5"
          role="group"
          aria-label="Map view"
        >
          {([
            { key: "satellite", label: "Satellite", Icon: Satellite },
            { key: "roadmap", label: "Map", Icon: MapIcon },
          ] as const).map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => show(key)}
              aria-pressed={type === key}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors",
                type === key
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

      <div className="relative aspect-[16/9] overflow-hidden rounded-xl border border-border bg-muted">
        {(["satellite", "roadmap"] as const).map((t) =>
          requested[t] && !failed[t] ? (
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
                type === t && loaded[t] ? "opacity-100" : "opacity-0"
              )}
            />
          ) : null
        )}

        {requested[type] && !failed[type] && !loaded[type] ? (
          <div className="absolute inset-0 grid place-items-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : null}

        {failed[type] ? (
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
    </div>
  );
}
