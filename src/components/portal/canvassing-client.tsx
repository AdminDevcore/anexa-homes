"use client";

// Import Leaflet's stylesheet eagerly so it can never race the lazy map chunk.
import "leaflet/dist/leaflet.css";
import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Map as LeafletMap } from "leaflet";
import { Crosshair, Pencil, MapPin, Map, Check, X, Trash2, Loader2, UserPlus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { DISPOSITIONS, KNOCKED_DISPOSITIONS, dispositionMeta, type LatLng } from "@/lib/canvassing";
import type { CanvassingMeta, KnockDTO, KnockDetailDTO, KnockEventDTO, TerritoryDTO } from "@/server/modules/canvassing/queries";
import type { Viewport, ZipFeature } from "./canvassing-map";
import { DateRangeFilter, resolveRange, type RangePreset } from "./canvassing-filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  updateKnockAction,
  deleteKnockAction,
  addKnockCommentAction,
  updateKnockContactAction,
  convertKnockToLeadAction,
  convertKnockToAppointmentAction,
  createTerritoryAction,
  deleteTerritoryAction,
  generateTerritoryPinsAction,
  setTerritoryRepsAction,
  assignKnockRepAction,
  ensureHouseKnockAction,
} from "@/server/modules/canvassing/actions";

const CanvassingMap = dynamic(() => import("./canvassing-map").then((m) => m.CanvassingMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <Loader2 className="mr-2 size-5 animate-spin" /> Loading map…
    </div>
  ),
});

const DEFAULT_CENTER: LatLng = [32.7831, -96.8067];
const MIN_PIN_ZOOM = 16; // below this we show territory summaries, not individual pins

export function CanvassingClient() {
  const qc = useQueryClient();
  const router = useRouter();
  const mapRef = React.useRef<LeafletMap | null>(null);

  const { data: meta } = useQuery<CanvassingMeta>({
    queryKey: ["canvassing-meta"],
    queryFn: async () => {
      const res = await fetch("/api/canvassing/data");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 30000,
    // Don't refetch on window focus — it re-renders the markers and would tear
    // down an open popup the moment the user clicks back into the map.
    refetchOnWindowFocus: false,
  });

  const canManage = meta?.me.canManageAll ?? false;
  const territories = meta?.territories ?? [];
  const reps = meta?.reps ?? [];

  const [mode, setMode] = React.useState<"knock" | "draw">("knock");
  const [basemap, setBasemap] = React.useState<"satellite" | "street">("satellite");
  const [drawPoints, setDrawPoints] = React.useState<LatLng[]>([]);
  const [dispFilter, setDispFilter] = React.useState<Set<string>>(new Set());
  const [repFilter, setRepFilter] = React.useState<string>("all");
  const [datePreset, setDatePreset] = React.useState<RangePreset>("all");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [remainingOnly, setRemainingOnly] = React.useState(false);
  const [viewport, setViewport] = React.useState<Viewport | null>(null);
  const [generating, setGenerating] = React.useState(false);
  // ZIP boundaries are shown by default (the map is "divided into ZIP zones");
  // the "ZIP codes" button can still hide them. Only loads at city zoom (>=9).
  const [showZips, setShowZips] = React.useState(true);

  const [pendingTerritory, setPendingTerritory] = React.useState<LatLng[] | null>(null);
  const [pendingTerritoryName, setPendingTerritoryName] = React.useState("");
  const [convertTarget, setConvertTarget] = React.useState<KnockDTO | null>(null);
  const [detailId, setDetailId] = React.useState<string | null>(null);

  // Server-side status filter for the lazy knock query. Memoized so the derived
  // `knocks` array stays referentially stable across renders (an unstable array
  // re-renders every map marker and crashes Leaflet's popup positioning).
  const statusKey = (remainingOnly ? ["not_knocked"] : [...dispFilter]).slice().sort().join(",");
  const statuses = React.useMemo(() => (statusKey ? statusKey.split(",") : []), [statusKey]);

  // Stable map callback — an inline arrow would re-run MapController's effect
  // (re-subscribing listeners + ResizeObserver) on every render → render loop.
  const handleMapReady = React.useCallback((m: LeafletMap) => {
    mapRef.current = m;
  }, []);

  // Lazy-load knocks for the current viewport (only at house-level zoom).
  const zoomOK = (viewport?.zoom ?? 0) >= MIN_PIN_ZOOM;
  const bKey = viewport
    ? `${viewport.minLat.toFixed(3)},${viewport.minLng.toFixed(3)},${viewport.maxLat.toFixed(3)},${viewport.maxLng.toFixed(3)}`
    : "";
  const { data: knockData, isFetching: knocksLoading } = useQuery<{ knocks: KnockDTO[] }>({
    queryKey: ["canvassing-knocks", bKey, repFilter, statusKey, zoomOK],
    queryFn: async () => {
      if (!viewport || !zoomOK) return { knocks: [] };
      const p = new URLSearchParams({
        minLat: String(viewport.minLat),
        minLng: String(viewport.minLng),
        maxLat: String(viewport.maxLat),
        maxLng: String(viewport.maxLng),
      });
      if (repFilter !== "all") p.set("rep", repFilter);
      if (statuses.length) p.set("status", statuses.join(","));
      const res = await fetch(`/api/canvassing/knocks?${p.toString()}`);
      if (!res.ok) return { knocks: [] };
      return res.json();
    },
    enabled: !!viewport && zoomOK,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });
  // Stable ref: only changes when the fetched data does (not every render).
  const persistedKnocks = React.useMemo(
    () => (zoomOK ? knockData?.knocks ?? [] : []),
    [zoomOK, knockData]
  );

  // ZIP (ZCTA) boundary overlay — fetched on-demand for the viewport from Census.
  // Enabled only when the toggle is on and the view isn't zoomed all the way out.
  const zipsZoomOK = (viewport?.zoom ?? 0) >= 9;
  const { data: zipData, isFetching: zipsLoading } = useQuery<{ zips: ZipFeature[]; tooBig?: boolean }>({
    queryKey: ["canvassing-zips", bKey, showZips && zipsZoomOK],
    queryFn: async () => {
      if (!viewport || !showZips || !zipsZoomOK) return { zips: [] };
      const p = new URLSearchParams({
        minLat: String(viewport.minLat),
        minLng: String(viewport.minLng),
        maxLat: String(viewport.maxLat),
        maxLng: String(viewport.maxLng),
      });
      const res = await fetch(`/api/canvassing/zips?${p.toString()}`);
      if (!res.ok) return { zips: [] };
      return res.json();
    },
    enabled: !!viewport && showZips && zipsZoomOK,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });
  const zips = React.useMemo(() => (showZips && zipsZoomOK ? zipData?.zips ?? [] : []), [showZips, zipsZoomOK, zipData]);
  const zipsTooBig = !!(showZips && zipsZoomOK && zipData?.tooBig);

  // Managers can click a ZIP outline to turn the whole ZIP into a territory.
  function onZipClick(zcta: string, ring: LatLng[]) {
    if (!canManage || ring.length < 3) return;
    setPendingTerritoryName(`ZIP ${zcta}`);
    setPendingTerritory(ring);
  }

  // Auto-load a dot on EVERY house in the current view (from OSM footprints), so
  // the rep never has to draw a zone first to see houses. These synthetic dots are
  // not persisted — tapping one creates the Knock on first action. We only show
  // them where there isn't already a real knock (dedupe by coordinate).
  // `?houses=off` disables auto-load (used by E2E to stay off the live OSM API).
  const housesDisabled = React.useMemo(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("houses") === "off",
    []
  );
  const houseZoomOK = !housesDisabled && (viewport?.zoom ?? 0) >= 17;
  const { data: houseData, isFetching: housesLoading } = useQuery<{ houses: { lat: number; lng: number; address: string | null }[] }>({
    queryKey: ["canvassing-houses", bKey, houseZoomOK],
    queryFn: async () => {
      if (!viewport || !houseZoomOK) return { houses: [] };
      const p = new URLSearchParams({
        minLat: String(viewport.minLat),
        minLng: String(viewport.minLng),
        maxLat: String(viewport.maxLat),
        maxLng: String(viewport.maxLng),
      });
      const res = await fetch(`/api/canvassing/houses?${p.toString()}`);
      if (!res.ok) return { houses: [] };
      return res.json();
    },
    enabled: !!viewport && houseZoomOK,
    placeholderData: (prev) => prev,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Merge: real knocks win; auto-loaded houses fill the gaps as "Not Knocked" dots.
  const knocks: KnockDTO[] = React.useMemo(() => {
    const ck = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`;
    const taken = new Set(persistedKnocks.map((k) => ck(k.lat, k.lng)));
    // Status filter also applies to auto-loaded houses (they're all "not_knocked").
    const showHouses = houseZoomOK && (statuses.length === 0 || statuses.includes("not_knocked"));
    const synthetic: KnockDTO[] = showHouses
      ? (houseData?.houses ?? [])
          .filter((h) => !taken.has(ck(h.lat, h.lng)))
          .map((h) => ({
            id: `house:${ck(h.lat, h.lng)}`,
            lat: h.lat,
            lng: h.lng,
            address: h.address,
            disposition: "not_knocked",
            notes: null,
            repId: null,
            repName: null,
            territoryId: null,
            leadId: null,
            propertyValue: null,
            propertyValueSource: null,
            knockedAt: "",
          }))
      : [];
    return [...persistedKnocks, ...synthetic];
  }, [persistedKnocks, houseData, houseZoomOK, statuses]);

  const refresh = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["canvassing-meta"] });
    qc.invalidateQueries({ queryKey: ["canvassing-knocks"] });
  }, [qc]);

  // Center on the first territory's centroid so its house dots are in view.
  // Memoized so a new array each render doesn't churn the map.
  const center: LatLng = React.useMemo(() => {
    const poly = territories[0]?.polygon ?? [];
    return poly.length > 0
      ? [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length]
      : DEFAULT_CENTER;
  }, [territories]);

  // When a rep is selected, emphasize the territories they're assigned to.
  const highlightTerritoryIds = React.useMemo(
    () => (repFilter !== "all" ? new Set(territories.filter((t) => t.repIds.includes(repFilter)).map((t) => t.id)) : null),
    [repFilter, territories]
  );

  // Date-filtered counters/chips for the Map tab (active only when a range is picked).
  const dateRange = resolveRange(datePreset, dateFrom, dateTo);
  const dateActive = datePreset !== "all";
  const statsParams = new URLSearchParams();
  if (dateRange.from) statsParams.set("from", dateRange.from);
  if (dateRange.to) statsParams.set("to", dateRange.to);
  if (repFilter !== "all") statsParams.set("rep", repFilter);
  const { data: rangeStats } = useQuery<{ knocked: number; houses: number; byDisposition: Record<string, number> }>({
    queryKey: ["canvassing-stats", statsParams.toString()],
    queryFn: async () => (await fetch(`/api/canvassing/stats?${statsParams.toString()}`)).json(),
    enabled: dateActive,
  });
  const statsByDisp = (dateActive && rangeStats ? rangeStats.byDisposition : meta?.stats.byDisposition) ?? {};
  const knockedCount = dateActive && rangeStats ? rangeStats.knocked : meta?.stats.knocked ?? 0;

  function onMapClick(lat: number, lng: number) {
    // Only territory drawing reacts to empty-map taps. Houses are pre-generated
    // dots — tapping empty space never creates a pin (no orphan/manual pins).
    if (mode === "draw") setDrawPoints((pts) => [...pts, [lat, lng]]);
  }

  function locate() {
    if (!navigator.geolocation) return toast.error("Geolocation isn't available on this device.");
    navigator.geolocation.getCurrentPosition(
      (pos) => mapRef.current?.setView([pos.coords.latitude, pos.coords.longitude], 18),
      () => toast.error("Couldn't get your location."),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  function finishDrawing() {
    if (drawPoints.length < 3) return toast.error("Add at least 3 points to form a territory.");
    setPendingTerritoryName("");
    setPendingTerritory(drawPoints);
  }
  function cancelDrawing() {
    setDrawPoints([]);
    setMode("knock");
  }

  // After a territory is created, auto-generate its house pins.
  async function generatePins(territoryId: string) {
    setGenerating(true);
    const res = await generateTerritoryPinsAction(territoryId);
    setGenerating(false);
    if (!res.ok) return toast.error(res.error);
    toast[res.created > 0 ? "success" : "message"](res.message);
    refresh();
  }

  // Synthetic (auto-loaded) house dots have an id like "house:<lat>,<lng>" and no
  // DB row yet. Materialize one on first action, then operate on the real id.
  const isHouseDot = (k: KnockDTO) => k.id.startsWith("house:");
  async function ensureHouse(k: KnockDTO): Promise<string | null> {
    const res = await ensureHouseKnockAction({ lat: k.lat, lng: k.lng, address: k.address });
    if (!res.ok) {
      toast.error(res.error);
      return null;
    }
    return res.id;
  }
  async function openDetails(k: KnockDTO) {
    if (!isHouseDot(k)) return setDetailId(k.id);
    const id = await ensureHouse(k);
    if (id) {
      setDetailId(id);
      refresh();
    }
  }
  // Convert works on a real row, so materialize an auto-loaded house dot first.
  async function startConvert(k: KnockDTO) {
    if (!isHouseDot(k)) return setConvertTarget(k);
    const id = await ensureHouse(k);
    if (id) {
      setConvertTarget({ ...k, id });
      refresh();
    }
  }

  async function changeDisposition(k: KnockDTO, disposition: string) {
    const id = isHouseDot(k) ? await ensureHouse(k) : k.id;
    if (!id) return;
    const res = await updateKnockAction({ id, disposition });
    if (!res.ok) return toast.error(res.error ?? "Update failed");
    toast.success("Knock updated");
    refresh();
  }
  async function removeKnock(k: KnockDTO) {
    const res = await deleteKnockAction(k.id);
    if (!res.ok) return toast.error(res.error ?? "Delete failed");
    toast.success("Pin removed");
    refresh();
  }
  async function setTerritoryReps(t: TerritoryDTO, repIds: string[]) {
    const res = await setTerritoryRepsAction({ territoryId: t.id, repIds });
    if (!res.ok) return toast.error(res.error ?? "Update failed");
    toast.success("Reps updated");
    refresh();
  }
  async function removeTerritory(t: TerritoryDTO) {
    const res = await deleteTerritoryAction(t.id);
    if (!res.ok) return toast.error(res.error ?? "Delete failed");
    toast.success("Territory deleted");
    refresh();
  }

  function renderKnockPopup(k: KnockDTO) {
    const meta = dispositionMeta(k.disposition);
    const blank = k.disposition === "not_knocked";
    return (
      <div className="min-w-52 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="font-semibold">{k.address ?? "House"}</div>
          <button onClick={() => openDetails(k)} className="shrink-0 text-xs font-medium text-gold hover:underline">
            Details
          </button>
        </div>
        {canManage && k.repName && <div className="text-xs text-muted-foreground">Knocked by {k.repName}</div>}
        {/* Static cached value only — a live (resizing) fetch inside a Leaflet
            popup crashes Leaflet's positioning. Full estimate is in Details. */}
        {k.propertyValue != null ? (
          <div className="text-xs text-muted-foreground">
            ~{usd(k.propertyValue)} · est.{k.propertyValueSource ? ` · ${k.propertyValueSource}` : ""}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">Open Details for value estimate</div>
        )}
        <div className="flex items-center gap-2">
          <span className="inline-block size-3 rounded-full border" style={{ background: blank ? "#fff" : meta.color, borderColor: meta.color }} />
          <select
            value={blank ? "" : k.disposition}
            onChange={(e) => e.target.value && changeDisposition(k, e.target.value)}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
          >
            {blank && <option value="">Set status…</option>}
            {KNOCKED_DISPOSITIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        {k.notes && <p className="text-sm text-muted-foreground">{k.notes}</p>}
        <div className="flex items-center gap-2 pt-1">
          {k.leadId ? (
            <button
              onClick={() => router.push(`/portal/leads/${k.leadId}`)}
              className="inline-flex items-center gap-1 text-sm font-medium text-gold"
            >
              <Check className="size-3.5" /> Appointment created — open
            </button>
          ) : (
            <Button size="sm" className="h-7 gap-1" onClick={() => startConvert(k)}>
              <UserPlus className="size-3.5" /> Convert to appointment
            </Button>
          )}
          {!isHouseDot(k) && (
            <button
              onClick={() => removeKnock(k)}
              className="ml-auto inline-flex items-center text-muted-foreground hover:text-destructive"
              aria-label="Delete pin"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  function renderTerritoryPopup(t: TerritoryDTO) {
    const pct = t.total ? Math.round((t.knocked / t.total) * 100) : 0;
    return (
      <div className="min-w-56 space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-block size-3 rounded-full" style={{ background: t.color }} />
          <span className="font-semibold">{t.name}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {t.knocked} / {t.total} knocked · {pct}%
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
        </div>
        {canManage ? (
          <>
            <div>
              <label className="block text-xs font-medium text-muted-foreground">Assigned reps</label>
              <div className="mt-1 max-h-32 space-y-0.5 overflow-y-auto rounded border border-border p-1">
                {reps.length === 0 && <p className="px-1 text-xs text-muted-foreground">No reps available.</p>}
                {reps.map((r) => {
                  const on = t.repIds.includes(r.id);
                  return (
                    <label key={r.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setTerritoryReps(t, on ? t.repIds.filter((x) => x !== r.id) : [...t.repIds, r.id])}
                      />
                      {r.name}
                      {t.assignedRepId === r.id && <span className="text-[10px] text-muted-foreground">(primary)</span>}
                    </label>
                  );
                })}
              </div>
            </div>
            <button
              onClick={() => generatePins(t.id)}
              className="inline-flex items-center gap-1 pt-1 text-sm font-medium text-gold"
            >
              <Sparkles className="size-3.5" /> {t.total > 0 ? "Re-sync house pins" : "Generate house pins"}
            </button>
            <button
              onClick={() => removeTerritory(t)}
              className="block inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3.5" /> Delete territory
            </button>
          </>
        ) : (
          <div className="text-sm">Rep: {t.assignedRepName ?? "Unassigned"}</div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {mode === "draw"
              ? "Tap the map to add territory corners, then Finish — houses inside fill in automatically."
              : zoomOK
                ? "Every house shows a dot — tap one to log a knock or take action."
                : "Zoom in to see a dot on every house."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            <button
              onClick={() => setBasemap("satellite")}
              className={cn("px-3 py-1.5 text-sm font-medium transition-colors", basemap === "satellite" ? "bg-foreground text-background" : "hover:bg-muted")}
            >
              Satellite
            </button>
            <button
              onClick={() => setBasemap("street")}
              className={cn("px-3 py-1.5 text-sm font-medium transition-colors", basemap === "street" ? "bg-foreground text-background" : "hover:bg-muted")}
            >
              Street
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={locate} className="gap-1.5">
            <Crosshair className="size-4" /> Locate me
          </Button>
          <Button
            variant={showZips ? "default" : "outline"}
            size="sm"
            onClick={() => setShowZips((v) => !v)}
            className="gap-1.5"
            title={canManage ? "Show ZIP code boundaries — click a ZIP to make it a territory" : "Show ZIP code boundaries"}
          >
            <Map className="size-4" /> ZIP codes
          </Button>
          <Button variant={mode === "knock" ? "default" : "outline"} size="sm" onClick={() => setMode("knock")} className="gap-1.5">
            <MapPin className="size-4" /> Knock
          </Button>
          {canManage &&
            (mode === "draw" ? (
              <>
                <Button size="sm" onClick={finishDrawing} className="gap-1.5" disabled={drawPoints.length < 3}>
                  <Check className="size-4" /> Finish ({drawPoints.length})
                </Button>
                <Button variant="outline" size="sm" onClick={cancelDrawing} className="gap-1.5">
                  <X className="size-4" /> Cancel
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setMode("draw")} className="gap-1.5">
                <Pencil className="size-4" /> Draw territory
              </Button>
            ))}
        </div>
      </div>

      {/* Date filter — scopes the Knocked counter + disposition chips below */}
      <div className="flex flex-wrap items-center gap-2">
        <DateRangeFilter
          preset={datePreset} setPreset={setDatePreset}
          customFrom={dateFrom} setCustomFrom={setDateFrom}
          customTo={dateTo} setCustomTo={setDateTo}
        />
        {dateActive && <span className="text-xs text-muted-foreground">scoping counters to selected period</span>}
      </div>

      {/* Stats + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <StatPill label="Today" value={meta?.stats.today ?? 0} />
        <StatPill label={dateActive ? "Knocked (period)" : "Knocked"} value={knockedCount} />
        <StatPill label="Houses" value={meta?.stats.houses ?? 0} />
        <button
          onClick={() => setRemainingOnly((v) => !v)}
          className={cn(
            "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
            remainingOnly ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted"
          )}
        >
          Remaining only
        </button>
        <div className="mx-1 h-6 w-px bg-border" />
        {DISPOSITIONS.map((d) => {
          const active = dispFilter.has(d.value);
          const count = statsByDisp[d.value] ?? 0;
          return (
            <button
              key={d.value}
              disabled={remainingOnly}
              onClick={() =>
                setDispFilter((prev) => {
                  const next = new Set(prev);
                  if (next.has(d.value)) next.delete(d.value);
                  else next.add(d.value);
                  return next;
                })
              }
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40",
                active ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted"
              )}
            >
              <span className="size-2.5 rounded-full border" style={{ background: d.value === "not_knocked" ? "#fff" : d.color, borderColor: d.color }} />
              {d.label}
              <span className="tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
        {canManage && reps.length > 0 && (
          <select
            value={repFilter}
            onChange={(e) => setRepFilter(e.target.value)}
            className="ml-auto rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
          >
            <option value="all">All reps</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div
        className="relative w-full overflow-hidden rounded-xl border border-border bg-muted"
        style={{ height: "min(75vh, 800px)", minHeight: 480, isolation: "isolate" }}
      >
        {(generating || knocksLoading || housesLoading || zipsLoading) && (
          <div className="absolute right-3 top-3 z-[1000] inline-flex items-center gap-1.5 rounded-full bg-foreground/90 px-3 py-1.5 text-xs font-medium text-background shadow">
            <Loader2 className="size-3.5 animate-spin" />
            {generating ? "Finding houses…" : zipsLoading && !knocksLoading && !housesLoading ? "Loading ZIP codes…" : housesLoading && !knocksLoading ? "Loading houses…" : "Loading pins…"}
          </div>
        )}
        {showZips && zipsTooBig && (
          <div className="absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded-full bg-foreground/90 px-3 py-1.5 text-xs font-medium text-background shadow">
            Zoom in to load ZIP code boundaries
          </div>
        )}
        <CanvassingMap
          center={center}
          basemap={basemap}
          knocks={knocks}
          territories={territories}
          drawPoints={drawPoints}
          onMapClick={onMapClick}
          onMapReady={handleMapReady}
          onViewport={setViewport}
          renderKnockPopup={renderKnockPopup}
          renderTerritoryPopup={renderTerritoryPopup}
          highlightTerritoryIds={highlightTerritoryIds}
          zips={zips}
          showZips={showZips}
          onZipClick={canManage ? onZipClick : undefined}
        />
      </div>

      <TerritoryDialog
        points={pendingTerritory}
        defaultName={pendingTerritoryName}
        reps={reps}
        onClose={() => setPendingTerritory(null)}
        onSaved={(id) => {
          setPendingTerritory(null);
          setDrawPoints([]);
          setMode("knock");
          refresh();
          void generatePins(id);
        }}
      />
      <KnockDetailDialog
        id={detailId}
        canManage={canManage}
        reps={reps}
        onClose={() => setDetailId(null)}
        onChanged={refresh}
        onConvert={(k) => {
          setDetailId(null);
          setConvertTarget(k);
        }}
      />
      <ConvertDialog
        knock={convertTarget}
        onClose={() => setConvertTarget(null)}
        onConverted={(leadId) => {
          setConvertTarget(null);
          refresh();
          toast.success("Appointment created from knock", {
            duration: 12000,
            action: { label: "Open appointment", onClick: () => router.push(`/portal/leads/${leadId}`) },
          });
        }}
      />
    </div>
  );
}

// --- Property value (AVM) display ------------------------------------------
export const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
// Compact money for ranges/sales: $412k / $1.2M.
function shortUsd(cents: number): string {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(d % 1_000_000 === 0 ? 0 : 1)}M`;
  return `$${Math.round(d / 1000)}k`;
}
function monthYear(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
function yearOf(iso: string): string {
  const m = iso.match(/^(\d{4})/);
  return m ? m[1] : "";
}

type PropertyValueResp = {
  value: number | null;
  low: number | null;
  high: number | null;
  confidence: "high" | "medium" | "low" | null;
  matched: boolean;
  source: string;
  asOfDate: string;
  lastSalePrice: number | null;
  lastSaleDate: string | null;
  assessedValue: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  yearBuilt: number | null;
};

const CONFIDENCE_LABEL: Record<string, string> = { high: "high confidence", medium: "med confidence", low: "low confidence" };

/**
 * Lazily resolves and shows a house's real estimated value as a RANGE with a
 * confidence label, last sale, and source/date — never a single hard number.
 * Leaflet popups only mount their children when opened, so this fetch fires
 * per-dot on open (not for all houses). Server caches by address.
 */
function PropertyInfo({
  knockId,
  lat,
  lng,
  address,
}: {
  knockId?: string | null;
  lat: number;
  lng: number;
  address?: string | null;
}) {
  const { data, isLoading } = useQuery<PropertyValueResp | null>({
    queryKey: ["property-value", knockId ?? `${lat.toFixed(5)},${lng.toFixed(5)}`],
    queryFn: async () => {
      const p = new URLSearchParams({ lat: String(lat), lng: String(lng) });
      if (address) p.set("address", address);
      if (knockId) p.set("knockId", knockId);
      const r = await fetch(`/api/canvassing/property-value?${p.toString()}`);
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: Infinity,
  });

  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Estimating value…
      </span>
    );
  }
  // Honest: no confident match → don't show a misleading number.
  if (!data || !data.matched || data.value == null) {
    return (
      <span className="text-xs text-muted-foreground">
        Estimate unavailable / unverified{data?.source && data.source !== "Unavailable" ? ` · ${data.source}` : ""}
      </span>
    );
  }

  const range =
    data.low != null && data.high != null ? `${shortUsd(data.low)}–${shortUsd(data.high)}` : shortUsd(data.value);
  const conf = data.confidence ? CONFIDENCE_LABEL[data.confidence] : null;
  const structure = [
    data.beds != null ? `${data.beds} bd` : null,
    data.baths != null ? `${data.baths} ba` : null,
    data.sqft != null ? `${data.sqft.toLocaleString("en-US")} sqft` : null,
    data.yearBuilt != null ? `${data.yearBuilt}` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-0.5 text-right">
      <div className="text-sm font-semibold tabular-nums">
        {range}
        {conf && <span className="ml-1 text-xs font-normal text-muted-foreground">· {conf}</span>}
      </div>
      <div className="text-[11px] text-muted-foreground">
        est. · {data.source}
        {data.asOfDate ? ` · ${monthYear(data.asOfDate)}` : ""}
      </div>
      {data.lastSalePrice != null && (
        <div className="text-[11px] text-muted-foreground">
          Sold {shortUsd(data.lastSalePrice)}
          {data.lastSaleDate ? ` · ${yearOf(data.lastSaleDate)}` : ""}
        </div>
      )}
      {structure.length > 0 && <div className="text-[11px] text-muted-foreground">{structure.join(" · ")}</div>}
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>{" "}
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}


function TerritoryDialog({
  points,
  defaultName = "",
  reps,
  onClose,
  onSaved,
}: {
  points: LatLng[] | null;
  defaultName?: string;
  reps: { id: string; name: string }[];
  onClose: () => void;
  onSaved: (territoryId: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState("#F4631E");
  const [repId, setRepId] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (points) {
      setName(defaultName);
      setColor("#F4631E");
      setRepId("");
    }
  }, [points, defaultName]);

  async function save() {
    if (!points) return;
    if (!name.trim()) return toast.error("Give the territory a name.");
    setBusy(true);
    const res = await createTerritoryAction({ name: name.trim(), color, polygon: points, assignedRepId: repId || null });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Territory created");
    onSaved(res.id);
  }

  return (
    <Dialog open={!!points} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New territory</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="terr-name">Name</Label>
            <Input id="terr-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. North Frisco" />
          </div>
          <div className="flex items-center gap-3">
            <div>
              <Label htmlFor="terr-color">Color</Label>
              <input id="terr-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="mt-1 h-10 w-16 cursor-pointer rounded border border-border bg-background" />
            </div>
            <div className="flex-1">
              <Label htmlFor="terr-rep">Assign to</Label>
              <select id="terr-rep" value={repId} onChange={(e) => setRepId(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                <option value="">Unassigned</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {points?.length ?? 0} boundary points · houses inside will be added automatically.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Create &amp; populate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConvertDialog({
  knock,
  onClose,
  onConverted,
}: {
  knock: KnockDTO | null;
  onClose: () => void;
  onConverted: (leadId: string) => void;
}) {
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (knock) {
      setFirstName("");
      setLastName("");
      setPhone("");
    }
  }, [knock]);

  async function convert() {
    if (!knock) return;
    setBusy(true);
    const res = await convertKnockToLeadAction({
      id: knock.id,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      phone: phone || undefined,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    onConverted(res.leadId);
  }

  return (
    <Dialog open={!!knock} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert knock to appointment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{knock?.address ?? "This house"} will become an appointment assigned to its rep.</p>
          {knock && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">Estimated value (saved to appointment)</span>
              <PropertyInfo knockId={knock.id} lat={knock.lat} lng={knock.lng} address={knock.address} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cv-first">First name</Label>
              <Input id="cv-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <Label htmlFor="cv-last">Last name</Label>
              <Input id="cv-last" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div>
            <Label htmlFor="cv-phone">Phone</Label>
            <Input id="cv-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={convert} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Create appointment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function eventLabel(ev: KnockEventDTO): string {
  switch (ev.type) {
    case "status_change":
      return `Status → ${ev.disposition ? dispositionMeta(ev.disposition).label : "updated"}`;
    case "comment":
      return "Comment";
    case "contact_update":
      return "Updated contact";
    case "lead_created":
      return "Converted to appointment";
    default:
      return "Created";
  }
}

function KnockDetailDialog({
  id,
  canManage,
  reps,
  onClose,
  onChanged,
  onConvert,
}: {
  id: string | null;
  canManage: boolean;
  reps: { id: string; name: string }[];
  onClose: () => void;
  onChanged: () => void;
  onConvert: (k: KnockDTO) => void;
}) {
  const { data: detail, refetch, isFetching } = useQuery<KnockDetailDTO>({
    queryKey: ["knock-detail", id],
    queryFn: async () => {
      const r = await fetch(`/api/canvassing/knock/${id}`);
      if (!r.ok) throw new Error("failed");
      return r.json();
    },
    enabled: !!id,
    refetchOnWindowFocus: false,
  });

  const [comment, setComment] = React.useState("");
  const [contact, setContact] = React.useState({ contactName: "", contactPhone: "", contactEmail: "", bestTime: "" });
  const [savingContact, setSavingContact] = React.useState(false);
  const [apptAt, setApptAt] = React.useState("");
  const [apptRep, setApptRep] = React.useState("");
  const [bookingAppt, setBookingAppt] = React.useState(false);

  React.useEffect(() => {
    if (detail) {
      setComment("");
      setContact({
        contactName: detail.contactName ?? "",
        contactPhone: detail.contactPhone ?? "",
        contactEmail: detail.contactEmail ?? "",
        bestTime: detail.bestTime ?? "",
      });
      setApptRep(detail.repId ?? "");
      setApptAt(detail.appointmentAt ? detail.appointmentAt.slice(0, 16) : "");
    }
  }, [detail?.id]);

  // Resolve "Address pending" once: reverse-geocode and persist the real address.
  React.useEffect(() => {
    if (!detail || detail.address || !id) return;
    let cancelled = false;
    fetch(`/api/canvassing/reverse?lat=${detail.lat}&lng=${detail.lng}`)
      .then((r) => r.json())
      .then(async (d: { address?: string }) => {
        if (cancelled || !d.address) return;
        const res = await updateKnockAction({ id, address: d.address });
        if (res.ok) {
          await refetch();
          onChanged();
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id]);

  async function setStatus(d: string) {
    if (!id) return;
    const res = await updateKnockAction({ id, disposition: d });
    if (!res.ok) return toast.error(res.error ?? "Failed");
    await refetch();
    onChanged();
  }
  async function addComment() {
    if (!id || !comment.trim()) return;
    const res = await addKnockCommentAction({ knockId: id, body: comment });
    if (!res.ok) return toast.error(res.error ?? "Failed");
    setComment("");
    await refetch();
    onChanged();
  }
  async function saveContact() {
    if (!id) return;
    setSavingContact(true);
    const res = await updateKnockContactAction({ knockId: id, ...contact });
    setSavingContact(false);
    if (!res.ok) return toast.error(res.error ?? "Failed");
    toast.success("Contact saved");
    await refetch();
    onChanged();
  }
  async function setRep(repId: string) {
    if (!id) return;
    const res = await assignKnockRepAction({ knockId: id, repId: repId || null });
    if (!res.ok) return toast.error(res.error ?? "Failed");
    await refetch();
    onChanged();
  }
  async function bookAppointment() {
    if (!id) return;
    if (!apptAt) return toast.error("Pick a date and time.");
    setBookingAppt(true);
    const res = await convertKnockToAppointmentAction({
      knockId: id,
      appointmentAt: new Date(apptAt).toISOString(),
      repId: apptRep || null,
    });
    setBookingAppt(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Appointment booked + task created");
    await refetch();
    onChanged();
  }

  const blank = detail?.disposition === "not_knocked";

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{detail?.address ?? "House detail"}</DialogTitle>
        </DialogHeader>
        {!detail ? (
          <div className="py-10 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="max-h-[68vh] space-y-4 overflow-y-auto pr-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {detail.territoryName && <span>Territory: {detail.territoryName}</span>}
              <span>Rep: {detail.repName ?? "Unassigned"}</span>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">Estimated property value</span>
              <PropertyInfo knockId={detail.id} lat={detail.lat} lng={detail.lng} address={detail.address} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <select
                value={blank ? "" : detail.disposition}
                onChange={(e) => e.target.value && setStatus(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm"
              >
                {blank && <option value="">Set status…</option>}
                {KNOCKED_DISPOSITIONS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>

            {canManage && (
              <div className="space-y-1.5">
                <Label className="text-xs">Assigned rep</Label>
                <select
                  value={detail.repId ?? ""}
                  onChange={(e) => setRep(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm"
                >
                  <option value="">Unassigned</option>
                  {reps.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs font-medium">Homeowner contact</p>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Name" value={contact.contactName} onChange={(e) => setContact((c) => ({ ...c, contactName: e.target.value }))} />
                <Input placeholder="Phone" value={contact.contactPhone} onChange={(e) => setContact((c) => ({ ...c, contactPhone: e.target.value }))} />
                <Input placeholder="Email" value={contact.contactEmail} onChange={(e) => setContact((c) => ({ ...c, contactEmail: e.target.value }))} />
                <Input placeholder="Best time to reach" value={contact.bestTime} onChange={(e) => setContact((c) => ({ ...c, bestTime: e.target.value }))} />
              </div>
              <Button size="sm" variant="outline" onClick={saveContact} disabled={savingContact}>
                {savingContact && <Loader2 className="size-3.5 animate-spin" />} Save contact
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Add a comment</Label>
              <div className="flex gap-2">
                <Textarea
                  rows={1}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="e.g. callback Tuesday 6pm; spoke to homeowner, wants a quote"
                  className="min-h-9"
                />
                <Button size="sm" onClick={addComment} disabled={!comment.trim()}>Add</Button>
              </div>
            </div>

            {/* Convert to appointment */}
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs font-medium">
                Appointment
                {detail.appointmentAt && (
                  <span className="ml-2 font-normal text-gold">booked {new Date(detail.appointmentAt).toLocaleString()}</span>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="datetime-local"
                  value={apptAt}
                  onChange={(e) => setApptAt(e.target.value)}
                  className="w-48"
                />
                <select
                  value={apptRep}
                  onChange={(e) => setApptRep(e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-2 text-sm"
                >
                  <option value="">{detail.repName ? `Keep ${detail.repName}` : "Assign rep"}</option>
                  {reps.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
                <Button size="sm" onClick={bookAppointment} disabled={bookingAppt || !apptAt}>
                  {bookingAppt && <Loader2 className="size-3.5 animate-spin" />} Book appointment time
                </Button>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium">Visit history {isFetching && <Loader2 className="ml-1 inline size-3 animate-spin" />}</p>
              <ul className="space-y-1.5">
                {detail.events.length === 0 && <li className="text-xs text-muted-foreground">No activity yet.</li>}
                {detail.events.map((ev) => (
                  <li key={ev.id} className="rounded-md border border-border/60 px-2.5 py-1.5">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">{eventLabel(ev)}</span>
                      <span className="tabular-nums">{new Date(ev.createdAt).toLocaleString()}</span>
                    </div>
                    {ev.body && <p className="mt-0.5 whitespace-pre-wrap text-sm">{ev.body}</p>}
                    {ev.authorName && <p className="text-[10px] text-muted-foreground">by {ev.authorName}</p>}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center gap-2 border-t border-border pt-3">
              {detail.leadId ? (
                <span className="text-sm font-medium text-gold">Appointment created from this house ✓</span>
              ) : (
                <Button size="sm" onClick={() => onConvert(detail as KnockDTO)}>
                  <UserPlus className="size-3.5" /> Create appointment from this house
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
