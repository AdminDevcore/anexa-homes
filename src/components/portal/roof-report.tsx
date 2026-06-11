"use client";

import "leaflet/dist/leaflet.css";
import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Map as LeafletMap } from "leaflet";
import { Ruler, X, Undo2, Trash2, Loader2, Check, FileDown, Crosshair, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  computeRoof,
  segmentFeet,
  PITCHES,
  EDGE_TYPES,
  ROOF_DISCLAIMER,
  type Facet,
  type EdgeType,
  type LatLng,
} from "@/lib/roof";
import { saveRoofReportAction, generateRoofReportPdfAction } from "@/server/modules/roof/actions";

const FACET_COLORS = ["#F4631E", "#3b82f6", "#22c55e", "#a855f7", "#ef4444", "#14b8a6"];
const color = (i: number) => FACET_COLORS[i % FACET_COLORS.length];
const DEFAULT_CENTER: LatLng = [32.7831, -96.8067];

const RoofTracerMap = dynamic(() => import("./roof-tracer-map").then((m) => m.RoofTracerMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-muted text-muted-foreground">
      <Loader2 className="mr-2 size-5 animate-spin" /> Loading imagery…
    </div>
  ),
});

let facetSeq = 0;
const newId = () => `f${Date.now()}_${facetSeq++}`;

export function RoofReportButton({
  leadId,
  address,
  initialFacets,
  initialWaste,
  hasReport,
}: {
  leadId: string;
  address: string;
  initialFacets: Facet[];
  initialWaste: number;
  hasReport: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Ruler className="size-4" /> {hasReport ? "Roof Report" : "Build Roof Report"}
      </Button>
      {open && (
        <RoofModal
          leadId={leadId}
          address={address}
          initialFacets={initialFacets}
          initialWaste={initialWaste}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function RoofModal({
  leadId,
  address,
  initialFacets,
  initialWaste,
  onClose,
}: {
  leadId: string;
  address: string;
  initialFacets: Facet[];
  initialWaste: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const mapRef = React.useRef<LeafletMap | null>(null);
  const [center, setCenter] = React.useState<LatLng | null>(null);
  const [geoMsg, setGeoMsg] = React.useState("Locating property…");
  const [facets, setFacets] = React.useState<Facet[]>(initialFacets);
  const [current, setCurrent] = React.useState<LatLng[]>([]);
  const [selected, setSelected] = React.useState<number | null>(initialFacets.length ? 0 : null);
  const [wastePct, setWastePct] = React.useState(initialWaste);
  const [saving, setSaving] = React.useState(false);
  const [genning, setGenning] = React.useState(false);
  const [detecting, setDetecting] = React.useState(false);

  // Geocode the lead address → recenter.
  React.useEffect(() => {
    let active = true;
    fetch(`/api/geocode?q=${encodeURIComponent(address)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (!active) return;
        const c: LatLng = [d.lat, d.lng];
        setCenter(c);
        setGeoMsg("");
        mapRef.current?.setView(c, 20);
      })
      .catch(() => {
        if (!active) return;
        // Fall back to existing geometry centroid or a default; let the user pan.
        const c = initialFacets[0]?.points[0] ?? DEFAULT_CENTER;
        setCenter(c);
        setGeoMsg("Couldn't pinpoint the address — pan/zoom to the rooftop.");
      });
    return () => {
      active = false;
    };
  }, [address, initialFacets]);

  const result = computeRoof(facets, wastePct);

  // Snap a clicked point to a nearby existing vertex (within ~3 ft).
  function snap(lat: number, lng: number): LatLng {
    let best: LatLng | null = null;
    let bestFt = 3;
    for (const f of facets) for (const p of f.points) {
      const d = segmentFeet([lat, lng], p);
      if (d < bestFt) { bestFt = d; best = p; }
    }
    for (const p of current) {
      const d = segmentFeet([lat, lng], p);
      if (d < bestFt) { bestFt = d; best = p; }
    }
    return best ?? [lat, lng];
  }

  function onClick(lat: number, lng: number) {
    setCurrent((c) => [...c, snap(lat, lng)]);
  }

  function closeFacet() {
    if (current.length < 3) {
      toast.error("Add at least 3 corners.");
      return;
    }
    setFacets((fs) => {
      const next = [...fs, { id: newId(), points: current, pitch: "6/12", edgeTypes: current.map(() => "eave" as EdgeType) }];
      setSelected(next.length - 1);
      return next;
    });
    setCurrent([]);
  }

  function undo() {
    if (current.length > 0) setCurrent((c) => c.slice(0, -1));
  }

  function onVertexDrag(fi: number, pi: number, ll: LatLng) {
    setFacets((fs) => fs.map((f, i) => (i === fi ? { ...f, points: f.points.map((p, j) => (j === pi ? ll : p)) } : f)));
  }
  function onVertexClick(fi: number, pi: number) {
    setFacets((fs) =>
      fs.map((f, i) => {
        if (i !== fi || f.points.length <= 3) return f;
        return { ...f, points: f.points.filter((_, j) => j !== pi), edgeTypes: f.edgeTypes.filter((_, j) => j !== pi) };
      })
    );
  }
  function setPitch(fi: number, pitch: string) {
    setFacets((fs) => fs.map((f, i) => (i === fi ? { ...f, pitch } : f)));
  }
  function setFacetName(fi: number, name: string) {
    setFacets((fs) => fs.map((f, i) => (i === fi ? { ...f, name } : f)));
  }
  function setEdgeType(fi: number, ei: number, type: EdgeType) {
    setFacets((fs) => fs.map((f, i) => (i === fi ? { ...f, edgeTypes: f.edgeTypes.map((t, j) => (j === ei ? type : t)) } : f)));
  }
  function deleteFacet(fi: number) {
    setFacets((fs) => fs.filter((_, i) => i !== fi));
    setSelected(null);
  }

  function locate() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((p) => mapRef.current?.setView([p.coords.latitude, p.coords.longitude], 20));
  }

  // Auto-detect the roof outline at the map center from OSM building footprints.
  async function autoDetect() {
    const c = mapRef.current?.getCenter();
    const lat = c?.lat ?? center?.[0];
    const lng = c?.lng ?? center?.[1];
    if (lat == null || lng == null) return toast.error("Map isn't ready yet.");
    setDetecting(true);
    try {
      const res = await fetch(`/api/roof/footprint?lat=${lat}&lng=${lng}`);
      const d: { points: LatLng[] | null } = await res.json();
      if (!d.points || d.points.length < 3) {
        toast.error("Couldn't find a building here. Center the house and retry, or trace it manually.");
        return;
      }
      const idx = facets.length;
      setFacets((fs) => [
        ...fs,
        { id: newId(), name: "Roof outline", points: d.points!, pitch: "6/12", edgeTypes: d.points!.map(() => "eave" as EdgeType) },
      ]);
      setCurrent([]);
      setSelected(idx);
      mapRef.current?.fitBounds(d.points as [number, number][], { padding: [50, 50], maxZoom: 21 });
      toast.success("Roof outline detected — tweak the corners, pitch, and add facets as needed.");
    } catch {
      toast.error("Auto-detect failed. Trace the roof manually.");
    } finally {
      setDetecting(false);
    }
  }

  async function save(): Promise<boolean> {
    if (facets.length === 0) {
      toast.error("Trace at least one roof facet first.");
      return false;
    }
    setSaving(true);
    const res = await saveRoofReportAction({ leadId, facets, wastePct });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    toast.success(`Saved — ${res.squares} squares`);
    router.refresh();
    return true;
  }

  async function generate() {
    setGenning(true);
    const saved = await save();
    if (!saved) {
      setGenning(false);
      return;
    }
    const res = await generateRoofReportPdfAction(leadId);
    setGenning(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Roof report PDF saved to the appointment", {
      action: { label: "Download", onClick: () => window.open(`/portal/files/${res.fileId}`, "_blank") },
    });
    router.refresh();
  }

  const sel = selected !== null ? facets[selected] : null;
  const selResult = selected !== null ? result.facets[selected] : null;

  return (
    <div className="fixed inset-0 z-[2000] flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold">
            <Ruler className="size-4 text-gold" /> Build Roof Report
          </div>
          <div className="truncate text-xs text-muted-foreground">{address}</div>
        </div>
        <button onClick={onClose} className="rounded-lg p-2 hover:bg-muted" aria-label="Close">
          <X className="size-5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Map */}
        <div className="relative min-w-0 flex-1">
          {center ? (
            <RoofTracerMap
              center={center}
              facets={facets}
              current={current}
              selected={selected}
              onReady={(m) => (mapRef.current = m)}
              onClick={onClick}
              onVertexDrag={onVertexDrag}
              onVertexClick={onVertexClick}
              onFacetClick={setSelected}
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-muted text-muted-foreground">
              <Loader2 className="mr-2 size-5 animate-spin" /> {geoMsg}
            </div>
          )}
          {geoMsg && center && (
            <div className="absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded-full bg-foreground/90 px-3 py-1.5 text-xs text-background">
              {geoMsg}
            </div>
          )}
          {/* Toolbar */}
          <div className="absolute bottom-4 left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-background/95 p-2 shadow-lg">
            <span className="px-1 text-xs text-muted-foreground">
              {current.length > 0 ? `${current.length} corner${current.length === 1 ? "" : "s"} — click to add` : "Click rooftop corners"}
            </span>
            <Button size="sm" onClick={autoDetect} disabled={detecting} className="gap-1 bg-gold text-gold-foreground hover:bg-gold/90">
              {detecting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Auto-detect roof
            </Button>
            <Button size="sm" onClick={closeFacet} disabled={current.length < 3} className="gap-1">
              <Check className="size-4" /> Close facet
            </Button>
            <Button size="sm" variant="outline" onClick={undo} disabled={current.length === 0} className="gap-1">
              <Undo2 className="size-4" /> Undo
            </Button>
            <Button size="sm" variant="outline" onClick={locate} aria-label="Locate me">
              <Crosshair className="size-4" />
            </Button>
          </div>
        </div>

        {/* Panel */}
        <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border">
          <div className="space-y-4 p-4">
            {/* Totals */}
            <div className="rounded-xl border border-border bg-card p-3">
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Roof area" value={`${Math.round(result.roofArea).toLocaleString()} ft²`} />
                <Metric label="Squares" value={result.squares.toFixed(1)} accent />
                <Metric label="Footprint" value={`${Math.round(result.footprintArea).toLocaleString()} ft²`} />
                <Metric label="Pitch" value={result.predominantPitch} />
                <Metric label="Perimeter" value={`${Math.round(result.perimeterFt)} ft`} />
                <Metric label="Facets" value={String(result.facetCount)} />
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-sm">
                <label className="text-muted-foreground">Waste</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={wastePct}
                    min={0}
                    max={30}
                    onChange={(e) => setWastePct(Number(e.target.value) || 0)}
                    className="w-16 rounded border border-border bg-background px-2 py-1 text-right text-sm"
                  />
                  <span className="text-muted-foreground">%</span>
                </div>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Squares to order</span>
                <span className="font-semibold">{result.squaresToOrder.toFixed(1)}</span>
              </div>
            </div>

            {/* Facet list */}
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Facets</div>
              {facets.length === 0 && <p className="text-sm text-muted-foreground">Trace a roof slope on the map, then “Close facet”.</p>}
              {facets.map((f, i) => (
                <button
                  key={f.id}
                  onClick={() => setSelected(i)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm",
                    selected === i ? "border-foreground bg-muted" : "border-border hover:bg-muted"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="size-3 rounded-sm" style={{ background: color(i) }} />
                    {f.name?.trim() || `Facet ${i + 1}`}
                  </span>
                  <span className="text-muted-foreground">{Math.round(result.facets[i]?.sloped ?? 0)} ft²</span>
                </button>
              ))}
            </div>

            {/* Selected facet editor */}
            {sel && selResult && selected !== null && (
              <div className="space-y-3 rounded-xl border border-border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <input
                    value={sel.name ?? ""}
                    onChange={(e) => setFacetName(selected, e.target.value)}
                    placeholder={`Facet ${selected + 1}`}
                    aria-label="Facet name"
                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-semibold outline-none hover:border-border focus:border-gold"
                  />
                  <button onClick={() => deleteFacet(selected)} className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="Delete facet">
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <label className="text-muted-foreground">Pitch</label>
                  <select
                    value={sel.pitch}
                    onChange={(e) => setPitch(selected, e.target.value)}
                    className="rounded border border-border bg-background px-2 py-1 text-sm"
                  >
                    {PITCHES.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div className="text-xs text-muted-foreground">
                  Footprint {Math.round(selResult.footprint)} ft² → sloped <strong>{Math.round(selResult.sloped)} ft²</strong>
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Edges (tap a vertex on the map to delete)</div>
                  <div className="space-y-1">
                    {selResult.segments.map((s, ei) => (
                      <div key={ei} className="flex items-center justify-between gap-2 text-xs">
                        <span className="w-14 tabular-nums text-muted-foreground">{Math.round(s.feet)} ft</span>
                        <select
                          value={sel.edgeTypes[ei] ?? "eave"}
                          onChange={(e) => setEdgeType(selected, ei, e.target.value as EdgeType)}
                          className="flex-1 rounded border border-border bg-background px-1.5 py-1 capitalize"
                        >
                          {EDGE_TYPES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <p className="text-[11px] leading-snug text-muted-foreground">{ROOF_DISCLAIMER}</p>
          </div>

          {/* Footer actions */}
          <div className="mt-auto flex gap-2 border-t border-border p-4">
            <Button onClick={save} disabled={saving || genning} variant="outline" className="flex-1 gap-1.5">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save
            </Button>
            <Button onClick={generate} disabled={saving || genning} className="flex-1 gap-1.5">
              {genning ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />} PDF
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums", accent && "text-gold")}>{value}</div>
    </div>
  );
}
