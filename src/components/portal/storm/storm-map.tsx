"use client";

import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, CircleMarker, Circle, Polygon, Popup, useMapEvents } from "react-leaflet";
import type { StormEventDTO } from "@/server/modules/storm/queries";

export const TYPE_COLOR: Record<StormEventDTO["type"], string> = {
  hail: "#3b82f6",
  wind: "#14b8a6",
  tornado: "#ef4444",
};

const MI_TO_M = 1609.34;

// Hail-size color scale (HailTrace-style): blue → green → yellow → orange → red → magenta.
const HAIL_SCALE: { min: number; color: string; label: string }[] = [
  { min: 2.5, color: "#d946ef", label: '2.5"+' },
  { min: 2, color: "#ef4444", label: '2"' },
  { min: 1.5, color: "#f97316", label: '1.5"' },
  { min: 1, color: "#eab308", label: '1"' },
  { min: 0.5, color: "#22c55e", label: '0.5"' },
  { min: 0, color: "#3b82f6", label: '<0.5"' },
];

function hailColor(inch: number | null | undefined): string {
  const h = inch ?? 0;
  return HAIL_SCALE.find((t) => h >= t.min)?.color ?? "#3b82f6";
}

function radiusFor(e: StormEventDTO): number {
  if (e.type === "hail") return 4 + Math.min(12, (e.hailSizeIn ?? 0.5) * 5);
  if (e.type === "wind") return 4 + Math.min(12, Math.max(0, ((e.windSpeedMph ?? 40) - 40) / 6));
  return 9;
}

/** Geographic swath footprint radius (miles → meters), scaled by hail size. */
function swathRadiusM(e: StormEventDTO): number {
  return (1.4 + (e.hailSizeIn ?? 0.75)) * MI_TO_M;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function ViewportTracker({ onCenter }: { onCenter: (lat: number, lng: number) => void }) {
  useMapEvents({
    moveend(e) {
      const c = e.target.getCenter();
      onCenter(c.lat, c.lng);
    },
  });
  return null;
}

export type ZonePreview = { lat: number; lng: number; radiusMiles: number };

export type StormWarning = {
  id: string;
  color: string;
  label: string;
  ps: string;
  issue: string | null;
  rings: [number, number][][];
};

export function StormMap({
  events,
  center,
  radiusMiles,
  zonePreview,
  showSwaths = true,
  warnings = [],
  onMapCenter,
}: {
  events: StormEventDTO[];
  center: { lat: number; lng: number };
  radiusMiles: number;
  zonePreview?: ZonePreview | null;
  showSwaths?: boolean;
  warnings?: StormWarning[];
  onMapCenter?: (lat: number, lng: number) => void;
}) {
  const hail = events.filter((e) => e.type === "hail");

  return (
    <div className="relative">
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={9}
        scrollWheelZoom
        className="h-[58vh] min-h-[360px] w-full overflow-hidden rounded-xl border border-border"
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />
        {/* Search radius */}
        <Circle
          center={[center.lat, center.lng]}
          radius={radiusMiles * MI_TO_M}
          pathOptions={{ color: "#9ca3af", weight: 1, fill: false, dashArray: "6 6" }}
        />

        {/* Hail swaths: translucent size-colored footprints that overlap into a
            HailTrace-style hail map. Drawn under the point markers. */}
        {showSwaths
          ? hail.map((e) => (
              <Circle
                key={`sw-${e.id}`}
                center={[e.lat, e.lng]}
                radius={swathRadiusM(e)}
                pathOptions={{
                  stroke: false,
                  fillColor: hailColor(e.hailSizeIn),
                  fillOpacity: 0.16,
                }}
              />
            ))
          : null}

        {/* NWS storm-warning footprints (severe t-storm / tornado) */}
        {warnings.map((w) => (
          <Polygon
            key={`wn-${w.id}`}
            positions={w.rings}
            pathOptions={{ color: w.color, weight: 1, fillColor: w.color, fillOpacity: 0.06, dashArray: "4 4" }}
          >
            <Popup>
              <div className="text-xs">
                <div className="font-semibold">{w.ps}</div>
                {w.issue ? <div className="text-muted-foreground">{fmtDate(w.issue)}</div> : null}
              </div>
            </Popup>
          </Polygon>
        ))}

        {/* Live zone preview while creating */}
        {zonePreview ? (
          <Circle
            center={[zonePreview.lat, zonePreview.lng]}
            radius={zonePreview.radiusMiles * MI_TO_M}
            pathOptions={{ color: "#F4631E", weight: 2, fillColor: "#F4631E", fillOpacity: 0.1 }}
          />
        ) : null}

        {events.map((e) => (
          <CircleMarker
            key={e.id}
            center={[e.lat, e.lng]}
            radius={radiusFor(e)}
            pathOptions={{
              color: e.type === "hail" ? hailColor(e.hailSizeIn) : TYPE_COLOR[e.type],
              fillColor: e.type === "hail" ? hailColor(e.hailSizeIn) : TYPE_COLOR[e.type],
              fillOpacity: 0.6,
              weight: 1,
            }}
          >
            <Popup>
              <div className="space-y-0.5 text-xs">
                <div className="font-semibold capitalize">{e.type}</div>
                {e.hailSizeIn != null ? <div>Hail: {e.hailSizeIn.toFixed(2)}″</div> : null}
                {e.windSpeedMph != null ? <div>Wind: {e.windSpeedMph} mph</div> : null}
                {e.tornadoScale ? <div>Scale: {e.tornadoScale}</div> : null}
                <div>{fmtDate(e.eventAt)}</div>
                {e.city || e.county ? (
                  <div className="text-muted-foreground">
                    {[e.city, e.county, e.state].filter(Boolean).join(", ")}
                  </div>
                ) : null}
                <div className="text-muted-foreground">{e.distanceMiles} mi from center</div>
              </div>
            </Popup>
          </CircleMarker>
        ))}
        {onMapCenter ? <ViewportTracker onCenter={onMapCenter} /> : null}
      </MapContainer>

      {/* Hail-size legend */}
      {showSwaths && hail.length > 0 ? (
        <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-lg border border-border bg-background/90 px-3 py-2 text-xs shadow-sm backdrop-blur">
          <div className="mb-1 font-medium">Hail size</div>
          <div className="flex items-center gap-1.5">
            {[...HAIL_SCALE].reverse().map((t) => (
              <div key={t.label} className="flex flex-col items-center gap-0.5">
                <span className="size-3 rounded-sm" style={{ backgroundColor: t.color }} />
                <span className="text-[10px] text-muted-foreground">{t.label}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
