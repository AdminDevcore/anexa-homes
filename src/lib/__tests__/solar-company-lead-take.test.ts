import { describe, it, expect } from "vitest";
import {
  applyCompanyLeadTake,
  managerOverrideCents,
  solarRepPayCents,
  type SolarPayTerms,
  leadAdjustColumns,
} from "../solar-pay";

/**
 * The company-provided-lead adjustment, and the manager overrides that sit on
 * top of it.
 *
 * TWO THINGS ARE EASY TO GET BACKWARDS HERE, and both are silent when wrong:
 *
 *   1. `takePct` is what the COMPANY keeps, not what the rep gets. It is the
 *      opposite convention to roofing's `providedLeadSplitPct`. Inverted, a rep
 *      on a 40% company take is paid $4,000 instead of $6,000 and nothing about
 *      the number looks unusual.
 *   2. A percentage override is a share of the REP'S FINAL commission — after
 *      the lead adjustment — not of the contract price and not of the gross.
 */

const redline: SolarPayTerms = {
  basis: "redline",
  redlineCentsPerWatt: 200, // $2.00/W
  millsPerWatt: null,
  redlinePerBatteryCents: null,
  perBatteryFlatCents: null,
};

const selfGen = { companyProvided: false, mode: "none" as const, takePct: null, flatCents: null };

describe("company lead adjustment — exactly one method", () => {
  it("PERCENTAGE keeps the company's share: $10,000 at 40% leaves the rep $6,000", () => {
    const out = applyCompanyLeadTake(10_000_00, {
      companyProvided: true, mode: "percentage", takePct: 40, flatCents: null,
    });
    expect(out.companyTakeCents).toBe(4_000_00);
    expect(out.netCents).toBe(6_000_00);
    expect(out.appliedMode).toBe("percentage");
    expect(out.appliedTakePct).toBe(40);
    expect(out.appliedFlatCents).toBe(0);
  });

  it("FLAT deducts the amount: $10,000 less $1,500 leaves the rep $8,500", () => {
    const out = applyCompanyLeadTake(10_000_00, {
      companyProvided: true, mode: "flat", takePct: null, flatCents: 1_500_00,
    });
    expect(out.companyTakeCents).toBe(1_500_00);
    expect(out.netCents).toBe(8_500_00);
    expect(out.appliedMode).toBe("flat");
    expect(out.appliedFlatCents).toBe(1_500_00);
    expect(out.appliedTakePct).toBe(0);
  });

  it("SELF-GENERATED is never adjusted, whatever is configured", () => {
    for (const mode of ["none", "percentage", "flat"] as const) {
      const out = applyCompanyLeadTake(10_000_00, {
        companyProvided: false, mode, takePct: 40, flatCents: 1_500_00,
      });
      expect(out.netCents).toBe(10_000_00);
      expect(out.appliedMode).toBe("none");
    }
  });

  it("mode NONE ignores both amounts, even on a company-provided lead", () => {
    const out = applyCompanyLeadTake(10_000_00, {
      companyProvided: true, mode: "none", takePct: 40, flatCents: 1_500_00,
    });
    expect(out.netCents).toBe(10_000_00);
  });

  it("EXCLUSIVITY: percentage mode ignores a stale flat amount", () => {
    // A rep moved from a flat deduction to a percentage keeps the old number on
    // their profile. It must not stack.
    const out = applyCompanyLeadTake(10_000_00, {
      companyProvided: true, mode: "percentage", takePct: 40, flatCents: 1_500_00,
    });
    expect(out.netCents).toBe(6_000_00); // not 4,500
    expect(out.appliedFlatCents).toBe(0);
  });

  it("EXCLUSIVITY: flat mode ignores a stale percentage", () => {
    const out = applyCompanyLeadTake(10_000_00, {
      companyProvided: true, mode: "flat", takePct: 40, flatCents: 1_500_00,
    });
    expect(out.netCents).toBe(8_500_00); // not 4,500
    expect(out.appliedTakePct).toBe(0);
  });

  it("treats an undecided classification as self-generated", () => {
    // `companyProvidedLead` is NULL until M1 settles it. Taking money off a rep
    // on a decision nobody has made is the wrong way round.
    expect(applyCompanyLeadTake(10_000_00, selfGen).netCents).toBe(10_000_00);
  });

  it("never owes the rep a negative — a flat deduction cannot exceed the gross", () => {
    // Owing a negative is a chargeback, and a chargeback is raised deliberately
    // and approved. A mistyped deduction must not create one.
    const out = applyCompanyLeadTake(1_000_00, {
      companyProvided: true, mode: "flat", takePct: null, flatCents: 5_000_00,
    });
    expect(out.netCents).toBe(0);
    expect(out.companyTakeCents).toBe(1_000_00);
  });

  it("clamps a percentage outside 0–100", () => {
    expect(applyCompanyLeadTake(10_000_00, { companyProvided: true, mode: "percentage", takePct: 150, flatCents: null }).netCents).toBe(0);
    expect(applyCompanyLeadTake(10_000_00, { companyProvided: true, mode: "percentage", takePct: -10, flatCents: null }).netCents).toBe(10_000_00);
  });

  it("applies to every basis — the lead came from the company either way", () => {
    const cases: { terms: SolarPayTerms; deal: { systemWatts: number; basePriceCents: number; batteryQty?: number } }[] = [
      { terms: redline, deal: { systemWatts: 10_000, basePriceCents: 30_000_00 } },
      { terms: { basis: "per_watt", redlineCentsPerWatt: null, millsPerWatt: 400, redlinePerBatteryCents: null, perBatteryFlatCents: null }, deal: { systemWatts: 10_000, basePriceCents: 30_000_00 } },
      { terms: { basis: "battery_redline", redlineCentsPerWatt: null, millsPerWatt: null, redlinePerBatteryCents: 800_000, perBatteryFlatCents: null }, deal: { systemWatts: 0, basePriceCents: 20_000_00, batteryQty: 2 } },
      { terms: { basis: "battery_flat", redlineCentsPerWatt: null, millsPerWatt: null, redlinePerBatteryCents: null, perBatteryFlatCents: 150_000 }, deal: { systemWatts: 0, basePriceCents: 20_000_00, batteryQty: 2 } },
    ];
    for (const { terms, deal } of cases) {
      const gross = solarRepPayCents(terms, deal).amountCents;
      const out = applyCompanyLeadTake(gross, { companyProvided: true, mode: "percentage", takePct: 20, flatCents: null });
      expect(out.netCents).toBe(gross - Math.round((gross * 20) / 100));
    }
  });
});

describe("manager overrides — all four shapes", () => {
  const deal = { systemWatts: 10_000, repNetCents: 6_000_00 };

  it("$/W pays the rate on the system's watts, independent of the rep", () => {
    // 10,000 W × 50 mills ÷ 10 = $500. Mills are tenths of a cent, so the
    // divisor is 10 — the same convention as the rep's per-watt basis.
    const out = managerOverrideCents(
      { type: "ppw", percent: 0, flatAmount: 0, perWattMills: 50 },
      deal
    );
    expect(out.amountCents).toBe(500_00);
    expect(out.basisCents).toBe(10_000); // the watts it was paid on
  });

  it("$/W does not move when the rep's commission moves", () => {
    const a = managerOverrideCents({ type: "ppw", percent: 0, flatAmount: 0, perWattMills: 50 }, deal);
    const b = managerOverrideCents({ type: "ppw", percent: 0, flatAmount: 0, perWattMills: 50 }, { ...deal, repNetCents: 1_00 });
    expect(a.amountCents).toBe(b.amountCents);
  });

  it("$/W pays nothing on a job with no watts", () => {
    const out = managerOverrideCents(
      { type: "ppw", percent: 0, flatAmount: 0, perWattMills: 50 },
      { systemWatts: 0, repNetCents: 6_000_00 }
    );
    expect(out.amountCents).toBe(0);
  });

  it("PERCENTAGE is a share of the rep's FINAL commission", () => {
    const out = managerOverrideCents(
      { type: "percentage", percent: 10, flatAmount: 0, perWattMills: 0 },
      deal
    );
    // 10% of the rep's $6,000 net = $600. Of a $30,000 contract it would be $3,000.
    expect(out.amountCents).toBe(600_00);
    expect(out.basisCents).toBe(6_000_00);
  });

  it("PERCENTAGE follows the lead adjustment down", () => {
    const gross = solarRepPayCents(redline, { systemWatts: 10_000, basePriceCents: 30_000_00 });
    expect(gross.amountCents).toBe(10_000_00);
    const net = applyCompanyLeadTake(gross.amountCents, {
      companyProvided: true, mode: "percentage", takePct: 40, flatCents: null,
    });
    const out = managerOverrideCents(
      { type: "percentage", percent: 10, flatAmount: 0, perWattMills: 0 },
      { systemWatts: 10_000, repNetCents: net.netCents }
    );
    expect(out.amountCents).toBe(600_00); // 10% of $6,000, not of $10,000
  });

  it("FLAT is a fixed amount and measures nothing", () => {
    const out = managerOverrideCents(
      { type: "flat", percent: 10, flatAmount: 250_00, perWattMills: 50 },
      deal
    );
    expect(out.amountCents).toBe(250_00);
    expect(out.basisCents).toBe(0);
  });

  it("never returns a negative", () => {
    for (const t of [
      { type: "percentage" as const, percent: -5, flatAmount: 0, perWattMills: 0 },
      { type: "flat" as const, percent: 0, flatAmount: -100, perWattMills: 0 },
      { type: "ppw" as const, percent: 0, flatAmount: 0, perWattMills: -50 },
    ]) {
      expect(managerOverrideCents(t, deal).amountCents).toBe(0);
    }
  });
});

describe("worked example, end to end", () => {
  it("10 kW at $3.00/W base, $2.00/W redline, 40% company take, three managers", () => {
    const gross = solarRepPayCents(redline, { systemWatts: 10_000, basePriceCents: 30_000_00 });
    expect(gross.amountCents).toBe(10_000_00);

    const net = applyCompanyLeadTake(gross.amountCents, {
      companyProvided: true, mode: "percentage", takePct: 40, flatCents: null,
    });
    expect(net.netCents).toBe(6_000_00);

    const d = { systemWatts: 10_000, repNetCents: net.netCents };
    const ppw = managerOverrideCents({ type: "ppw", percent: 0, flatAmount: 0, perWattMills: 50 }, d);
    const pct = managerOverrideCents({ type: "percentage", percent: 10, flatAmount: 0, perWattMills: 0 }, d);
    const flat = managerOverrideCents({ type: "flat", percent: 0, flatAmount: 250_00, perWattMills: 0 }, d);

    expect([ppw.amountCents, pct.amountCents, flat.amountCents]).toEqual([500_00, 600_00, 250_00]);
    // …and none of them came out of the rep.
    expect(net.netCents).toBe(6_000_00);
  });
});

/**
 * The WRITE side of the one-method rule.
 *
 * `applyCompanyLeadTake` already ignores the amount its mode does not name, so
 * these are not about arithmetic — they are about the column not being there to
 * be read by the next author, report or migration that assumes a non-null
 * figure means something.
 */
describe("leadAdjustColumns — one method, one live column", () => {
  const both = { takePct: 40, flatCents: 1_500_00 };

  it("percentage keeps the percentage and CLEARS the flat amount", () => {
    expect(leadAdjustColumns("percentage", both)).toEqual({
      solarCompanyLeadTakePct: 40,
      solarCompanyLeadFlatCents: null,
    });
  });

  it("flat keeps the flat amount and CLEARS the percentage", () => {
    expect(leadAdjustColumns("flat", both)).toEqual({
      solarCompanyLeadTakePct: null,
      solarCompanyLeadFlatCents: 1_500_00,
    });
  });

  it("none clears BOTH — it is an answer, not an absence", () => {
    expect(leadAdjustColumns("none", both)).toEqual({
      solarCompanyLeadTakePct: null,
      solarCompanyLeadFlatCents: null,
    });
  });

  it("switching a rep from percentage to flat leaves no stale percentage behind", () => {
    // The migration that matters: yesterday 40%, today $1,500. If the old rate
    // survived, a reader looking at `takePct` first would still take 40%.
    const before = leadAdjustColumns("percentage", { takePct: 40, flatCents: null });
    expect(before.solarCompanyLeadTakePct).toBe(40);

    const after = leadAdjustColumns("flat", {
      takePct: before.solarCompanyLeadTakePct,
      flatCents: 1_500_00,
    });
    expect(after.solarCompanyLeadTakePct).toBeNull();
    expect(after.solarCompanyLeadFlatCents).toBe(1_500_00);
  });

  it("never leaves two live figures, whatever it is handed", () => {
    for (const mode of ["none", "percentage", "flat"] as const) {
      const out = leadAdjustColumns(mode, both);
      const live = [out.solarCompanyLeadTakePct, out.solarCompanyLeadFlatCents].filter(
        (v) => v != null
      );
      expect(live.length).toBeLessThanOrEqual(1);
    }
  });
});
