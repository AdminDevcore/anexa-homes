import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SCOPED_MODELS, classify } from "@/server/vertical/models";
import { CALENDAR_EVENT_TYPES, calendarShows } from "@/server/modules/calendar/queries";

/**
 * Isolation rules that are DECLARED rather than enforced by the Prisma
 * extension. Each one closed a specific gap found by auditing the shipped code,
 * so each test names the leak it prevents rather than restating the code.
 */

describe("calendar event types are per vertical", () => {
  it("solar is exactly Appointment / Installation / Inspection", () => {
    expect([...CALENDAR_EVENT_TYPES.solar].sort()).toEqual(
      ["appointment", "inspection", "install"].sort()
    );
  });

  // The point of the change: Adjuster Meeting is an insurance concept. It was
  // already absent from solar, but only because solar deals happen to have no
  // claims — data, not a rule. A solar claim tomorrow must not change this.
  it("solar can never show an adjuster meeting", () => {
    expect(calendarShows("solar", "adjuster")).toBe(false);
    expect(CALENDAR_EVENT_TYPES.solar).not.toContain("adjuster");
  });

  it("roofing keeps its existing set, unchanged", () => {
    expect([...CALENDAR_EVENT_TYPES.roofing]).toEqual(["appointment", "adjuster", "install"]);
    expect(calendarShows("roofing", "adjuster")).toBe(true);
  });

  // Inspection is solar-only: adding it to roofing would put a new event type on
  // a live calendar, which is exactly the roofing change the brief forbids.
  it("roofing does NOT gain the new inspection type", () => {
    expect(calendarShows("roofing", "inspection")).toBe(false);
  });

  it("the retired `others` vertical shows nothing rather than throwing", () => {
    expect(calendarShows("others", "appointment")).toBe(false);
  });
});

describe("solar milestones are inside the isolation boundary", () => {
  // SolarMilestone carried a `vertical` column but was missing from the
  // registry, so it was the one solar model a roofing session could still read.
  it("SolarMilestone is scoped like every other solar model", () => {
    expect(SCOPED_MODELS).toContain("SolarMilestone");
    expect(classify("SolarMilestone")).toBe("scoped");
  });

  it("every Solar* model is scoped, so none is forgotten again", () => {
    const solarModels = SCOPED_MODELS.filter((m) => m.startsWith("Solar"));
    expect(solarModels.length).toBeGreaterThanOrEqual(4);
    for (const m of solarModels) expect(classify(m)).toBe("scoped");
  });
});

describe("shared modules stay shared", () => {
  // The spec is explicit that this is NOT isolated. A future edit that scoped
  // it would split the employee roster in two.
  it("Team is not scoped", () => {
    expect(classify("User")).toBe("shared");
  });

  it("chat is not scoped, so it stays cross-vertical", () => {
    expect(classify("Message")).toBe("shared");
  });

  it("the ledger stays TAGGED, not scoped — consolidated books", () => {
    expect(classify("Transaction")).toBe("tagged");
    expect(classify("Commission")).toBe("tagged");
    expect(classify("Invoice")).toBe("tagged");
  });
});

describe("report ledger filter", () => {
  const load = async () => await import("@/server/modules/reports/vertical-filter");

  beforeEach(() => vi.resetModules());
  afterEach(() => {
    delete process.env.SOLAR_VERTICAL_ENABLED;
    vi.resetModules();
  });

  // Flag off must add NO clause at all — not "a clause that happens to match".
  // This is what makes the change byte-for-byte invisible to roofing today.
  it("adds nothing when the flag is off", async () => {
    delete process.env.SOLAR_VERTICAL_ENABLED;
    const { ledgerVerticalFilter } = await load();
    expect(await ledgerVerticalFilter()).toEqual({});
  });

  it("includes NULL-vertical rows so company overhead is not dropped", async () => {
    process.env.SOLAR_VERTICAL_ENABLED = "1";
    vi.doMock("@/server/vertical/context", () => ({
      resolveVertical: async () => ({ mode: "vertical", vertical: "roofing" }),
    }));
    const { ledgerVerticalFilter } = await load();
    const f = await ledgerVerticalFilter();
    expect(f).toEqual({ OR: [{ vertical: "roofing" }, { vertical: null }] });
  });

  it("filters to the active vertical, so an admin's report stops summing both", async () => {
    process.env.SOLAR_VERTICAL_ENABLED = "1";
    vi.doMock("@/server/vertical/context", () => ({
      resolveVertical: async () => ({ mode: "vertical", vertical: "solar" }),
    }));
    const { ledgerVerticalFilter } = await load();
    const f = await ledgerVerticalFilter();
    expect(f).toEqual({ OR: [{ vertical: "solar" }, { vertical: null }] });
  });

  // A background job (payroll cron) has no workspace. It must fall back to the
  // consolidated ledger rather than silently reporting one vertical's numbers.
  it("adds nothing when there is no active vertical", async () => {
    process.env.SOLAR_VERTICAL_ENABLED = "1";
    vi.doMock("@/server/vertical/context", () => ({
      resolveVertical: async () => ({ mode: "none" }),
    }));
    const { ledgerVerticalFilter } = await load();
    expect(await ledgerVerticalFilter()).toEqual({});
  });
});
