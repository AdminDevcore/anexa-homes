"use client";

// Import Leaflet's stylesheet eagerly so it can never race the lazy map chunk.
import "leaflet/dist/leaflet.css";
import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Map as LeafletMap } from "leaflet";
import { Loader2 } from "lucide-react";
import type { LatLng } from "@/lib/canvassing";
import type { KnockDTO, DealDTO, TerritoryDTO } from "@/server/modules/canvassing/queries";
import type { Viewport } from "../canvassing-map";
import { FieldMapLegend } from "@/components/portal/storm/field-map-legend";
import { useMapFilters } from "./use-map-filters";
import { useFieldMapData } from "./use-field-map-data";
import { KnockSheet } from "./knock-sheet";
import { DealSheet } from "./deal-sheet";
import { FiltersSheet } from "./filters-sheet";
import { LayersSheet } from "./layers-sheet";
import { ManagerRail, type StormTab } from "./manager-rail";
import { LoadingPill, TopBar, StatusBar, MovingBanner, Banner, ViewSwitcher } from "./map-overlays";
import { AddressSearch, TerritoryDialog, ConvertDialog, KnockDetailDialog } from "./dialogs";
import {
  updateKnockAction,
  deleteKnockAction,
  lookupOwnerAction,
  deleteTerritoryAction,
  generateTerritoryPinsAction,
  setTerritoryRepsAction,
  ensureHouseKnockAction,
  updateLeadPositionAction,
} from "@/server/modules/canvassing/actions";

const CanvassingMap = dynamic(() => import("../canvassing-map").then((m) => m.CanvassingMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <Loader2 className="mr-2 size-5 animate-spin" /> Loading map…
    </div>
  ),
});

const DEFAULT_CENTER: LatLng = [32.7831, -96.8067];

export type FieldMapProps = {
  tab: string;
  onChangeTab: (t: "map" | "list" | "insights") => void;
  onOpenStormTab: (tab: StormTab) => void;
  canStorm: boolean;
};

export function FieldMap({ tab, onChangeTab, onOpenStormTab, canStorm }: FieldMapProps) {
  const router = useRouter();
  const mapRef = React.useRef<LeafletMap | null>(null);

  const { filters, activeCount, set, toggleDisposition, reset } = useMapFilters();
  const [viewport, setViewport] = React.useState<Viewport | null>(null);
  const data = useFieldMapData(filters, viewport);

  const [mode, setMode] = React.useState<"knock" | "draw">("knock");
  const [drawPoints, setDrawPoints] = React.useState<LatLng[]>([]);
  const [generating, setGenerating] = React.useState(false);
  // Pulsing highlight dropped on the address a rep searched for. searchTarget is
  // the raw geocoded point we snap to the nearest real house dot once dots load.
  const [searchPin, setSearchPin] = React.useState<LatLng | null>(null);
  const [searchTarget, setSearchTarget] = React.useState<LatLng | null>(null);
  // Drag-to-reposition: id of the pin in "move" mode (knock id or `deal-<id>`).
  const [movingId, setMovingId] = React.useState<string | null>(null);
  const [pendingTerritory, setPendingTerritory] = React.useState<LatLng[] | null>(null);
  const [pendingTerritoryName, setPendingTerritoryName] = React.useState("");
  const [convertTarget, setConvertTarget] = React.useState<KnockDTO | null>(null);
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [sheetKnock, setSheetKnock] = React.useState<KnockDTO | null>(null);
  const [sheetDeal, setSheetDeal] = React.useState<DealDTO | null>(null);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [layersOpen, setLayersOpen] = React.useState(false);

  const { canManage, refresh, knocks, knockScores, dealScores } = data;

  // Stable map callback — an inline arrow would re-run MapController's effect
  // (re-subscribing listeners + ResizeObserver) on every render → render loop.
  const handleMapReady = React.useCallback((m: LeafletMap) => {
    mapRef.current = m;
  }, []);

  // After a search, once house dots load, snap the highlight ring to the nearest
  // real house so it never sits in the middle of the street (street-name searches
  // resolve to the road midpoint). Beyond ~70m we keep the raw geocoded point.
  React.useEffect(() => {
    if (!searchTarget || knocks.length === 0) return;
    const [tlat, tlng] = searchTarget;
    let best: { lat: number; lng: number } | null = null;
    let bestD = Infinity;
    for (const k of knocks) {
      const d = (k.lat - tlat) ** 2 + (k.lng - tlng) ** 2;
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best && bestD <= 0.0007 ** 2) setSearchPin([best.lat, best.lng]);
    setSearchTarget(null);
  }, [knocks, searchTarget]);

  // Center on the first territory's centroid so its house dots are in view.
  const center: LatLng = React.useMemo(() => {
    const poly = data.territories[0]?.polygon ?? [];
    return poly.length > 0
      ? [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length]
      : DEFAULT_CENTER;
  }, [data.territories]);

  // When a rep is selected, emphasize the territories they're assigned to.
  const highlightTerritoryIds = React.useMemo(
    () =>
      filters.repId !== "all"
        ? new Set(data.territories.filter((t) => t.repIds.includes(filters.repId)).map((t) => t.id))
        : null,
    [filters.repId, data.territories]
  );

  // Min-score filter: when > 0, show only knocks/deals at/above that storm score.
  const mapKnocks = React.useMemo(
    () => (filters.minScore > 0 ? knocks.filter((k) => (knockScores[k.id] ?? -1) >= filters.minScore) : knocks),
    [filters.minScore, knocks, knockScores]
  );
  const mapDeals = React.useMemo(() => {
    const visible = filters.showDeals ? data.deals : [];
    return filters.minScore > 0 ? visible.filter((d) => (dealScores[d.id] ?? -1) >= filters.minScore) : visible;
  }, [filters.showDeals, filters.minScore, data.deals, dealScores]);

  // --- Actions -------------------------------------------------------------

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

  // Jump the map to a searched address and drop a pulsing highlight on it so the
  // rep can see which house dot to tap. Zoom 19 so the house dots auto-load.
  function goToAddress(lat: number, lng: number) {
    setSearchPin([lat, lng]);
    setSearchTarget([lat, lng]);
    mapRef.current?.setView([lat, lng], 19, { animate: true });
  }

  // Managers can click a ZIP outline to turn the whole ZIP into a territory.
  function onZipClick(zcta: string, ring: LatLng[]) {
    if (!canManage || ring.length < 3) return;
    setPendingTerritoryName(`ZIP ${zcta}`);
    setPendingTerritory(ring);
  }

  async function handleMovePin(kind: "knock" | "deal", id: string, lat: number, lng: number) {
    const res =
      kind === "knock"
        ? await updateKnockAction({ id, lat, lng })
        : await updateLeadPositionAction({ leadId: id, lat, lng });
    setMovingId(null);
    if (!res.ok) return toast.error(res.error ?? "Couldn't move the pin.");
    toast.success("Pin moved");
    refresh();
  }

  // Begin moving a pin: materialize auto-loaded house dots first (no DB row yet),
  // close the sheet, then make that marker draggable.
  async function startMoveKnock(k: KnockDTO) {
    const id = isHouseDot(k) ? await ensureHouse(k) : k.id;
    if (!id) return;
    if (isHouseDot(k)) refresh();
    setSheetKnock(null);
    setMovingId(id);
    toast.message("Drag the pin onto the right house, then drop it.");
  }
  function startMoveDeal(d: DealDTO) {
    setSheetDeal(null);
    setMovingId(`deal-${d.id}`);
    toast.message("Drag the pin onto the right house, then drop it.");
  }

  function startDrawing() {
    setMode("draw");
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

  async function openDetails(k: KnockDTO) {
    setSheetKnock(null);
    if (!isHouseDot(k)) return setDetailId(k.id);
    const id = await ensureHouse(k);
    if (id) {
      setDetailId(id);
      refresh();
    }
  }
  // Skip-trace needs a real knock row to cache the result onto.
  async function lookupOwnerForKnock(k: KnockDTO) {
    const realId = isHouseDot(k) ? await ensureHouse(k) : k.id;
    if (!realId) return;
    const t = toast.loading("Looking up owner…");
    const res = await lookupOwnerAction({ knockId: realId });
    toast.dismiss(t);
    if (!res.ok) return toast.error(res.error);
    toast.success(res.applied.contactName ? `Owner: ${res.applied.contactName}` : `Owner found via ${res.result.source}`);
    refresh();
  }
  // Convert works on a real row, so materialize an auto-loaded house dot first.
  async function startConvert(k: KnockDTO) {
    setSheetKnock(null);
    if (!isHouseDot(k)) return setConvertTarget(k);
    const id = await ensureHouse(k);
    if (id) {
      setConvertTarget({ ...k, id });
      refresh();
    }
  }

  // The two-tap path. Auto-loaded house dots must be materialized first or the
  // knock is silently dropped.
  async function changeDisposition(k: KnockDTO, disposition: string) {
    const id = isHouseDot(k) ? await ensureHouse(k) : k.id;
    if (!id) return;
    const res = await updateKnockAction({ id, disposition });
    if (!res.ok) return void toast.error(res.error ?? "Update failed");
    toast.success("Knock updated");
    refresh();
  }
  async function removeKnock(k: KnockDTO) {
    setSheetKnock(null);
    const res = await deleteKnockAction(k.id);
    if (!res.ok) return toast.error(res.error ?? "Delete failed");
    toast.success("Pin removed");
    refresh();
  }

  function renderTerritoryPopup(t: TerritoryDTO) {
    const pct = t.total ? Math.round((t.knocked / t.total) * 100) : 0;
    return (
      <div className="min-w-48 space-y-2">
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
        <div className="text-sm">Rep: {t.assignedRepName ?? "Unassigned"}</div>
        {canManage && <p className="text-[11px] text-muted-foreground">Manage this territory in the Tools rail.</p>}
      </div>
    );
  }

  const remaining = Math.max(0, data.houseCount - data.knockedCount);

  return (
    // Cancel PortalShell's p-4/sm:p-6/lg:p-8 and fill the viewport under the
    // h-16 header. The map is the page; nothing stacks above it.
    <div className="relative -m-4 h-[calc(100dvh-4rem)] overflow-hidden sm:-m-6 lg:-m-8" style={{ isolation: "isolate" }}>
      <CanvassingMap
        center={center}
        basemap={filters.basemap}
        knocks={mapKnocks}
        deals={mapDeals}
        territories={data.territories}
        drawPoints={drawPoints}
        onMapClick={onMapClick}
        onMapReady={handleMapReady}
        onViewport={setViewport}
        onKnockClick={setSheetKnock}
        onDealClick={setSheetDeal}
        renderTerritoryPopup={renderTerritoryPopup}
        highlightTerritoryIds={highlightTerritoryIds}
        zips={data.zips}
        showZips={filters.showZips}
        onZipClick={canManage ? onZipClick : undefined}
        radarSwaths={data.radarSwaths}
        stormEvents={data.stormEvents}
        stormWarnings={data.stormWarnings}
        knockScores={filters.showHeat ? knockScores : undefined}
        dealScores={filters.showHeat ? dealScores : undefined}
        searchPin={searchPin}
        movingId={movingId}
        onMovePin={handleMovePin}
      />

      <TopBar onLocate={locate} onLayers={() => setLayersOpen(true)} className={canManage ? "sm:left-[21rem]" : ""}>
        <AddressSearch onSelect={goToAddress} />
      </TopBar>

      {(generating || data.loading) && <LoadingPill label={generating ? "Finding houses…" : data.loadingLabel} />}
      {filters.showZips && data.zipsTooBig && <Banner>Zoom in to load ZIP code boundaries</Banner>}
      {!data.zoomOK && !movingId && <Banner>Zoom in to see a dot on every house.</Banner>}
      {mode === "draw" && (
        <Banner>Tap the map to add territory corners, then Finish.</Banner>
      )}
      {movingId && <MovingBanner onCancel={() => setMovingId(null)} />}

      <ViewSwitcher tab={tab} onChange={onChangeTab} />

      {canManage ? (
        <ManagerRail
          filters={filters}
          activeCount={activeCount}
          set={set}
          toggleDisposition={toggleDisposition}
          reset={reset}
          statsByDisp={data.statsByDisp}
          reps={data.reps}
          territories={data.territories}
          drawing={mode === "draw"}
          drawPointCount={drawPoints.length}
          onStartDraw={startDrawing}
          onFinishDraw={finishDrawing}
          onCancelDraw={cancelDrawing}
          onGeneratePins={generatePins}
          onDeleteTerritory={removeTerritory}
          onSetTerritoryReps={setTerritoryReps}
          onOpenStormTab={onOpenStormTab}
          canStorm={canStorm}
        />
      ) : (
        <StatusBar
          today={data.todayCount}
          remaining={remaining}
          activeCount={activeCount}
          onOpenFilters={() => setFiltersOpen(true)}
        />
      )}

      <FieldMapLegend showHail={filters.showRadar || filters.showStormReports} showHeat={filters.showHeat} />

      <FiltersSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        filters={filters}
        activeCount={activeCount}
        set={set}
        toggleDisposition={toggleDisposition}
        reset={reset}
        statsByDisp={data.statsByDisp}
        reps={data.reps}
        canManage={canManage}
      />
      <LayersSheet open={layersOpen} onOpenChange={setLayersOpen} filters={filters} set={set} />

      {/* key: opening a different house remounts the sheet, resetting it to peek. */}
      <KnockSheet
        key={sheetKnock?.id ?? "none"}
        knock={sheetKnock}
        ownerLookupEnabled={data.ownerLookupEnabled}
        canManage={canManage}
        onClose={() => setSheetKnock(null)}
        onDisposition={changeDisposition}
        onOpenDetails={openDetails}
        onLookupOwner={lookupOwnerForKnock}
        onConvert={startConvert}
        onMove={startMoveKnock}
        onDelete={removeKnock}
      />
      <DealSheet deal={sheetDeal} onClose={() => setSheetDeal(null)} onMove={startMoveDeal} />

      <TerritoryDialog
        points={pendingTerritory}
        defaultName={pendingTerritoryName}
        reps={data.reps}
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
        ownerLookupEnabled={data.ownerLookupEnabled}
        reps={data.reps}
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
