import { describe, it, expect } from "vitest";
import { planStarterRules, GENERIC_RULES } from "../../server/modules/notifications/defaults";

/** The real solar stage names in production — a hand-built, customised pipeline. */
const SOLAR_STAGES = [
  "New Appointment", "Contract Signed / Hold", "NTP Submitted", "NTP Action Required",
  "NTP Approved", "Design Submitted", "Design Action Required", "Design Complete",
  "Permit Submitted", "Permit Action Required", "Permit Complete",
  "Interconnection Application Submitted", "Install Ready", "Install Scheduled",
  "Install In Progress / MPU", "Install Complete", "Inspection Scheduled",
  "Inspection Action Required", "Inspection Complete", "Monitoring Requested",
  "Monitoring Action Required", "Monitoring Complete", "Interconnection Action Required",
  "Interconnection Complete ( PTO )", "Partial Funding", "Fully Funded",
  "Install Closed", "Cancelled",
].map((name, i) => ({ id: `s${i}`, name }));

describe("starter notification rules", () => {
  it("alerts on every stage that means the deal is stuck", () => {
    const planned = planStarterRules(SOLAR_STAGES);
    const blocked = SOLAR_STAGES.filter((s) => /action required/i.test(s.name));
    expect(blocked).toHaveLength(6);
    for (const stage of blocked) {
      const rule = planned.find((r) => r.conditions.stageId === stage.id);
      expect(rule, `no rule for "${stage.name}"`).toBeTruthy();
      // A blocker nobody is emailed about is a blocker nobody clears.
      expect(rule!.channels).toContain("email");
      expect(rule!.recipients.dynamic).toContain("assigned_rep");
    }
  });

  it("never points two rules at the same stage", () => {
    const ids = planStarterRules(SOLAR_STAGES)
      .map((r) => r.conditions.stageId)
      .filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is idempotent — a second pass adds nothing", () => {
    const first = planStarterRules(SOLAR_STAGES);
    const second = planStarterRules(SOLAR_STAGES, first.map((r) => r.name));
    expect(second).toHaveLength(0);
  });

  it("tops up rather than duplicating when some rules already exist", () => {
    const all = planStarterRules(SOLAR_STAGES);
    const half = all.slice(0, 5).map((r) => r.name);
    const rest = planStarterRules(SOLAR_STAGES, half);
    expect(rest).toHaveLength(all.length - 5);
    expect(rest.map((r) => r.name)).not.toContain(all[0].name);
  });

  it("still produces the portable rules for a pipeline it recognises nothing in", () => {
    const planned = planStarterRules([{ id: "x", name: "Something Bespoke" }]);
    expect(planned).toHaveLength(GENERIC_RULES.length);
    expect(planned.every((r) => !r.conditions.stageId)).toBe(true);
  });

  it("keeps email for movement and in-app for assignment, as roofing already does", () => {
    const planned = planStarterRules(SOLAR_STAGES);
    const byName = (n: string) => planned.find((r) => r.name === n)!;
    expect(byName("Appointment assigned → Rep").channels).toEqual(["in_app"]);
    expect(byName("Task assigned → Assignee").channels).toEqual(["in_app"]);
    expect(byName("New appointment → Managers").channels).toContain("email");
  });
});
