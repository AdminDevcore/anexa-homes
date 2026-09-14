import { describe, it, expect } from "vitest";
import {
  NONE,
  buildFilterFields,
  completeConditions,
  customFieldKey,
  describeCondition,
  isComplete,
  matchCondition,
  matchesDeal,
  sameConditions,
  sanitizeConditions,
  stageTimer,
  stateFromSearchParams,
  stateToQuery,
  type Condition,
  type DealPlacement,
  type FactValue,
  type FieldKind,
  type FilterField,
  type FilterableDeal,
  type Operator,
} from "@/lib/pipeline-filters";

// Local-calendar moments, so every date test holds in any runner timezone.
const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();
const NOW = new Date(2026, 8, 13, 15, 0).getTime(); // Sun Sep 13 2026, 3pm local

const DAMAGE = customFieldKey("lead", "damage_type");
const ROOF_AGE = customFieldKey("lead", "roof_age");
const PERMIT = customFieldKey("project", "permit_pulled");
const NOTES = customFieldKey("lead", "notes");
const INSPECTED = customFieldKey("lead", "inspected_on");

type Deal = FilterableDeal & DealPlacement;
const deal = (facts: Record<string, FactValue> = {}, over: Partial<Deal> = {}): Deal => ({
  searchText: "tessa resendez 108 oak street victoria tx 77901 shayan salman",
  phoneDigits: "3619343950",
  stageDays: 7,
  stageId: "stage-signed",
  targetDays: 3,
  facts: {
    rep: "rep-shayan",
    value: 8_360_000, // $83,600
    stage_days: 7,
    appointment_at: local(2026, 9, 10, 23),
    created_at: local(2026, 9, 1),
    city: "victoria",
    [DAMAGE]: "Hail",
    [ROOF_AGE]: "12",
    [PERMIT]: "true",
    [NOTES]: "Steep pitch, two layers",
    [INSPECTED]: "2026-09-10",
    ...facts,
  },
  ...over,
});

const field = (key: string, kind: FieldKind, extra: Partial<FilterField> = {}): FilterField => ({
  key,
  label: key,
  group: "Deal",
  kind,
  ...extra,
});
const FIELDS = new Map<string, FilterField>(
  [
    field("rep", "multi"),
    field("city", "multi"),
    field("stage", "multi"),
    field("stage_timer", "multi"),
    field("value", "number", { unit: "money" }),
    field("stage_days", "number", { unit: "days" }),
    field("appointment_at", "date"),
    field("created_at", "date"),
    field(DAMAGE, "multi"),
    field(ROOF_AGE, "number"),
    field(PERMIT, "checkbox"),
    field(NOTES, "text"),
    field(INSPECTED, "date"),
  ].map((f) => [f.key, f])
);

let n = 0;
const cond = (fieldKey: string, op: Operator, ...values: string[]): Condition => ({ id: `t${n++}`, field: fieldKey, op, values });
const hit = (c: Condition, d = deal()) => matchesDeal(d, d, [c], FIELDS, "", NOW);

describe("stageTimer mirrors the card's colours", () => {
  it("has no timer when the stage has no target", () => {
    expect(stageTimer(40, 0)).toBeNull();
  });
  it("is overdue past the target, due soon in the last day, on track before", () => {
    expect(stageTimer(4, 3)).toBe("overdue");
    expect(stageTimer(3, 3)).toBe("due_soon");
    expect(stageTimer(2, 3)).toBe("due_soon");
    expect(stageTimer(1, 3)).toBe("on_track");
  });
});

describe("choice fields", () => {
  it("is any of / is none of, with the empty bucket as its own choice", () => {
    expect(hit(cond("rep", "any_of", "rep-mia", "rep-shayan"))).toBe(true);
    expect(hit(cond("rep", "none_of", "rep-shayan"))).toBe(false);
    expect(hit(cond("rep", "any_of", NONE))).toBe(false);
    expect(hit(cond("rep", "any_of", NONE), deal({ rep: null }))).toBe(true);
  });

  it("is empty / is not empty", () => {
    expect(hit(cond("rep", "empty"), deal({ rep: "" }))).toBe(true);
    expect(hit(cond("rep", "not_empty"))).toBe(true);
  });

  it("filters a select custom field by its stored option", () => {
    expect(hit(cond(DAMAGE, "any_of", "Wind", "Hail"))).toBe(true);
    expect(hit(cond(DAMAGE, "any_of", "Wind"))).toBe(false);
  });
});

describe("stage and stage timer come from where the card sits", () => {
  it("uses the column, not the stage the deal was loaded in", () => {
    const moved = { stageId: "stage-ntp", targetDays: 0 };
    expect(matchesDeal(deal(), moved, [cond("stage", "any_of", "stage-signed")], FIELDS, "", NOW)).toBe(false);
    expect(matchesDeal(deal(), moved, [cond("stage", "any_of", "stage-ntp")], FIELDS, "", NOW)).toBe(true);
  });

  it("has no timer on an untargeted stage, so only 'is empty' reaches it", () => {
    expect(hit(cond("stage_timer", "any_of", "overdue"))).toBe(true);
    const untargeted = deal({}, { targetDays: 0 });
    expect(hit(cond("stage_timer", "any_of", "overdue"), untargeted)).toBe(false);
    expect(hit(cond("stage_timer", "empty"), untargeted)).toBe(true);
  });
});

describe("number fields", () => {
  it("reads money in whole units against a deal carried in cents", () => {
    expect(hit(cond("value", "gt", "80000"))).toBe(true);
    expect(hit(cond("value", "gt", "83600"))).toBe(false);
    expect(hit(cond("value", "lt", "90000"))).toBe(true);
    expect(hit(cond("value", "eq", "83600"))).toBe(true);
  });

  it("is between inclusively, whichever end is typed first", () => {
    expect(hit(cond("stage_days", "between", "7", "10"))).toBe(true);
    expect(hit(cond("stage_days", "between", "10", "7"))).toBe(true);
    expect(hit(cond("stage_days", "between", "8", "10"))).toBe(false);
  });

  it("does not scale a plain number and never matches an empty one", () => {
    expect(hit(cond(ROOF_AGE, "gt", "10"))).toBe(true);
    expect(hit(cond(ROOF_AGE, "gt", "10"), deal({ [ROOF_AGE]: null }))).toBe(false);
  });
});

describe("date fields", () => {
  it("counts the whole local day for 'is on', late evening included", () => {
    expect(hit(cond("appointment_at", "on", "2026-09-10"))).toBe(true);
    expect(hit(cond("appointment_at", "on", "2026-09-11"))).toBe(false);
  });

  it("is before / after the day, exclusive of it", () => {
    expect(hit(cond("appointment_at", "before", "2026-09-11"))).toBe(true);
    expect(hit(cond("appointment_at", "before", "2026-09-10"))).toBe(false);
    expect(hit(cond("appointment_at", "after", "2026-09-09"))).toBe(true);
    expect(hit(cond("appointment_at", "after", "2026-09-10"))).toBe(false);
  });

  it("is between inclusive of both end days", () => {
    expect(hit(cond("appointment_at", "between", "2026-09-01", "2026-09-10"))).toBe(true);
    expect(hit(cond("appointment_at", "between", "2026-09-11", "2026-09-01"))).toBe(true);
  });

  it("measures last / next N days in whole days from today", () => {
    expect(hit(cond("created_at", "last_days", "14"))).toBe(true);
    expect(hit(cond("created_at", "last_days", "7"))).toBe(false);
    const soon = deal({ appointment_at: local(2026, 9, 20, 9) });
    expect(hit(cond("appointment_at", "next_days", "7"), soon)).toBe(true);
    expect(hit(cond("appointment_at", "next_days", "6"), soon)).toBe(false);
  });

  it("reads a custom yyyy-mm-dd as a local day, not UTC midnight", () => {
    expect(hit(cond(INSPECTED, "on", "2026-09-10"))).toBe(true);
    expect(hit(cond(INSPECTED, "on", "2026-09-09"))).toBe(false);
  });
});

describe("text and checkbox fields", () => {
  it("contains / does not contain / is exactly, ignoring case", () => {
    expect(hit(cond(NOTES, "contains", "STEEP"))).toBe(true);
    expect(hit(cond(NOTES, "not_contains", "steep"))).toBe(false);
    expect(hit(cond(NOTES, "not_contains", "steep"), deal({ [NOTES]: null }))).toBe(true);
    expect(hit(cond(NOTES, "is", " steep pitch, two layers "))).toBe(true);
  });

  it("is checked only for a stored truthy value", () => {
    expect(hit(cond(PERMIT, "checked"))).toBe(true);
    expect(hit(cond(PERMIT, "checked"), deal({ [PERMIT]: "" }))).toBe(false);
    expect(hit(cond(PERMIT, "unchecked"), deal({ [PERMIT]: null }))).toBe(true);
  });
});

describe("half-built conditions", () => {
  it("are not complete until they say enough", () => {
    expect(isComplete(cond("rep", "any_of"), FIELDS.get("rep"))).toBe(false);
    expect(isComplete(cond("value", "between", "5"), FIELDS.get("value"))).toBe(false);
    expect(isComplete(cond(NOTES, "contains", "  "), FIELDS.get(NOTES))).toBe(false);
    expect(isComplete(cond("value", "any_of", "5"), FIELDS.get("value"))).toBe(false); // wrong operator for the kind
    expect(isComplete(cond("rep", "empty"), FIELDS.get("rep"))).toBe(true);
  });

  it("narrow nothing, and neither does a field this pipeline doesn't have", () => {
    const d = deal();
    const conditions = [cond("rep", "any_of"), cond("cf.lead.gone", "any_of", "x"), cond("value", "gt", "1")];
    expect(matchesDeal(d, d, conditions, FIELDS, "", NOW)).toBe(true);
    expect(completeConditions(conditions, FIELDS)).toHaveLength(1);
  });

  it("requires every complete condition at once", () => {
    const d = deal();
    expect(matchesDeal(d, d, [cond("rep", "any_of", "rep-shayan"), cond("value", "gt", "50000")], FIELDS, "", NOW)).toBe(true);
    expect(matchesDeal(d, d, [cond("rep", "any_of", "rep-shayan"), cond("value", "gt", "90000")], FIELDS, "", NOW)).toBe(false);
  });
});

describe("search", () => {
  it("matches the address the card never shows, and a formatted phone", () => {
    const d = deal();
    expect(matchesDeal(d, d, [], FIELDS, "108 Oak", NOW)).toBe(true);
    expect(matchesDeal(d, d, [], FIELDS, "(361) 934", NOW)).toBe(true);
    expect(matchesDeal(d, d, [], FIELDS, "Nowhereville", NOW)).toBe(false);
  });
});

describe("buildFilterFields", () => {
  const deals: Deal[] = [
    deal({ rep: "rep-shayan", inspection: null, service_type: "solar" }),
    deal({ rep: "rep-mia", inspection: null, service_type: "solar" }, { stageId: "stage-new", targetDays: 2 }),
    deal({ rep: null, inspection: null, service_type: "solar" }, { stageId: "stage-new", targetDays: 2 }),
  ];
  const base = {
    stages: [
      { id: "stage-new", name: "New Appointment" },
      { id: "stage-signed", name: "Contract Signed" },
      { id: "stage-ntp", name: "NTP Submitted" },
    ],
    customFields: [
      { entity: "lead" as const, key: "damage_type", label: "Damage Type", type: "select", options: ["Hail", "Wind", "Other"] },
      { entity: "lead" as const, key: "roof_age", label: "Roof age", type: "number", options: [] },
      { entity: "project" as const, key: "permit_pulled", label: "Permit pulled", type: "checkbox", options: [] },
      { entity: "project" as const, key: "ahj", label: "AHJ", type: "text", options: [] },
    ],
    deals,
    labels: { rep: { "rep-shayan": "Shayan Salman", "rep-mia": "Mia Lopez" } },
  };
  const byKey = (fields: FilterField[]) => new Map(fields.map((f) => [f.key, f]));

  it("lists stages in pipeline order, zero-count stages kept", () => {
    const stage = byKey(buildFilterFields({ ...base, vertical: "solar" })).get("stage")!;
    expect(stage.options!.map((o) => [o.label, o.count])).toEqual([
      ["New Appointment", 2],
      ["Contract Signed", 1],
      ["NTP Submitted", 0],
    ]);
  });

  it("sorts people by name and puts the empty bucket last", () => {
    const rep = byKey(buildFilterFields({ ...base, vertical: "solar" })).get("rep")!;
    expect(rep.options).toEqual([
      { value: "rep-mia", label: "Mia Lopez", count: 1 },
      { value: "rep-shayan", label: "Shayan Salman", count: 1 },
      { value: NONE, label: "Unassigned", count: 1 },
    ]);
  });

  it("offers roofing's claim fields on roofing and solar's blocker on solar, never both", () => {
    const roofing = byKey(buildFilterFields({ ...base, vertical: "roofing" }));
    const solar = byKey(buildFilterFields({ ...base, vertical: "solar" }));
    expect(roofing.has("deal_type") && roofing.has("claim_status")).toBe(true);
    expect(roofing.has("blocked_by")).toBe(false);
    expect(solar.has("blocked_by")).toBe(true);
    expect(solar.has("claim_status") || solar.has("deal_type")).toBe(false);
  });

  it("hides a field with nothing to narrow by", () => {
    const fields = byKey(buildFilterFields({ ...base, vertical: "solar" }));
    expect(fields.has("inspection")).toBe(false); // nobody recorded one
    expect(fields.has("service_type")).toBe(false); // every deal agrees
  });

  it("turns each custom field into the right kind, project fields grouped apart", () => {
    const fields = byKey(buildFilterFields({ ...base, vertical: "solar" }));
    const damage = fields.get(DAMAGE)!;
    expect(damage.kind).toBe("multi");
    expect(damage.options!.map((o) => o.value)).toEqual(["Hail", "Wind", "Other"]);
    expect(fields.get(ROOF_AGE)!.kind).toBe("number");
    expect(fields.get(PERMIT)).toMatchObject({ kind: "checkbox", group: "Project fields" });
    expect(fields.get(customFieldKey("project", "ahj"))!.kind).toBe("text");
  });
});

describe("describeCondition", () => {
  const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US")}`;
  const rep = field("rep", "multi", {
    label: "Rep",
    options: [
      { value: "a", label: "Ann", count: 1 },
      { value: "b", label: "Bo", count: 1 },
      { value: "c", label: "Cy", count: 1 },
    ],
  });

  it("names the choices, collapsing past two", () => {
    expect(describeCondition(cond("rep", "any_of", "a", "b", "c"), rep, money)).toBe("Rep is any of Ann, Bo +1");
  });

  it("shows money, relative days and a bare operator the way a person reads them", () => {
    expect(describeCondition(cond("value", "gt", "50000"), field("value", "number", { label: "Deal value", unit: "money" }), money)).toBe(
      "Deal value is greater than $50,000"
    );
    expect(describeCondition(cond("created_at", "last_days", "7"), field("created_at", "date", { label: "Created date" }), money)).toBe(
      "Created date is in the last 7 days"
    );
    expect(describeCondition(cond(PERMIT, "checked"), field(PERMIT, "checkbox", { label: "Permit pulled" }), money)).toBe(
      "Permit pulled is checked"
    );
  });
});

describe("storage and the URL", () => {
  it("writes nothing when nothing is set", () => {
    expect(stateToQuery({ q: "", conditions: [], viewId: null })).toBe("");
  });

  it("reads back what it wrote", () => {
    const state = {
      q: "oak st",
      viewId: "0b7d6a3e-4f7e-4d0c-9d2f-3c5a1b2e9f10",
      conditions: [cond("rep", "any_of", "rep-a", NONE), cond("value", "between", "25000", "90000"), cond(PERMIT, "checked")],
    };
    const params = Object.fromEntries(new URLSearchParams(stateToQuery(state)).entries());
    const back = stateFromSearchParams(params);
    expect(back.q).toBe("oak st");
    expect(back.viewId).toBe(state.viewId);
    expect(sameConditions(back.conditions, state.conditions)).toBe(true);
  });

  it("drops malformed input instead of trusting a hand-edited link", () => {
    expect(stateFromSearchParams({ f: "{not json" }).conditions).toEqual([]);
    expect(stateFromSearchParams({ view: "1; drop table" }).viewId).toBeNull();
    const kept = sanitizeConditions([
      ["rep", "any_of", ["x", 7]],
      ["rep", "explode", ["x"]],
      ["bad key!", "any_of", ["x"]],
      "nonsense",
    ]);
    expect(kept).toEqual([{ id: "c0", field: "rep", op: "any_of", values: ["x"] }]);
  });

  it("reads the object shape a saved view stores", () => {
    expect(sanitizeConditions([{ field: "value", op: "gt", values: ["100"] }])).toEqual([
      { id: "c0", field: "value", op: "gt", values: ["100"] },
    ]);
  });

  it("compares filters without caring about row ids", () => {
    expect(sameConditions([{ ...cond("rep", "any_of", "a"), id: "x" }], [{ ...cond("rep", "any_of", "a"), id: "y" }])).toBe(true);
  });
});

describe("matchCondition on its own", () => {
  it("defaults 'now' to the real clock without throwing", () => {
    expect(matchCondition(cond("created_at", "last_days", "36500"), field("created_at", "date"), local(2026, 1, 1))).toBe(true);
  });
});
