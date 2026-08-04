"use client";

import * as React from "react";
import { Satellite, Map as MapIcon, ImageOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type MapType = "satellite" | "roadmap";

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
  className,
}: {
  leadId: string;
  address: string | null;
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

  const src = (t: MapType) => `/api/property/satellite?leadId=${encodeURIComponent(leadId)}&type=${t}`;

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
