/**
 * The Pipeline page's filter builder — Kanban and List both.
 *
 * A filter is a list of CONDITIONS that must all hold. Each names a field
 * ("Rep", "Deal value", one of the company's custom fields), an operator
 * ("is any of", "is between") and its values. Everything here is pure and runs
 * in the browser over deals the page already loaded, which is what lets the
 * column counts, the column $ totals and the "N of M deals" header follow the
 * filter.
 *
 * One shape travels everywhere: the URL carries the conditions, and a saved
 * view (`pipeline_filter_views.conditions`) stores them. So a view, a shared
 * link and Back from a deal all rebuild the same board, and every one of them
 * goes back through `sanitizeConditions` on the way in.
 */

/** The option meaning "the field is empty" — no rep, no outcome, no city. */
export const NONE = "__none__";

// ── Stage timer ─────────────────────────────────────────────────────────────

/** Where a deal stands against its stage's target days, as the card colours it. */
export type StageTimer = "overdue" | "due_soon" | "on_track";

export const STAGE_TIMER_LABEL: Record<StageTimer, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  on_track: "On track",
};

/**
 * The card's timer colour, as a value. A stage with no target has no timer, so
 * it is null — the card's amber "14d here" for an untargeted stage is a nudge,
 * not a deadline, and "Days in stage" is the field that reaches it.
 */
export function stageTimer(stageDays: number, targetDays: number): StageTimer | null {
  if (!(targetDays > 0)) return null;
  if (stageDays > targetDays) return "overdue";
  if (stageDays >= targetDays - 1) return "due_soon";
  return "on_track";
}

// ── Fields and operators ────────────────────────────────────────────────────

export type FieldKind = "multi" | "number" | "date" | "text" | "checkbox";

export const OPERATORS = {
  multi: [
    { op: "any_of", label: "is any of" },
    { op: "none_of", label: "is none of" },
    { op: "empty", label: "is empty" },
    { op: "not_empty", label: "is not empty" },
  ],
  number: [
    { op: "gt", label: "is greater than" },
    { op: "lt", label: "is less than" },
    { op: "between", label: "is between" },
    { op: "eq", label: "equals" },
    { op: "empty", label: "is empty" },
    { op: "not_empty", label: "is not empty" },
  ],
  date: [
    { op: "on", label: "is on" },
    { op: "before", label: "is before" },
    { op: "after", label: "is after" },
    { op: "between", label: "is between" },
    { op: "last_days", label: "is in the last" },
    { op: "next_days", label: "is in the next" },
    { op: "empty", label: "is empty" },
    { op: "not_empty", label: "is not empty" },
  ],
  text: [
    { op: "contains", label: "contains" },
    { op: "not_contains", label: "does not contain" },
    { op: "is", label: "is exactly" },
    { op: "empty", label: "is empty" },
    { op: "not_empty", label: "is not empty" },
  ],
  checkbox: [
    { op: "checked", label: "is checked" },
    { op: "unchecked", label: "is not checked" },
  ],
} as const;

export type Operator = (typeof OPERATORS)[FieldKind][number]["op"];
export type OperatorDef = { op: Operator; label: string };

export function operatorsFor(kind: FieldKind): readonly OperatorDef[] {
  return OPERATORS[kind];
}

const ALL_OPERATORS = new Set<string>(
  (Object.keys(OPERATORS) as FieldKind[]).flatMap((k) => operatorsFor(k).map((o) => o.op))
);

/** Operators that stand on their own — "is empty" needs nothing typed. */
export const VALUELESS = new Set<Operator>(["empty", "not_empty", "checked", "unchecked"]);

export type FieldGroup = "Deal" | "People" | "Dates" | "Location" | "Custom fields" | "Project fields";
export const FIELD_GROUPS: FieldGroup[] = ["Deal", "People", "Dates", "Location", "Custom fields", "Project fields"];

export type FilterOption = { value: string; label: string; count: number };

export type FilterField = {
  key: string;
  label: string;
  group: FieldGroup;
  kind: FieldKind;
  /** multi only: every choice in display order, with how many deals hold it. */
  options?: FilterOption[];
  /** number only. "money" is typed in whole units and compared against cents. */
  unit?: "money" | "days";
};

export type Condition = { id: string; field: string; op: Operator; values: string[] };
export type StoredCondition = { field: string; op: Operator; values: string[] };

// ── Deals ───────────────────────────────────────────────────────────────────

export type FactValue = string | number | null;

/**
 * What a deal carries to be filtered. `facts` is keyed by field key; money is
 * cents, dates are ISO timestamps or yyyy-mm-dd, everything else a string.
 */
export type FilterableDeal = {
  /** Lower-cased text the search box matches, address included. */
  searchText: string;
  phoneDigits: string;
  stageDays: number;
  facts: Record<string, FactValue>;
};

/**
 * Where the deal sits right now. Separate from the facts because on the board
 * it is the COLUMN the card is in — which a drag changes without a reload.
 */
export type DealPlacement = { stageId: string | null; targetDays: number };

/** Answered by the placement, not by a stored fact. */
export const STAGE_FIELD = "stage";
export const STAGE_TIMER_FIELD = "stage_timer";

export function customFieldKey(entity: "lead" | "project", key: string): string {
  return `cf.${entity}.${key}`;
}

function factOf(deal: FilterableDeal, at: DealPlacement, key: string): FactValue {
  if (key === STAGE_FIELD) return at.stageId;
  if (key === STAGE_TIMER_FIELD) return stageTimer(deal.stageDays, at.targetDays);
  return deal.facts[key] ?? null;
}

// ── Matching ────────────────────────────────────────────────────────────────

const isNum = (s: string | undefined) => s !== undefined && s.trim() !== "" && Number.isFinite(Number(s));
const isDay = (s: string | undefined) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");

/**
 * True once a condition says enough to filter by. A half-built row — a field
 * with no values picked yet — narrows nothing rather than emptying the board.
 */
export function isComplete(c: Condition, field: FilterField | undefined): boolean {
  if (!field) return false;
  if (!operatorsFor(field.kind).some((o) => o.op === c.op)) return false;
  const [a, b] = c.values;
  switch (c.op) {
    case "empty":
    case "not_empty":
    case "checked":
    case "unchecked":
      return true;
    case "any_of":
    case "none_of":
      return c.values.length > 0;
    case "between":
      return field.kind === "date" ? isDay(a) && isDay(b) : isNum(a) && isNum(b);
    case "last_days":
    case "next_days":
      return /^\d{1,4}$/.test(a ?? "");
    case "on":
    case "before":
    case "after":
      return isDay(a);
    case "gt":
    case "lt":
    case "eq":
      return isNum(a);
    case "contains":
    case "not_contains":
    case "is":
      return (a ?? "").trim() !== "";
  }
}

export function completeConditions(conditions: Condition[], fields: ReadonlyMap<string, FilterField>): Condition[] {
  return conditions.filter((c) => isComplete(c, fields.get(c.field)));
}

/** Local midnight of a yyyy-mm-dd, `plus` days on. */
function day(s: string, plus = 0): number {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d + plus).getTime();
}

function startOfDay(now: number, plus = 0): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + plus).getTime();
}

/**
 * A stored date as a moment. A bare yyyy-mm-dd (how a custom date field is
 * kept) is that day's LOCAL midnight — `Date.parse` would read it as UTC,
 * which is the previous evening in Texas.
 */
function moment(s: string): number | null {
  if (isDay(s)) return day(s);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

const TRUTHY = new Set(["true", "1", "yes", "on", "checked"]);

export function matchCondition(c: Condition, field: FilterField, fact: FactValue, now = Date.now()): boolean {
  const empty = fact === null || String(fact).trim() === "";
  const [a = "", b = ""] = c.values;
  const text = String(fact ?? "").toLowerCase();
  const needle = a.trim().toLowerCase();

  switch (c.op) {
    case "empty":
      return empty;
    case "not_empty":
      return !empty;
    case "any_of":
      return c.values.includes(empty ? NONE : String(fact));
    case "none_of":
      return !c.values.includes(empty ? NONE : String(fact));
    case "checked":
      return TRUTHY.has(text.trim());
    case "unchecked":
      return !TRUTHY.has(text.trim());
    case "contains":
      return text.includes(needle);
    case "not_contains":
      return !text.includes(needle);
    case "is":
      return text.trim() === needle;
  }

  if (empty) return false;

  if (field.kind === "number") {
    const n = typeof fact === "number" ? fact : Number(fact);
    if (!Number.isFinite(n)) return false;
    const scale = field.unit === "money" ? 100 : 1;
    const x = Number(a) * scale;
    const y = Number(b) * scale;
    switch (c.op) {
      case "gt":
        return n > x;
      case "lt":
        return n < x;
      case "eq":
        return n === x;
      case "between":
        return n >= Math.min(x, y) && n <= Math.max(x, y);
    }
    return false;
  }

  if (field.kind === "date") {
    const t = moment(String(fact));
    if (t === null) return false;
    switch (c.op) {
      case "on":
        return t >= day(a) && t < day(a, 1);
      case "before":
        return t < day(a);
      case "after":
        return t >= day(a, 1);
      case "between": {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        return t >= day(lo) && t < day(hi, 1);
      }
      // Whole days, today included, so "last 7 days" still holds this morning's.
      case "last_days":
        return t >= startOfDay(now, -Number(a)) && t < startOfDay(now, 1);
      case "next_days":
        return t >= startOfDay(now) && t < startOfDay(now, Number(a) + 1);
    }
  }
  return false;
}

function matchesSearch(deal: FilterableDeal, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle || deal.searchText.includes(needle)) return true;
  // "(361) 934" should find 3619343950: compare digits when the query is a phone.
  const digits = needle.replace(/\D/g, "");
  return digits.length >= 3 && /^[\d\s().+-]+$/.test(needle) && deal.phoneDigits.includes(digits);
}

export function matchesDeal(
  deal: FilterableDeal,
  at: DealPlacement,
  conditions: Condition[],
  fields: ReadonlyMap<string, FilterField>,
  q = "",
  now = Date.now()
): boolean {
  if (!matchesSearch(deal, q)) return false;
  for (const c of conditions) {
    const field = fields.get(c.field);
    if (!field || !isComplete(c, field)) continue;
    if (!matchCondition(c, field, factOf(deal, at, c.field), now)) return false;
  }
  return true;
}

// ── The field catalogue ─────────────────────────────────────────────────────

export const PRIORITY_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };
export const DEAL_TYPE_LABEL: Record<string, string> = { insurance: "Insurance", cash: "Cash" };

export type CatalogCustomField = {
  entity: "lead" | "project";
  key: string;
  label: string;
  type: string;
  options: string[];
};

export type FieldCatalogInput = {
  vertical: string;
  stages: { id: string; name: string }[];
  customFields: CatalogCustomField[];
  deals: (FilterableDeal & DealPlacement)[];
  /**
   * field key → stored value → what to show ("rep" → user id → name). For an
   * enum the map's key order is also the order its options are listed in.
   */
  labels: Partial<Record<string, Record<string, string>>>;
};

/**
 * Every field the builder offers for THIS pipeline. Option lists come from the
 * deals loaded here plus the configured choices (stages, a select field's
 * options), so nothing from the other vertical can appear and every configured
 * choice is reachable even before a deal uses it.
 */
export function buildFilterFields(input: FieldCatalogInput): FilterField[] {
  const { deals, vertical } = input;
  const labels: Partial<Record<string, Record<string, string>>> = {
    ...input.labels,
    [STAGE_FIELD]: Object.fromEntries(input.stages.map((s) => [s.id, s.name])),
    [STAGE_TIMER_FIELD]: STAGE_TIMER_LABEL,
  };
  const fields: FilterField[] = [];

  function multi(
    key: string,
    label: string,
    group: FieldGroup,
    opts: { order?: string[]; emptyLabel?: string; hideUnder?: number } = {}
  ) {
    const counts = new Map<string, number>();
    let empty = 0;
    for (const d of deals) {
      const v = factOf(d, d, key);
      if (v === null || String(v).trim() === "") empty += 1;
      else counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
    }
    // A field nobody on this pipeline uses (or where every deal agrees) has
    // nothing to narrow by — offering it would only pad the list.
    if (opts.hideUnder !== undefined && counts.size < opts.hideUnder) return;
    const names = labels[key] ?? {};
    const labelOf = (v: string) => names[v] ?? v;
    const order = [...new Set(opts.order ?? [])];
    const seen = [...counts.keys()].filter((v) => !order.includes(v)).sort((x, y) => labelOf(x).localeCompare(labelOf(y)));
    const options = [...order, ...seen].map((v) => ({ value: v, label: labelOf(v), count: counts.get(v) ?? 0 }));
    if (empty > 0) options.push({ value: NONE, label: opts.emptyLabel ?? "Not set", count: empty });
    fields.push({ key, label, group, kind: "multi", options });
  }
  const scalar = (key: string, label: string, group: FieldGroup, kind: FieldKind, unit?: FilterField["unit"]) =>
    fields.push(unit ? { key, label, group, kind, unit } : { key, label, group, kind });

  // Deal
  multi(STAGE_FIELD, "Stage", "Deal", { order: input.stages.map((s) => s.id), emptyLabel: "No stage" });
  multi(STAGE_TIMER_FIELD, "Stage timer", "Deal", { order: Object.keys(STAGE_TIMER_LABEL), emptyLabel: "Stage has no target" });
  scalar("value", "Deal value", "Deal", "number", "money");
  scalar("stage_days", "Days in stage", "Deal", "number", "days");
  scalar("age_days", "Days since appointment", "Deal", "number", "days");
  multi("source", "Lead source", "Deal", { emptyLabel: "No source" });
  multi("appt_status", "Appointment status", "Deal", {
    order: Object.keys(labels.appt_status ?? {}),
    emptyLabel: "No outcome yet",
  });
  multi("outcome", "Appointment outcome", "Deal", { emptyLabel: "No outcome" });
  multi("inspection", "Inspection outcome", "Deal", { emptyLabel: "No inspection outcome", hideUnder: 1 });
  multi("priority", "Priority", "Deal", { order: Object.keys(PRIORITY_LABEL) });
  if (vertical === "roofing") {
    multi("deal_type", "Deal type", "Deal", { order: Object.keys(DEAL_TYPE_LABEL) });
    multi("claim_status", "Claim status", "Deal", {
      order: Object.keys(labels.claim_status ?? {}),
      emptyLabel: "No claim status",
    });
  }
  if (vertical === "solar") {
    multi("blocked_by", "Waiting on", "Deal", { order: Object.keys(labels.blocked_by ?? {}), emptyLabel: "Nobody" });
  }
  multi("service_type", "Service type", "Deal", { hideUnder: 2 });

  // People
  multi("rep", "Rep", "People", { emptyLabel: "Unassigned" });
  multi("setter", "Setter", "People", { emptyLabel: "No setter" });

  // Dates
  scalar("appointment_at", "Appointment date", "Dates", "date");
  scalar("created_at", "Created date", "Dates", "date");

  // Location
  multi("city", "City", "Location", { emptyLabel: "No city" });
  multi("zip", "ZIP code", "Location", { emptyLabel: "No ZIP" });

  // The company's own fields, from Settings → Fields.
  for (const def of input.customFields) {
    const key = customFieldKey(def.entity, def.key);
    const group: FieldGroup = def.entity === "project" ? "Project fields" : "Custom fields";
    if (def.type === "select") multi(key, def.label, group, { order: def.options, emptyLabel: "Not set" });
    else if (def.type === "number") scalar(key, def.label, group, "number");
    else if (def.type === "date") scalar(key, def.label, group, "date");
    else if (def.type === "checkbox") scalar(key, def.label, group, "checkbox");
    else scalar(key, def.label, group, "text");
  }

  return fields;
}

// ── Describing a condition ──────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2026-09-01" → "Sep 1". Read from the digits, never through Date: the same
 * string is rendered on the server and in the browser, and a timezone between
 * them must not move the day.
 */
export function shortDate(s: string): string {
  if (!isDay(s)) return s;
  const [y, m, d] = s.split("-").map(Number);
  const label = `${MONTHS[m - 1]} ${d}`;
  return y === new Date().getFullYear() ? label : `${label}, ${y}`;
}

/** One line a chip can show: "Rep is any of Shayan Salman, Mia Lopez +1". */
export function describeCondition(c: Condition, field: FilterField, money: (cents: number) => string): string {
  const op = operatorsFor(field.kind).find((o) => o.op === c.op)?.label ?? c.op;
  const [a = "", b = ""] = c.values;
  const show = (v: string) =>
    field.kind === "date"
      ? shortDate(v)
      : field.kind === "number" && field.unit === "money"
        ? money(Math.round(Number(v) * 100))
        : v;

  switch (c.op) {
    case "empty":
    case "not_empty":
    case "checked":
    case "unchecked":
      return `${field.label} ${op}`;
    case "any_of":
    case "none_of": {
      const names = c.values.map((v) => field.options?.find((o) => o.value === v)?.label ?? v);
      const list = names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
      return `${field.label} ${op} ${list}`;
    }
    case "between":
      return `${field.label} ${op} ${show(a)} and ${show(b)}`;
    case "last_days":
    case "next_days":
      return `${field.label} ${op} ${a} ${a === "1" ? "day" : "days"}`;
    case "contains":
    case "not_contains":
    case "is":
      return `${field.label} ${op} “${a}”`;
    default:
      return `${field.label} ${op} ${show(a)}`;
  }
}

// ── Storage and the URL ─────────────────────────────────────────────────────

const MAX_CONDITIONS = 30;
const FIELD_KEY = /^[A-Za-z0-9_.:-]{1,120}$/;

/**
 * Conditions from anywhere untrusted — a URL, a saved view's JSON. Accepts
 * `[field, op, values]` tuples (the URL) and `{ field, op, values }` objects
 * (the database). Anything malformed is dropped rather than trusted, so a
 * hand-edited link can never produce a condition the builder cannot show.
 */
export function sanitizeConditions(raw: unknown): Condition[] {
  if (!Array.isArray(raw)) return [];
  const out: Condition[] = [];
  for (const item of raw.slice(0, MAX_CONDITIONS)) {
    let field: unknown;
    let op: unknown;
    let values: unknown;
    if (Array.isArray(item)) [field, op, values] = item;
    else if (item && typeof item === "object") ({ field, op, values } = item as Record<string, unknown>);
    if (typeof field !== "string" || !FIELD_KEY.test(field)) continue;
    if (typeof op !== "string" || !ALL_OPERATORS.has(op)) continue;
    const vals = Array.isArray(values)
      ? values
          .filter((v): v is string => typeof v === "string")
          .slice(0, 100)
          .map((v) => v.slice(0, 200))
      : [];
    out.push({ id: `c${out.length}`, field, op: op as Operator, values: vals });
  }
  return out;
}

export function toStoredConditions(conditions: Condition[]): StoredCondition[] {
  return conditions.map(({ field, op, values }) => ({ field, op, values }));
}

/** Same filter, ignoring the row ids the builder hands out. */
export function sameConditions(a: Condition[], b: Condition[]): boolean {
  return JSON.stringify(toStoredConditions(a)) === JSON.stringify(toStoredConditions(b));
}

export type FilterUrlState = { q: string; conditions: Condition[]; viewId: string | null };

type RawParams = Record<string, string | string[] | undefined>;

export function stateFromSearchParams(params: RawParams): FilterUrlState {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  let conditions: Condition[] = [];
  const f = one("f");
  if (f) {
    try {
      conditions = sanitizeConditions(JSON.parse(f));
    } catch {
      conditions = [];
    }
  }
  const view = one("view");
  return {
    q: one("q").slice(0, 200),
    conditions,
    viewId: /^[0-9a-f-]{36}$/i.test(view) ? view : null,
  };
}

/** The query string (no "?") for the given state; "" when nothing is set. */
export function stateToQuery(s: FilterUrlState): string {
  const sp = new URLSearchParams();
  if (s.q) sp.set("q", s.q);
  if (s.viewId) sp.set("view", s.viewId);
  if (s.conditions.length) sp.set("f", JSON.stringify(s.conditions.map((c) => [c.field, c.op, c.values])));
  return sp.toString();
}
