// Pure filter state for the Field Map. No React, no DOM — so it unit-tests under
// vitest's node environment and stays the single definition of "what is filtered".
import { DISPOSITIONS } from "@/lib/canvassing";

export type DatePreset = "today" | "yesterday" | "week" | "month" | "all" | "custom";

const DATE_PRESETS: DatePreset[] = ["today", "yesterday", "week", "month", "all", "custom"];

// DISPOSITIONS, not KNOCKED_DISPOSITIONS: "not_knocked" is filterable (it's the
// "Remaining" chip) even though a rep can never set it on a house.
const FILTERABLE = DISPOSITIONS.map((d) => d.value);

export const MAX_SCORE = 150;

/**
 * Basemaps, in the order the Layers panel offers them.
 *
 * The two `google*` entries are billed per tile (Map Tiles API), so they are
 * opt-in rather than the default, and they are only offered when the key is
 * configured. `googleHybrid` is the one reps ask for: Google's imagery WITH the
 * roadmap layer over it, which is what labels house numbers on the rooftops.
 */
export const BASEMAPS = ["satellite", "street", "google", "googleHybrid"] as const;

export type Basemap = (typeof BASEMAPS)[number];

export const BASEMAP_LABEL: Record<Basemap, string> = {
  satellite: "Satellite",
  street: "Street",
  google: "Google",
  googleHybrid: "Google Sat",
};

/** The Google Map Tiles map type behind a basemap, or null for the free ones. */
export function googleMapType(b: Basemap): "roadmap" | "hybrid" | null {
  if (b === "google") return "roadmap";
  if (b === "googleHybrid") return "hybrid";
  return null;
}

export type FieldMapFilters = {
  dispositions: Set<string>;
  remainingOnly: boolean;
  showDeals: boolean;
  repId: string; // "all" | rep id
  datePreset: DatePreset;
  dateFrom: string;
  dateTo: string;
  // Layer toggles ride along in the URL so a shared link restores the whole view,
  // but they are deliberately excluded from activeFilterCount.
  basemap: Basemap;
  showZips: boolean;
  showRadar: boolean;
  showStormReports: boolean;
  showStormWarnings: boolean;
  showHeat: boolean;
  minScore: number;
};

export const DEFAULT_FILTERS: FieldMapFilters = {
  dispositions: new Set(),
  remainingOnly: false,
  showDeals: true,
  repId: "all",
  datePreset: "all",
  dateFrom: "",
  dateTo: "",
  basemap: "satellite",
  showZips: true,
  showRadar: true,
  showStormReports: false,
  showStormWarnings: false,
  showHeat: true,
  minScore: 0,
};

const bool = (v: string | null, fallback: boolean) => (v === null ? fallback : v === "1");

/** The query params that carry storm layer state. */
export const STORM_PARAMS = ["hail", "reports", "warnings", "heat", "score"] as const;

/**
 * Force every storm layer off. Applied wherever the active workspace has no
 * storm concept (see lib/vertical-features), and applied at *parse* time rather
 * than at render time on purpose: a link like `?hail=1&heat=1&score=50` — a
 * shared view from the roofing workspace, or a stale bookmark — must not be able
 * to switch a hail overlay back on in solar, or fire `/api/storm/*` for it.
 */
export function withoutStormLayers(f: FieldMapFilters): FieldMapFilters {
  return {
    ...f,
    showRadar: false,
    showStormReports: false,
    showStormWarnings: false,
    showHeat: false,
    minScore: 0,
  };
}

export function parseFilters(sp: URLSearchParams): FieldMapFilters {
  const disp = (sp.get("disp") ?? "").split(",").filter((d) => FILTERABLE.includes(d));

  const rawPreset = sp.get("date");
  const datePreset = DATE_PRESETS.includes(rawPreset as DatePreset)
    ? (rawPreset as DatePreset)
    : DEFAULT_FILTERS.datePreset;

  const rawScore = sp.get("score");
  const parsedScore = rawScore === null ? NaN : Number(rawScore);
  const minScore = Number.isFinite(parsedScore)
    ? Math.min(MAX_SCORE, Math.max(0, parsedScore))
    : DEFAULT_FILTERS.minScore;

  const rawBasemap = sp.get("base");

  return {
    dispositions: new Set(disp),
    remainingOnly: bool(sp.get("remaining"), DEFAULT_FILTERS.remainingOnly),
    showDeals: bool(sp.get("deals"), DEFAULT_FILTERS.showDeals),
    repId: sp.get("rep") ?? DEFAULT_FILTERS.repId,
    datePreset,
    dateFrom: sp.get("from") ?? DEFAULT_FILTERS.dateFrom,
    dateTo: sp.get("to") ?? DEFAULT_FILTERS.dateTo,
    basemap: BASEMAPS.includes(rawBasemap as Basemap) ? (rawBasemap as Basemap) : DEFAULT_FILTERS.basemap,
    showZips: bool(sp.get("zips"), DEFAULT_FILTERS.showZips),
    showRadar: bool(sp.get("hail"), DEFAULT_FILTERS.showRadar),
    showStormReports: bool(sp.get("reports"), DEFAULT_FILTERS.showStormReports),
    showStormWarnings: bool(sp.get("warnings"), DEFAULT_FILTERS.showStormWarnings),
    showHeat: bool(sp.get("heat"), DEFAULT_FILTERS.showHeat),
    minScore,
  };
}

/** Only non-default values are emitted, so an untouched map keeps a clean URL. */
export function serializeFilters(f: FieldMapFilters): string {
  const sp = new URLSearchParams();
  if (f.dispositions.size) sp.set("disp", [...f.dispositions].sort().join(","));
  if (f.remainingOnly !== DEFAULT_FILTERS.remainingOnly) sp.set("remaining", f.remainingOnly ? "1" : "0");
  if (f.showDeals !== DEFAULT_FILTERS.showDeals) sp.set("deals", f.showDeals ? "1" : "0");
  if (f.repId !== DEFAULT_FILTERS.repId) sp.set("rep", f.repId);
  if (f.datePreset !== DEFAULT_FILTERS.datePreset) sp.set("date", f.datePreset);
  if (f.dateFrom) sp.set("from", f.dateFrom);
  if (f.dateTo) sp.set("to", f.dateTo);
  if (f.basemap !== DEFAULT_FILTERS.basemap) sp.set("base", f.basemap);
  if (f.showZips !== DEFAULT_FILTERS.showZips) sp.set("zips", f.showZips ? "1" : "0");
  if (f.showRadar !== DEFAULT_FILTERS.showRadar) sp.set("hail", f.showRadar ? "1" : "0");
  if (f.showStormReports !== DEFAULT_FILTERS.showStormReports) sp.set("reports", f.showStormReports ? "1" : "0");
  if (f.showStormWarnings !== DEFAULT_FILTERS.showStormWarnings) sp.set("warnings", f.showStormWarnings ? "1" : "0");
  if (f.showHeat !== DEFAULT_FILTERS.showHeat) sp.set("heat", f.showHeat ? "1" : "0");
  if (f.minScore !== DEFAULT_FILTERS.minScore) sp.set("score", String(f.minScore));
  return sp.toString();
}

/** Badge count on the Filters button. Layer toggles are not filters. */
export function activeFilterCount(f: FieldMapFilters): number {
  let n = 0;
  if (f.dispositions.size) n++;
  if (f.remainingOnly) n++;
  if (!f.showDeals) n++;
  if (f.repId !== "all") n++;
  if (f.datePreset !== "all") n++;
  return n;
}

/** Server-side status filter for the knock query — matches today's behaviour. */
export function statusesFor(f: FieldMapFilters): string[] {
  return (f.remainingOnly ? ["not_knocked"] : [...f.dispositions]).slice().sort();
}
