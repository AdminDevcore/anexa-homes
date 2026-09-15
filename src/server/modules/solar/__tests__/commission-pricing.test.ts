import { describe, expect, it } from "vitest";
import { commissionMeasure, compareWithSignedDocument } from "../commission-pricing";

/**
 * What a solar commission is measured on, and the check against the signed
 * document when that measure is frozen. The database half is in
 * `pricing-stage1.itest.ts`.
 */

const live = { systemWatts: 10_000, basePriceCents: 3_000_000, batteryQty: 1 };
const frozen = {
  systemWatts: 9_600,
  basePriceCents: 2_880_000,
  batteryQty: 1,
  pricedAt: new Date("2026-09-15T12:00:00Z"),
};

describe("commissionMeasure", () => {
  it("reads the copy frozen at signing over the live deal", () => {
    expect(commissionMeasure(live, frozen)).toEqual({
      systemWatts: 9_600,
      basePriceCents: 2_880_000,
      batteryQty: 1,
      frozen: true,
    });
  });

  it("still pays on the frozen copy when the live deal can no longer be priced", () => {
    expect(commissionMeasure(null, frozen)?.basePriceCents).toBe(2_880_000);
  });

  it("reads the live deal until a measure is frozen", () => {
    const unfrozen = { systemWatts: null, basePriceCents: null, batteryQty: null, pricedAt: null };
    expect(commissionMeasure(live, unfrozen)).toEqual({ ...live, frozen: false });
    expect(commissionMeasure(live, null)).toEqual({ ...live, frozen: false });
  });

  it("does not treat a half-written row as frozen", () => {
    expect(commissionMeasure(live, { ...frozen, basePriceCents: null })?.frozen).toBe(false);
    expect(commissionMeasure(live, { ...frozen, pricedAt: null })?.frozen).toBe(false);
  });

  it("has nothing to measure on an unsigned deal that is not priced", () => {
    expect(commissionMeasure(null, null)).toBeNull();
  });
});

describe("compareWithSignedDocument", () => {
  const deal = { systemType: "pv_storage" as const, systemWatts: 10_000, batteryQty: 1, finalPriceCents: 6_493_333 };
  const document = {
    financing: { contractPriceCents: 6_493_333, batteryQty: 1 },
    system: { sizeKwDc: 10 },
  };

  it("matches a deal that still prices to what was signed", () => {
    expect(compareWithSignedDocument(deal, document)).toEqual({ matches: true, differences: [] });
  });

  it("names every figure that moved", () => {
    const moved = { ...deal, systemWatts: 10_400, batteryQty: 2, finalPriceCents: 6_600_000 };
    const result = compareWithSignedDocument(moved, document);
    expect(result.matches).toBe(false);
    expect(result.differences).toEqual([
      "final price $66,000.00 on the deal, $64,933.33 on the signed document",
      "10400 W on the deal, 10000 W on the signed document",
      "2 batteries on the deal, 1 on the signed document",
    ]);
  });

  it("reads a storage job's batteries from its storage block and never compares watts", () => {
    const storage = { systemType: "storage" as const, systemWatts: 0, batteryQty: 2, finalPriceCents: 4_800_000 };
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
