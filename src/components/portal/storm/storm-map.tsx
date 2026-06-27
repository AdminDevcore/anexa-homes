"use client";

import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, CircleMarker, Circle, Popup, useMapEvents } from "react-leaflet";
import type { StormEventDTO } from "@/server/modules/storm/queries";

export const TYPE_COLOR: Record<StormEventDTO["type"], string> = {
  hail: "#3b82f6",
  wind: "#14b8a6",
  tornado: "#ef4444",
};

const MI_TO_M = 1609.34;

function radiusFor(e: StormEventDTO): number {
  if (e.type === "hail") return 4 + Math.min(12, (e.hailSizeIn ?? 0.5) * 5);
  if (e.type === "wind") return 4 + Math.min(12, Math.max(0, ((e.windSpeedMph ?? 40) - 40) / 6));
  return 9;
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

export function StormMap({
  events,
  center,
  radiusMiles,
  zonePreview,
  onMapCenter,
}: {
  events: StormEventDTO[];
  center: { lat: number; lng: number };
  radiusMiles: number;
  zonePreview?: ZonePreview | null;
  onMapCenter?: (lat: number, lng: number) => void;
}) {
  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={9}
      scrollWheelZoom
      className="h-[58vh] min-h-[360px] w-full overflow-hidden rounded-xl border border-border"
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; OpenStreetMap contributors'
      />
      {/* Search radius */}
      <Circle
        center={[center.lat, center.lng]}
        radius={radiusMiles * MI_TO_M}
        pathOptions={{ color: "#9ca3af", weight: 1, fill: false, dashArray: "6 6" }}
      />
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
          pathOptions={{ color: TYPE_COLOR[e.type], fillColor: TYPE_COLOR[e.type], fillOpacity: 0.5, weight: 1 }}
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
  );
}
