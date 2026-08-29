import { describe, it, expect } from "vitest";
import { resolveSolarPay, solarRepPayCents, type SolarPayTerms } from "@/lib/solar-pay";
import { pricePurchase } from "@/lib/solar-money";

const REP = { solarRedlineCentsPerWatt: 200, solarPerWattMills: 400, solarRedlinePerBatteryCents: null };

/**
 * The PV resolver, as these tests have always used it.
 *
 * `resolveSolarPay` now answers three ways rather than returning a nullable —
 * see the storage block at the foot of this file for why. Every assertion here
 * predates that and describes the PV rules, so this narrows back to the old
 * shape and each one keeps saying exactly what it said.
 */
const terms = (input: Omit<Parameters<typeof resolveSolarPay>[0], "systemType">): SolarPayTerms | null => {
  const r = resolveSolarPay({ systemType: "pv", ...input });
  return r.kind === "terms" ? r.terms : null;
};

// ---------------------------------------------------------------------------
// Which basis applies
// ---------------------------------------------------------------------------
describe("basis selection", () => {
  it("a loan through a per_watt lender pays the rep's fixed rate", () => {
    const t = terms({ product: "loan", lenderPayMode: "per_watt", rep: REP });
    expect(t).toEqual({ basis: "per_watt", redlineCentsPerWatt: null, millsPerWatt: 400, redlinePerBatteryCents: null });
  });

  it("a loan through a redline lender pays against the rep's redline", () => {
    const t = terms({ product: "loan", lenderPayMode: "redline", rep: REP });
    expect(t).toEqual({ basis: "redline", redlineCentsPerWatt: 200, millsPerWatt: null, redlinePerBatteryCents: null });
  });

  it("cash has no lender at all, so it falls to the redline", () => {
    const t = terms({ product: "cash", lenderPayMode: null, rep: REP });
    expect(t?.basis).toBe("redline");
  });

  it("a loan with no lender picked yet falls to the redline", () => {
    const t = terms({ product: "loan", lenderPayMode: null, rep: REP });
    expect(t?.basis).toBe("redline");
  });

  // The array is still physically installed on a TPO deal, but there is no
  // system PRICE — a redline has nothing to compare against.
  it("lease and PPA pay per watt whatever the lender's mode says", () => {
    for (const product of ["lease", "ppa"] as const) {
      expect(terms({ product, lenderPayMode: "redline", rep: REP })?.basis).toBe("per_watt");
      expect(terms({ product, lenderPayMode: "per_watt", rep: REP })?.basis).toBe("per_watt");
    }
  });

  it("a rep with no redline set generates NOTHING on a redline deal", () => {
    const t = terms({
      product: "loan",
      lenderPayMode: "redline",
      rep: { solarRedlineCentsPerWatt: null, solarPerWattMills: 400, solarRedlinePerBatteryCents: null },
    });
    expect(t).toBeNull();
  });

  it("a rep with no fixed rate set generates NOTHING on a per_watt deal", () => {
    const t = terms({
      product: "loan",
      lenderPayMode: "per_watt",
      rep: { solarRedlineCentsPerWatt: 200, solarPerWattMills: null, solarRedlinePerBatteryCents: null },
    });
    expect(t).toBeNull();
  });

  it("a zero rate is a real answer, not an unset one", () => {
    const t = terms({
      product: "loan",
      lenderPayMode: "per_watt",
      rep: { solarRedlineCentsPerWatt: null, solarPerWattMills: 0, solarRedlinePerBatteryCents: null },
    });
    expect(t).toEqual({ basis: "per_watt", redlineCentsPerWatt: null, millsPerWatt: 0, redlinePerBatteryCents: null });
  });
});

// ---------------------------------------------------------------------------
// Redline — the rep keeps everything above it
// ---------------------------------------------------------------------------
describe("redline pay", () => {
  const terms: SolarPayTerms = { basis: "redline", redlineCentsPerWatt: 200, millsPerWatt: null, redlinePerBatteryCents: null };

  it("pays the overage on the NET price, so the dealer fee comes out of the rep", () => {
    // 10 kW at $3.20/W through Credit Human's 18%: net $2.624/W, $0.624 over.
    const cheap = pricePurchase({ product: "loan", systemSizeKwDc: 10, stickerPpwCents: 320, dealerFeePct: 18, adderTotalCents: 0 });
    const a = solarRepPayCents(terms, { systemWatts: cheap.systemWatts, basePriceCents: cheap.basePriceCents });
    expect(a.amountCents).toBe(624_000);
    expect(a.overageCentsPerWatt).toBeCloseTo(62.4, 4);

    // The same sticker through GoodLeap's 32%: net $2.176/W, $0.176 over.
    const dear = pricePurchase({ product: "loan", systemSizeKwDc: 10, stickerPpwCents: 320, dealerFeePct: 32, adderTotalCents: 0 });
    const b = solarRepPayCents(terms, { systemWatts: dear.systemWatts, basePriceCents: dear.basePriceCents });
    expect(b.amountCents).toBe(176_000);

    // Cheap money is worth $4,480 more to the rep on the identical sticker.
    expect(a.amountCents - b.amountCents).toBe(448_000);
  });

  it("cash has no fee, so the whole gross sits above the redline", () => {
    const p = pricePurchase({ product: "cash", systemSizeKwDc: 10, stickerPpwCents: 290, dealerFeePct: 0, adderTotalCents: 0 });
    const pay = solarRepPayCents(terms, { systemWatts: p.systemWatts, basePriceCents: p.basePriceCents });
    expect(pay.amountCents).toBe(900_000); // $0.90/W over × 10,000 W
  });

  // A rep who sells under the redline owes the company nothing — they just earn
  // nothing. A negative commission would net off against their other deals.
  it("never goes negative below the redline", () => {
    const p = pricePurchase({ product: "loan", systemSizeKwDc: 10, stickerPpwCents: 250, dealerFeePct: 32, adderTotalCents: 0 });
    const pay = solarRepPayCents(terms, { systemWatts: p.systemWatts, basePriceCents: p.basePriceCents });
    expect(pay.basePpwCents).toBeLessThan(200);
    expect(pay.amountCents).toBe(0);
  });

  it("pays nothing exactly at the redline", () => {
    const pay = solarRepPayCents(terms, { systemWatts: 10_000, basePriceCents: 2_000_000 });
    expect(pay.amountCents).toBe(0);
    expect(pay.overageCentsPerWatt).toBe(0);
  });

  // Adders are priced from the catalogue to cover their own cost; they are not
  // rep overage. netPriceCents from pricePurchase already excludes them.
  it("ignores adders", () => {
    const plain = pricePurchase({ product: "loan", systemSizeKwDc: 10, stickerPpwCents: 320, dealerFeePct: 18, adderTotalCents: 0 });
    const laden = pricePurchase({ product: "loan", systemSizeKwDc: 10, stickerPpwCents: 320, dealerFeePct: 18, adderTotalCents: 1_450_000 });
    expect(laden.contractPriceCents).toBeGreaterThan(plain.contractPriceCents);
    expect(
      solarRepPayCents(terms, { systemWatts: laden.systemWatts, basePriceCents: laden.basePriceCents }).amountCents
    ).toBe(
      solarRepPayCents(terms, { systemWatts: plain.systemWatts, basePriceCents: plain.basePriceCents }).amountCents
    );
  });

  it("pays nothing on a system with no watts", () => {
    expect(solarRepPayCents(terms, { systemWatts: 0, basePriceCents: 0 }).amountCents).toBe(0);
    expect(solarRepPayCents(terms, { systemWatts: 0, basePriceCents: 0 }).basePpwCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fixed $/W — flat, whatever the price
// ---------------------------------------------------------------------------
describe("per-watt pay", () => {
  const terms: SolarPayTerms = { basis: "per_watt", redlineCentsPerWatt: null, millsPerWatt: 400, redlinePerBatteryCents: null };

  it("pays the rate on installed watts, and the sticker is irrelevant", () => {
    expect(solarRepPayCents(terms, { systemWatts: 10_000, basePriceCents: 2_600_000 }).amountCents).toBe(400_000);
    expect(solarRepPayCents(terms, { systemWatts: 10_000, basePriceCents: 9_900_000 }).amountCents).toBe(400_000);
  });

  it("carries a rate cents cannot express", () => {
    // $0.405/W on 10,140 W = $4,106.70.
    const t: SolarPayTerms = { basis: "per_watt", redlineCentsPerWatt: null, millsPerWatt: 405, redlinePerBatteryCents: null };
    expect(solarRepPayCents(t, { systemWatts: 10_140, basePriceCents: 0 }).amountCents).toBe(410_670);
  });

  it("reports the watts it was paid on as its basis", () => {
    const pay = solarRepPayCents(terms, { systemWatts: 10_000, basePriceCents: 2_600_000 });
    expect(pay.basisCents).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// Storage — a deal with no watts in it
//
// Both existing bases misfire on one, and the redline misfires WORSE than the
// zero: `basePriceCents − redline × 0` is the entire base price. Neither may
// happen quietly.
// ---------------------------------------------------------------------------
const REP_ALL = {
  solarRedlineCentsPerWatt: 200,
  solarPerWattMills: 400,
  solarRedlinePerBatteryCents: 9_000_00,
};

describe("storage deals", () => {
  it("pays the rep what they hold above their own per-battery redline", () => {
    const r = resolveSolarPay({
      systemType: "storage", product: "loan", lenderPayMode: "redline", rep: REP_ALL,
    });
    expect(r.kind).toBe("terms");
    if (r.kind !== "terms") throw new Error("unreachable");
    expect(r.terms.basis).toBe("battery_redline");

    // 2 batteries, redline $9,000 each, base price $23,000 => $5,000 over.
    const pay = solarRepPayCents(r.terms, {
      systemWatts: 0, batteryQty: 2, basePriceCents: 23_000_00,
    });
    expect(pay.amountCents).toBe(5_000_00);
  });

  it("pays nothing, not a negative, on a deal priced under the redline", () => {
    const r = resolveSolarPay({
      systemType: "storage", product: "loan", lenderPayMode: "redline", rep: REP_ALL,
    });
    if (r.kind !== "terms") throw new Error("unreachable");
    const pay = solarRepPayCents(r.terms, {
      systemWatts: 0, batteryQty: 2, basePriceCents: 15_000_00,
    });
    expect(pay.amountCents).toBe(0);
  });

  it("REFUSES a per-watt rule instead of paying zero", () => {
    const r = resolveSolarPay({
      systemType: "storage", product: "loan", lenderPayMode: "per_watt", rep: REP_ALL,
    });
    expect(r.kind).toBe("refused");
    if (r.kind !== "refused") throw new Error("unreachable");
    expect(r.reason).toMatch(/per watt/i);
  });

  it("REFUSES a lease or PPA rather than paying a per-watt rate on no watts", () => {
    for (const product of ["lease", "ppa"] as const) {
      const r = resolveSolarPay({
        systemType: "storage", product, lenderPayMode: "redline", rep: REP_ALL,
      });
      expect(r.kind).toBe("refused");
    }
  });

  it("writes no line at all when the rep has no per-battery redline", () => {
    const r = resolveSolarPay({
      systemType: "storage", product: "loan", lenderPayMode: "redline",
      rep: { ...REP_ALL, solarRedlinePerBatteryCents: null },
    });
    expect(r.kind).toBe("unconfigured");
  });

  it("a zero per-battery redline is a real answer, not an unset one", () => {
    const r = resolveSolarPay({
      systemType: "storage", product: "loan", lenderPayMode: "redline",
      rep: { ...REP_ALL, solarRedlinePerBatteryCents: 0 },
    });
    expect(r.kind).toBe("terms");
  });

  it("NEVER pays the whole base price when the count is zero", () => {
    // The specific bug: max(0, base − redline × 0) is the entire base price.
    const terms: SolarPayTerms = {
      basis: "battery_redline",
      redlineCentsPerWatt: null,
      millsPerWatt: null,
      redlinePerBatteryCents: 9_000_00,
    };
    const pay = solarRepPayCents(terms, {
      systemWatts: 0, batteryQty: 0, basePriceCents: 23_000_00,
    });
    expect(pay.amountCents).toBe(0);
    expect(pay.basisCents).toBe(0);
  });
});

describe("PV is untouched by any of it", () => {
  it("still resolves the redline basis", () => {
    const r = resolveSolarPay({
      systemType: "pv", product: "loan", lenderPayMode: "redline", rep: REP_ALL,
    });
    expect(r.kind === "terms" && r.terms.basis).toBe("redline");
  });

  it("pv_storage takes the IDENTICAL path to pv", () => {
    const a = resolveSolarPay({ systemType: "pv", product: "loan", lenderPayMode: "redline", rep: REP_ALL });
    const b = resolveSolarPay({ systemType: "pv_storage", product: "loan", lenderPayMode: "redline", rep: REP_ALL });
    expect(b).toEqual(a);
  });

  it("a battery on a pv_storage deal does not reach the pay maths", () => {
    const r = resolveSolarPay({ systemType: "pv_storage", product: "loan", lenderPayMode: "redline", rep: REP_ALL });
    if (r.kind !== "terms") throw new Error("unreachable");
    const withBattery = solarRepPayCents(r.terms, { systemWatts: 10_000, basePriceCents: 2_600_000, batteryQty: 2 });
    const without = solarRepPayCents(r.terms, { systemWatts: 10_000, basePriceCents: 2_600_000 });
    expect(withBattery).toEqual(without);
  });
});
