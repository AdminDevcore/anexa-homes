import { describe, expect, it } from "vitest";
import {
  adderAmountCents,
  adderRateLabel,
  adderTotals,
  dollarsToMillsPerWatt,
  millsPerWattToDollars,
  type AdderLine,
} from "../solar-adders";

const line = (over: Partial<AdderLine> = {}): AdderLine => ({
  id: "a1",
  label: "Main panel upgrade",
  basis: "flat",
  flatCents: 270000,
  millsPerWatt: null,
  qty: 1,
  ...over,
});

// A 20 kW system, so a $0.05/W rate comes to a round $1,000.
const WATTS = 20_000;

describe("adderAmountCents", () => {
  it("charges a flat adder its catalogue price, whatever the system size", () => {
    expect(adderAmountCents(line(), WATTS)).toBe(270000);
    expect(adderAmountCents(line(), 5_000)).toBe(270000);
  });

  it("scales a per-watt adder with the array", () => {
    const steep = line({ basis: "perWatt", flatCents: null, millsPerWatt: 50 });
    expect(adderAmountCents(steep, WATTS)).toBe(100000); // $0.05 × 20,000 W = $1,000
    expect(adderAmountCents(steep, 10_000)).toBe(50000);
  });

  /**
   * The whole reason a per-watt adder is not stored as a resolved amount: the
   * roof decides the size, and the size decides the charge.
   */
  it("follows the design when the array grows", () => {
    const steep = line({ basis: "perWatt", flatCents: null, millsPerWatt: 50 });
    const before = adderAmountCents(steep, 8_000);
    const after = adderAmountCents(steep, 12_000);
    expect(after).toBeGreaterThan(before);
    expect(after / before).toBeCloseTo(1.5, 6);
  });

  it("multiplies by quantity", () => {
    expect(adderAmountCents(line({ qty: 3 }), WATTS)).toBe(810000);
  });

  it("reads a missing or broken quantity as one", () => {
    expect(adderAmountCents(line({ qty: 0 }), WATTS)).toBe(270000);
    expect(adderAmountCents(line({ qty: -2 }), WATTS)).toBe(270000);
    expect(adderAmountCents(line({ qty: Number.NaN }), WATTS)).toBe(270000);
  });

  it("prices a per-watt adder at nothing when nothing is drawn", () => {
    const steep = line({ basis: "perWatt", flatCents: null, millsPerWatt: 50 });
    expect(adderAmountCents(steep, 0)).toBe(0);
  });

  it("prices a line with no rate at nothing rather than at NaN", () => {
    expect(adderAmountCents(line({ flatCents: null }), WATTS)).toBe(0);
    expect(adderAmountCents(line({ basis: "perWatt", flatCents: null, millsPerWatt: null }), WATTS)).toBe(0);
  });

  it("keeps a sub-cent rate honest across the whole array", () => {
    // $0.0125/W on 20 kW is $250. Dividing mills by ten per watt and rounding
    // each one would lose the quarter cent 20,000 times over.
    const line0 = line({ basis: "perWatt", flatCents: null, millsPerWatt: 12.5 });
    expect(adderAmountCents(line0, WATTS)).toBe(25000);
  });

  it("treats a custom line exactly like a flat one — it is just untyped by the catalogue", () => {
    expect(adderAmountCents(line({ basis: "custom", flatCents: 145000 }), WATTS)).toBe(145000);
  });
});

describe("adderTotals", () => {
  it("prices every line and sums them", () => {
    const t = adderTotals(
      [
        line({ id: "a", flatCents: 270000 }),
        line({ id: "b", basis: "perWatt", flatCents: null, millsPerWatt: 50 }),
      ],
      WATTS
    );
    expect(t.lines.map((l) => l.amountCents)).toEqual([270000, 100000]);
    expect(t.totalCents).toBe(370000);
  });

  it("expresses the total per installed watt", () => {
    const t = adderTotals([line({ flatCents: 100000 })], WATTS);
    // $1,000 over 20,000 W is 5 cents a watt.
    expect(t.ppwCents).toBeCloseTo(5, 6);
  });

  it("does not round the per-watt figure — a breakdown has to add up", () => {
    const t = adderTotals([line({ flatCents: 100001 })], 3);
    expect(t.ppwCents).toBeCloseTo(100001 / 3, 6);
  });

  it("is zero, not NaN, on a deal with nothing drawn", () => {
    const t = adderTotals([line()], 0);
    expect(t.ppwCents).toBe(0);
    expect(t.totalCents).toBe(270000);
  });

  it("sums to nothing when there are no lines", () => {
    const t = adderTotals([], WATTS);
    expect(t.totalCents).toBe(0);
    expect(t.ppwCents).toBe(0);
  });
});

describe("units", () => {
  it("round-trips dollars per watt through mills", () => {
    expect(dollarsToMillsPerWatt(0.05)).toBe(50);
    expect(millsPerWattToDollars(50)).toBeCloseTo(0.05, 6);
    expect(millsPerWattToDollars(dollarsToMillsPerWatt(0.125))).toBeCloseTo(0.125, 6);
  });

  it("labels a line by its rule, not by what it happens to come to", () => {
    expect(adderRateLabel({ basis: "perWatt", flatCents: null, millsPerWatt: 50 })).toBe("$0.05/W");
    expect(adderRateLabel({ basis: "flat", flatCents: 270000, millsPerWatt: null })).toBe("$2,700");
    expect(adderRateLabel({ basis: "custom", flatCents: 145000, millsPerWatt: null })).toBe("$1,450");
  });
});
