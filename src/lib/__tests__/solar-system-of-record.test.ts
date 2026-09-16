import { describe, it, expect } from "vitest";
import {
  frozenPriceLadder,
  resolveReportedSystem,
  systemDrift,
  type DesignSystem,
} from "@/lib/solar-system-of-record";
import type { SnapshotFinancing, SolarProposalSnapshot } from "@/lib/solar-proposal";

/**
 * The deal that produced this module, copied out of production.
 *
 * Proposal v13 was signed on 2026-08-28 quoting a 25-panel, 11.00 kW system at
 * $60,500. Somebody reopened the builder on 2026-08-29 and left the design at
 * 24 panels, 10.56 kW, with the battery taken off and the annual usage moved
 * from 14,000 kWh to 12,667. Every figure on either side is internally
 * consistent — the defect was that the deal page reported BOTH of them, on the
 * same screen, without saying which was which.
 */
const SNAPSHOT = {
  schemaVersion: 6,
  system: {
    sizeKwDc: 11,
    year1ProductionKwh: 15397,
    offsetPct: 109.9785714285714,
    moduleLabel: "Silfab SIL440-QD-DCA2",
    moduleQty: 25,
    inverterLabel: "Tesla 1538000-xx-y",
    batteryLabel: "Tesla 1707000-21-y",
    mountType: "roof",
    module: { manufacturer: "Silfab", model: "SIL440-QD-DCA2", qty: 25, ratingW: 440 },
    inverter: { manufacturer: "Tesla", model: "1538000-xx-y", qty: 1, ratingW: null },
    battery: { manufacturer: "Tesla", model: "1707000-21-y", qty: 2, ratingW: null },
  },
  energy: { annualUsageKwh: 14000 },
  financing: {
    product: "loan",
    finalPriceCents: 6050000,
    leasePaymentCents: null,
    rateMillsPerKwh: null,
  },
} as unknown as SolarProposalSnapshot;

const DESIGN: DesignSystem = {
  sizeKwDc: 10.56,
  moduleQty: 24,
  moduleRatingW: 440,
  year1ProductionKwh: 12219,
  offsetPct: 96.4632509670798,
  annualUsageKwh: 12667,
  moduleLabel: "Silfab SIL440-QD-DCA2",
  inverterLabel: "Tesla 1538000-xx-y",
  batteryLabel: null,
  batteryQty: 0,
  product: "loan",
  contractPriceCents: 5808000,
  netAfterCreditsCents: null,
  monthlyPaymentCents: null,
  rateMillsPerKwh: null,
};

const PROPOSAL = { version: 13, status: "signed", at: "2026-08-28T00:58:15.043Z", approved: true };

describe("resolveReportedSystem", () => {
  it("reports the newest proposal, not the design that moved under it", () => {
    const got = resolveReportedSystem({ proposal: { ...PROPOSAL, snapshot: SNAPSHOT }, design: DESIGN });
    expect(got).not.toBeNull();
    expect(got!.source).toEqual({
      kind: "proposal",
      version: 13,
      status: "signed",
      at: PROPOSAL.at,
      approved: true,
    });
    expect(got!.sizeKwDc).toBe(11);
    expect(got!.moduleQty).toBe(25);
    expect(got!.year1ProductionKwh).toBe(15397);
    expect(Math.round(got!.offsetPct)).toBe(110);
    expect(got!.annualUsageKwh).toBe(14000);
    expect(got!.contractPriceCents).toBe(6050000);
    // The battery the customer signed for, not the one a later edit removed.
    expect(got!.batteryLabel).toBe("Tesla 1707000-21-y");
    expect(got!.batteryQty).toBe(2);
  });

  it("falls back to the design while no proposal exists", () => {
    const got = resolveReportedSystem({ proposal: null, design: DESIGN });
    expect(got!.source).toEqual({ kind: "design" });
    expect(got!.sizeKwDc).toBe(10.56);
    expect(got!.moduleQty).toBe(24);
    expect(got!.contractPriceCents).toBe(5808000);
  });

  it("is null when there is neither", () => {
    expect(resolveReportedSystem({ proposal: null, design: null })).toBeNull();
  });

  it("reports a proposal even when the design row was never written", () => {
    const got = resolveReportedSystem({ proposal: { ...PROPOSAL, snapshot: SNAPSHOT }, design: null });
    expect(got!.sizeKwDc).toBe(11);
  });

  it("reads a v1 snapshot, which carries labels and no equipment rows", () => {
    const v1 = {
      schemaVersion: 1,
      system: {
        sizeKwDc: 8.8,
        year1ProductionKwh: 12000,
        offsetPct: 100,
        moduleLabel: "Q CELLS Q.PEAK",
        moduleQty: 20,
        inverterLabel: "Enphase IQ8",
        batteryLabel: null,
        mountType: "roof",
        module: null,
        inverter: null,
        battery: null,
      },
      financing: { product: "cash", finalPriceCents: 3080000 },
    } as unknown as SolarProposalSnapshot;
    const got = resolveReportedSystem({ proposal: { ...PROPOSAL, snapshot: v1 }, design: DESIGN });
    expect(got!.moduleLabel).toBe("Q CELLS Q.PEAK");
    expect(got!.moduleQty).toBe(20);
    expect(got!.moduleRatingW).toBeNull();
    expect(got!.batteryQty).toBe(0);
    // `energy` arrived with schemaVersion 2; an older document simply has none.
    expect(got!.annualUsageKwh).toBeNull();
  });
});

describe("systemDrift", () => {
  it("names every figure that moved since the signed proposal", () => {
    const reported = resolveReportedSystem({
      proposal: { ...PROPOSAL, snapshot: SNAPSHOT },
      design: DESIGN,
    })!;
    const rows = systemDrift(reported, DESIGN);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));

    expect(Object.keys(by).sort()).toEqual(
      ["batteryQty", "contractPrice", "moduleQty", "offsetPct", "sizeKwDc", "year1ProductionKwh"].sort()
    );
    expect(by.sizeKwDc).toMatchObject({ proposed: 11, working: 10.56, unit: "kw" });
    expect(by.moduleQty).toMatchObject({ proposed: 25, working: 24, unit: "count" });
    expect(by.year1ProductionKwh).toMatchObject({ proposed: 15397, working: 12219, unit: "kwh" });
    expect(by.contractPrice).toMatchObject({ proposed: 6050000, working: 5808000, unit: "cents" });
  });

  /**
   * The second price moves for a reason the first one does not.
   *
   * The credits a deal claims are tick-boxes on the finance row, so a rep who
   * unticks the domestic-content bonus a week after the signature changes what
   * the deal says the household nets without touching the drawing or the price.
   * The tile reports the ladder the document was signed against and the card's
   * own breakdown re-derives a live one; unreported, that is two "after
   * credits" figures on one screen with nothing saying why.
   */
  it("names the after-credits figure when the credits claimed have moved", () => {
    const withLadder = {
      ...SNAPSHOT,
      financing: { ...(SNAPSHOT.financing as object), creditLadder: { netCostCents: 2722500 } },
    } as unknown as SolarProposalSnapshot;
    const design: DesignSystem = {
      ...DESIGN,
      // The drawing is untouched — only the tick-boxes moved.
      sizeKwDc: 11,
      moduleQty: 25,
      year1ProductionKwh: 15397,
      offsetPct: 109.9785714285714,
      batteryLabel: "Tesla 1707000-21-y",
      batteryQty: 2,
      contractPriceCents: 6050000,
      netAfterCreditsCents: 3327500,
    };
    const reported = resolveReportedSystem({
      proposal: { ...PROPOSAL, snapshot: withLadder },
      design,
    })!;
    expect(reported.netAfterCreditsCents).toBe(2722500);

    const rows = systemDrift(reported, design);
    expect(rows.map((r) => r.key)).toEqual(["netAfterCredits"]);
    expect(rows[0]).toMatchObject({
      label: "After credits",
      unit: "cents",
      proposed: 2722500,
      working: 3327500,
    });
  });

  it("says nothing about a net the document never carried", () => {
    // v6 and earlier froze no ladder. "The document does not say" is not the
    // same claim as "nothing was claimed", and neither is a change.
    const reported = resolveReportedSystem({
      proposal: { ...PROPOSAL, snapshot: SNAPSHOT },
      design: { ...DESIGN, netAfterCreditsCents: 3327500 },
    })!;
    expect(reported.netAfterCreditsCents).toBeNull();
    expect(
      systemDrift(reported, { ...DESIGN, netAfterCreditsCents: 3327500 }).map((r) => r.key)
    ).not.toContain("netAfterCredits");
  });

  it("says nothing when the design still matches the proposal", () => {
    const proposal = { ...PROPOSAL, snapshot: SNAPSHOT };
    const matching: DesignSystem = {
      ...DESIGN,
      sizeKwDc: 11,
      moduleQty: 25,
      year1ProductionKwh: 15397,
      offsetPct: 109.9785714285714,
      batteryLabel: "Tesla 1707000-21-y",
      batteryQty: 2,
      contractPriceCents: 6050000,
    };
    const reported = resolveReportedSystem({ proposal, design: matching })!;
    expect(systemDrift(reported, matching)).toEqual([]);
  });

  it("does not call a sub-percent rounding difference a change", () => {
    const proposal = { ...PROPOSAL, snapshot: SNAPSHOT };
    const wobbled: DesignSystem = {
      ...DESIGN,
      sizeKwDc: 11.001,
      moduleQty: 25,
      year1ProductionKwh: 15397,
      // 109.98 and 110.02 both print as 110%, so they are the same figure.
      offsetPct: 110.02,
      batteryLabel: "Tesla 1707000-21-y",
      batteryQty: 2,
      contractPriceCents: 6050000,
    };
    const reported = resolveReportedSystem({ proposal, design: wobbled })!;
    expect(systemDrift(reported, wobbled)).toEqual([]);
  });

  it("has nothing to compare against when the design IS what is reported", () => {
    const reported = resolveReportedSystem({ proposal: null, design: DESIGN })!;
    expect(systemDrift(reported, DESIGN)).toEqual([]);
  });

  it("ignores a price that is not a contract price on either side", () => {
    const lease = {
      ...SNAPSHOT,
      financing: {
        product: "lease",
        finalPriceCents: null,
        leasePaymentCents: 21500,
        rateMillsPerKwh: null,
      },
    } as unknown as SolarProposalSnapshot;
    const reported = resolveReportedSystem({
      proposal: { ...PROPOSAL, snapshot: lease },
      design: { ...DESIGN, product: "lease", contractPriceCents: null, monthlyPaymentCents: 21500 },
    })!;
    const keys = systemDrift(reported, {
      ...DESIGN,
      product: "lease",
      contractPriceCents: null,
      monthlyPaymentCents: 21500,
    }).map((r) => r.key);
    expect(keys).not.toContain("contractPrice");
  });
});

/**
 * The ladder off a real document.
 *
 * A 11.00 kW loan deal at $60,500, two Powerwalls at $19,000 and $6,900 of
 * extra work — the shape every purchase snapshot has, with the dealer fee
 * already inside the base and the adders. The whole point of the block is that
 * these four figures subtract to each other on screen, so that is what is
 * asserted rather than each rung on its own.
 */
const LADDER_FINANCING = {
  product: "loan",
  finalPriceCents: 6050000,
  baseFinalCents: 3460000,
  addersFinalCents: 690000,
  equipmentFinalCents: 1900000,
  batteryQty: 2,
  finalPpwCents: 550,
  leasePaymentCents: null,
  rateMillsPerKwh: null,
} as unknown as SnapshotFinancing;

describe("frozenPriceLadder", () => {
  it("reads the document's own rungs, and they add up to its total", () => {
    const l = frozenPriceLadder(LADDER_FINANCING, 11)!;
    expect(l.source).toBe("proposal");
    expect(l.base.totalCents + l.adders.totalCents + l.batteryPriceCents).toBe(
      l.final.totalCents
    );
    expect(l.final.totalCents).toBe(6050000);
    expect(l.batteryQty).toBe(2);
  });

  it("divides each rung into the array it was sold with", () => {
    const l = frozenPriceLadder(LADDER_FINANCING, 11)!;
    // 11 kW = 11,000 W. $34,600 / 11,000 = $3.15/W, $6,900 / 11,000 = $0.63/W.
    expect(l.base.ppwCents).toBe(315);
    expect(l.adders.ppwCents).toBe(63);
    // The document's own rate, not the contract re-divided — they agree here,
    // and where they do not it is the frozen one that was quoted.
    expect(l.final.ppwCents).toBe(550);
    expect(l.systemWatts).toBe(11000);
  });

  it("quotes no rate per watt on a storage job, which has no watts", () => {
    const l = frozenPriceLadder(
      { ...LADDER_FINANCING, baseFinalCents: 1900000, addersFinalCents: null,
        equipmentFinalCents: 1900000, finalPriceCents: 1900000, finalPpwCents: null
      } as unknown as SnapshotFinancing,
      0
    )!;
    expect(l.base.ppwCents).toBeNull();
    expect(l.final.ppwCents).toBeNull();
    expect(l.final.totalCents).toBe(1900000);
  });

  it("falls back to the total less what is priced separately, for an old document", () => {
    // Generated before the base was frozen: the customer's own cost chapter
    // reads it the same way, so this card cannot disagree with the sheet.
    const old = { ...LADDER_FINANCING, baseFinalCents: null } as unknown as SnapshotFinancing;
    const l = frozenPriceLadder(old, 11)!;
    expect(l.base.totalCents).toBe(6050000 - 690000 - 1900000);
  });

  it("has no ladder for a lease, which is sold as a monthly", () => {
    const lease = {
      product: "lease",
      finalPriceCents: null,
      leasePaymentCents: 21500,
    } as unknown as SnapshotFinancing;
    expect(frozenPriceLadder(lease, 11)).toBeNull();
  });
});
