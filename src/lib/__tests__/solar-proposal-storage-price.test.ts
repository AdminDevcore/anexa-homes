import { describe, it, expect } from "vitest";
import { buildProposalSnapshot } from "@/lib/solar-proposal";
import { proposalAlternatives, type CatalogueProgramme } from "@/lib/solar-proposal-options";
import type { SolarAssumptions } from "@/lib/solar-money";

/**
 * A battery deal has to be priced by the battery.
 *
 * THE DEFECT THIS PINS: a storage-only job has no array, so `systemSizeKwDc` is
 * zero and `grossPpwCents` is zero with it — the two numbers the per-watt ladder
 * multiplies together. The deal screen already knew the unit was a battery and
 * quoted $18,000; the customer's own document ran the same deal through the
 * per-watt ladder and printed "System price $0", with every option on the
 * payment menu agreeing with it.
 */

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
};

/** Two Powerwalls, no panels — exactly what a storage-only deal looks like. */
const DESIGN = {
  systemSizeKwDc: 0,
  year1ProductionKwh: 0,
  offsetPct: 0,
  annualUsageKwh: 14_000,
  moduleLabel: null,
  moduleQty: 0,
  inverterLabel: null,
  batteryLabel: "Tesla Powerwall 3",
  mountType: "roof",
  utilityProvider: "Oncor",
  avgMonthlyBillCents: 21_000,
};

const STORAGE = {
  batteryLabel: "Tesla Powerwall 3",
  batteryQty: 2,
  usableKwh: 27,
  backup: [{ name: "Essentials", loadWatts: 750, hours: 36 }],
  tou: null,
  rebates: [],
};

const build = (over: Partial<Parameters<typeof buildProposalSnapshot>[0]> = {}) =>
  buildProposalSnapshot({
    reference: "SP-TEST-V1",
    generatedById: "user-1",
    customer: { name: "Priya Raman", address: "902 Solaris Way, Dallas TX" },
    company: { name: "Anexa Homes", phone: "(866) 650-9996", email: null, logoUrl: null },
    design: DESIGN,
    finance: {
      product: "cash" as const,
      grossPpwCents: 0,
      stickerPricePerBatteryCents: 900_000,
      dealerFeePct: 0,
      adderTotalCents: 0,
      rateMillsPerKwh: null,
      monthlyPaymentCents: null,
      escalatorPct: null,
      termYears: null,
      aprPct: null,
    },
    lender: null,
    assumptions: A,
    systemType: "storage" as const,
    storage: STORAGE,
    now: new Date("2026-08-29T12:00:00Z"),
    ...over,
  });

describe("a storage proposal is priced by the battery", () => {
  it("quotes the batteries rather than zero installed watts", () => {
    const f = build().financing;
    expect(f.contractPriceCents).toBe(1_800_000);
    expect(f.basePriceCents).toBe(1_800_000);
  });

  it("prints no price per watt, on a job that has no watts", () => {
    const f = build().financing;
    expect(f.grossPpwCents).toBeNull();
    expect(f.finalPpwCents).toBeNull();
  });

  it("carries the lender's fee on a financed battery, as it does on an array", () => {
    // $9,000 a battery at a 20% programme leaves the company $7,200 of each.
    const f = build({
      finance: {
        product: "loan",
        grossPpwCents: 0,
        stickerPricePerBatteryCents: 900_000,
        dealerFeePct: 20,
        adderTotalCents: 0,
        rateMillsPerKwh: null,
        monthlyPaymentCents: null,
        escalatorPct: null,
        termYears: null,
        aprPct: 6.99,
      },
    }).financing;
    expect(f.contractPriceCents).toBe(1_800_000);
  });

  it("takes the rebate off the contract once, not twice", () => {
    // The renderer prints the rebate as its own line beneath the system price,
    // so the contract has to be the figure AFTER it — a document that showed a
    // net contract and then subtracted the rebate again under it is short of
    // its own bottom line by the rebate.
    const f = build({
      storage: { ...STORAGE, rebates: [{ name: "TXU storage", qty: 2, amountCents: 50_000, totalCents: 100_000 }] },
    }).financing;
    expect(f.basePriceCents).toBe(1_800_000);
    expect(f.contractPriceCents).toBe(1_700_000);
  });

  it("prices the extra work on top of the batteries", () => {
    const f = build({
      finance: {
        product: "cash",
        grossPpwCents: 0,
        stickerPricePerBatteryCents: 900_000,
        dealerFeePct: 0,
        adderTotalCents: 250_000,
        adders: [{ label: "Panel upgrade", amountCents: 250_000 }],
        rateMillsPerKwh: null,
        monthlyPaymentCents: null,
        escalatorPct: null,
        termYears: null,
        aprPct: null,
      },
    }).financing;
    expect(f.adderTotalCents).toBe(250_000);
    expect(f.contractPriceCents).toBe(2_050_000);
  });
});

const PROGRAMME = (over: Partial<CatalogueProgramme> = {}): CatalogueProgramme => ({
  id: "p1",
  product: "loan",
  name: "Storage 25 Y",
  aprPct: 6.99,
  termMonths: 300,
  dealerFeePct: 20,
  leaseRateCentsPerKwMonth: null,
  rateMillsPerKwh: null,
  escalatorPct: null,
  termYears: null,
  factorWithPaydownMicros: null,
  factorWithoutPaydownMicros: null,
  paydownPct: null,
  paydownMonths: null,
  rank: 0,
  financesStorageOnly: true,
  lender: {
    id: "l1",
    name: "Climate First",
    rank: 0,
    applyUrl: null,
    logoUrl: null,
    maxFinalPpwCents: null,
    finalPpwMode: "cap",
    maxFinalPricePerBatteryCents: null,
    finalBatteryPriceMode: "cap",
  },
  ...over,
});

const alts = (programmes: CatalogueProgramme[]) =>
  proposalAlternatives({
    quoted: { product: "cash", lenderProductId: null, lenderId: null, grossPpwCents: 0, dealerFeePct: 0 },
    programmes,
    approvedLenderIds: null,
    design: { systemSizeKwDc: 0 },
    systemType: "storage",
    storage: { batteryQty: 2, stickerPricePerBatteryCents: 900_000 },
    adders: [],
    adderTotalCents: 0,
    onTopAdderTotalCents: 0,
    assumptions: A,
    targetNetPpwCents: null,
  });

describe("the payment menu on a storage deal", () => {
  it("re-grosses the deal's own base by each programme's fee", () => {
    const [alt] = alts([PROGRAMME()]);
    // $9,000 cash base ÷ (1 − 20%) = $11,250 a battery.
    expect(alt.finance.stickerPricePerBatteryCents).toBe(1_125_000);
  });

  it("holds a programme to what its partner will fund a battery for", () => {
    const [alt] = alts([
      PROGRAMME({
        lender: { ...PROGRAMME().lender, maxFinalPricePerBatteryCents: 1_000_000 },
      }),
    ]);
    expect(alt.finance.stickerPricePerBatteryCents).toBe(1_000_000);
  });

  it("offers no programme that will not fund a job with no array", () => {
    expect(alts([PROGRAMME({ financesStorageOnly: false })])).toHaveLength(0);
  });
});
