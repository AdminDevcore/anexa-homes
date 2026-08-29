import { describe, it, expect } from "vitest";
import type { FinanceProduct } from "@prisma/client";
import {
  buybackLine,
  hasProviderTerms,
  providerTermsLine,
  vppEligibility,
  vppLine,
  vppRequirementsLine,
  vppVerdictLine,
  type ProviderTerms,
  type VppDealFacts,
} from "@/lib/solar-provider-terms";

/** Keeps a literal list of ways to pay typed as the enum, not as strings. */
const ways = (...p: FinanceProduct[]) => p;

const blank: ProviderTerms = {
  buyback: false,
  buybackRateMills: null,
  touPeakRateMills: null,
  touOffPeakRateMills: null,
  touPeakWindow: null,
  vpp: false,
  vppProgramme: null,
  vppUpfrontCents: null,
  vppAnnualCents: null,
  notes: null,
  vppFinanceProducts: ways(),
  vppBatteries: [],
  vppProducts: [],
};

describe("what a provider does for a solar customer, as one line", () => {
  it("prints a buyback rate to the mill", () => {
    // Export credits are quoted in tenths of a cent — $0.095, not $0.10 — and a
    // rate rounded to the cent is a different offer.
    expect(buybackLine({ ...blank, buyback: true, buybackRateMills: 95 })).toBe(
      "Buyback $0.095/kWh"
    );
  });

  it("says a provider buys back even when nobody recorded a rate", () => {
    // A real and common answer: they buy back at a figure that moves with the
    // market. Waiting for a number that may never exist would hide the fact.
    expect(buybackLine({ ...blank, buyback: true })).toBe("Buys back exported power");
    expect(buybackLine({ ...blank, buyback: true, buybackRateMills: 0 })).toBe(
      "Buys back exported power"
    );
  });

  it("says nothing at all when they do not buy back", () => {
    expect(buybackLine(blank)).toBeNull();
    // Including when a rate is stranded on the row from before somebody
    // un-ticked it — the flag is what was answered, the rate is only detail.
    expect(buybackLine({ ...blank, buybackRateMills: 95 })).toBeNull();
  });

  it("leads a battery programme with its own name", () => {
    // The customer signs up to "Renew Home", and that is what appears on their
    // statement. A rep saying "your retailer pays you" has created a question
    // they cannot answer.
    expect(
      vppLine({
        ...blank,
        vpp: true,
        vppProgramme: "Renew Home",
        vppUpfrontCents: 50_000,
        vppAnnualCents: 12_000,
      })
    ).toBe("VPP · Renew Home — $500 upfront + $120/yr");
  });

  it("still reports a programme with no name and no money on it", () => {
    expect(vppLine({ ...blank, vpp: true })).toBe("Battery programme");
    expect(vppLine({ ...blank, vpp: true, vppUpfrontCents: 50_000 })).toBe(
      "Battery programme — $500 upfront"
    );
  });

  it("joins both halves for the summary beside a name", () => {
    expect(
      providerTermsLine({
        ...blank,
        buyback: true,
        buybackRateMills: 95,
        vpp: true,
        vppProgramme: "Renew Home",
        vppAnnualCents: 12_000,
      })
    ).toBe("Buyback $0.095/kWh · VPP · Renew Home — $120/yr");
  });

  it("tells 'nothing recorded' apart from 'they do neither'", () => {
    // THE DISTINCTION THE WHOLE FEATURE TURNS ON. Both render an empty summary,
    // and only one of them means the answer is no — so the callers ask this
    // before deciding which sentence to print. Silence read as "no" is how a
    // rep quotes a buyback nobody ever confirmed, or misses one that exists.
    expect(hasProviderTerms(blank)).toBe(false);
    expect(providerTermsLine(blank)).toBe("");

    const checkedAndNegative = { ...blank, notes: "Called March 2026 — they do not buy back." };
    expect(hasProviderTerms(checkedAndNegative)).toBe(true);
    expect(providerTermsLine(checkedAndNegative)).toBe("");
  });
});

// ── Who the programme is open to ───────────────────────────────────────────

const PW3 = { id: "pw3", label: "Tesla Powerwall 3" };
const IQ5P = { id: "iq5p", label: "Enphase IQ Battery 5P" };
const GL25 = { id: "gl25", label: "GoodLeap 25 yr · 4.99%" };

/** A programme that pays, before anybody records a condition on it. */
const openToAll: ProviderTerms = { ...blank, vpp: true, vppProgramme: "Renew Home" };

const nothingPicked: VppDealFacts = {
  batteryId: null,
  batteryLabel: null,
  financeProduct: null,
  financeProductId: null,
  financeProductLabel: null,
};

describe("what a VPP programme requires", () => {
  it("says nothing when nobody has recorded a condition", () => {
    // The state of every provider row the day this shipped. A requirement line
    // on a programme with no requirements is noise a rep learns to skip.
    expect(vppRequirementsLine(openToAll)).toBeNull();
  });

  it("says nothing on a provider that runs no programme", () => {
    // Conditions stranded on a provider somebody has since said runs no VPP are
    // the same class of bug as an APR left on a lease.
    expect(vppRequirementsLine({ ...blank, vppBatteries: [PW3] })).toBeNull();
  });

  it("reads the finance types the way a rep would say them", () => {
    expect(
      vppRequirementsLine({ ...openToAll, vppFinanceProducts: ways("cash", "loan") })
    ).toBe("Needs Cash or Loan");
    expect(vppRequirementsLine({ ...openToAll, vppFinanceProducts: ways("loan") })).toBe(
      "Needs Loan"
    );
  });

  it("keeps the count when a list is too long to print", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ id: `b${i}`, label: `Battery ${i}` }));
    // "+4 more" sends a rep to the settings screen. A list silently cut at three
    // reads as a list that ended at three.
    expect(vppRequirementsLine({ ...openToAll, vppBatteries: many })).toBe(
      "Battery 0, Battery 1, Battery 2 +4 more"
    );
  });
});

describe("whether a deal clears the programme", () => {
  it("gives no verdict on a programme with no conditions", () => {
    expect(vppEligibility(openToAll, nothingPicked)).toEqual({ state: "unrestricted" });
    expect(vppVerdictLine({ state: "unrestricted" })).toBeNull();
  });

  it("does not fail a deal for a battery nobody has picked yet", () => {
    // The Energy step comes BEFORE the design step. Telling a rep their customer
    // does not qualify for a programme they have not designed for yet is how the
    // line stops being read.
    const t = { ...openToAll, vppBatteries: [PW3] };
    expect(vppEligibility(t, nothingPicked)).toEqual({
      state: "unknown",
      reasons: ["no battery on this design yet"],
    });
  });

  it("names the battery that is not on the list", () => {
    const t = { ...openToAll, vppBatteries: [PW3, IQ5P] };
    const v = vppEligibility(t, {
      ...nothingPicked,
      batteryId: "pw2",
      batteryLabel: "Tesla Powerwall 2",
    });
    expect(v).toEqual({
      state: "ineligible",
      reasons: ["Tesla Powerwall 2 is not on the programme"],
    });
    expect(vppVerdictLine(v)).toBe("Not eligible — Tesla Powerwall 2 is not on the programme.");
  });

  it("fails outright rather than waiting for the facts it is still missing", () => {
    // A design holding the wrong battery is wrong now. Waiting for financing
    // before saying so leaves it on the deal for another two steps.
    const t = { ...openToAll, vppBatteries: [PW3], vppFinanceProducts: ways("loan") };
    expect(
      vppEligibility(t, { ...nothingPicked, batteryId: "pw2", batteryLabel: "Powerwall 2" })
    ).toEqual({ state: "ineligible", reasons: ["Powerwall 2 is not on the programme"] });
  });

  it("rules out a way of paying the programme does not take", () => {
    const t = { ...openToAll, vppFinanceProducts: ways("cash", "loan") };
    expect(vppEligibility(t, { ...nothingPicked, financeProduct: "lease" })).toEqual({
      state: "ineligible",
      reasons: ["lease does not qualify"],
    });
    expect(vppEligibility(t, { ...nothingPicked, financeProduct: "loan" })).toEqual({
      state: "eligible",
    });
  });

  it("lets a cash deal past a list of named loan products", () => {
    // THE REASON THE TYPE LIST EXISTS AT ALL. Cash has no lender row, so a list
    // of rate-sheet products can never contain it — and judging cash against
    // that list would rule out the answer these programmes most often give.
    const t = { ...openToAll, vppFinanceProducts: ways("cash", "loan"), vppProducts: [GL25] };
    expect(vppEligibility(t, { ...nothingPicked, financeProduct: "cash" })).toEqual({
      state: "eligible",
    });
  });

  it("narrows within an allowed type when specific products are listed", () => {
    // The whole case: this lender's 25-year paper is in the programme and their
    // other rows are not, so "loans qualify" on its own is not the answer.
    const t = { ...openToAll, vppFinanceProducts: ways("loan"), vppProducts: [GL25] };
    expect(
      vppEligibility(t, {
        ...nothingPicked,
        financeProduct: "loan",
        financeProductId: "gl25",
        financeProductLabel: "GoodLeap 25 yr · 4.99%",
      })
    ).toEqual({ state: "eligible" });
    expect(
      vppEligibility(t, {
        ...nothingPicked,
        financeProduct: "loan",
        financeProductId: "gl10",
        financeProductLabel: "GoodLeap 10 yr · 2.99%",
      })
    ).toEqual({
      state: "ineligible",
      reasons: ["GoodLeap 10 yr · 2.99% is not on the programme"],
    });
  });

  it("does not pass hand-entered terms off as a listed product", () => {
    // A loan quoted without picking a rate-sheet row is exactly the deal nobody
    // has checked against the programme's paper.
    const t = { ...openToAll, vppProducts: [GL25] };
    expect(vppEligibility(t, { ...nothingPicked, financeProduct: "loan" })).toEqual({
      state: "ineligible",
      reasons: ["hand-entered terms are not on the programme's list"],
    });
  });

  it("clears a deal that meets every axis", () => {
    const t = {
      ...openToAll,
      vppFinanceProducts: ways("loan"),
      vppProducts: [GL25],
      vppBatteries: [PW3],
    };
    expect(
      vppEligibility(t, {
        batteryId: "pw3",
        batteryLabel: "Tesla Powerwall 3",
        financeProduct: "loan",
        financeProductId: "gl25",
        financeProductLabel: "GoodLeap 25 yr · 4.99%",
      })
    ).toEqual({ state: "eligible" });
  });
});
