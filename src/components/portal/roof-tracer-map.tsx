"use client";

import "leaflet/dist/leaflet.css";
import * as React from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Polygon, Polyline, Marker, useMap } from "react-leaflet";
import type { Map as LeafletMap } from "leaflet";
import { segmentFeet, type Facet, type LatLng } from "@/lib/roof";

const FACET_COLORS = ["#F4631E", "#3b82f6", "#22c55e", "#a855f7", "#ef4444", "#14b8a6"];
export function facetColor(i: number) {
  return FACET_COLORS[i % FACET_COLORS.length];
}

function vertexIcon(color: string) {
  return L.divIcon({
    html: `<div style="width:12px;height:12px;border-radius:9999px;background:#fff;border:3px solid ${color};box-shadow:0 1px 3px rgba(0,0,0,.5);"></div>`,
    className: "roof-vertex",
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}
function lengthLabel(text: string) {
  return L.divIcon({
    html: `<div style="transform:translate(-50%,-50%);background:rgba(17,17,17,.85);color:#fff;font-size:11px;font-weight:600;padding:1px 5px;border-radius:4px;white-space:nowrap;font-family:system-ui">${text}</div>`,
    className: "roof-len",
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function Controller({
  onReady,
  onClick,
}: {
  onReady: (m: LeafletMap) => void;
  onClick: (lat: number, lng: number) => void;
}) {
  const map = useMap();
  const clickRef = React.useRef(onClick);
  clickRef.current = onClick;
  React.useEffect(() => {
    onReady(map);
    const el = map.getContainer();
    const handle = (ev: MouseEvent) => {
      const t = ev.target as Element | null;
      if (t && typeof t.closest === "function" && t.closest(".leaflet-marker-icon, .leaflet-control")) return;
      const ll = map.mouseEventToLatLng(ev);
      clickRef.current(ll.lat, ll.lng);
    };
    el.addEventListener("click", handle, true);
    const fix = () => map.invalidateSize();
    const t1 = setTimeout(fix, 120);
    const t2 = setTimeout(fix, 500);
    return () => {
      el.removeEventListener("click", handle, true);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [map, onReady]);
  return null;
}

function SegmentLabels({ points, closed }: { points: LatLng[]; closed: boolean }) {
  const segs: { mid: LatLng; text: string }[] = [];
  const n = points.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    segs.push({ mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], text: `${Math.round(segmentFeet(a, b))} ft` });
  }
  return (
    <>
      {segs.map((s, i) => (
        <Marker key={i} position={s.mid} icon={lengthLabel(s.text)} interactive={false} />
      ))}
    </>
  );
}

export type RoofTracerMapProps = {
  center: LatLng;
  facets: Facet[];
  current: LatLng[];
  selected: number | null;
  onReady: (m: LeafletMap) => void;
  onClick: (lat: number, lng: number) => void;
  onVertexDrag: (facetIdx: number, ptIdx: number, ll: LatLng) => void;
  onVertexClick: (facetIdx: number, ptIdx: number) => void;
  onFacetClick: (facetIdx: number) => void;
};

export function RoofTracerMap({
  center,
  facets,
  current,
  selected,
  onReady,
  onClick,
  onVertexDrag,
  onVertexClick,
  onFacetClick,
}: RoofTracerMapProps) {
  return (
    <MapContainer center={center} zoom={20} maxZoom={22} scrollWheelZoom className="h-full w-full">
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        attribution="Tiles &copy; Esri"
        maxZoom={22}
        maxNativeZoom={19}
      />
      <Controller onReady={onReady} onClick={onClick} />

      {facets.map((f, fi) => {
        const color = facetColor(fi);
        return (
          <React.Fragment key={f.id}>
            <Polygon
              positions={f.points}
              pathOptions={{ color, weight: selected === fi ? 3 : 2, fillColor: color, fillOpacity: selected === fi ? 0.25 : 0.15 }}
              eventHandlers={{ click: () => onFacetClick(fi) }}
            />
            {f.points.map((p, pi) => (
              <Marker
                key={pi}
                position={p}
                draggable
                icon={vertexIcon(color)}
                eventHandlers={{
                  dragend: (e) => {
                    const ll = (e.target as L.Marker).getLatLng();
                    onVertexDrag(fi, pi, [ll.lat, ll.lng]);
                  },
                  click: () => onVertexClick(fi, pi),
                }}
              />
            ))}
            {selected === fi && <SegmentLabels points={f.points} closed />}
          </React.Fragment>
        );
      })}

      {/* In-progress facet */}
      {current.length >= 1 && (
        <>
          {current.length >= 2 && <Polyline positions={current} pathOptions={{ color: "#fff", weight: 2, dashArray: "5" }} />}
          {current.map((p, i) => (
            <Marker key={`c${i}`} position={p} icon={vertexIcon("#ffffff")} interactive={false} />
          ))}
          <SegmentLabels points={current} closed={false} />
        </>
      )}
    </MapContainer>
  );
}
