import { describe, it, expect } from "vitest";
import {
  SOLAR_STAGES,
  SOLAR_SALES_STAGES,
  SOLAR_OPS_STAGES,
  STAGE_OWNERS,
  stageOwnerLabel,
  stageOwnerRbacRole,
  BLOCKER_LABEL,
} from "@/lib/solar-pipeline";
import { chaseTiming, chaseStatusLabel, stageTiming } from "@/lib/stage-status";

const DAY = 86_400_000;
const NOW = Date.parse("2026-07-30T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

describe("the canonical solar pipeline", () => {
  it("covers sales through PTO in order", () => {
    expect(SOLAR_STAGES).toHaveLength(SOLAR_SALES_STAGES.length + SOLAR_OPS_STAGES.length);
    const keys = SOLAR_STAGES.map((s) => s.key);
    expect(keys[0]).toBe("new_lead");
    expect(keys.at(-1)).toBe("system_activated");
    // The stages a solar deal actually dies in must all be present.
    for (const k of [
      "ntp_submitted", "site_survey_complete", "engineering_design", "permit_submitted",
      "interconnection_submitted", "install_scheduled", "mpu_derate", "installed",
      "inspection", "utility_pto",
    ]) {
      expect(keys, `missing stage ${k}`).toContain(k);
    }
  });

  it("has unique keys and exactly one won stage", () => {
    expect(new Set(SOLAR_STAGES.map((s) => s.key)).size).toBe(SOLAR_STAGES.length);
    expect(SOLAR_STAGES.filter((s) => s.isWon)).toHaveLength(1);
  });

  it("gives every stage an owning department role that exists", () => {
    for (const s of SOLAR_STAGES) {
      expect(STAGE_OWNERS, `${s.key} has no owner`).toHaveProperty(s.ownerRole);
      expect(stageOwnerLabel(s.ownerRole)).toBeTruthy();
      // Every department role must resolve to a real RBAC role, or escalations
      // would silently reach nobody.
      expect(stageOwnerRbacRole(s.ownerRole), `${s.ownerRole} routes nowhere`).toBeTruthy();
    }
  });
});

/**
 * The central rule of the whole design: we only put a deadline on work we
 * control. If these invert, the team gets flagged for a utility's queue and the
 * aging report becomes noise everyone ignores.
 */
describe("owned vs blocked stages never mix their timing model", () => {
  it("internally-owned stages have an SLA and NO chase cadence", () => {
    for (const s of SOLAR_STAGES.filter((x) => x.stageType === "internally_owned")) {
      expect(s.targetDays, `${s.key} needs a target`).toBeGreaterThan(0);
      expect(s.followUpDays ?? 0, `${s.key} must not have a chase cadence`).toBe(0);
    }
  });

  it("externally-blocked stages have a cadence and NO deadline", () => {
    const blocked = SOLAR_STAGES.filter((x) => x.stageType === "externally_blocked");
    expect(blocked.length).toBeGreaterThan(0);
    for (const s of blocked) {
      expect(s.followUpDays, `${s.key} needs a cadence`).toBeGreaterThan(0);
      expect(s.targetDays ?? 0, `${s.key} must not carry a deadline`).toBe(0);
      // …and must name who we are waiting on, or the backlog isn't actionable.
      expect(s.defaultBlocker, `${s.key} needs a default blocker`).toBeTruthy();
      expect(s.defaultBlocker).not.toBe("us"); // if it were us, we'd control it
    }
  });

  it("every action-required sub-state names a blocker and is ours to clear", () => {
    const action = SOLAR_STAGES.filter((s) => s.isActionRequired);
    expect(action.map((s) => s.key)).toEqual([
      "design_redline",
      "permit_redline",
      "inspection_corrections",
    ]);
    for (const s of action) {
      expect(s.defaultBlocker).toBe("us");
      expect(s.stageType).toBe("internally_owned");
      expect(s.targetDays).toBeGreaterThan(0);
    }
  });

  it("the permit and utility waits are blocked, not owned", () => {
    const byKey = Object.fromEntries(SOLAR_STAGES.map((s) => [s.key, s]));
    expect(byKey.permit_submitted.stageType).toBe("externally_blocked");
    expect(byKey.permit_submitted.defaultBlocker).toBe("ahj");
    expect(byKey.utility_pto.stageType).toBe("externally_blocked");
    expect(byKey.utility_pto.defaultBlocker).toBe("utility");
    expect(byKey.interconnection_submitted.defaultBlocker).toBe("utility");
    // …while the work we actually do is owned.
    expect(byKey.engineering_design.stageType).toBe("internally_owned");
    expect(byKey.installed.stageType).toBe("internally_owned");
  });
});

describe("chase timing measures our last touch, not time in stage", () => {
  it("a long wait we chased yesterday is fine", () => {
    // 45 days in permit review, chased 1 day ago.
    const t = chaseTiming(daysAgo(1), daysAgo(45), daysAgo(60), 7, NOW);
    expect(t.status).toBe("recently_touched");
    expect(t.daysSinceTouch).toBe(1);
    // Crucially: the label never claims the deal is overdue.
    expect(chaseStatusLabel(t)).not.toMatch(/overdue/i);
  });

  it("a short wait we have ignored needs a chase", () => {
    const t = chaseTiming(daysAgo(8), daysAgo(10), daysAgo(10), 7, NOW);
    expect(t.status).toBe("chase_due");
  });

  it("two missed cadences escalates the chase itself", () => {
    const t = chaseTiming(daysAgo(15), daysAgo(20), daysAgo(20), 7, NOW);
    expect(t.status).toBe("chase_overdue");
    expect(t.chaseOverdueBy).toBe(8);
  });

  it("falls back to stage entry when nobody has ever chased", () => {
    const t = chaseTiming(null, daysAgo(9), daysAgo(30), 7, NOW);
    expect(t.neverTouched).toBe(true);
    expect(t.daysSinceTouch).toBe(9);
    expect(t.status).toBe("chase_due");
    expect(chaseStatusLabel(t)).toMatch(/never chased/);
  });

  it("no cadence configured = no nagging", () => {
    const t = chaseTiming(null, daysAgo(90), daysAgo(90), 0, NOW);
    expect(t.status).toBe("none");
    expect(chaseStatusLabel(t)).toBe("");
  });

  it("the same 45-day wait WOULD read as badly overdue under the owned model", () => {
    // This is the bug the split exists to prevent: treat a utility's queue as
    // our deadline and every solar deal is red by week three.
    const wrong = stageTiming(daysAgo(45), daysAgo(60), 7, NOW);
    expect(wrong.status).toBe("overdue");
    expect(wrong.overdueBy).toBe(38);

    const right = chaseTiming(daysAgo(1), daysAgo(45), daysAgo(60), 7, NOW);
    expect(right.status).toBe("recently_touched");
  });
});

describe("blocker labels", () => {
  it("names every party a solar deal can wait on", () => {
    expect(Object.keys(BLOCKER_LABEL).sort()).toEqual(
      ["ahj", "customer", "lender", "us", "utility"]
    );
  });
});
