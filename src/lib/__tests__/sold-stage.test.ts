import { describe, it, expect } from "vitest";
import { findSaleLine, soldStageIds, type SaleStageShape } from "../sold-stage";

const stage = (
  position: number,
  name: string,
  flags: Partial<Pick<SaleStageShape, "countsAsSold" | "isWon" | "isLost">> = {},
): SaleStageShape => ({
  id: `s-${position}`,
  name,
  position,
  countsAsSold: false,
  isWon: false,
  isLost: false,
  ...flags,
});

/** The two pipelines this product actually ships, trimmed to what matters here. */
const ROOFING = [
  stage(0, "New Appointment"),
  stage(1, "Inspection Complete"),
  stage(7, "Contract Signed", { countsAsSold: true }),
  stage(10, "In Production"),
  stage(14, "Paid", { isWon: true }),
  stage(16, "Cancelled", { isLost: true }),
];

describe("findSaleLine", () => {
  it("takes the stage the company flagged in Settings", () => {
    expect(findSaleLine(ROOFING)?.name).toBe("Contract Signed");
  });

  it("takes the earliest flagged stage when more than one is marked", () => {
    const line = findSaleLine([
      stage(2, "Verbal Commitment", { countsAsSold: true }),
      stage(7, "Contract Signed", { countsAsSold: true }),
    ]);
    expect(line?.name).toBe("Verbal Commitment");
  });

  // Nothing flagged is the state every existing company is in the moment this
  // ships, so the fallback has to land on the signature by itself.
  it("falls back to the stage named for the signature", () => {
    const line = findSaleLine(ROOFING.map((s) => ({ ...s, countsAsSold: false })));
    expect(line?.name).toBe("Contract Signed");
  });

  // A custom pipeline that names the moment something else still has to pay out
  // a number rather than reporting nobody has ever won anything.
  it("falls back to the won stage when no stage is flagged or named", () => {
    const line = findSaleLine([
      stage(0, "New"),
      stage(3, "Handshake"),
      stage(9, "Paid", { isWon: true }),
    ]);
    expect(line?.name).toBe("Paid");
  });

  it("has no line at all when a pipeline marks nothing", () => {
    expect(findSaleLine([stage(0, "New"), stage(1, "Working")])).toBeNull();
  });
});

describe("soldStageIds", () => {
  it("counts every stage at or past the sale line", () => {
    const ids = soldStageIds([{ stages: ROOFING }]);
    expect(ids.has("s-7")).toBe(true); // Contract Signed
    expect(ids.has("s-10")).toBe(true); // In Production — sold, still working
    expect(ids.has("s-14")).toBe(true); // Paid
  });

  it("never counts a stage before the line", () => {
    const ids = soldStageIds([{ stages: ROOFING }]);
    expect(ids.has("s-0")).toBe(false);
    expect(ids.has("s-1")).toBe(false);
  });

  // Cancelled sits at the END of both pipelines, so "at or past the line"
  // sweeps it up unless lost stages are cut back out — and a dead deal counting
  // as a win is the one error nobody would catch by eye.
  it("never counts a lost stage, however late it sits", () => {
    expect(soldStageIds([{ stages: ROOFING }]).has("s-16")).toBe(false);
  });

  it("resolves each pipeline against its own line", () => {
    const solar = [
      stage(0, "New Lead"),
      stage(5, "Contract Signed", { countsAsSold: true }),
      stage(25, "System Activated", { isWon: true }),
    ].map((s) => ({ ...s, id: `solar-${s.position}` }));
    const ids = soldStageIds([{ stages: ROOFING }, { stages: solar }]);
    expect(ids.has("s-7")).toBe(true);
    expect(ids.has("solar-5")).toBe(true);
    expect(ids.has("solar-0")).toBe(false);
  });

  it("counts nothing from a pipeline with no line", () => {
    expect(soldStageIds([{ stages: [stage(0, "New"), stage(1, "Working")] }]).size).toBe(0);
  });
});
