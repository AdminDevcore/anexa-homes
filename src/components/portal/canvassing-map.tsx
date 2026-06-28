"use client";

import "leaflet/dist/leaflet.css";
import * as React from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Polygon, CircleMarker, Popup, useMap } from "react-leaflet";
import type { Map as LeafletMap } from "leaflet";
import { dispositionMeta, type LatLng } from "@/lib/canvassing";
import type { KnockDTO, TerritoryDTO, DealDTO } from "@/server/modules/canvassing/queries";
import type { StormSwathDTO, StormEventDTO } from "@/server/modules/storm/queries";
import type { StormWarning } from "@/components/portal/storm/storm-map";

// Hail-size color scale (matches the Storm Intelligence map).
const HAIL_TIERS: [number, string][] = [
  [2.5, "#d946ef"],
  [2, "#ef4444"],
  [1.5, "#f97316"],
  [1, "#eab308"],
  [0.5, "#22c55e"],
];
function hailColor(inch: number | null | undefined): string {
  const h = inch ?? 0;
  for (const [min, c] of HAIL_TIERS) if (h >= min) return c;
  return "#3b82f6";
}
function stormEventColor(e: { type: string; hailSizeIn: number | null }): string {
  if (e.type === "hail") return hailColor(e.hailSizeIn);
  if (e.type === "wind") return "#14b8a6";
  return "#ef4444";
}

export type Basemap = "satellite" | "street";

export type Viewport = { minLat: number; minLng: number; maxLat: number; maxLng: number; zoom: number };

// ZIP (ZCTA) boundary for the overlay. Mirrors the server's ZipFeature shape but
// declared here so this client component never imports the server-only module.
export type ZipFeature = { zcta: string; centroid: [number, number]; rings: LatLng[][] };

function MapController({
  onReady,
  onMapClick,
  onViewport,
}: {
  onReady: (map: LeafletMap) => void;
  onMapClick: (lat: number, lng: number) => void;
  onViewport: (v: Viewport) => void;
}) {
  const map = useMap();
  const clickRef = React.useRef(onMapClick);
  clickRef.current = onMapClick;
  const vpRef = React.useRef(onViewport);
  vpRef.current = onViewport;

  React.useEffect(() => {
    onReady(map);
    const container = map.getContainer();

    const report = () => {
      const b = map.getBounds();
      vpRef.current({
        minLat: b.getSouth(),
        minLng: b.getWest(),
        maxLat: b.getNorth(),
        maxLng: b.getEast(),
        zoom: map.getZoom(),
      });
    };
    map.on("moveend", report);
    map.on("zoomend", report);
    setTimeout(report, 300);

    // Bind a plain DOM click on the container (Leaflet's own synthetic `click`
    // doesn't fire reliably here). Ignore clicks on existing pins / territories /
    // controls so those keep opening their own popups.
    const handleClick = (ev: MouseEvent) => {
      const t = ev.target as Element | null;
      // Let pins, territory labels, popups, controls, and interactive vectors
      // (e.g. ZIP outlines) handle their own clicks — don't also fire a map click.
      if (t && typeof t.closest === "function" && t.closest(".leaflet-marker-icon, .leaflet-popup, .leaflet-control, .leaflet-interactive")) {
        return;
      }
      const ll = map.mouseEventToLatLng(ev);
      clickRef.current(ll.lat, ll.lng);
    };
    // Capture phase: Leaflet stops click propagation before the bubble phase,
    // so a normal listener never runs. Capture fires first and reliably.
    container.addEventListener("click", handleClick, true);

    const fix = () => map.invalidateSize();
    const t1 = setTimeout(fix, 100);
    const t2 = setTimeout(fix, 600);
    const ro = new ResizeObserver(fix);
    ro.observe(container);
    window.addEventListener("resize", fix);

    return () => {
      container.removeEventListener("click", handleClick, true);
      map.off("moveend", report);
      map.off("zoomend", report);
      clearTimeout(t1);
      clearTimeout(t2);
      ro.disconnect();
      window.removeEventListener("resize", fix);
    };
  }, [map, onReady]);
  return null;
}

/** A colored map-pin (teardrop) carrying the disposition glyph — SalesRabbit-style.
 *  Not-knocked houses render as a small hollow gray dot to read as "blank". */
const iconCache = new Map<string, L.DivIcon>();
function knockIcon(disposition: string): L.DivIcon {
  const cached = iconCache.get(disposition);
  if (cached) return cached;

  let icon: L.DivIcon;
  if (disposition === "not_knocked") {
    icon = L.divIcon({
      html: `<div style="width:14px;height:14px;border-radius:9999px;background:rgba(255,255,255,0.9);border:2px solid #94a3b8;box-shadow:0 1px 2px rgba(0,0,0,.3);"></div>`,
      className: "anexa-knock-pin",
      iconSize: [14, 14],
      iconAnchor: [7, 7],
      popupAnchor: [0, -8],
    });
  } else {
    const meta = dispositionMeta(disposition);
    const html = `
      <div style="position:relative;width:30px;height:40px;">
        <svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
          <path d="M15 0C7 0 .5 6.5.5 14.5c0 10 14.5 25 14.5 25s14.5-15 14.5-25C29.5 6.5 23 0 15 0z"
            fill="${meta.color}" stroke="#ffffff" stroke-width="2.5"/>
        </svg>
        <span style="position:absolute;top:4px;left:0;width:30px;text-align:center;color:#fff;font-weight:800;font-size:15px;line-height:21px;font-family:system-ui,sans-serif;">${meta.glyph}</span>
      </div>`;
    icon = L.divIcon({ html, className: "anexa-knock-pin", iconSize: [30, 40], iconAnchor: [15, 40], popupAnchor: [0, -38] });
  }
  iconCache.set(disposition, icon);
  return icon;
}

/** A circular "home" badge for a pipeline deal/appointment — colored by its
 *  pipeline stage. Deliberately a different shape from the teardrop knock pin so
 *  reps can tell at a glance which homes are already in the pipeline. */
const dealIconCache = new Map<string, L.DivIcon>();
function dealIcon(color: string | null): L.DivIcon {
  const c = color || "#6366f1";
  const cached = dealIconCache.get(c);
  if (cached) return cached;
  const html = `
    <div style="width:30px;height:30px;border-radius:9999px;background:${c};border:3px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 11.5 12 4l9 7.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M5 10.5V20h14v-9.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>`;
  const icon = L.divIcon({
    html,
    className: "anexa-deal-pin",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -16],
  });
  dealIconCache.set(c, icon);
  return icon;
}

function centroid(points: LatLng[]): LatLng {
  const n = points.length;
  const sum = points.reduce((a, p) => [a[0] + p[0], a[1] + p[1]] as LatLng, [0, 0] as LatLng);
  return [sum[0] / n, sum[1] / n];
}

function territoryLabelIcon(name: string, color: string, progress: string): L.DivIcon {
  const safe = name.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<div style="white-space:nowrap;transform:translateX(-50%);background:${color};color:#fff;font-weight:700;font-size:12px;padding:3px 8px;border-radius:9999px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);font-family:system-ui,sans-serif;">${safe}<span style="opacity:.85;font-weight:600;"> · ${progress}</span></div>`;
  return L.divIcon({ html, className: "anexa-territory-label", iconSize: [0, 0], iconAnchor: [0, 0] });
}

/** Pulsing ring dropped on the address a rep searched for, so they can see
 *  exactly which house dot to tap. Anchored at its center over the dot. */
const searchRingIcon: L.DivIcon = L.divIcon({
  html: `<div style="position:relative;width:46px;height:46px;"><div class="pulse"></div><div class="ring"></div></div>`,
  className: "anexa-search-ring",
  iconSize: [46, 46],
  iconAnchor: [23, 23],
});

const ZIP_COLOR = "#2563eb";
function zipLabelIcon(zcta: string): L.DivIcon {
  const html = `<div style="white-space:nowrap;transform:translate(-50%,-50%);background:rgba(255,255,255,0.92);color:${ZIP_COLOR};font-weight:700;font-size:11px;letter-spacing:0.02em;padding:2px 7px;border-radius:9999px;border:1.5px solid ${ZIP_COLOR};box-shadow:0 1px 3px rgba(0,0,0,.25);font-family:system-ui,sans-serif;">${zcta}</div>`;
  return L.divIcon({ html, className: "anexa-zip-label", iconSize: [0, 0], iconAnchor: [0, 0] });
}

export type CanvassingMapProps = {
  center: LatLng;
  basemap: Basemap;
  knocks: KnockDTO[];
  deals?: DealDTO[];
  territories: TerritoryDTO[];
  drawPoints: LatLng[];
  onMapClick: (lat: number, lng: number) => void;
  onMapReady: (map: LeafletMap) => void;
  onViewport: (v: Viewport) => void;
  renderKnockPopup: (k: KnockDTO) => React.ReactNode;
  renderDealPopup?: (d: DealDTO) => React.ReactNode;
  renderTerritoryPopup: (t: TerritoryDTO) => React.ReactNode;
  // When a rep is selected, the IDs of that rep's territories (emphasized; others dimmed).
  highlightTerritoryIds?: Set<string> | null;
  // ZIP-code boundary overlay (toggle). onZipClick is provided for managers only.
  zips?: ZipFeature[];
  showZips?: boolean;
  onZipClick?: (zcta: string, ring: LatLng[]) => void;
  // Storm overlay layers (fusion with Storm Intelligence).
  radarSwaths?: StormSwathDTO[];
  stormEvents?: StormEventDTO[];
  stormWarnings?: StormWarning[];
  // Pulsing highlight for the address a rep just searched for.
  searchPin?: LatLng | null;
  // Drag-to-reposition: the id currently in "move" mode (knock id, or `deal-<id>`)
  // becomes draggable; onMovePin fires with the dropped coordinates.
  movingId?: string | null;
  onMovePin?: (kind: "knock" | "deal", id: string, lat: number, lng: number) => void;
};

export function CanvassingMap({
  center,
  basemap,
  knocks,
  deals,
  territories,
  drawPoints,
  onMapClick,
  onMapReady,
  onViewport,
  renderKnockPopup,
  renderDealPopup,
  renderTerritoryPopup,
  highlightTerritoryIds,
  zips,
  showZips,
  onZipClick,
  radarSwaths,
  stormEvents,
  stormWarnings,
  searchPin,
  movingId,
  onMovePin,
}: CanvassingMapProps) {
  return (
    <MapContainer center={center} zoom={16} scrollWheelZoom className="h-full w-full">
      {basemap === "satellite" ? (
        <>
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics"
            maxZoom={19}
          />
          {/* Street/place labels on top of the imagery */}
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
            maxZoom={19}
          />
        </>
      ) : (
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
      )}

      {/* Storm overlays (fusion) — vector layers sit in the overlay pane, beneath
          the knock/deal markers (marker pane), so pins stay clickable on top. */}
      {(radarSwaths ?? []).map((s) => (
        <Polygon
          key={`rs-${s.id}`}
          positions={s.rings}
          pathOptions={{ stroke: false, fillColor: hailColor(s.hailMinIn), fillOpacity: 0.3 }}
        />
      ))}
      {(stormWarnings ?? []).map((w) => (
        <Polygon
          key={`wn-${w.id}`}
          positions={w.rings}
          pathOptions={{ color: w.color, weight: 1, fillColor: w.color, fillOpacity: 0.05, dashArray: "4 4" }}
        />
      ))}
      {(stormEvents ?? []).map((e) => (
        <CircleMarker
          key={`se-${e.id}`}
          center={[e.lat, e.lng]}
          radius={e.type === "hail" ? 4 + Math.min(10, (e.hailSizeIn ?? 0.5) * 4) : 5}
          pathOptions={{ color: stormEventColor(e), fillColor: stormEventColor(e), fillOpacity: 0.5, weight: 1 }}
        >
          <Popup>
            <div className="space-y-0.5 text-xs">
              <div className="font-semibold capitalize">{e.type}</div>
              {e.hailSizeIn != null ? <div>Hail {e.hailSizeIn.toFixed(2)}″</div> : null}
              {e.windSpeedMph != null ? <div>Wind {e.windSpeedMph} mph</div> : null}
              <div className="text-muted-foreground">{new Date(e.eventAt).toLocaleDateString()}</div>
            </div>
          </Popup>
        </CircleMarker>
      ))}

      <MapController onReady={onMapReady} onMapClick={onMapClick} onViewport={onViewport} />

      {/* ZIP (ZCTA) boundary overlay — click a ZIP (managers) to make it a territory */}
      {showZips &&
        (zips ?? []).map((z) =>
          z.rings.map((ring, ri) => {
            if (ring.length < 3) return null;
            return (
              <Polygon
                key={`zip-${z.zcta}-${ri}`}
                positions={ring}
                pathOptions={{
                  color: ZIP_COLOR,
                  weight: 1.5,
                  opacity: 0.9,
                  dashArray: "5 4",
                  fillColor: ZIP_COLOR,
                  fillOpacity: onZipClick ? 0.05 : 0.02,
                }}
                eventHandlers={onZipClick ? { click: () => onZipClick(z.zcta, ring) } : undefined}
              />
            );
          }),
        )}
      {showZips &&
        (zips ?? []).map((z) => (
          <Marker key={`ziplbl-${z.zcta}`} position={z.centroid} icon={zipLabelIcon(z.zcta)} interactive={false} />
        ))}

      {territories.map((t) => {
        if (t.polygon.length < 3) return null;
        const c = centroid(t.polygon);
        // Emphasize the selected rep's territories; dim the rest.
        const dimmed = highlightTerritoryIds != null && !highlightTerritoryIds.has(t.id);
        const emphasized = highlightTerritoryIds != null && highlightTerritoryIds.has(t.id);
        return (
          <React.Fragment key={t.id}>
            {/* Non-interactive overlay so knocks can be logged anywhere inside it */}
            <Polygon
              positions={t.polygon}
              interactive={false}
              pathOptions={{
                color: t.color,
                fillColor: t.color,
                fillOpacity: dimmed ? 0.04 : emphasized ? 0.22 : 0.12,
                weight: emphasized ? 4 : dimmed ? 1 : 2,
                opacity: dimmed ? 0.35 : 1,
              }}
            />
            {/* Clickable name label at the center manages the territory */}
            <Marker position={c} icon={territoryLabelIcon(t.name, t.color, `${t.knocked}/${t.total}`)}>
              <Popup>{renderTerritoryPopup(t)}</Popup>
            </Marker>
          </React.Fragment>
        );
      })}

      {knocks.map((k) => {
        const moving = movingId === k.id;
        return (
          <Marker
            key={k.id}
            position={[k.lat, k.lng]}
            icon={knockIcon(k.disposition)}
            draggable={moving}
            zIndexOffset={moving ? 2000 : 0}
            eventHandlers={
              moving
                ? {
                    dragend: (e) => {
                      const ll = (e.target as L.Marker).getLatLng();
                      onMovePin?.("knock", k.id, ll.lat, ll.lng);
                    },
                  }
                : undefined
            }
          >
            <Popup>{renderKnockPopup(k)}</Popup>
          </Marker>
        );
      })}

      {/* Searched-address highlight — a pulsing ring over the matching dot */}
      {searchPin && (
        <Marker position={searchPin} icon={searchRingIcon} interactive={false} zIndexOffset={2000} />
      )}

      {/* Pipeline deals / appointments — rendered on top of knock pins */}
      {(deals ?? []).map((d) => {
        const moving = movingId === `deal-${d.id}`;
        return (
          <Marker
            key={`deal-${d.id}`}
            position={[d.lat, d.lng]}
            icon={dealIcon(d.stageColor)}
            draggable={moving}
            zIndexOffset={moving ? 2100 : 1000}
            eventHandlers={
              moving
                ? {
                    dragend: (e) => {
                      const ll = (e.target as L.Marker).getLatLng();
                      onMovePin?.("deal", d.id, ll.lat, ll.lng);
                    },
                  }
                : undefined
            }
          >
            <Popup>{renderDealPopup ? renderDealPopup(d) : d.name}</Popup>
          </Marker>
        );
      })}

      {/* In-progress territory drawing */}
      {drawPoints.length >= 2 && (
        <Polygon
          positions={drawPoints}
          pathOptions={{ color: "#F4631E", dashArray: "6", fillOpacity: 0.08, weight: 2 }}
        />
      )}
      {drawPoints.map((p, i) => (
        <Marker
          key={`dp-${i}`}
          position={p}
          icon={L.divIcon({
            html: '<div style="width:12px;height:12px;border-radius:9999px;background:#F4631E;border:2px solid #fff;"></div>',
            className: "anexa-draw-vertex",
            iconSize: [12, 12],
            iconAnchor: [6, 6],
          })}
        />
      ))}
    </MapContainer>
  );
}
