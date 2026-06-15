import { describe, it, expect } from "vitest";
import { computeDelinquency, delinquencyRenderable, type DelinquencyLeadInput } from "../delinquency";

const NOW = new Date("2026-06-15T12:00:00Z").getTime();
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000);

// Two stages: "Contract Signed" (limit 14, position 1) and "Adjuster Meeting"
// (limit 7, position 0). Helper to build a lead cheaply.
function lead(
  id: string,
  stageName: string,
  targetDays: number,
  position: number,
  enteredDaysAgo: number,
  rep: { firstName: string; lastName: string } | null = { firstName: "Ana", lastName: "Diaz" },
): DelinquencyLeadInput {
  return {
    id,
    firstName: id,
    lastName: "Test",
    createdAt: daysAgo(enteredDaysAgo),
    stageChangedAt: daysAgo(enteredDaysAgo),
    assignedRep: rep,
    stage: { name: stageName, color: "#fff", targetDays, position },
  };
}

describe("computeDelinquency", () => {
  it("keeps only overdue deals when due-soon is excluded", () => {
    const leads = [
      lead("over", "Contract Signed", 14, 1, 40), // 40 > 14 → overdue (+26)
      lead("soon", "Contract Signed", 14, 1, 14), // 14 == target → due_soon
      lead("ontrack", "Contract Signed", 14, 1, 2), // on track
    ];
    const r = computeDelinquency(leads, false, NOW);
    expect(r.rows.map((x) => x.leadId)).toEqual(["over"]);
    expect(r.metrics).toMatchObject({ overdue: 1, dueSoon: 0, tracked: 3 });
    expect(r.rows[0].daysOver).toBe(26);
  });

  it("includes due-soon deals when requested", () => {
    const leads = [
      lead("over", "Contract Signed", 14, 1, 40),
      lead("soon", "Contract Signed", 14, 1, 14),
      lead("ontrack", "Contract Signed", 14, 1, 2),
    ];
    const r = computeDelinquency(leads, true, NOW);
    expect(r.rows.map((x) => x.leadId).sort()).toEqual(["over", "soon"]);
    expect(r.metrics).toMatchObject({ overdue: 1, dueSoon: 1, tracked: 3 });
  });

  it("groups by stage ordered by pipeline position", () => {
    const leads = [
      lead("a", "Contract Signed", 14, 1, 40),
      lead("b", "Adjuster Meeting", 7, 0, 20),
    ];
    const r = computeDelinquency(leads, false, NOW);
    // Adjuster Meeting (position 0) comes before Contract Signed (position 1).
    expect(r.groups.map((g) => g.stageName)).toEqual(["Adjuster Meeting", "Contract Signed"]);
  });

  it("sorts rows worst-first by days over", () => {
    const leads = [
      lead("mild", "Contract Signed", 14, 1, 20), // +6
      lead("severe", "Contract Signed", 14, 1, 50), // +36
    ];
    const r = computeDelinquency(leads, false, NOW);
    expect(r.rows.map((x) => x.leadId)).toEqual(["severe", "mild"]);
    expect(r.metrics.worst).toBe(36);
    expect(r.metrics.avgOver).toBe(21); // (36 + 6) / 2
  });

  it("labels unassigned deals", () => {
    const r = computeDelinquency([lead("x", "Contract Signed", 14, 1, 40, null)], false, NOW);
    expect(r.rows[0].rep).toBe("Unassigned");
  });

  it("renders to export tables with a row per overdue deal", () => {
    const leads = [
      lead("a", "Contract Signed", 14, 1, 40),
      lead("b", "Adjuster Meeting", 7, 0, 20),
    ];
    const computed = computeDelinquency(leads, false, NOW);
    const renderable = delinquencyRenderable({
      scopeLabel: "Whole company",
      includeDueSoon: false,
      generatedLabel: "Jun 15, 2026",
      ...computed,
    });
    expect(renderable.tables).toHaveLength(2);
    expect(renderable.tables[0].title).toContain("Adjuster Meeting · limit 7d");
    expect(renderable.tables[0].rows[0][0]).toBe("b Test"); // customer (first + last)
    expect(renderable.tables[0].columns).toContain("Days over");
  });
});
