/**
 * Filters for the Pipeline page — Kanban and List both.
 *
 * Everything here is pure and runs in the browser over deals the page already
 * loaded. Filtering the DATA rather than hiding DOM nodes is the point: the
 * column counts, the column $ totals and the "N of M deals" header all follow
 * the filter, where the old page-level ListFilter hid cards and left every
 * number above them counting the deals you could no longer see.
 *
 * The filters round-trip through the URL (see `filtersFromSearchParams`), so
 * opening a deal and pressing Back lands on the same narrowed board.
 */

/** The option meaning "the field is empty" — no rep, no outcome, no city. */
export const NONE = "__none__";

/** Where a deal stands against its stage's target days, as the card colours it. */
export type StageTimer = "overdue" | "due_soon" | "on_track";
export const STAGE_TIMERS: { key: StageTimer; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "due_soon", label: "Due soon" },
  { key: "on_track", label: "On track" },
];

export type PipelineFilters = {
  q: string;
  /** "" = any; NONE = unassigned; otherwise a user id. */
  rep: string;
  setter: string;
  /** "" = any; otherwise a stage id. */
  stage: string;
  /** Empty = any. Several = any of them. */
  timers: StageTimer[];
  /** "" = any; NONE = nothing recorded; otherwise the outcome's label. */
  outcome: string;
  inspection: string;
  /** "" = any; NONE = no source; otherwise a lead-source id. */
  source: string;
  /** "" = any; NONE = no city; otherwise a city, matched case-insensitively. */
  city: string;
  /** Whole currency units as typed ("25000"), not cents. */
  valueMin: string;
  valueMax: string;
  /** Days in the current stage, inclusive. */
  daysMin: string;
  daysMax: string;
  /** yyyy-mm-dd, inclusive, in the viewer's local calendar. */
  apptFrom: string;
  apptTo: string;
  createdFrom: string;
  createdTo: string;
};

export const DEFAULT_PIPELINE_FILTERS: PipelineFilters = {
  q: "",
  rep: "",
  setter: "",
  stage: "",
  timers: [],
  outcome: "",
  inspection: "",
  source: "",
  city: "",
  valueMin: "",
  valueMax: "",
  daysMin: "",
  daysMax: "",
  apptFrom: "",
  apptTo: "",
  createdFrom: "",
  createdTo: "",
};

/** What a deal must carry to be filtered. Both the card and the list row do. */
export type FilterableDeal = {
  name: string;
  phone: string | null;
  city: string | null;
  /** Full street/city/state/ZIP — searchable though only the city is shown. */
  addressText: string | null;
  rep: string | null;
  repId: string | null;
  setter: string | null;
  setterId: string | null;
  source: string | null;
  sourceId: string | null;
  appointmentOutcome: string | null;
  inspectionOutcome: string | null;
  /** Cents. */
  value: number;
  stageDays: number;
  /** ISO timestamps. */
  appointmentAt: string | null;
  createdAt: string;
};

/**
 * Where the deal sits right now. Passed separately because on the board it is
 * the COLUMN the card is in — which a drag changes without touching the deal.
 */
export type DealPlacement = { stageId: string | null; targetDays: number };

/**
 * The card's timer colour, as a value. A stage with no target has no timer, so
 * it is null — the card's amber "14d here" for an untargeted stage is a nudge,
 * not a deadline, and "Days in stage" is the filter that reaches it.
 */
export function stageTimer(stageDays: number, targetDays: number): StageTimer | null {
  if (!(targetDays > 0)) return null;
  if (stageDays > targetDays) return "overdue";
  if (stageDays >= targetDays - 1) return "due_soon";
  return "on_track";
}

/** How many filters are narrowing the view, not counting the search box. */
export function activeFilterCount(f: PipelineFilters): number {
  let n = 0;
  for (const k of ["rep", "setter", "stage", "outcome", "inspection", "source", "city"] as const) {
    if (f[k]) n += 1;
  }
  if (f.timers.length) n += 1;
  if (f.valueMin || f.valueMax) n += 1;
  if (f.daysMin || f.daysMax) n += 1;
  if (f.apptFrom || f.apptTo) n += 1;
  if (f.createdFrom || f.createdTo) n += 1;
  return n;
}

/** True when anything — search or filter — is narrowing the view. */
export function isFiltering(f: PipelineFilters): boolean {
  return f.q.trim() !== "" || activeFilterCount(f) > 0;
}

/** Every filter back to "any", keeping what is typed in the search box. */
export function clearFilters(f: PipelineFilters): PipelineFilters {
  return { ...DEFAULT_PIPELINE_FILTERS, q: f.q };
}

function num(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** yyyy-mm-dd → local midnight. `endOfDay` gives the NEXT midnight (exclusive). */
function localDay(s: string, endOfDay = false): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + (endOfDay ? 1 : 0)).getTime();
}

function inDateRange(iso: string | null, from: string, to: string): boolean {
  const lo = localDay(from);
  const hi = localDay(to, true);
  if (lo === null && hi === null) return true;
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return (lo === null || t >= lo) && (hi === null || t < hi);
}

function inRange(v: number, min: string, max: string): boolean {
  const lo = num(min);
  const hi = num(max);
  return (lo === null || v >= lo) && (hi === null || v <= hi);
}

/** "" = any, NONE = the field is empty, anything else = exact match. */
function pick(selected: string, actual: string | null): boolean {
  if (!selected) return true;
  if (selected === NONE) return !actual;
  return actual === selected;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

function matchesSearch(d: FilterableDeal, q: string): boolean {
  const needle = norm(q);
  if (!needle) return true;
  const hay = [
    d.name,
    d.phone,
    d.city,
    d.addressText,
    d.rep,
    d.setter,
    d.source,
    d.appointmentOutcome,
    d.inspectionOutcome,
  ]
    .map(norm)
    .join(" ");
  if (hay.includes(needle)) return true;
  // "(361) 934" should find 3619343950: compare digits when the query is a phone.
  const digits = needle.replace(/\D/g, "");
  return (
    digits.length >= 3 &&
    /^[\d\s().+-]+$/.test(needle) &&
    (d.phone ?? "").replace(/\D/g, "").includes(digits)
  );
}

export function matchesPipelineFilters(
  d: FilterableDeal,
  at: DealPlacement,
  f: PipelineFilters
): boolean {
  if (!matchesSearch(d, f.q)) return false;
  if (!pick(f.rep, d.repId)) return false;
  if (!pick(f.setter, d.setterId)) return false;
  if (!pick(f.source, d.sourceId)) return false;
  if (!pick(f.outcome, d.appointmentOutcome)) return false;
  if (!pick(f.inspection, d.inspectionOutcome)) return false;
  if (f.stage && at.stageId !== f.stage) return false;
  if (f.city) {
    if (f.city === NONE ? norm(d.city) !== "" : norm(d.city) !== norm(f.city)) return false;
  }
  if (f.timers.length) {
    const t = stageTimer(d.stageDays, at.targetDays);
    if (!t || !f.timers.includes(t)) return false;
  }
  // Typed in whole units; the deal carries cents.
  const lo = num(f.valueMin);
  const hi = num(f.valueMax);
  if ((lo !== null && d.value < lo * 100) || (hi !== null && d.value > hi * 100)) return false;
  if (!inRange(d.stageDays, f.daysMin, f.daysMax)) return false;
  if (!inDateRange(d.appointmentAt, f.apptFrom, f.apptTo)) return false;
  if (!inDateRange(d.createdAt, f.createdFrom, f.createdTo)) return false;
  return true;
}

// ── Options ─────────────────────────────────────────────────────────────────

export type FilterOption = { value: string; label: string; count: number };

export type PipelineFilterOptions = {
  reps: FilterOption[];
  setters: FilterOption[];
  sources: FilterOption[];
  outcomes: FilterOption[];
  inspections: FilterOption[];
  cities: FilterOption[];
};

/**
 * Options come from the deals on THIS pipeline, not from company config, so
 * every choice leads somewhere and nothing from the other vertical can appear.
 * Sorted by label; the "empty" bucket goes last.
 */
export function buildFilterOptions(deals: FilterableDeal[]): PipelineFilterOptions {
  function collect(
    key: (d: FilterableDeal) => string | null,
    label: (d: FilterableDeal) => string | null,
    noneLabel: string,
    fold: (s: string) => string = (s) => s
  ): FilterOption[] {
    const byKey = new Map<string, FilterOption>();
    let none = 0;
    for (const d of deals) {
      const raw = key(d);
      if (!raw || !raw.trim()) {
        none += 1;
        continue;
      }
      const k = fold(raw);
      const hit = byKey.get(k);
      if (hit) hit.count += 1;
      else byKey.set(k, { value: raw, label: label(d)?.trim() || raw, count: 1 });
    }
    const list = [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
    if (none > 0) list.push({ value: NONE, label: noneLabel, count: none });
    return list;
  }

  return {
    reps: collect((d) => d.repId, (d) => d.rep, "Unassigned"),
    setters: collect((d) => d.setterId, (d) => d.setter, "No setter"),
    sources: collect((d) => d.sourceId, (d) => d.source, "No source"),
    outcomes: collect((d) => d.appointmentOutcome, (d) => d.appointmentOutcome, "No outcome"),
    inspections: collect((d) => d.inspectionOutcome, (d) => d.inspectionOutcome, "No inspection outcome"),
    cities: collect(
      (d) => d.city?.trim() || null,
      (d) => d.city,
      "No city",
      (s) => s.trim().toLowerCase()
    ),
  };
}

// ── URL ─────────────────────────────────────────────────────────────────────

const PARAM: Record<Exclude<keyof PipelineFilters, "timers">, string> = {
  q: "q",
  rep: "rep",
  setter: "setter",
  stage: "stage",
  outcome: "outcome",
  inspection: "insp",
  source: "source",
  city: "city",
  valueMin: "vmin",
  valueMax: "vmax",
  daysMin: "dmin",
  daysMax: "dmax",
  apptFrom: "afrom",
  apptTo: "ato",
  createdFrom: "cfrom",
  createdTo: "cto",
};
const TIMER_PARAM = "timer";

const NUMERIC = new Set<keyof PipelineFilters>(["valueMin", "valueMax", "daysMin", "daysMax"]);
const DATE = new Set<keyof PipelineFilters>(["apptFrom", "apptTo", "createdFrom", "createdTo"]);

type RawParams = Record<string, string | string[] | undefined>;

/**
 * Read filters off the page's search params. Anything malformed is dropped
 * rather than trusted — a hand-edited URL must not produce a filter the panel
 * cannot display (and so cannot clear).
 */
export function filtersFromSearchParams(params: RawParams): PipelineFilters {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v)?.slice(0, 200) ?? "";
  };
  const f: PipelineFilters = { ...DEFAULT_PIPELINE_FILTERS, timers: [] };
  for (const [field, key] of Object.entries(PARAM) as [keyof typeof PARAM, string][]) {
    const v = one(key);
    if (NUMERIC.has(field) && !/^\d+(\.\d+)?$/.test(v)) continue;
    if (DATE.has(field) && !/^\d{4}-\d{2}-\d{2}$/.test(v)) continue;
    f[field] = v;
  }
  const valid = new Set<string>(STAGE_TIMERS.map((t) => t.key));
  f.timers = [...new Set(one(TIMER_PARAM).split(",").filter((t) => valid.has(t)))] as StageTimer[];
  return f;
}

/** The query string for the given filters (no leading "?"); "" when unfiltered. */
export function filtersToQuery(f: PipelineFilters): string {
  const sp = new URLSearchParams();
  for (const [field, key] of Object.entries(PARAM) as [keyof typeof PARAM, string][]) {
    if (f[field]) sp.set(key, f[field]);
  }
  if (f.timers.length) sp.set(TIMER_PARAM, f.timers.join(","));
  return sp.toString();
}
