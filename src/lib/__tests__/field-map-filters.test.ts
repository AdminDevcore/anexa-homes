import { describe, it, expect } from "vitest";
import {
  DEFAULT_FILTERS,
  parseFilters,
  serializeFilters,
  activeFilterCount,
  googleMapType,
  BASEMAPS,
  type FieldMapFilters,
} from "@/lib/field-map-filters";

describe("parseFilters", () => {
  it("returns defaults for an empty query string", () => {
    expect(parseFilters(new URLSearchParams(""))).toEqual(DEFAULT_FILTERS);
  });

  it("reads dispositions from a comma list", () => {
    const f = parseFilters(new URLSearchParams("disp=sold,callback"));
    expect([...f.dispositions].sort()).toEqual(["callback", "sold"]);
  });

  it("ignores disposition values that are not real dispositions", () => {
    const f = parseFilters(new URLSearchParams("disp=sold,bogus"));
    expect([...f.dispositions]).toEqual(["sold"]);
  });

  // The "Not Knocked" chip is a filterable disposition even though a rep can't
  // *set* it. Validating against KNOCKED_DISPOSITIONS would silently drop it.
  it("keeps not_knocked, which is filterable but not settable", () => {
    const f = parseFilters(new URLSearchParams("disp=not_knocked"));
    expect([...f.dispositions]).toEqual(["not_knocked"]);
  });

  it("reads booleans, rep, date preset and custom range", () => {
    const f = parseFilters(
      new URLSearchParams("remaining=1&deals=0&rep=rep_1&date=custom&from=2026-01-01&to=2026-01-31")
    );
    expect(f.remainingOnly).toBe(true);
    expect(f.showDeals).toBe(false);
    expect(f.repId).toBe("rep_1");
    expect(f.datePreset).toBe("custom");
    expect(f.dateFrom).toBe("2026-01-01");
    expect(f.dateTo).toBe("2026-01-31");
  });

  it("falls back to the default preset when date is unrecognised", () => {
    expect(parseFilters(new URLSearchParams("date=lastCentury")).datePreset).toBe("all");
  });

  it("clamps minScore into 0-150 and defaults non-numeric input", () => {
    expect(parseFilters(new URLSearchParams("score=200")).minScore).toBe(150);
    expect(parseFilters(new URLSearchParams("score=-5")).minScore).toBe(0);
    expect(parseFilters(new URLSearchParams("score=abc")).minScore).toBe(0);
  });
});

describe("serializeFilters", () => {
  it("emits nothing for defaults so a clean URL stays clean", () => {
    expect(serializeFilters(DEFAULT_FILTERS)).toBe("");
  });

  it("round-trips through parseFilters", () => {
    const f: FieldMapFilters = {
      ...DEFAULT_FILTERS,
      dispositions: new Set(["sold", "not_home"]),
      remainingOnly: true,
      showDeals: false,
      repId: "rep_9",
      datePreset: "week",
      minScore: 40,
      showZips: false,
      showHeat: false,
    };
    expect(parseFilters(new URLSearchParams(serializeFilters(f)))).toEqual(f);
  });

  it("sorts dispositions so the URL is stable across renders", () => {
    const a = serializeFilters({ ...DEFAULT_FILTERS, dispositions: new Set(["sold", "callback"]) });
    const b = serializeFilters({ ...DEFAULT_FILTERS, dispositions: new Set(["callback", "sold"]) });
    expect(a).toBe(b);
  });
});

describe("activeFilterCount", () => {
  it("is zero for defaults", () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
  });

  it("counts each engaged filter once", () => {
    const f: FieldMapFilters = {
      ...DEFAULT_FILTERS,
      dispositions: new Set(["sold", "callback"]),
      remainingOnly: true,
      repId: "rep_1",
      datePreset: "today",
    };
    // dispositions (1) + remainingOnly (1) + rep (1) + date (1)
    expect(activeFilterCount(f)).toBe(4);
  });

  it("does not count layer toggles — they are not filters", () => {
    expect(activeFilterCount({ ...DEFAULT_FILTERS, showZips: false, showHeat: false })).toBe(0);
  });
});

describe("basemaps", () => {
  it("round-trips every basemap through the URL", () => {
    for (const b of BASEMAPS) {
      const qs = serializeFilters({ ...DEFAULT_FILTERS, basemap: b });
      expect(parseFilters(new URLSearchParams(qs)).basemap).toBe(b);
    }
  });

  it("falls back to the default for an unknown ?base", () => {
    expect(parseFilters(new URLSearchParams("base=bing")).basemap).toBe(DEFAULT_FILTERS.basemap);
  });

  it("maps only the Google basemaps to a billed tile type", () => {
    // googleMapType is what gates the paid tiles, both in the Layers panel and
    // in the tile stack — a wrong answer here either hides the feature or bills
    // for a basemap the user did not pick.
    expect(googleMapType("google")).toBe("roadmap");
    expect(googleMapType("googleHybrid")).toBe("hybrid");
    expect(googleMapType("satellite")).toBeNull();
    expect(googleMapType("street")).toBeNull();
  });
});
