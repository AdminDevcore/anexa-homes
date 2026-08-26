import { describe, it, expect } from "vitest";
import { savingsModel, buildProposalSnapshot, postSolarUtilityCents } from "@/lib/solar-proposal";
import {
  year1Production,
  PRODUCTION_MARGIN_FACTOR,
  deriveUtilityRateMills,
  pricePurchase,
  type SolarAssumptions,
} from "@/lib/solar-money";

const A: SolarAssumptions = {
  derateFactor: 0.84,
  annualDegradationPct: 0.5,
  utilityEscalationPct: 3.5,
  kwhPerKwYear: 1450,
  utilityMeterFeeCents: 1000,
  defaultGrossPpwCents: 350,
  defaultDealerFeePct: 18,
  minOffsetPct: 0,
  maxOffsetPct: 150,
  minPpwCents: 150,
  maxPpwCents: 800,
};

describe("production accounts for the roof it is actually going on", () => {
  it("still de-rates for shading when a caller supplies it", () => {
    // Nothing supplies TSRF today — it was a figure typed from memory on the
    // design form and it moved a customer's quoted kWh by up to 17%, so the
    // form stopped asking and system losses became the company-wide derate.
    // The capability stays here for the day roof faces are traced properly.
    const unshaded = year1Production(8, A, 100);
    const shaded = year1Production(8, A, 85);
    expect(unshaded).toBe(Math.round(8 * 1450 * 0.84 * PRODUCTION_MARGIN_FACTOR));
    expect(shaded).toBe(Math.round(8 * 1450 * 0.84 * 0.85 * PRODUCTION_MARGIN_FACTOR));
    expect(shaded).toBeLessThan(unshaded);
  });

  it("treats an unsurveyed site as unshaded rather than guessing a penalty", () => {
    expect(year1Production(8, A, null)).toBe(year1Production(8, A, 100));
    expect(year1Production(8, A)).toBe(year1Production(8, A, 100));
  });
});

describe("the current utility rate comes from the customer's own bill", () => {
  it("derives mills per kWh from bill and usage", () => {
    // $180/mo × 12 ÷ 14,000 kWh = $0.15428/kWh = 154 mills.
    expect(deriveUtilityRateMills(18_000, 14_000)).toBe(154);
  });

  it("returns null rather than inventing a rate when the bill is missing", () => {
    // This used to fall back to a hardcoded 150 mills, which produced a
    // confident 25-year savings projection built on a number nobody had seen.
    expect(deriveUtilityRateMills(null, 14_000)).toBeNull();
    expect(deriveUtilityRateMills(0, 14_000)).toBeNull();
    expect(deriveUtilityRateMills(18_000, null)).toBeNull();
    expect(deriveUtilityRateMills(18_000, 0)).toBeNull();
  });
});

describe("savings distinguish the bill avoided from what the customer is actually left with", () => {
  const base = {
    year1ProductionKwh: 8_282,
    annualUsageKwh: 14_000,
    currentRateMillsPerKwh: 154,
    assumptions: A,
  };

  it("CASH: net savings subtract the system price", () => {
    // The misleading version of this number shows the bill reduction and calls
    // it "25-year savings", ignoring the cheque the customer wrote.
    const purchase = pricePurchase({
      product: "cash", systemSizeKwDc: 8, stickerPpwCents: 350,
      dealerFeePct: 0, adderTotalCents: 0,
    });
    const m = savingsModel({ ...base, product: "cash", purchase });

    expect(m.solarPaidCents).toBe(purchase.contractPriceCents);
    expect(m.netSavingsCents).toBe(m.utilityCostAvoidedCents - m.solarPaidCents);
    expect(m.netSavingsCents).toBeLessThan(m.utilityCostAvoidedCents);
    // The identity that matters:
    //   net = utility billed − what the utility still bills afterwards − system.
    // "Afterwards" is grid power AND the standing meter fee, which is why the
    // second term is not just `residualGridCents`.
    const billed = m.years.reduce((n, y) => n + y.utilityCostCents, 0);
    const afterwards = m.years.reduce((n, y) => n + postSolarUtilityCents(y), 0);
    expect(m.netSavingsCents).toBe(billed - afterwards - m.solarPaidCents);
  });

  it("CASH: the whole price lands in year one and nothing after", () => {
    const purchase = pricePurchase({
      product: "cash", systemSizeKwDc: 8, stickerPpwCents: 350,
      dealerFeePct: 0, adderTotalCents: 0,
    });
    const m = savingsModel({ ...base, product: "cash", purchase });
    expect(m.years[0].solarPaymentCents).toBe(purchase.contractPriceCents);
    expect(m.years.slice(1).every((y) => y.solarPaymentCents === 0)).toBe(true);
    // Year one is therefore deeply negative, and that is the honest picture.
    expect(m.years[0].cumulativeSavingsCents).toBeLessThan(0);
    expect(m.paybackYear).toBeGreaterThan(1);
  });

  it("LOAN prices the same as cash for the customer's contract", () => {
    // The dealer fee is EMBEDDED in the sticker, not added on top of it: the
    // customer signs $2.80/W either way, and on the loan the lender takes 18%
    // of that out of what the company keeps.
    const loan = pricePurchase({
      product: "loan", systemSizeKwDc: 8, stickerPpwCents: 350,
      dealerFeePct: 18, adderTotalCents: 0,
    });
    expect(loan.contractPriceCents).toBe(8_000 * 350);
    expect(loan.dealerFeeCents).toBe(Math.round(8_000 * 350 * 0.18));
    expect(loan.grossPriceCents).toBe(loan.contractPriceCents - loan.dealerFeeCents);
    expect(loan.basePriceCents).toBe(loan.grossPriceCents);
    // Cash carries no fee at all.
    const cash = pricePurchase({
      product: "cash", systemSizeKwDc: 8, stickerPpwCents: 350,
      dealerFeePct: 18, adderTotalCents: 0,
    });
    expect(cash.dealerFeeCents).toBe(0);
  });

  it("final price per watt reflects adders, not just the sticker", () => {
    const p = pricePurchase({
      product: "cash", systemSizeKwDc: 8, stickerPpwCents: 350,
      dealerFeePct: 0, adderTotalCents: 1_450_000, // a $14,500 re-roof
    });
    expect(p.contractPriceCents).toBe(8_000 * 350 + 1_450_000);
    // $3.50/W sticker becomes $5.31/W once the re-roof is in the contract.
    expect(Math.round(p.finalPpwCents)).toBe(Math.round(p.contractPriceCents / 8_000));
    expect(p.finalPpwCents).toBeGreaterThan(350);
  });

  it("LEASE: payments run for the term and stop, and escalate", () => {
    const m = savingsModel({
      ...base, product: "lease", leaseMonthlyCents: 17_500,
      escalatorPct: 2.9, termYears: 20,
    });
    expect(m.years[0].solarPaymentCents).toBe(17_500 * 12);
    // Year 2 is one escalation up.
    expect(m.years[1].solarPaymentCents).toBe(Math.round(17_500 * 12 * 1.029));
    // Nothing is paid after the term ends.
    expect(m.years[20].solarPaymentCents).toBe(0);
    expect(m.years[24].solarPaymentCents).toBe(0);
    expect(m.netSavingsCents).toBe(m.utilityCostAvoidedCents - m.solarPaidCents);
  });

  it("PPA: the bill follows production, so degradation lowers it too", () => {
    const m = savingsModel({
      ...base, product: "ppa", ppaRateMills: 145,
      escalatorPct: 2.9, termYears: 25,
    });
    expect(m.years[0].solarPaymentCents).toBe(Math.round((8_282 * 145) / 10));
    // Production degrades 0.5%/yr while the rate escalates 2.9%/yr.
    const y2 = Math.round((8_282 * 0.995 * 145 * 1.029) / 10);
    expect(m.years[1].solarPaymentCents).toBe(y2);
    expect(m.netSavingsCents).toBe(m.utilityCostAvoidedCents - m.solarPaidCents);
  });

  it("a 0% escalator is honoured rather than treated as missing", () => {
    const m = savingsModel({
      ...base, product: "lease", leaseMonthlyCents: 17_500,
      escalatorPct: 0, termYears: 25,
    });
    const flat = m.years.slice(0, 25).map((y) => y.solarPaymentCents);
    expect(new Set(flat).size).toBe(1);
    expect(flat[0]).toBe(17_500 * 12);
  });

  it("production degrades every year after the first", () => {
    const m = savingsModel({ ...base, product: "cash" });
    expect(m.years[0].productionKwh).toBe(8_282);
    expect(m.years[1].productionKwh).toBe(Math.round(8_282 * 0.995));
    expect(m.years[24].productionKwh).toBeLessThan(m.years[0].productionKwh);
  });
});

describe("the snapshot never renders a number the customer cannot act on", () => {
  const build = (over: Record<string, unknown> = {}) =>
    buildProposalSnapshot({
      reference: "SP-TEST-V1",
      generatedById: "u1",
      customer: { name: "Test Customer", address: "1 Test Way" },
      company: { name: "Anexa Homes", phone: "(866) 650-9996", email: null, logoUrl: null, address: "1 Co Way" },
      design: {
        systemSizeKwDc: 8, year1ProductionKwh: 8_282, offsetPct: 59.16,
        annualUsageKwh: 14_000, moduleLabel: "Qcells · 400W", moduleQty: 20,
        inverterLabel: "Enphase", batteryLabel: null, mountType: "roof",
        utilityProvider: "ZZ TEST",
        avgMonthlyBillCents: 18_000,
      },
      finance: {
        product: "cash", grossPpwCents: 350, dealerFeePct: 0, adderTotalCents: 0,
        rateMillsPerKwh: null, monthlyPaymentCents: null, escalatorPct: null,
        termYears: null, aprPct: null,
      },
      lender: null,
      assumptions: A,
      now: new Date("2026-08-16T12:00:00Z"),
      ...over,
    });

  it("omits the adders row entirely when there are none", () => {
    // null, not 0 — the renderer drops the row rather than printing "Adders $0".
    expect(build().financing.adderTotalCents).toBeNull();
  });

  it("never quotes an incentive — no credit is offered at all", () => {
    expect(build().financing.itcEstimateCents).toBeNull();
    expect(build().financing.itcPct).toBeNull();
  });

  it("strips a stale APR from a lease even if one reached the builder", () => {
    // Belt and braces: the write path already gates this, and so does the
    // snapshot, because the renderer shows an APR whenever one is present.
    const s = build({
      finance: {
        product: "lease", stickerPpwCents: 0, dealerFeePct: 0, adderTotalCents: 0,
        rateMillsPerKwh: null, monthlyPaymentCents: 17_500, escalatorPct: 2.9,
        termYears: 25, aprPct: 6.99,
      },
      lender: "GoodLeap",
    });
    expect(s.financing.aprPct).toBeNull();
    expect(s.financing.lender).toBeNull();
    expect(s.financing.contractPriceCents).toBeNull();
    expect(s.financing.monthlyPaymentCents).toBe(17_500);
  });

  it("records the layout only when one was actually attached", () => {
    expect(build().layout).toBeNull();
    const withLayout = build({
      layout: { fileId: "file-1", provider: "Aurora", externalRef: "A-1", preliminary: true },
    });
    expect(withLayout.layout).toEqual({
      fileId: "file-1",
      provider: "Aurora",
      externalRef: "A-1",
      preliminary: true,
    });
  });

  it("stores the layout's file id, never a URL carrying the share token", () => {
    // A URL would have had to embed the public token, freezing it into the
    // snapshot and leaking it into every internal preview of that proposal.
    const s = build({
      layout: { fileId: "file-1", provider: null, externalRef: null, preliminary: true },
    });
    expect(JSON.stringify(s)).not.toMatch(/\/proposal\//);
    expect(s.layout).toHaveProperty("fileId");
    expect(s.layout).not.toHaveProperty("imageUrl");
  });

  it("carries the approved flag through, so a final design drops the caveat", () => {
    const prelim = build({
      layout: { fileId: "f", provider: null, externalRef: null, preliminary: true },
    });
    const final = build({
      layout: { fileId: "f", provider: null, externalRef: null, preliminary: false },
    });
    expect(prelim.layout!.preliminary).toBe(true);
    expect(final.layout!.preliminary).toBe(false);
  });

  it("carries the energy profile the savings were built from", () => {
    const s = build();
    expect(s.energy.annualUsageKwh).toBe(14_000);
    expect(s.energy.avgMonthlyBillCents).toBe(18_000);
    expect(s.assumptions.currentRateMillsPerKwh).toBe(154);
    expect(s.energy.currentAnnualCostCents).toBe(Math.round((14_000 * 154) / 10));
  });

  it("contains no NaN, Infinity or undefined anywhere", () => {
    const bad: string[] = [];
    const walk = (o: unknown, path: string) => {
      if (o === undefined) bad.push(`${path}=undefined`);
      else if (typeof o === "number" && !Number.isFinite(o)) bad.push(`${path}=${o}`);
      else if (o && typeof o === "object") {
        for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
      }
    };
    walk(build(), "snapshot");
    expect(bad).toEqual([]);
  });
});

describe("the snapshot stops carrying what nobody sets", () => {
  const design = {
    systemSizeKwDc: 8, year1ProductionKwh: 9_744, offsetPct: 69.6,
    annualUsageKwh: 14_000, moduleLabel: "Qcells · 400W", moduleQty: 20,
    inverterLabel: null, batteryLabel: null, mountType: "roof",
    utilityProvider: "ZZ TEST",
    avgMonthlyBillCents: 18_000,
  };

  const snap = () =>
    buildProposalSnapshot({
      reference: "SP-TEST-1",
      generatedById: null,
      customer: { name: "Test Customer", address: "1 Test Way" },
      company: { name: "Anexa Homes", phone: null, email: null, logoUrl: null, address: null },
      design,
      finance: {
        product: "cash", grossPpwCents: 350, dealerFeePct: 0, adderTotalCents: 0,
        rateMillsPerKwh: null, monthlyPaymentCents: null, escalatorPct: null,
        termYears: null, aprPct: null,
      },
      lender: null,
      assumptions: A,
      now: new Date("2026-08-18T00:00:00Z"),
    });

  it("nulls the rate plan, TSRF and the net-metering programme, so the proposal omits all three rows", () => {
    // The renderer guards every one of these on null, which is why a field the
    // form stopped collecting disappears from the document rather than printing
    // blank — and why a proposal already SENT still shows what it showed.
    //
    // The net-metering programme joined them when the company setting that fed
    // it was deleted. Nothing supplies one any more, so the snapshot cannot be
    // handed one: the field is not on the generation input at all.
    const s = snap();
    expect(s.energy.ratePlan).toBeNull();
    expect(s.system.tsrfPct).toBeNull();
    expect(s.system.netMeteringProgram).toBeNull();
  });
});

/**
 * The half of the utility bill that is not kilowatt-hours.
 *
 * The defect these pin: a system at or above full offset drove the residual
 * grid cost to zero, and the proposal printed "Utility bill afterwards: $0/mo"
 * beside a monthly payment. No utility bills that way — the meter carries a
 * standing charge whatever the roof produced that month — so the first real
 * bill after switch-on contradicted the document the customer kept.
 */
describe("the meter fee is billed whatever the roof produces", () => {
  // Deliberately OVER-produces: 150% of usage, so there is no grid top-up at
  // all and the fee is the only thing left in the bill.
  const overproducing = {
    product: "cash" as const,
    year1ProductionKwh: 21_000,
    annualUsageKwh: 14_000,
    currentRateMillsPerKwh: 154,
    assumptions: A,
  };

  it("a fully-offset system still owes the utility something", () => {
    const m = savingsModel(overproducing);
    expect(m.years[0].residualGridCents).toBe(0);
    expect(m.years[0].meterFeeCents).toBe(A.utilityMeterFeeCents * 12);
    // The number the proposal prints. $10 a month, never $0.
    expect(Math.round(postSolarUtilityCents(m.years[0]) / 12)).toBe(1_000);
  });

  it("the fee is inside what the solar path costs, so it cannot be forgotten", () => {
    const m = savingsModel(overproducing);
    // Year 1 carries the contract price; every later year carries the fee alone.
    expect(m.years[1].solarPaymentCents).toBe(0);
    expect(m.years[1].solarCostCents).toBe(m.years[1].meterFeeCents);
    expect(m.years[1].solarCostCents).toBeGreaterThan(0);
  });

  it("escalates with the utility's own rate rather than sitting flat for 25 years", () => {
    const m = savingsModel(overproducing);
    expect(m.years[1].meterFeeCents).toBe(
      Math.round(A.utilityMeterFeeCents * 12 * (1 + A.utilityEscalationPct / 100))
    );
    expect(m.years[24].meterFeeCents).toBeGreaterThan(m.years[0].meterFeeCents);
  });

  it("holds the projection on the conservative side, never the flattering one", () => {
    const withFee = savingsModel(overproducing);
    const without = savingsModel({
      ...overproducing,
      assumptions: { ...A, utilityMeterFeeCents: 0 },
    });
    // Same system, same rate, same everything else: quoting the fee can only
    // ever REDUCE what the document promises.
    expect(withFee.netSavingsCents).toBeLessThan(without.netSavingsCents);
    expect(withFee.utilityCostAvoidedCents).toBeLessThan(without.utilityCostAvoidedCents);
    // And it is not added to the pre-solar side, which is derived from the
    // customer's own bill and therefore already contained it. Counting it there
    // too would inflate the saving straight back out again.
    expect(withFee.years[0].utilityCostCents).toBe(without.years[0].utilityCostCents);
  });

  it("a company whose utility charges no standing fee is unchanged", () => {
    const m = savingsModel({ ...overproducing, assumptions: { ...A, utilityMeterFeeCents: 0 } });
    expect(m.years[0].meterFeeCents).toBe(0);
    expect(postSolarUtilityCents(m.years[0])).toBe(0);
  });

  it("a proposal generated before the fee existed keeps reporting its own numbers", () => {
    // No `meterFeeCents` key at all — which is exactly what a v4 snapshot in
    // the database looks like. It was priced without the fee and must not be
    // silently re-read with today's.
    const legacy = { residualGridCents: 60_430 } as Parameters<typeof postSolarUtilityCents>[0];
    expect(postSolarUtilityCents(legacy)).toBe(60_430);
  });
});
