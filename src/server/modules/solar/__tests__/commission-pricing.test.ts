import { describe, expect, it } from "vitest";
import {
  commissionMeasure,
  compareWithSignedDocument,
  measureFromSignedDocument,
  derivedPrice,
} from "../commission-pricing";

/**
 * What a solar commission is measured on, and the check against the signed
 * document when that measure is frozen. The database half is in
 * `pricing-stage1.itest.ts`.
 */

const live = { systemWatts: 10_000, baseKeptCents: 3_000_000, batteryQty: 1 };
const frozen = {
  systemWatts: 9_600,
  baseKeptCents: 2_880_000,
  batteryQty: 1,
  pricedAt: new Date("2026-09-15T12:00:00Z"),
};

describe("commissionMeasure", () => {
  it("reads the copy frozen at signing over the live deal", () => {
    expect(commissionMeasure(live, frozen)).toEqual({
      systemWatts: 9_600,
      baseKeptCents: 2_880_000,
      batteryQty: 1,
      frozen: true,
    });
  });

  it("still pays on the frozen copy when the live deal can no longer be priced", () => {
    expect(commissionMeasure(null, frozen)?.baseKeptCents).toBe(2_880_000);
  });

  it("reads the live deal until a measure is frozen", () => {
    const unfrozen = { systemWatts: null, baseKeptCents: null, batteryQty: null, pricedAt: null };
    expect(commissionMeasure(live, unfrozen)).toEqual({ ...live, frozen: false });
    expect(commissionMeasure(live, null)).toEqual({ ...live, frozen: false });
  });

  it("does not treat a half-written row as frozen", () => {
    expect(commissionMeasure(live, { ...frozen, baseKeptCents: null })?.frozen).toBe(false);
    expect(commissionMeasure(live, { ...frozen, pricedAt: null })?.frozen).toBe(false);
  });

  it("has nothing to measure on an unsigned deal that is not priced", () => {
    expect(commissionMeasure(null, null)).toBeNull();
  });
});

describe("compareWithSignedDocument", () => {
  const deal = { systemType: "pv_storage" as const, systemWatts: 10_000, batteryQty: 1, finalPriceCents: derivedPrice(6_493_333) };
  const document = {
    financing: { contractPriceCents: 6_493_333, batteryQty: 1 },
    system: { sizeKwDc: 10 },
  };

  it("matches a deal that still prices to what was signed", () => {
    expect(compareWithSignedDocument(deal, document)).toEqual({ matches: true, differences: [] });
  });

  it("names every figure that moved", () => {
    const moved = { ...deal, systemWatts: 10_400, batteryQty: 2, finalPriceCents: derivedPrice(6_600_000) };
    const result = compareWithSignedDocument(moved, document);
    expect(result.matches).toBe(false);
    expect(result.differences).toEqual([
      "final price $66,000.00 on the deal, $64,933.33 on the signed document",
      "10400 W on the deal, 10000 W on the signed document",
      "2 batteries on the deal, 1 on the signed document",
    ]);
  });

  it("reads a storage job's batteries from its storage block and never compares watts", () => {
    const storage = { systemType: "storage" as const, systemWatts: 0, batteryQty: 2, finalPriceCents: derivedPrice(4_800_000) };
    const storageDocument = {
      financing: { contractPriceCents: 4_800_000 },
      system: { sizeKwDc: 7.2 }, // a stale size left on the design
      storage: { batteryQty: 2 },
    };
    expect(compareWithSignedDocument(storage, storageDocument)).toEqual({ matches: true, differences: [] });
  });

  it("says nothing when the document carries none of the figures", () => {
    expect(compareWithSignedDocument(deal, { financing: { contractPriceCents: null } })).toEqual({
      matches: null,
      differences: [],
    });
    expect(compareWithSignedDocument(deal, null)).toEqual({ matches: null, differences: [] });
  });
});

describe("measureFromSignedDocument", () => {
  /**
   * The worked example: a $30,000 base at sticker with a 25% dealer fee inside
   * it, which leaves the company $22,500 — the figure a redline is measured on.
   */
  const document = {
    financing: { basePriceCents: 3_000_000, batteryQty: 1 },
    system: { sizeKwDc: 10 },
  };
  const loan = { product: "loan" as const, dealerFeePct: 25, systemType: "pv_storage" as const };

  it("measures on the document's base with the deal's fee taken out of it", () => {
    expect(measureFromSignedDocument(document, loan)).toEqual({
      systemWatts: 10_000,
      baseKeptCents: 2_250_000,
      batteryQty: 1,
    });
  });

  it("takes no fee out of a cash deal, whatever the row carries", () => {
    expect(
      measureFromSignedDocument(document, { ...loan, product: "cash", dealerFeePct: 25 })
        ?.baseKeptCents
    ).toBe(3_000_000);
  });

  it("stands a fee down rather than making nonsense of it", () => {
    for (const dealerFeePct of [0, 100, Number.NaN]) {
      expect(measureFromSignedDocument(document, { ...loan, dealerFeePct })?.baseKeptCents).toBe(
        3_000_000
      );
    }
  });

  it("gives a storage job no watts and reads its batteries from the storage block", () => {
    expect(
      measureFromSignedDocument(
        {
          financing: { basePriceCents: 4_000_000 },
          system: { sizeKwDc: 7.2 }, // a stale size left on the design
          storage: { batteryQty: 2 },
        },
        { ...loan, systemType: "storage" }
      )
    ).toEqual({ systemWatts: 0, baseKeptCents: 3_000_000, batteryQty: 2 });
  });

  it("reads nothing off a document that carries no priced figures", () => {
    expect(measureFromSignedDocument({ financing: { batteryQty: 1 } }, loan)).toBeNull();
    expect(measureFromSignedDocument(null, loan)).toBeNull();
  });
});
