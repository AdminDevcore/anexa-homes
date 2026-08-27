import { describe, expect, it } from "vitest";
import {
  adderAmountCents,
  adderConsumptionKwh,
  adderCountLabel,
  adderRateLabel,
  adderTotals,
  catalogueBasis,
  inAutoApplyBand,
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

  it("splits the lines by which side of the partner's price they fall", () => {
    // Two lines, one flagged. The total is still what the extra work costs;
    // the two halves are what pricing needs, because a roof is added to the
    // loan at its own price and trenching comes out of the partner's rate.
    const t = adderTotals(
      [
        line({ id: "roof", flatCents: 700_000, financedOnTop: true }),
        line({ id: "trench", flatCents: 255_000 }),
      ],
      WATTS
    );
    expect(t.totalCents).toBe(955_000);
    expect(t.onTopCents).toBe(700_000);
    expect(t.financedInCents).toBe(255_000);
    // The two halves are disjoint and complete. Anything else double-counts a
    // line onto the contract or drops one off it.
    expect(t.financedInCents + t.onTopCents).toBe(t.totalCents);
  });

  it("puts everything inside the price when nothing is flagged", () => {
    const t = adderTotals([line({ flatCents: 270_000 })], WATTS);
    expect(t.onTopCents).toBe(0);
    expect(t.financedInCents).toBe(t.totalCents);
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

/**
 * The three bases that arrived with the Pipe-parity rate sheet.
 *
 * Every figure below is arithmetic done by hand rather than a re-derivation of
 * what the implementation returns: these land on a contract, and a per-foot
 * rate that quietly prices per unit is a trench billed at a hundredth of the
 * job.
 */
describe("per-unit, per-foot and discount", () => {
  const line = (over: Partial<AdderLine>): AdderLine => ({
    id: "x",
    label: "Line",
    basis: "flat",
    flatCents: null,
    millsPerWatt: null,
    qty: 1,
    ...over,
  });

  it("prices a trench at the rate times the feet", () => {
    // $10.00/ft over 120 ft = $1,200.
    const l = line({ basis: "perFoot", flatCents: 1_000, qty: 120 });
    expect(adderAmountCents(l, 8_000)).toBe(120_000);
  });

  it("does not let the system size touch a per-foot line", () => {
    const l = line({ basis: "perFoot", flatCents: 1_000, qty: 120 });
    expect(adderAmountCents(l, 8_000)).toBe(adderAmountCents(l, 20_000));
  });

  it("prices per unit at the amount times the count", () => {
    const l = line({ basis: "perUnit", flatCents: 25_000, qty: 3 });
    expect(adderAmountCents(l, 8_000)).toBe(75_000);
  });

  it("takes a discount OFF, from a positive stored amount", () => {
    const l = line({ basis: "discount", flatCents: 100_000 });
    expect(adderAmountCents(l, 8_000)).toBe(-100_000);
  });

  it("nets a discount against the charges in the total", () => {
    const totals = adderTotals(
      [
        line({ id: "a", basis: "flat", flatCents: 270_000 }),
        line({ id: "b", basis: "discount", flatCents: 50_000 }),
      ],
      8_000
    );
    expect(totals.totalCents).toBe(220_000);
    // And the per-watt figure follows it down rather than being taken off the
    // gross — a breakdown that does not add up on screen is the whole reason
    // the typed "Adders $" box had to go.
    expect(totals.ppwCents).toBeCloseTo(220_000 / 8_000, 10);
  });

  it("labels each basis with the unit it is priced in", () => {
    expect(adderRateLabel(line({ basis: "perFoot", flatCents: 1_000 }))).toBe("$10/ft");
    expect(adderRateLabel(line({ basis: "perUnit", flatCents: 25_000 }))).toBe("$250 each");
    expect(adderRateLabel(line({ basis: "discount", flatCents: 50_000 }))).toBe("−$500");
    expect(adderRateLabel(line({ basis: "flat", flatCents: 270_000 }))).toBe("$2,700");
  });

  it("asks for the right count, or for none at all", () => {
    expect(adderCountLabel("perFoot")).toBe("Feet");
    expect(adderCountLabel("perUnit")).toBe("Units");
    expect(adderCountLabel("perWatt")).toBeNull();
    expect(adderCountLabel("flat")).toBeNull();
  });
});

describe("consumption adjustment", () => {
  const line = (over: Partial<AdderLine> & { consumptionKwhPerYear?: number | null }) => ({
    id: "x",
    label: "Line",
    basis: "flat" as const,
    flatCents: 0,
    millsPerWatt: null,
    qty: 1,
    ...over,
  });

  it("is zero when nothing was entered", () => {
    expect(adderConsumptionKwh(line({}))).toBe(0);
    expect(adderConsumptionKwh(line({ consumptionKwhPerYear: null }))).toBe(0);
  });

  it("scales with the count on a basis that has one", () => {
    // Two chargers draw twice what one does.
    expect(
      adderConsumptionKwh(line({ basis: "perUnit", qty: 2, consumptionKwhPerYear: 3_000 }))
    ).toBe(6_000);
  });

  it("ignores the count on a basis that does not have one", () => {
    // A fixed line's qty is pinned to 1 by the server; if a legacy row carries
    // more, the kWh must not be multiplied by it.
    expect(
      adderConsumptionKwh(line({ basis: "flat", qty: 4, consumptionKwhPerYear: 3_000 }))
    ).toBe(3_000);
  });
});


/**
 * The band that puts an adder on a deal without anybody clicking.
 *
 * The boundary is the whole test: two bands written back to back must not both
 * fire on the system that sits exactly on the seam, or a 5 kW design carries a
 * small-system charge AND the mid-range one.
 */
describe("auto-apply bands", () => {
  const band = (min: number | null, max: number | null) => ({
    autoApplyMinKw: min,
    autoApplyMaxKw: max,
  });

  it("fires on the minimum and not on the maximum", () => {
    expect(inAutoApplyBand(5, band(5, 8))).toBe(true);
    expect(inAutoApplyBand(7.99, band(5, 8))).toBe(true);
    expect(inAutoApplyBand(8, band(5, 8))).toBe(false);
    expect(inAutoApplyBand(4.99, band(5, 8))).toBe(false);
  });

  it("lets back-to-back bands cover a range without overlapping", () => {
    const small = band(null, 5);
    const mid = band(5, 8);
    for (const kw of [1, 4.9, 5, 5.1, 7.9, 8, 12]) {
      expect(inAutoApplyBand(kw, small) && inAutoApplyBand(kw, mid)).toBe(false);
    }
    expect(inAutoApplyBand(5, small)).toBe(false);
    expect(inAutoApplyBand(5, mid)).toBe(true);
  });

  it("treats an open end as open", () => {
    expect(inAutoApplyBand(0.5, band(null, 5))).toBe(true);
    expect(inAutoApplyBand(200, band(8, null))).toBe(true);
  });

  it("never fires on a design with nothing drawn", () => {
    expect(inAutoApplyBand(0, band(null, 5))).toBe(false);
    expect(inAutoApplyBand(-1, band(null, 5))).toBe(false);
  });
});

describe("catalogueBasis", () => {
  it("takes the stored basis when there is one", () => {
    expect(catalogueBasis({ adderBasis: "perFoot", priceMillsPerWatt: null })).toBe("perFoot");
  });

  it("falls back to the rule the catalogue used before the column existed", () => {
    expect(catalogueBasis({ adderBasis: null, priceMillsPerWatt: 50 })).toBe("perWatt");
    expect(catalogueBasis({ adderBasis: null, priceMillsPerWatt: null })).toBe("flat");
  });

  it("ignores a value that is not one of ours", () => {
    expect(catalogueBasis({ adderBasis: "nonsense", priceMillsPerWatt: null })).toBe("flat");
  });
});
