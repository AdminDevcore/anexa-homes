import { describe, it, expect } from "vitest";
import {
  DEFAULT_PIPELINE_FILTERS,
  NONE,
  activeFilterCount,
  buildFilterOptions,
  clearFilters,
  filtersFromSearchParams,
  filtersToQuery,
  isFiltering,
  matchesPipelineFilters,
  stageTimer,
  type FilterableDeal,
  type PipelineFilters,
} from "@/lib/pipeline-filters";

// Local-calendar timestamps, so the date-range tests hold in any runner timezone.
const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

const deal = (over: Partial<FilterableDeal> = {}): FilterableDeal => ({
  name: "Tessa Resendez",
  phone: "3619343950",
  city: "Victoria",
  addressText: "108 Oak Street Victoria TX 77901",
  rep: "Shayan Salman",
  repId: "rep-shayan",
  setter: null,
  setterId: null,
  source: "Door knock",
  sourceId: "src-door",
  appointmentOutcome: "Signed — proposal accepted",
  inspectionOutcome: null,
  value: 8_360_000, // $83,600
  stageDays: 7,
  appointmentAt: local(2026, 9, 10, 23, 30),
  createdAt: local(2026, 9, 1),
  ...over,
});
const at = { stageId: "stage-signed", targetDays: 3 };
const f = (over: Partial<PipelineFilters>): PipelineFilters => ({ ...DEFAULT_PIPELINE_FILTERS, ...over });
const hit = (over: Partial<PipelineFilters>, d = deal(), place = at) => matchesPipelineFilters(d, place, f(over));

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

describe("matchesPipelineFilters", () => {
  it("lets everything through with no filters", () => {
    expect(hit({})).toBe(true);
  });

  it("matches a rep by id, and Unassigned only when there is no rep", () => {
    expect(hit({ rep: "rep-shayan" })).toBe(true);
    expect(hit({ rep: "rep-mustafa" })).toBe(false);
    expect(hit({ rep: NONE })).toBe(false);
    expect(hit({ rep: NONE }, deal({ repId: null, rep: null }))).toBe(true);
  });

  it("filters stage by where the card sits, not where it was loaded", () => {
    expect(hit({ stage: "stage-signed" })).toBe(true);
    expect(hit({ stage: "stage-signed" }, deal(), { stageId: "stage-ntp", targetDays: 0 })).toBe(false);
  });

  it("matches city case-insensitively, and No city only when blank", () => {
    expect(hit({ city: "victoria " })).toBe(true);
    expect(hit({ city: "Plano" })).toBe(false);
    expect(hit({ city: NONE }, deal({ city: "  " }))).toBe(true);
  });

  it("takes any of the chosen stage timers, and none on an untargeted stage", () => {
    expect(hit({ timers: ["overdue"] })).toBe(true);
    expect(hit({ timers: ["on_track", "due_soon"] })).toBe(false);
    expect(hit({ timers: ["overdue"] }, deal(), { stageId: "s", targetDays: 0 })).toBe(false);
  });

  it("reads deal value in whole units against a deal carried in cents", () => {
    expect(hit({ valueMin: "80000" })).toBe(true);
    expect(hit({ valueMin: "90000" })).toBe(false);
    expect(hit({ valueMax: "83600" })).toBe(true);
    expect(hit({ valueMax: "83599" })).toBe(false);
  });

  it("treats days in stage as an inclusive range", () => {
    expect(hit({ daysMin: "7", daysMax: "7" })).toBe(true);
    expect(hit({ daysMin: "8" })).toBe(false);
  });

  it("includes the whole of the To day, in the local calendar", () => {
    expect(hit({ apptFrom: "2026-09-10", apptTo: "2026-09-10" })).toBe(true);
    expect(hit({ apptFrom: "2026-09-11" })).toBe(false);
    expect(hit({ apptTo: "2026-09-09" })).toBe(false);
  });

  it("drops a deal with no appointment once an appointment range is set", () => {
    expect(hit({ apptFrom: "2020-01-01" }, deal({ appointmentAt: null }))).toBe(false);
    expect(hit({ createdFrom: "2026-09-01", createdTo: "2026-09-01" })).toBe(true);
  });

  it("searches the address the card never shows, the rep, and a formatted phone", () => {
    expect(hit({ q: "108 oak" })).toBe(true);
    expect(hit({ q: "shayan" })).toBe(true);
    expect(hit({ q: "(361) 934" })).toBe(true);
    expect(hit({ q: "Nowhereville" })).toBe(false);
  });

  it("requires every filter at once", () => {
    expect(hit({ rep: "rep-shayan", timers: ["overdue"], valueMin: "50000" })).toBe(true);
    expect(hit({ rep: "rep-shayan", timers: ["overdue"], valueMin: "90000" })).toBe(false);
  });
});

describe("counting", () => {
  it("counts a range once and ignores the search box", () => {
    expect(activeFilterCount(f({ q: "tessa" }))).toBe(0);
    expect(activeFilterCount(f({ valueMin: "1", valueMax: "2", timers: ["overdue", "due_soon"], rep: NONE }))).toBe(3);
    expect(isFiltering(f({ q: "tessa" }))).toBe(true);
    expect(isFiltering(f({ q: "  " }))).toBe(false);
  });

  it("clearing keeps what is typed in search", () => {
    expect(clearFilters(f({ q: "oak", rep: "x", timers: ["overdue"] }))).toEqual(f({ q: "oak" }));
  });
});

describe("buildFilterOptions", () => {
  const deals = [
    deal(),
    deal({ repId: "rep-mustafa", rep: "Mustafa Joulani", city: "plano" }),
    deal({ repId: "rep-mustafa", rep: "Mustafa Joulani", city: "Plano" }),
    deal({ repId: null, rep: null, city: null }),
  ];
  const opts = buildFilterOptions(deals);

  it("counts deals per option, sorted by label, empty bucket last", () => {
    expect(opts.reps).toEqual([
      { value: "rep-mustafa", label: "Mustafa Joulani", count: 2 },
      { value: "rep-shayan", label: "Shayan Salman", count: 1 },
      { value: NONE, label: "Unassigned", count: 1 },
    ]);
  });

  it("folds city spellings together", () => {
    expect(opts.cities.map((o) => [o.label, o.count])).toEqual([
      ["plano", 2],
      ["Victoria", 1],
      ["No city", 1],
    ]);
  });

  it("leaves out an empty bucket nobody is in", () => {
    expect(opts.sources.some((o) => o.value === NONE)).toBe(false);
    expect(opts.setters).toEqual([{ value: NONE, label: "No setter", count: 4 }]);
  });
});

describe("URL round trip", () => {
  it("writes nothing when unfiltered", () => {
    expect(filtersToQuery(DEFAULT_PIPELINE_FILTERS)).toBe("");
  });

  it("reads back what it wrote", () => {
    const set = f({
      q: "oak st",
      rep: "rep-shayan",
      stage: "stage-signed",
      timers: ["overdue", "due_soon"],
      city: "Corpus Christi",
      valueMin: "25000",
      daysMax: "14",
      apptFrom: "2026-09-01",
      createdTo: "2026-09-13",
    });
    const params = Object.fromEntries(new URLSearchParams(filtersToQuery(set)).entries());
    expect(filtersFromSearchParams(params)).toEqual(set);
  });

  it("drops malformed values instead of trusting a hand-edited URL", () => {
    const read = filtersFromSearchParams({
      vmin: "abc",
      dmax: "-3",
      afrom: "yesterday",
      timer: "late,overdue,overdue",
      rep: ["rep-a", "rep-b"],
    });
    expect(read).toEqual(f({ timers: ["overdue"], rep: "rep-a" }));
  });
});
