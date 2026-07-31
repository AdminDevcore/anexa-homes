"use client";

// Every query the Field Map needs, in one place. Moved out of
// canvassing-client.tsx unchanged apart from reading its inputs from
// FieldMapFilters instead of a dozen useState calls.
//
// The useMemo wrappers are load-bearing, not style: an unstable array identity
// re-renders every Leaflet marker on every render, which crashes Leaflet's
// popup/marker positioning. Do not "simplify" them away.
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CanvassingMeta, KnockDTO, TerritoryDTO, DealDTO } from "@/server/modules/canvassing/queries";
import type { Viewport, ZipFeature } from "../canvassing-map";
import type { StormSwathDTO } from "@/server/modules/storm/queries";
import type { StormWarning } from "@/components/portal/storm/storm-map";
import { statusesFor, type FieldMapFilters } from "@/lib/field-map-filters";
import { resolveRange } from "../canvassing-filters";

export const MIN_PIN_ZOOM = 16; // below this we show territory summaries, not individual pins
export const MIN_DEAL_ZOOM = 11; // deal/appointment pins load at neighborhood/city zoom
export const MIN_ZIP_ZOOM = 9;
export const MIN_HOUSE_ZOOM = 17;

export type FieldMapData = {
  meta: CanvassingMeta | undefined;
  canManage: boolean;
  ownerLookupEnabled: boolean;
  territories: TerritoryDTO[];
  reps: { id: string; name: string }[];
  knocks: KnockDTO[];
  deals: DealDTO[];
  zips: ZipFeature[];
  zipsTooBig: boolean;
  radarSwaths: StormSwathDTO[];
  stormWarnings: StormWarning[];
  knockScores: Record<string, number>;
  dealScores: Record<string, number>;
  statsByDisp: Record<string, number>;
  knockedCount: number;
  todayCount: number;
  houseCount: number;
  zoomOK: boolean;
  loading: boolean;
  loadingLabel: string;
  refresh: () => void;
};

export function useFieldMapData(filters: FieldMapFilters, viewport: Viewport | null): FieldMapData {
  const qc = useQueryClient();

  const { data: meta } = useQuery<CanvassingMeta>({
    queryKey: ["canvassing-meta"],
    queryFn: async () => {
      const res = await fetch("/api/canvassing/data");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 30000,
    // Don't refetch on window focus — it re-renders the markers and would tear
    // down an open sheet the moment the user clicks back into the map.
    refetchOnWindowFocus: false,
  });

  const canManage = meta?.me.canManageAll ?? false;
  const ownerLookupEnabled = meta?.ownerLookupEnabled ?? false;
  const territories = React.useMemo(() => meta?.territories ?? [], [meta]);
  const reps = React.useMemo(() => meta?.reps ?? [], [meta]);

  // Server-side status filter for the lazy knock query. Memoized so the derived
  // `knocks` array stays referentially stable across renders.
  const statusKey = statusesFor(filters).join(",");
  const statuses = React.useMemo(() => (statusKey ? statusKey.split(",") : []), [statusKey]);

  const repFilter = filters.repId;
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
  const persistedKnocks = React.useMemo(
    () => (zoomOK ? knockData?.knocks ?? [] : []),
    [zoomOK, knockData]
  );

  // Pipeline deals/appointments for the viewport. Company-wide (the map is the
  // shared geographic source of truth) and loaded at a wider zoom than knocks.
  const dealZoomOK = (viewport?.zoom ?? 0) >= MIN_DEAL_ZOOM;
  const { data: dealData } = useQuery<{ deals: DealDTO[] }>({
    queryKey: ["canvassing-deals", bKey, dealZoomOK],
    queryFn: async () => {
      if (!viewport || !dealZoomOK) return { deals: [] };
      const p = new URLSearchParams({
        minLat: String(viewport.minLat),
        minLng: String(viewport.minLng),
        maxLat: String(viewport.maxLat),
        maxLng: String(viewport.maxLng),
      });
      const res = await fetch(`/api/canvassing/deals?${p.toString()}`);
      if (!res.ok) return { deals: [] };
      return res.json();
    },
    enabled: !!viewport && dealZoomOK,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });
  const deals = React.useMemo(
    () => (dealZoomOK ? dealData?.deals ?? [] : []),
    [dealZoomOK, dealData]
  );

  // ZIP (ZCTA) boundary overlay — fetched on-demand for the viewport from Census.
  const showZips = filters.showZips;
  const zipsZoomOK = (viewport?.zoom ?? 0) >= MIN_ZIP_ZOOM;
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
  const zips = React.useMemo(
    () => (showZips && zipsZoomOK ? zipData?.zips ?? [] : []),
    [showZips, zipsZoomOK, zipData]
  );
  const zipsTooBig = !!(showZips && zipsZoomOK && zipData?.tooBig);

  // Storm overlay layers (region-wide; storm data is Dallas-bounded so one fetch).
  const { data: radarData } = useQuery<{ swaths: StormSwathDTO[] }>({
    queryKey: ["cv-storm-swaths"],
    queryFn: async () => {
      const r = await fetch("/api/storm/swaths");
      return r.ok ? r.json() : { swaths: [] };
    },
    enabled: filters.showRadar,
    staleTime: 5 * 60_000,
  });
  const radarSwaths = React.useMemo(
    () => (filters.showRadar ? radarData?.swaths ?? [] : []),
    [filters.showRadar, radarData]
  );

  const { data: stormWarnData } = useQuery<{ warnings: StormWarning[] }>({
    queryKey: ["cv-storm-warnings"],
    queryFn: async () => {
      const r = await fetch("/api/storm/warnings");
      return r.ok ? r.json() : { warnings: [] };
    },
    enabled: filters.showStormWarnings,
    staleTime: 5 * 60_000,
  });
  const stormWarnings = React.useMemo(
    () => (filters.showStormWarnings ? stormWarnData?.warnings ?? [] : []),
    [filters.showStormWarnings, stormWarnData]
  );

  const { data: scoreData } = useQuery<{ knock: Record<string, number>; lead: Record<string, number> }>({
    queryKey: ["cv-storm-scores"],
    queryFn: async () => {
      const r = await fetch("/api/storm/scores");
      return r.ok ? r.json() : { knock: {}, lead: {} };
    },
    enabled: filters.showHeat || filters.minScore > 0,
    staleTime: 5 * 60_000,
  });
  const knockScores = React.useMemo(() => scoreData?.knock ?? {}, [scoreData]);
  const dealScores = React.useMemo(() => scoreData?.lead ?? {}, [scoreData]);

  // Auto-load a dot on EVERY house in the current view (from OSM footprints), so
  // the rep never has to draw a zone first. These synthetic dots are not
  // persisted — tapping one creates the Knock on first action.
  // `?houses=off` disables auto-load (used by E2E to stay off the live OSM API).
  const housesDisabled = React.useMemo(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("houses") === "off",
    []
  );
  const houseZoomOK = !housesDisabled && (viewport?.zoom ?? 0) >= MIN_HOUSE_ZOOM;
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
            contactName: null,
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

  // Date-filtered counters/chips (active only when a range is picked).
  const dateRange = resolveRange(filters.datePreset, filters.dateFrom, filters.dateTo);
  const dateActive = filters.datePreset !== "all";
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
  const houseCount = dateActive && rangeStats ? rangeStats.houses : meta?.stats.houses ?? 0;

  const refresh = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["canvassing-meta"] });
    qc.invalidateQueries({ queryKey: ["canvassing-knocks"] });
    qc.invalidateQueries({ queryKey: ["canvassing-deals"] });
  }, [qc]);

  const loading = knocksLoading || housesLoading || zipsLoading;
  // Same string ladder as the old toolbar — e2e specs poll on /Loading (houses|pins)…/.
  const loadingLabel =
    zipsLoading && !knocksLoading && !housesLoading
      ? "Loading ZIP codes…"
      : housesLoading && !knocksLoading
        ? "Loading houses…"
        : "Loading pins…";

  return {
    meta,
    canManage,
    ownerLookupEnabled,
    territories,
    reps,
    knocks,
    deals,
    zips,
    zipsTooBig,
    radarSwaths,
    stormWarnings,
    knockScores,
    dealScores,
    statsByDisp,
    knockedCount,
    todayCount: meta?.stats.today ?? 0,
    houseCount,
    zoomOK,
    loading,
    loadingLabel,
    refresh,
  };
}
