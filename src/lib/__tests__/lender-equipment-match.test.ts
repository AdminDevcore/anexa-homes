import { describe, expect, it } from "vitest";
import { normalise, sameBrand, suggestPartnerItem } from "../lender-equipment-match";

/**
 * Real strings, from both real catalogues.
 *
 * Every fixture below is a line that exists — ours out of the production
 * `solar_equipment` table, theirs out of Amos's live `/api/v1/partner/catalog`.
 * The mismatch this heuristic exists for is not hypothetical: on the day it was
 * written, 77 of our 99 sellable items had no exact match on their list.
 */
const THEIRS = [
  { kind: "panel" as const, brand: "Qcells", model: "Q.PEAK DUO BLK ML G10.C+" },
  { kind: "panel" as const, brand: "Qcells", model: "Q.PEAK DUO BLK ML G10.D+" },
  { kind: "panel" as const, brand: "Qcells", model: "Q.PEAK DUO BLK ML-G10+" },
  { kind: "panel" as const, brand: "Silfab", model: "PRIME DCA2 (SIL440QD-DCA2)" },
  { kind: "panel" as const, brand: "Silfab", model: "PRIME DCB4 (SIL440QD-DCB4)" },
  { kind: "panel" as const, brand: "Silfab", model: "Elite SIL-380 BK" },
  { kind: "panel" as const, brand: "REC", model: "Alpha Pure RX DomCon (RECxxxAA Pure-RX-DC)" },
  { kind: "panel" as const, brand: "REC", model: "Alpha Pure-R 430" },
  { kind: "inverter" as const, brand: "SolarEdge", model: "Nexis Inverter UNX13000T-00UCY" },
  { kind: "inverter" as const, brand: "SolarEdge", model: "HD-Wave SE7600H-US" },
  { kind: "inverter" as const, brand: "SolarEdge", model: "SE7600H-USMNUBL15" },
  { kind: "inverter" as const, brand: "SolarEdge", model: "SE7600H-USMNUBL75" },
  { kind: "inverter" as const, brand: "Tesla", model: "PV Standalone Inverter (1538000-xx-y)" },
  { kind: "inverter" as const, brand: "Tesla", model: "Powerwall 3 (Integrated Inverter)" },
  { kind: "battery" as const, brand: "Tesla", model: "Powerwall 3" },
  { kind: "battery" as const, brand: "Tesla", model: "Powerwall 3 Expansion Pack" },
];

const ours = (kind: "panel" | "inverter" | "battery", manufacturer: string, model: string) => ({
  kind,
  manufacturer,
  model,
});

describe("normalise", () => {
  it("erases exactly the punctuation the two catalogues disagree about", () => {
    expect(normalise("SIL440-QD-DCA2")).toBe(normalise("SIL440QD-DCA2"));
    expect(normalise("Q.PEAK DUO BLK ML-G10.C+")).toBe(normalise("Q.PEAK DUO BLK ML G10.C+"));
  });

  it("keeps the wattage, which is the difference that matters", () => {
    expect(normalise("Q.TRON BLK M-G2.C+ 425")).not.toBe(normalise("Q.TRON BLK M-G2.C+ 430"));
  });
});

describe("sameBrand", () => {
  it("reads a spelling difference as the same brand", () => {
    expect(sameBrand("Q CELLS", "Qcells")).toBe(true);
    expect(sameBrand("REC", "REC Group")).toBe(true);
  });

  it("does not collapse two different brands", () => {
    expect(sameBrand("Silfab", "Sirius")).toBe(false);
  });
});

describe("suggestPartnerItem", () => {
  it("finds their product family under our SKU-with-a-wattage", () => {
    const hit = suggestPartnerItem(ours("panel", "Qcells", "Q.PEAK DUO BLK ML-G10.C+ 405"), THEIRS);
    expect(hit?.model).toBe("Q.PEAK DUO BLK ML G10.C+");
  });

  it("prefers the longer of two names that both fit", () => {
    // "…ML-G10+" also fits "…ML-G10.D+ 415", and is the wrong answer.
    const hit = suggestPartnerItem(ours("panel", "Qcells", "Q.PEAK DUO BLK ML-G10.D+ 415"), THEIRS);
    expect(hit?.model).toBe("Q.PEAK DUO BLK ML G10.D+");
  });

  it("sees through a marketing prefix and the part number in their parentheses", () => {
    const hit = suggestPartnerItem(ours("panel", "Silfab", "SIL440-QD-DCA2"), THEIRS);
    expect(hit?.model).toBe("PRIME DCA2 (SIL440QD-DCA2)");
  });

  it("reads their xxx as the wildcard it is", () => {
    // One entry of theirs covers our REC450AA, REC460AA and REC470AA.
    for (const model of ["REC450AA PURE-RX-DC", "REC460AA PURE-RX-DC", "REC470AA PURE-RX-DC"]) {
      const hit = suggestPartnerItem(ours("panel", "REC Group", model), THEIRS);
      expect(hit?.model).toBe("Alpha Pure RX DomCon (RECxxxAA Pure-RX-DC)");
    }
  });

  it("matches a model code sitting at the end of their display name", () => {
    const hit = suggestPartnerItem(ours("inverter", "SolarEdge", "UNX13000T-00UCY-xx"), THEIRS);
    expect(hit?.model).toBe("Nexis Inverter UNX13000T-00UCY");
  });

  /**
   * THE ONE THAT MUST STAY SILENT. Tesla's `1707000-21-y` is a Powerwall 3 part
   * number and their list carries two Powerwall 3 entries — the unit and its
   * expansion pack. Which one a deal means is a question about the deal, and
   * answering it here would put the wrong battery on a credit application.
   */
  it("returns nothing when their list has no name ours points at", () => {
    expect(suggestPartnerItem(ours("battery", "Tesla", "1707000-21-y"), THEIRS)).toBeNull();
  });

  /**
   * Regression, from the live catalogues: our SIL530-XM-DCA2 and their PRIME
   * DCA2 share the four characters "DCA2" and are different panels. Four
   * characters out of twelve is not an agreement.
   */
  it("does not match two different products that share a suffix", () => {
    expect(suggestPartnerItem(ours("panel", "Silfab", "SIL530-XM-DCA2"), THEIRS)).toBeNull();
  });

  /**
   * Regression, also from the live data: our catalogue holds a Tesla row whose
   * entire model is the word "Inverter", which is a substring of two of their
   * inverter names and means nothing.
   */
  it("does not match on a generic word", () => {
    expect(suggestPartnerItem(ours("inverter", "Tesla", "Inverter"), THEIRS)).toBeNull();
  });

  it("returns nothing when the brand is not on their list at all", () => {
    expect(
      suggestPartnerItem(ours("panel", "Sirius", "ELNSM54M-HC-410 DC:BS-E"), THEIRS),
    ).toBeNull();
  });

  it("never crosses kinds", () => {
    expect(suggestPartnerItem(ours("battery", "Silfab", "SIL440-QD-DCA2"), THEIRS)).toBeNull();
  });

  /**
   * Both of these came back blank in the browser before the exact-name rule
   * existed, and both have an obviously right answer.
   */
  it("takes the name that IS ours over a longer one that merely contains it", () => {
    const hit = suggestPartnerItem(ours("inverter", "SolarEdge", "SE7600H-US"), THEIRS);
    expect(hit?.model).toBe("HD-Wave SE7600H-US");
  });

  it("takes the exact family name over its own two variants", () => {
    // Ours carries no wattage here, so "…C+" and "…D+" both contain it too.
    const hit = suggestPartnerItem(ours("panel", "Qcells", "Q.PEAK DUO BLK ML-G10+"), THEIRS);
    expect(hit?.model).toBe("Q.PEAK DUO BLK ML-G10+");
  });

  it("returns nothing on an empty catalogue rather than guessing", () => {
    expect(suggestPartnerItem(ours("panel", "Qcells", "Q.PEAK 410"), [])).toBeNull();
  });
});
