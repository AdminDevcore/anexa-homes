# Storage-Only Proposals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a rep quote and send a proposal for a battery with no solar panels — priced per battery, argued on backup hours, VPP earnings and time-of-use savings rather than on production.

**Architecture:** The per-watt pricing ladder in `solar-money.ts` is generalised to a per-**unit** core (watts or batteries) with the existing per-watt signatures kept as wrappers, so no PV call site changes. A `systemType` enum on `SolarDesign` branches the builder, the readiness check, the payroll engine and the document. The customer-facing document is a new sibling file sharing the existing primitives, not a branch inside the 69 KB `index.tsx`.

**Tech Stack:** Next.js App Router, Prisma + Postgres, Vitest (unit + integration), Playwright (e2e), Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-28-battery-only-proposal-design.md`

**Commands:**
- Unit tests: `npm test -- <path>`
- Integration tests: `npm run test:integration -- <path>`
- E2E: `npx playwright test <path>`
- Types: `npm run typecheck`
- Migration: `npx prisma migrate dev --name <name>`

---

## One correction to the spec, read this first

The spec's commission section, and the option preview it came from, said the
per-battery redline is measured against **the lender's storage floor**
(`minBasePricePerBatteryCents`). That conflates two different things:

- The lender floor is the **company's** minimum margin — a pricing guard.
- A redline is the **rep's own** number, and it is what they keep above.

Paying the rep everything above the company's minimum margin means the company
keeps exactly its minimum on every storage deal. That is not what the PV
redline does: PV measures against `User.solarRedlineCentsPerWatt`, a per-rep
figure, while `SolarLender.minBasePpwCents` stays a separate pricing guard.

**This plan implements the per-rep version** — a new
`User.solarRedlinePerBatteryCents`, mirroring PV exactly — because that is what
"the same as the PV redline but measured per battery" means. The lender's
per-battery floor stays a pricing guard, as its $/W counterpart does.

If the intent really was to pay against the lender floor, Task 4 is the only
task that changes.

## File structure

**Created**
| File | Responsibility |
|---|---|
| `src/lib/solar-storage.ts` | Pure storage maths: usable kWh, backup hours, TOU savings. No DB, no React |
| `src/lib/__tests__/solar-storage.test.ts` | Its tests |
| `src/components/proposal/solar/storage.tsx` | The six-chapter customer document |
| `src/components/portal/solar-storage-panel.tsx` | The Design step when `systemType = storage` |
| `src/components/portal/solar-backup-profile-manager.tsx` | Settings → backup load profiles |
| `src/components/portal/solar-rebate-manager.tsx` | Settings → rebate catalogue |
| `src/server/modules/solar/storage.ts` | Server reads/actions for backup profiles, rebates, deal rebates |
| `src/app/portal/settings/solar-backup/page.tsx` | Settings route for profiles |
| `src/app/portal/settings/solar-rebates/page.tsx` | Settings route for rebates |
| `e2e/solar-storage-proposal.spec.ts` | End-to-end storage build + the `pv_storage` regression guard |

**Modified**
| File | Change |
|---|---|
| `src/lib/solar-money.ts` | Per-unit pricing core + rebate; per-watt wrappers unchanged in signature |
| `src/lib/solar-pay.ts` | Resolution union, battery redline, explicit refusal |
| `src/lib/solar-proposal.ts` | Snapshot v5: `systemType` + `storage` block |
| `src/lib/solar-validation.ts` | Storage readiness branch |
| `src/components/portal/solar-proposal-builder.tsx` | The "What are we quoting?" question, step reshaping |
| `src/components/portal/solar-panels.tsx` | Per-battery price box on Financing; product filter |
| `src/components/proposal/solar/print.tsx` | Route storage documents to the storage renderer |
| `src/server/modules/payroll/solar-engine.ts` | Storage pricing + unpayable line |
| `src/server/modules/solar/proposal-generate.ts` | Build the v5 storage snapshot |
| `prisma/schema.prisma` | The enum, six column groups, three new models |

---

## Task 1: A pricing ladder that counts units, not watts

The whole family — `pricePurchase`, `capStickerToFinalPpw`, `underBaseFloor`,
`bandPpwCents` — is "a rate × a countable quantity". For PV the quantity is
installed watts; for storage it is batteries. Generalise the core, keep the
per-watt names as wrappers.

**Files:**
- Modify: `src/lib/solar-money.ts:219-390` (`PurchaseInput`, `PurchaseBreakdown`, `pricePurchase`)
- Test: `src/lib/__tests__/solar-money-units.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/solar-money-units.test.ts
import { describe, it, expect } from "vitest";
import { priceUnits, pricePurchase } from "@/lib/solar-money";

describe("priceUnits", () => {
  it("prices two batteries the way the spec's worked example does", () => {
    // 2 x $13,000 base at a 25% programme stickers each at $173.33 hundred-cents.
    // base 13_000_00 / 0.75 = 17_333_33 cents per battery.
    const b = priceUnits({
      product: "loan",
      units: 2,
      stickerPerUnitCents: 17_333_33,
      dealerFeePct: 25,
      adderTotalCents: 2_700_00,
      rebateTotalCents: 1_000_00,
    });
    expect(b.contractPriceCents).toBe(36_933_33);
    expect(b.grossPriceCents).toBe(27_699_99);
    expect(b.dealerFeeCents).toBe(b.contractPriceCents - b.grossPriceCents);
  });

  it("keeps the invariant a homeowner checks with a calculator", () => {
    const b = priceUnits({
      product: "loan",
      units: 2,
      stickerPerUnitCents: 17_333_33,
      dealerFeePct: 25,
      adderTotalCents: 2_700_00,
      rebateTotalCents: 1_000_00,
    });
    expect(b.baseStickerCents + b.adderStickerCents - b.rebateStickerCents).toBe(
      b.contractPriceCents
    );
  });

  it("an on-top adder does not gross up and does not move the base", () => {
    const b = priceUnits({
      product: "loan",
      units: 2,
      stickerPerUnitCents: 17_333_33,
      dealerFeePct: 25,
      adderTotalCents: 0,
      onTopAdderTotalCents: 7_000_00,
    });
    expect(b.adderStickerCents).toBe(7_000_00);
    expect(b.contractPriceCents).toBe(b.baseStickerCents + 7_000_00);
  });

  it("refuses a dealer fee on cash", () => {
    const b = priceUnits({
      product: "cash", units: 2, stickerPerUnitCents: 10_000_00,
      dealerFeePct: 25, adderTotalCents: 0,
    });
    expect(b.dealerFeeCents).toBe(0);
    expect(b.basePriceCents).toBe(20_000_00);
  });

  it("stands a fee of 100% or more down rather than dividing by zero", () => {
    const b = priceUnits({
      product: "loan", units: 1, stickerPerUnitCents: 10_000_00,
      dealerFeePct: 100, adderTotalCents: 1_000_00,
    });
    expect(Number.isFinite(b.contractPriceCents)).toBe(true);
    expect(b.dealerFeeCents).toBe(0);
  });
});

describe("pricePurchase still prices PV exactly as it did", () => {
  const pv = {
    product: "loan" as const,
    systemSizeKwDc: 10.14,
    stickerPpwCents: 350,
    dealerFeePct: 18,
    adderTotalCents: 14_500_00,
    onTopAdderTotalCents: 0,
  };

  it("is unchanged with no rebate", () => {
    const b = pricePurchase(pv);
    expect(b.systemWatts).toBe(10_140);
    expect(b.baseStickerCents).toBe(10_140 * 350);
    expect(b.baseStickerCents + b.adderStickerCents).toBe(b.contractPriceCents);
    expect(b.grossPriceCents + b.dealerFeeCents).toBe(b.contractPriceCents);
  });

  it("takes a rebate off gross before the fee when one is applied", () => {
    const without = pricePurchase(pv);
    const with_ = pricePurchase({ ...pv, rebateTotalCents: 1_000_00 });
    expect(with_.grossPriceCents).toBe(without.grossPriceCents - 1_000_00);
    expect(with_.contractPriceCents).toBeLessThan(without.contractPriceCents);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/lib/__tests__/solar-money-units.test.ts`
Expected: FAIL — `priceUnits` is not exported from `@/lib/solar-money`.

- [ ] **Step 3: Extract the core**

In `src/lib/solar-money.ts`, add above `pricePurchase`:

```ts
/**
 * The pricing ladder, over any countable thing.
 *
 * BASE + ADDERS − REBATE = GROSS, + FEE = FINAL, and the fee is a percentage
 * OF FINAL. Solar counts installed watts; storage counts batteries. The
 * arithmetic is the same and lives here once, because two copies of it is how
 * a lease's escalator ends up on a loan.
 *
 * Every rule in `pricePurchase`'s docblock holds here verbatim: cash takes no
 * fee, the fee applies to ordinary adders and not to on-top ones, and a fee at
 * or above 100% stands down rather than dividing by zero.
 */
export type UnitPriceInput = {
  product: "cash" | "loan";
  /** Installed watts, or batteries. Zero is legal and prices the base at nothing. */
  units: number;
  /** The customer-facing rate per unit — already grossed up by the fee. */
  stickerPerUnitCents: number;
  dealerFeePct: number;
  adderTotalCents: number;
  onTopAdderTotalCents?: number;
  /**
   * The manufacturer's money, at face. Comes off GROSS — the company passes it
   * through, so the fee is then taken on the lower final and the payment
   * amortises the smaller number.
   */
  rebateTotalCents?: number;
  equipmentCostCents?: number;
};

export type UnitPriceBreakdown = {
  units: number;
  basePriceCents: number;
  basePerUnitCents: number;
  adderTotalCents: number;
  onTopAdderTotalCents: number;
  rebateTotalCents: number;
  grossPriceCents: number;
  grossPerUnitCents: number;
  dealerFeeCents: number;
  contractPriceCents: number;
  finalPerUnitCents: number;
  baseStickerCents: number;
  adderStickerCents: number;
  /**
   * The rebate as it appears on the CUSTOMER'S breakdown — grossed up by the
   * same fee everything else is.
   *
   * Subtracting it at face value from a grossed-up total leaves a breakdown a
   * few hundred dollars short of its own bottom line, in front of a homeowner
   * with a calculator. `baseSticker + adderSticker − rebateSticker` is the
   * contract, exactly, and that is the line they add up.
   */
  rebateStickerCents: number;
  marginCents: number;
};

export function priceUnits(input: UnitPriceInput): UnitPriceBreakdown {
  const units = Math.max(0, Math.round(input.units));
  const insideAdderCents = Math.round(input.adderTotalCents);
  const onTopAdderTotalCents = Math.round(input.onTopAdderTotalCents ?? 0);
  const adderTotalCents = insideAdderCents + onTopAdderTotalCents;
  const rebateTotalCents = Math.max(0, Math.round(input.rebateTotalCents ?? 0));

  const rawPct = input.product === "cash" ? 0 : input.dealerFeePct;
  const f = Number.isFinite(rawPct) && rawPct > 0 && rawPct < 100 ? rawPct / 100 : 0;
  const up = (cents: number) => (f > 0 ? Math.round(cents / (1 - f)) : cents);

  const baseStickerCents = units * Math.round(input.stickerPerUnitCents);
  const basePriceCents = baseStickerCents - Math.round(baseStickerCents * f);

  const adderStickerCents = up(insideAdderCents) + onTopAdderTotalCents;
  const rebateStickerCents = up(rebateTotalCents);

  const contractPriceCents = baseStickerCents + adderStickerCents - rebateStickerCents;
  const grossPriceCents = basePriceCents + adderTotalCents - rebateTotalCents;

  // Subtracted, never recomputed as `contract × f`: gross + fee has to equal
  // final EXACTLY, because a customer reads those three lines and adds them up.
  const dealerFeeCents = contractPriceCents - grossPriceCents;

  const marginCents =
    input.equipmentCostCents === undefined ? 0 : grossPriceCents - input.equipmentCostCents;

  const per = (cents: number) => (units > 0 ? cents / units : 0);
  return {
    units,
    basePriceCents,
    basePerUnitCents: per(basePriceCents),
    adderTotalCents,
    onTopAdderTotalCents,
    rebateTotalCents,
    grossPriceCents,
    grossPerUnitCents: per(grossPriceCents),
    dealerFeeCents,
    contractPriceCents,
    finalPerUnitCents: per(contractPriceCents),
    baseStickerCents,
    adderStickerCents,
    rebateStickerCents,
    marginCents,
  };
}
```

- [ ] **Step 4: Make `pricePurchase` a wrapper**

Replace the **body** of `pricePurchase` (keep its docblock, which is the
canonical explanation of the model) with:

```ts
export function pricePurchase(input: PurchaseInput): PurchaseBreakdown {
  const u = priceUnits({
    product: input.product,
    units: Math.round(input.systemSizeKwDc * 1000),
    stickerPerUnitCents: input.stickerPpwCents,
    dealerFeePct: input.dealerFeePct,
    adderTotalCents: input.adderTotalCents,
    onTopAdderTotalCents: input.onTopAdderTotalCents,
    rebateTotalCents: input.rebateTotalCents,
    equipmentCostCents: input.equipmentCostCents,
  });
  return {
    systemWatts: u.units,
    basePriceCents: u.basePriceCents,
    basePpwCents: u.basePerUnitCents,
    adderTotalCents: u.adderTotalCents,
    onTopAdderTotalCents: u.onTopAdderTotalCents,
    rebateTotalCents: u.rebateTotalCents,
    grossPriceCents: u.grossPriceCents,
    grossPpwCents: u.grossPerUnitCents,
    dealerFeeCents: u.dealerFeeCents,
    contractPriceCents: u.contractPriceCents,
    finalPpwCents: u.finalPerUnitCents,
    baseStickerCents: u.baseStickerCents,
    adderStickerCents: u.adderStickerCents,
    rebateStickerCents: u.rebateStickerCents,
    marginCents: u.marginCents,
  };
}
```

Add to `PurchaseInput`:

```ts
  /**
   * The manufacturer's money on this deal, at face. Optional and zero by
   * default, so every deal in flight prices byte-identically to before.
   */
  rebateTotalCents?: number;
```

Add to `PurchaseBreakdown`:

```ts
  /** The rebate at face — what came off gross. Zero when none is applied. */
  rebateTotalCents: number;
  /** The rebate grossed up, as the customer's breakdown subtracts it. */
  rebateStickerCents: number;
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- src/lib/__tests__/solar-money-units.test.ts src/lib/__tests__/solar-loan.test.ts`
Expected: PASS, all of them.

- [ ] **Step 6: Run the whole unit suite — this is the regression gate**

Run: `npm test`
Expected: PASS. Every existing solar-money assertion must still hold; the
rebate defaults to zero, so the arithmetic is unchanged where nothing applies one.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors. `rebateTotalCents` and `rebateStickerCents` are new
required fields on `PurchaseBreakdown`, so any object literal building one by
hand will surface here.

- [ ] **Step 8: Commit**

```bash
git add src/lib/solar-money.ts src/lib/__tests__/solar-money-units.test.ts
git commit -m "The ladder counts units, and watts are one kind of unit"
```

---

## Task 2: The lender's ceiling, per battery

`capStickerToFinalPpw` solves a sticker back down so system + adders lands on
the partner's number. Nothing in it is about watts except the divisor.

**Files:**
- Modify: `src/lib/solar-money.ts:638-770` (`capStickerToFinalPpw`, `priceStoredPurchase`)
- Test: `src/lib/__tests__/solar-money-units.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/solar-money-units.test.ts`:

```ts
import {
  capStickerToFinalUnit, capStickerToFinalPpw,
  priceStorageStored, underBaseFloor,
} from "@/lib/solar-money";

describe("capStickerToFinalUnit", () => {
  it("holds a flat partner to its number per battery", () => {
    // Flat $16,000 a battery, 2 batteries, $2,700 of adders at a 25% fee.
    // Contract must land on 2 x 16,000 = $32,000.
    const r = capStickerToFinalUnit({
      stickerPerUnitCents: 20_000_00,
      maxFinalPerUnitCents: 16_000_00,
      mode: "flat",
      units: 2,
      dealerFeePct: 25,
      adderTotalCents: 2_700_00,
    });
    expect(r.capped).toBe(true);
    const b = priceUnits({
      product: "loan", units: 2,
      stickerPerUnitCents: r.stickerPerUnitCents,
      dealerFeePct: 25, adderTotalCents: 2_700_00,
    });
    expect(Math.abs(b.contractPriceCents - 32_000_00)).toBeLessThanOrEqual(2);
  });

  it("a ceiling only bites downwards", () => {
    const r = capStickerToFinalUnit({
      stickerPerUnitCents: 10_000_00,
      maxFinalPerUnitCents: 16_000_00,
      mode: "cap",
      units: 2, dealerFeePct: 25, adderTotalCents: 0,
    });
    expect(r.capped).toBe(false);
    expect(r.stickerPerUnitCents).toBe(10_000_00);
  });

  it("reports an overrun when the adders alone blow through the ceiling", () => {
    const r = capStickerToFinalUnit({
      stickerPerUnitCents: 10_000_00,
      maxFinalPerUnitCents: 1_000_00,
      mode: "cap",
      units: 1, dealerFeePct: 25, adderTotalCents: 5_000_00,
    });
    expect(r.adderOverrun).toBe(true);
    expect(r.stickerPerUnitCents).toBe(0);
  });

  it("no rule at all when the figure is null or zero", () => {
    for (const max of [null, undefined, 0, -1]) {
      const r = capStickerToFinalUnit({
        stickerPerUnitCents: 10_000_00, maxFinalPerUnitCents: max,
        units: 2, dealerFeePct: 25, adderTotalCents: 0,
      });
      expect(r.capped).toBe(false);
    }
  });

  it("no units means no rule — a cap cannot divide by nothing", () => {
    const r = capStickerToFinalUnit({
      stickerPerUnitCents: 10_000_00, maxFinalPerUnitCents: 1_000_00,
      units: 0, dealerFeePct: 25, adderTotalCents: 0,
    });
    expect(r.capped).toBe(false);
  });
});

describe("capStickerToFinalPpw is the same function over watts", () => {
  it("still holds Amos to $5.50/W", () => {
    const r = capStickerToFinalPpw({
      stickerPpwCents: 857,
      maxFinalPpwCents: 550,
      mode: "flat",
      systemSizeKwDc: 10,
      dealerFeePct: 65,
      adderTotalCents: 0,
    });
    expect(r.stickerPpwCents).toBe(550);
    expect(r.capped).toBe(true);
  });
});

describe("underBaseFloor is unit-agnostic", () => {
  it("blocks a battery quoted under the lender's floor", () => {
    // $11,000 sticker at a 25% fee leaves $8,250 — under a $9,000 floor.
    expect(underBaseFloor(11_000_00, 25, 9_000_00)).toBe(true);
    expect(underBaseFloor(13_000_00, 25, 9_000_00)).toBe(false);
  });

  it("null or non-positive floor means no floor", () => {
    expect(underBaseFloor(1, 25, null)).toBe(false);
    expect(underBaseFloor(1, 25, 0)).toBe(false);
  });
});

describe("priceStorageStored", () => {
  it("holds a saved storage deal to its partner's ceiling", () => {
    const { breakdown, cap } = priceStorageStored({
      product: "loan",
      batteryQty: 2,
      stickerPricePerBatteryCents: 20_000_00,
      dealerFeePct: 25,
      adderTotalCents: 0,
      maxFinalPricePerBatteryCents: 16_000_00,
      finalBatteryPriceMode: "flat",
    });
    expect(cap.capped).toBe(true);
    expect(breakdown.contractPriceCents).toBe(32_000_00);
  });

  it("cash has no partner rule", () => {
    const { cap } = priceStorageStored({
      product: "cash",
      batteryQty: 2,
      stickerPricePerBatteryCents: 20_000_00,
      dealerFeePct: 0,
      adderTotalCents: 0,
      maxFinalPricePerBatteryCents: 16_000_00,
      finalBatteryPriceMode: "flat",
    });
    expect(cap.capped).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/lib/__tests__/solar-money-units.test.ts`
Expected: FAIL — `capStickerToFinalUnit` and `priceStorageStored` are not exported.

- [ ] **Step 3: Generalise the cap**

In `solar-money.ts`, rename the internals of `capStickerToFinalPpw` into a new
`capStickerToFinalUnit` taking `units` and `stickerPerUnitCents` /
`maxFinalPerUnitCents`, returning `{ stickerPerUnitCents, capped, adderOverrun }`.
The body is the existing one with `systemWatts` replaced by `units` and the
`systemSizeKwDc * 1000` conversion removed. **Keep every comment** — the
rounding note (a maximum floors, a flat price rounds to nearest) and the
adder-overrun note are the reasons the function is shaped as it is.

Then:

```ts
/** The ceiling over installed watts. The shape every PV caller already uses. */
export function capStickerToFinalPpw(input: {
  stickerPpwCents: number;
  maxFinalPpwCents: number | null | undefined;
  mode?: FinalPpwMode;
  systemSizeKwDc: number;
  dealerFeePct: number;
  adderTotalCents: number;
}): FinalPpwCap {
  const r = capStickerToFinalUnit({
    stickerPerUnitCents: input.stickerPpwCents,
    maxFinalPerUnitCents: input.maxFinalPpwCents,
    mode: input.mode,
    units: Math.round(input.systemSizeKwDc * 1000),
    dealerFeePct: input.dealerFeePct,
    adderTotalCents: input.adderTotalCents,
  });
  return {
    stickerPpwCents: r.stickerPerUnitCents,
    capped: r.capped,
    adderOverrun: r.adderOverrun,
  };
}
```

- [ ] **Step 4: Add the storage pricing entry points**

```ts
export type StoragePriceInput = {
  product: "cash" | "loan";
  batteryQty: number;
  /** The customer-facing price of ONE battery, fee included. */
  stickerPricePerBatteryCents: number;
  dealerFeePct: number;
  adderTotalCents: number;
  onTopAdderTotalCents?: number;
  rebateTotalCents?: number;
  equipmentCostCents?: number;
};

/** Price a storage-only deal at the sticker it is handed. */
export function priceStoragePurchase(input: StoragePriceInput): UnitPriceBreakdown {
  return priceUnits({
    product: input.product,
    units: input.batteryQty,
    stickerPerUnitCents: input.stickerPricePerBatteryCents,
    dealerFeePct: input.dealerFeePct,
    adderTotalCents: input.adderTotalCents,
    onTopAdderTotalCents: input.onTopAdderTotalCents,
    rebateTotalCents: input.rebateTotalCents,
    equipmentCostCents: input.equipmentCostCents,
  });
}

/**
 * What a SAVED storage deal prices at today, held to its partner's ceiling.
 *
 * The storage twin of `priceStoredPurchase`, and it exists for the same reason:
 * a stored sticker is only as capped as the lender was on the day it was
 * saved, and a ceiling published afterwards must not leave two screens quoting
 * two different contracts for one deal.
 */
export function priceStorageStored(
  input: StoragePriceInput & {
    maxFinalPricePerBatteryCents: number | null | undefined;
    finalBatteryPriceMode?: FinalPpwMode;
  }
): { breakdown: UnitPriceBreakdown; cap: { stickerPerUnitCents: number; capped: boolean; adderOverrun: boolean } } {
  const cap = capStickerToFinalUnit({
    stickerPerUnitCents: input.stickerPricePerBatteryCents,
    // Cash has no lender and therefore no partner rule.
    maxFinalPerUnitCents: input.product === "cash" ? null : input.maxFinalPricePerBatteryCents,
    mode: input.finalBatteryPriceMode,
    units: input.batteryQty,
    dealerFeePct: input.dealerFeePct,
    adderTotalCents: input.adderTotalCents,
  });
  return {
    breakdown: priceStoragePurchase({
      ...input,
      stickerPricePerBatteryCents: cap.stickerPerUnitCents,
    }),
    cap,
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- src/lib/__tests__/solar-money-units.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/solar-money.ts src/lib/__tests__/solar-money-units.test.ts
git commit -m "A ceiling per battery is the same ceiling, divided differently"
```

---

## Task 3: What a battery is worth — backup hours and time-of-use

Pure functions, no DB, no React. This is the arithmetic the customer's document
prints, so it is tested on its own before anything renders it.

**Files:**
- Create: `src/lib/solar-storage.ts`
- Test: `src/lib/__tests__/solar-storage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/solar-storage.test.ts
import { describe, it, expect } from "vitest";
import {
  usableKwh, backupHours, backupTable, touSavings,
  type BackupProfile, type TouAssumptions,
} from "@/lib/solar-storage";

const PROFILES: BackupProfile[] = [
  { id: "a", name: "Essentials", loadWatts: 1000, rank: 0 },
  { id: "b", name: "Essentials + AC", loadWatts: 3500, rank: 1 },
  { id: "c", name: "Whole home", loadWatts: 5000, rank: 2 },
];

const TOU: TouAssumptions = { peakSharePct: 30, cyclesPerDay: 1, roundTripEfficiencyPct: 90 };

describe("usableKwh", () => {
  it("reads watt-hours off the catalogue row", () => {
    // SolarEquipment.ratingW holds Wh on a battery: "Powerwall 3 · 13500Wh".
    expect(usableKwh(13_500, 2)).toBe(27);
  });

  it("is zero when there is no battery or no count", () => {
    expect(usableKwh(null, 2)).toBe(0);
    expect(usableKwh(13_500, 0)).toBe(0);
  });
});

describe("backupHours", () => {
  it("divides capacity by the load", () => {
    expect(backupHours(27, 1000)).toBeCloseTo(27, 5);
    expect(backupHours(27, 3500)).toBeCloseTo(7.714, 3);
  });

  it("returns null rather than Infinity on a zero load", () => {
    expect(backupHours(27, 0)).toBeNull();
  });
});

describe("backupTable", () => {
  it("comes back in rank order, lowest load first", () => {
    const rows = backupTable(27, [...PROFILES].reverse());
    expect(rows.map((r) => r.name)).toEqual(["Essentials", "Essentials + AC", "Whole home"]);
    expect(rows[0].hours).toBeCloseTo(27, 5);
  });

  it("is empty when nothing is stored, so the chapter is omitted not zeroed", () => {
    expect(backupTable(0, PROFILES)).toEqual([]);
  });
});

describe("touSavings", () => {
  it("shifts what the battery holds, capped by what the peak window uses", () => {
    // 12,000 kWh/yr, 30% in peak = 9.863 kWh/day of peak usage.
    // 27 kWh of storage exceeds that, so the peak usage is the binding limit.
    // 9.863 x 365 x ($0.24 - $0.09) x 0.90 = $486.00
    const r = touSavings({
      usableKwh: 27, annualUsageKwh: 12_000,
      peakRateMills: 240, offPeakRateMills: 90, ...TOU,
    });
    expect(r).not.toBeNull();
    expect(r!.shiftedKwhPerDay).toBeCloseTo(9.863, 2);
    expect(r!.annualSavingsCents).toBe(48_600);
  });

  it("is capped by the battery on a house that uses more than it holds", () => {
    const r = touSavings({
      usableKwh: 5, annualUsageKwh: 40_000,
      peakRateMills: 240, offPeakRateMills: 90, ...TOU,
    });
    expect(r!.shiftedKwhPerDay).toBe(5);
  });

  it("is NULL, never zero, when a rate is missing", () => {
    expect(touSavings({ usableKwh: 27, annualUsageKwh: 12_000, peakRateMills: null, offPeakRateMills: 90, ...TOU })).toBeNull();
    expect(touSavings({ usableKwh: 27, annualUsageKwh: 12_000, peakRateMills: 240, offPeakRateMills: null, ...TOU })).toBeNull();
  });

  it("is NULL when the spread is zero or inverted — there is nothing to arbitrage", () => {
    expect(touSavings({ usableKwh: 27, annualUsageKwh: 12_000, peakRateMills: 90, offPeakRateMills: 90, ...TOU })).toBeNull();
    expect(touSavings({ usableKwh: 27, annualUsageKwh: 12_000, peakRateMills: 80, offPeakRateMills: 90, ...TOU })).toBeNull();
  });

  it("is NULL with no usage on file — the cap has nothing to bind against", () => {
    expect(touSavings({ usableKwh: 27, annualUsageKwh: 0, peakRateMills: 240, offPeakRateMills: 90, ...TOU })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/lib/__tests__/solar-storage.test.ts`
Expected: FAIL — cannot resolve `@/lib/solar-storage`.

- [ ] **Step 3: Write the module**

```ts
// src/lib/solar-storage.ts
/**
 * What a battery is worth, in the two currencies a homeowner buying one cares
 * about: hours the lights stay on, and money off the bill.
 *
 * Pure. No database, no React, no formatting — the customer's document and the
 * rep's builder both read these, and a figure that differs between the screen
 * a rep quoted from and the paper a customer signed is a phone call.
 *
 * NOTHING IS HARDCODED, the same rule the proposal model keeps: every
 * assumption arrives as an argument and is frozen into the snapshot beside the
 * number it produced.
 */

/** A company's named load profile. `loadWatts` is what is being backed up. */
export type BackupProfile = { id: string; name: string; loadWatts: number; rank: number };

export type BackupRow = { id: string; name: string; loadWatts: number; hours: number };

export type TouAssumptions = {
  /** What share of a day's kWh falls inside the peak window, %. Modelled. */
  peakSharePct: number;
  /** How many times a day the battery is cycled. */
  cyclesPerDay: number;
  /** What survives a charge/discharge round trip, %. */
  roundTripEfficiencyPct: number;
};

export type TouSavings = {
  shiftedKwhPerDay: number;
  peakUsageKwhPerDay: number;
  annualSavingsCents: number;
};

/**
 * Usable storage, kWh.
 *
 * `SolarEquipment.ratingW` holds WATT-HOURS on a battery — the catalogue label
 * renders "Tesla Powerwall 3 · 13500Wh". The column is misnamed for this kind
 * and is read, not renamed: a rename reaches the VPP equipment lists, the
 * catalogue manager and the approved-vendor joins, and buys nothing.
 */
export function usableKwh(batteryRatingWh: number | null | undefined, qty: number): number {
  if (!batteryRatingWh || !(batteryRatingWh > 0)) return 0;
  const n = Math.max(0, Math.round(qty));
  return (batteryRatingWh / 1000) * n;
}

/** Hours at a given load. Null rather than Infinity when nothing is drawing. */
export function backupHours(kwh: number, loadWatts: number): number | null {
  if (!(loadWatts > 0)) return null;
  return kwh / (loadWatts / 1000);
}

/**
 * Every active profile with its hours, lowest load first.
 *
 * Rank-ordered so the cover can headline the first row without the design
 * carrying a "which one do I headline" field. EMPTY when there is no storage,
 * so the chapter is omitted rather than printed as a column of zeroes.
 */
export function backupTable(kwh: number, profiles: BackupProfile[]): BackupRow[] {
  if (!(kwh > 0)) return [];
  return [...profiles]
    .sort((a, b) => a.rank - b.rank || a.loadWatts - b.loadWatts)
    .map((p) => ({ id: p.id, name: p.name, loadWatts: p.loadWatts, hours: backupHours(kwh, p.loadWatts) }))
    .filter((r): r is BackupRow => r.hours != null);
}

/**
 * What charging cheap and discharging at peak is worth in a year.
 *
 *   peakUsage/day = annualUsage ÷ 365 × peakShare
 *   shifted/day   = min(usableKwh × cycles, peakUsage/day)
 *   savings/yr    = shifted × 365 × (peak − offPeak) × roundTripEfficiency
 *
 * NULL, NOT ZERO, whenever the arithmetic has nothing behind it — a missing
 * rate, a spread of zero or less, no usage on file. The document omits the line
 * in that case. A zero printed beside a real backup figure reads as "this
 * battery saves you nothing", which is a different and untrue claim from "we do
 * not have your utility's peak rate on file".
 */
export function touSavings(input: {
  usableKwh: number;
  annualUsageKwh: number;
  peakRateMills: number | null | undefined;
  offPeakRateMills: number | null | undefined;
} & TouAssumptions): TouSavings | null {
  const { usableKwh: kwh, annualUsageKwh, peakRateMills, offPeakRateMills } = input;
  if (!(kwh > 0) || !(annualUsageKwh > 0)) return null;
  if (peakRateMills == null || offPeakRateMills == null) return null;

  const spreadMills = peakRateMills - offPeakRateMills;
  if (!(spreadMills > 0)) return null;

  const peakUsageKwhPerDay = (annualUsageKwh / 365) * (input.peakSharePct / 100);
  const shiftedKwhPerDay = Math.min(kwh * input.cyclesPerDay, peakUsageKwhPerDay);
  if (!(shiftedKwhPerDay > 0)) return null;

  // Mills are tenths of a cent, so the spread divides by 10 to reach cents.
  const annualSavingsCents = Math.round(
    ((shiftedKwhPerDay * 365 * spreadMills) / 10) * (input.roundTripEfficiencyPct / 100)
  );
  return { shiftedKwhPerDay, peakUsageKwhPerDay, annualSavingsCents };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- src/lib/__tests__/solar-storage.test.ts`
Expected: PASS, all 12.

- [ ] **Step 5: Commit**

```bash
git add src/lib/solar-storage.ts src/lib/__tests__/solar-storage.test.ts
git commit -m "Hours the lights stay on, and money off the bill"
```

---

## Task 4: Commission that refuses rather than pays nothing

Today a storage deal never reaches `solarRepPayCents` at all — `loadSolarDeal`
returns null on `systemSizeKwDc <= 0`. The moment storage deals become real,
both existing bases misfire: `per_watt` pays zero, and `redline` pays
`basePriceCents − redline × 0`, which is **the entire base price**. Neither may
be allowed to happen silently.

**Files:**
- Modify: `src/lib/solar-pay.ts:26-135`
- Test: `src/lib/__tests__/solar-pay.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/solar-pay.test.ts`:

```ts
import { resolveSolarPay, type SolarPayResolution } from "@/lib/solar-pay";

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

    // 2 batteries, rep redline $9,000, base price $23,000 => $5,000.
    const pay = solarRepPayCents(r.terms, {
      systemWatts: 0, batteryQty: 2, basePriceCents: 23_000_00,
    });
    expect(pay.amountCents).toBe(5_000_00);
  });

  it("REFUSES a per-watt rule instead of paying zero", () => {
    const r = resolveSolarPay({
      systemType: "storage", product: "loan", lenderPayMode: "per_watt", rep: REP_ALL,
    });
    expect(r.kind).toBe("refused");
    if (r.kind !== "refused") throw new Error("unreachable");
    expect(r.reason).toMatch(/per watt/i);
  });

  it("writes no line at all when the rep has no per-battery redline", () => {
    const r = resolveSolarPay({
      systemType: "storage", product: "loan", lenderPayMode: "redline",
      rep: { ...REP_ALL, solarRedlinePerBatteryCents: null },
    });
    expect(r.kind).toBe("unconfigured");
  });

  it("never pays the whole base price when the count is zero", () => {
    const terms: SolarPayTerms = {
      basis: "battery_redline", redlineCentsPerWatt: null, millsPerWatt: null,
      redlinePerBatteryCents: 9_000_00,
    };
    const pay = solarRepPayCents(terms, {
      systemWatts: 0, batteryQty: 0, basePriceCents: 23_000_00,
    });
    expect(pay.amountCents).toBe(0);
  });
});

describe("PV deals are untouched", () => {
  it("still resolves the redline basis", () => {
    const r = resolveSolarPay({
      systemType: "pv", product: "loan", lenderPayMode: "redline", rep: REP_ALL,
    });
    expect(r.kind === "terms" && r.terms.basis).toBe("redline");
  });

  it("pv_storage takes the identical path to pv", () => {
    const a = resolveSolarPay({ systemType: "pv", product: "loan", lenderPayMode: "redline", rep: REP_ALL });
    const b = resolveSolarPay({ systemType: "pv_storage", product: "loan", lenderPayMode: "redline", rep: REP_ALL });
    expect(b).toEqual(a);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/lib/__tests__/solar-pay.test.ts`
Expected: FAIL — `resolveSolarPay` is not exported.

- [ ] **Step 3: Widen the terms and add the resolution union**

In `src/lib/solar-pay.ts`:

```ts
export type SolarPayBasis = "redline" | "per_watt" | "battery_redline";

export type SolarPayTerms = {
  basis: SolarPayBasis;
  redlineCentsPerWatt: number | null;
  millsPerWatt: number | null;
  /** Cents of BASE price per battery the rep keeps above. `battery_redline` only. */
  redlinePerBatteryCents: number | null;
};

export type SolarRepConfig = {
  solarRedlineCentsPerWatt: number | null;
  solarPerWattMills: number | null;
  solarRedlinePerBatteryCents: number | null;
};

/**
 * What the payroll engine should do with this deal.
 *
 * Three answers, and the third is the point of the type.
 *
 * `unconfigured` is today's `null`: nobody has set this rep up for this kind of
 * deal, so no line is written. Not zero — a $0 line reads as a deal genuinely
 * worth nothing.
 *
 * `refused` is new and is the reason this stopped being a nullable return. A
 * rule that prices per watt, meeting a deal with no watts, is not a rep who is
 * owed nothing: it is a MISCONFIGURATION, and the two must not look the same on
 * a payroll run. Paying zero quietly is precisely how every solar commission
 * came out at $0 when `Project.contractValue` was read instead of
 * `SolarFinance`, and nobody noticed for weeks.
 */
export type SolarPayResolution =
  | { kind: "terms"; terms: SolarPayTerms }
  | { kind: "unconfigured" }
  | { kind: "refused"; reason: string };

export function resolveSolarPay(input: {
  systemType: "pv" | "pv_storage" | "storage";
  product: FinanceProduct;
  lenderPayMode: SolarRepPayMode | null;
  rep: SolarRepConfig;
}): SolarPayResolution {
  const { systemType, product, lenderPayMode, rep } = input;

  if (systemType === "storage") {
    // A lease or PPA over storage has no system price for a redline to measure,
    // and there is no per-battery flat rate to fall back on. Say so.
    if (product === "lease" || product === "ppa") {
      return {
        kind: "refused",
        reason: "A lease or PPA has no system price, and storage has no per-watt rate to pay instead.",
      };
    }
    if ((lenderPayMode ?? "redline") === "per_watt") {
      return {
        kind: "refused",
        reason: "This lender pays per watt and this deal has none. Set a per-battery redline, or move the lender off per-watt pay.",
      };
    }
    if (rep.solarRedlinePerBatteryCents == null) return { kind: "unconfigured" };
    return {
      kind: "terms",
      terms: {
        basis: "battery_redline",
        redlineCentsPerWatt: null,
        millsPerWatt: null,
        redlinePerBatteryCents: rep.solarRedlinePerBatteryCents,
      },
    };
  }

  // pv and pv_storage: exactly what resolveSolarPayTerms did before.
  const basis: SolarPayBasis =
    product === "lease" || product === "ppa"
      ? "per_watt"
      : (lenderPayMode ?? "redline") === "per_watt"
        ? "per_watt"
        : "redline";

  if (basis === "per_watt") {
    if (rep.solarPerWattMills == null) return { kind: "unconfigured" };
    return {
      kind: "terms",
      terms: { basis, redlineCentsPerWatt: null, millsPerWatt: rep.solarPerWattMills, redlinePerBatteryCents: null },
    };
  }
  if (rep.solarRedlineCentsPerWatt == null) return { kind: "unconfigured" };
  return {
    kind: "terms",
    terms: { basis, redlineCentsPerWatt: rep.solarRedlineCentsPerWatt, millsPerWatt: null, redlinePerBatteryCents: null },
  };
}
```

Delete `resolveSolarPayTerms`. It has two production callers, both updated in
this plan (Task 4 Step 5 and Task 17); leaving it beside the new function is
how one of them keeps calling the version that cannot refuse.

- [ ] **Step 4: Add the battery branch to the payout**

Widen the `deal` argument and add the branch:

```ts
export function solarRepPayCents(
  terms: SolarPayTerms,
  deal: { systemWatts: number; basePriceCents: number; batteryQty?: number }
): SolarPayResult {
  const watts = Math.max(0, Math.round(deal.systemWatts));
  const basePpwCents = watts > 0 ? deal.basePriceCents / watts : 0;

  if (terms.basis === "battery_redline") {
    const qty = Math.max(0, Math.round(deal.batteryQty ?? 0));
    const redline = terms.redlinePerBatteryCents ?? 0;
    // Guarded on the COUNT, not just clamped at zero. Without it a deal with no
    // batteries pays `basePriceCents − redline × 0` — the entire base price,
    // which is worse than the zero this basis exists to prevent.
    const amountCents = qty > 0 ? Math.max(0, deal.basePriceCents - redline * qty) : 0;
    return {
      amountCents,
      basisCents: qty > 0 ? Math.max(0, deal.basePriceCents) : 0,
      basePpwCents: 0,
      overageCentsPerWatt: 0,
    };
  }

  // ...per_watt and redline branches unchanged...
}
```

- [ ] **Step 5: Update the pay-structure preview component**

`src/components/portal/member-pay-structure.tsx:166-170` builds `SolarPayTerms`
literals by hand. Add the new field to both so they typecheck:

```ts
  : solarRepPayCents({ basis: "redline", redlineCentsPerWatt: redlineCents, millsPerWatt: null, redlinePerBatteryCents: null }, deal),
  : solarRepPayCents({ basis: "per_watt", redlineCentsPerWatt: null, millsPerWatt: perWattMills, redlinePerBatteryCents: null }, deal),
```

- [ ] **Step 6: Extend the labels**

In `solarPayLabel`, add before the per-watt branch:

```ts
  if (terms.basis === "battery_redline") {
    const each = usd(terms.redlinePerBatteryCents ?? 0);
    return `Solar battery redline (${each}/battery)`;
  }
```

And in `solarPayExplanation`:

```ts
  if (terms.basis === "battery_redline")
    return `Keeps everything above ${usd(terms.redlinePerBatteryCents ?? 0)} a battery — ${usd(result.amountCents)} to the rep.`;
```

- [ ] **Step 7: Run the tests**

Run: `npm test -- src/lib/__tests__/solar-pay.test.ts`
Expected: PASS. The pre-existing tests calling `resolveSolarPayTerms` will fail
to compile — update them to `resolveSolarPay({ systemType: "pv", ... })` and
read `.kind`/`.terms`. Do not delete an assertion; each one records a rule.

- [ ] **Step 8: Full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. `src/server/modules/payroll/solar-engine.ts` will not typecheck
until Task 17 — that is expected and is why Task 17 exists. If you need a green
typecheck between here and there, do Task 17 next.

- [ ] **Step 9: Commit**

```bash
git add src/lib/solar-pay.ts src/lib/__tests__/solar-pay.test.ts src/components/portal/member-pay-structure.tsx
git commit -m "A rule that cannot price a deal says so instead of paying nothing"
```

---

## Task 5: The schema

One migration. Everything the rest of the plan reads from the database is here,
so no later task is blocked on a column that does not exist yet.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_storage_only_proposals/migration.sql` (generated)

- [ ] **Step 1: Add the enum and the design field**

```prisma
/// What a deal is selling. `pv` and `pv_storage` take the IDENTICAL code path
/// everywhere — the distinction is the rep's vocabulary and the thing the
/// storage-only filters test against. Only `storage` branches. Written down
/// because a three-value enum where two behave alike is what drifts apart.
enum SolarSystemType {
  pv
  pv_storage
  storage
}
```

In `model SolarDesign`:

```prisma
  systemType SolarSystemType @default(pv_storage)

  /// This deal's own peak / off-peak rates, mills per kWh. NULL means use the
  /// electric provider's, which is where they normally come from.
  touPeakRateMills    Int?
  touOffPeakRateMills Int?
```

- [ ] **Step 2: Add the price and the guardrails**

`model SolarFinance`:

```prisma
  /// What ONE battery stickers at — fee included, exactly as `grossPpwCents`
  /// is. Zero on every PV deal.
  stickerPricePerBatteryCents Int @default(0)
```

`model SolarLender`:

```prisma
  /// The storage twins of `minBasePpwCents` / `maxFinalPpwCents` /
  /// `finalPpwMode`. Null means no rule, the default and every lender until
  /// somebody sets one.
  minBasePricePerBatteryCents  Int?
  maxFinalPricePerBatteryCents Int?
  finalBatteryPriceMode        SolarFinalPpwMode @default(cap)
```

`model SolarLenderProduct`:

```prisma
  /// Whether this paper funds a battery with no array on the roof. FALSE by
  /// default: an unreviewed product does not offer to fund something it may not.
  financesStorageOnly Boolean @default(false)
```

`model SolarProvider`:

```prisma
  /// Time-of-use rates, mills per kWh, beside the buyback rate above. Null
  /// means this provider has no TOU plan on file and the savings line is
  /// omitted rather than derived from the blended rate.
  touPeakRateMills    Int?
  touOffPeakRateMills Int?
  /// Human text for the document: "4pm – 8pm". Not parsed.
  touPeakWindow       String?
```

`model User`:

```prisma
  /// The rep's own redline on a storage deal, cents of BASE price per battery.
  /// The per-battery twin of `solarRedlineCentsPerWatt`, and like it a REP
  /// figure — distinct from the lender's margin floor, which guards pricing.
  solarRedlinePerBatteryCents Int?
```

- [ ] **Step 3: Add the three new models**

```prisma
/// A named load a battery might be asked to carry, so backup hours are derived
/// rather than typed. Rank-ordered: the cover headlines the first row.
model SolarBackupProfile {
  id        String   @id @default(uuid())
  companyId String
  company   Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  vertical  Vertical @default(solar)
  name      String
  loadWatts Int
  rank      Int      @default(0)
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([companyId, name])
  @@index([companyId, isActive])
  @@map("solar_backup_profiles")
}

/// Manufacturer or utility money the company passes through to the customer.
model SolarRebate {
  id          String   @id @default(uuid())
  companyId   String
  company     Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  vertical    Vertical @default(solar)
  name        String
  amountCents Int
  /// True when the amount is per battery rather than per job.
  perBattery  Boolean  @default(false)
  isActive    Boolean  @default(true)
  rank        Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  deals SolarDealRebate[]

  @@unique([companyId, name])
  @@index([companyId, isActive])
  @@map("solar_rebates")
}

/// One rebate as applied to one deal.
model SolarDealRebate {
  id       String      @id @default(uuid())
  companyId String
  vertical Vertical    @default(solar)
  leadId   String
  lead     Lead        @relation(fields: [leadId], references: [id], onDelete: Cascade)
  rebateId String
  rebate   SolarRebate @relation(fields: [rebateId], references: [id], onDelete: Restrict)
  qty      Int         @default(1)
  /**
   * Copied from the catalogue when the rebate is applied.
   *
   * Editing a rebate in Settings must not move a price a rep has already
   * quoted, for the same reason the proposal snapshot freezes everything else.
   */
  amountCents Int
  createdAt   DateTime @default(now())

  @@unique([leadId, rebateId])
  @@index([companyId, leadId])
  @@map("solar_deal_rebates")
}
```

Add the back-relations: `solarBackupProfiles SolarBackupProfile[]`,
`solarRebates SolarRebate[]` on `Company`, and `solarDealRebates SolarDealRebate[]`
on `Lead`.

- [ ] **Step 4: Add the TOU company assumptions**

The solar settings row already carries company assumptions. Add beside them:

```prisma
  /// What share of a day's kWh falls inside the peak window, %. MODELLED, not
  /// measured — it is the softest number in a storage quote, which is why it is
  /// a company decision listed on the document rather than a constant in code.
  touPeakSharePct         Float @default(30)
  touCyclesPerDay         Float @default(1)
  touRoundTripEfficiency  Float @default(90)
```

Locate the model with `kwhPerKwYear` in `prisma/schema.prisma` and add them there:

Run: `grep -n "kwhPerKwYear" prisma/schema.prisma`

- [ ] **Step 5: Generate the migration**

Run: `npx prisma migrate dev --name storage_only_proposals`

**Read the memory note first:** `migrate dev` wants to reset a local database
that is a clone of live. If it offers to reset, stop and use
`npx prisma migrate dev --create-only`, then apply by hand.

- [ ] **Step 6: Hand-write the backfill into the generated migration**

Append to the generated `migration.sql`:

```sql
-- Existing designs describe themselves from what is already on the row. A blanket
-- default would relabel deals that were sold with a battery.
UPDATE "solar_designs"
   SET "systemType" = 'pv_storage'
 WHERE "batteryId" IS NOT NULL;

UPDATE "solar_designs"
   SET "systemType" = 'pv'
 WHERE "batteryId" IS NULL;

-- Every company starts with the three profiles the proposal reads.
INSERT INTO "solar_backup_profiles" ("id", "companyId", "vertical", "name", "loadWatts", "rank", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), c."id", 'solar', p.name, p.watts, p.rank, true, now(), now()
  FROM "companies" c
 CROSS JOIN (VALUES ('Essentials', 1000, 0), ('Essentials + AC', 3500, 1), ('Whole home', 5000, 2))
       AS p(name, watts, rank)
ON CONFLICT ("companyId", "name") DO NOTHING;
```

Confirm the companies table name first: `grep -n '@@map("companies")' prisma/schema.prisma`.
If it differs, use the real one.

- [ ] **Step 7: Apply and verify**

```bash
npx prisma migrate dev
npx prisma generate
```

Verify the backfill landed rather than trusting the CLI:

```bash
psql "$DATABASE_URL" -c 'SELECT "systemType", count(*) FROM solar_designs GROUP BY 1;'
psql "$DATABASE_URL" -c 'SELECT count(*) FROM solar_backup_profiles;'
```

Expected: every design classified, three profiles per company.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: errors only in files this plan has not reached yet.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "A deal can say it is selling storage"
```

---

## Task 6: Backup load profiles in Settings

**Files:**
- Create: `src/server/modules/solar/storage.ts`
- Create: `src/components/portal/solar-backup-profile-manager.tsx`
- Create: `src/app/portal/settings/solar-backup/page.tsx`
- Modify: the Settings hub card list (find it: `grep -rn "solar-equipment" src/app/portal/settings/page.tsx`)

- [ ] **Step 1: Write the server module**

`src/server/modules/solar/storage.ts` — follow the shape of
`src/server/modules/solar/providers.ts` exactly (same auth guard, same
`revalidatePath`, same zod parse, same `{ ok: true }` / `{ ok: false, error }`
return). Export:

```ts
export type BackupProfileRow = { id: string; name: string; loadWatts: number; rank: number; isActive: boolean };

export async function listBackupProfiles(companyId: string): Promise<BackupProfileRow[]>;
export async function saveBackupProfileAction(input: {
  id?: string; name: string; loadWatts: number; rank: number; isActive: boolean;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }>;
export async function deleteBackupProfileAction(input: { id: string }): Promise<{ ok: true } | { ok: false; error: string }>;
```

Validation: `name` 1–60 chars, `loadWatts` an integer 1–50,000. Deleting the
last active profile is **allowed** — `backupTable` returns an empty list and the
chapter omits itself, which is the designed behaviour, not a broken state.

- [ ] **Step 2: Write the manager component**

Copy the structure of `src/components/portal/solar-provider-manager.tsx`: a
table with inline add/edit rows, a busy flag, and — **per the busy-flag latch
memory** — the flag reset in a `finally`, never only on the success path.

Columns: Name, Load (W), shown-as hours preview for a 27 kWh reference system,
Active, Rank, Delete.

- [ ] **Step 3: Wire the route and the Settings card**

`src/app/portal/settings/solar-backup/page.tsx` mirrors
`src/app/portal/settings/solar-providers/page.tsx` — same RBAC guard, same
`runInVertical("solar", ...)` wrapper, same page chrome.

Add a card to the Settings hub pointing at it, with a live count, matching the
existing solar cards.

- [ ] **Step 4: Verify by hand**

Run: `npm run dev`, open `/portal/settings/solar-backup`.
Expected: the three seeded profiles listed; add, edit, deactivate and delete all work.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/solar/storage.ts src/components/portal/solar-backup-profile-manager.tsx src/app/portal/settings/solar-backup src/app/portal/settings/page.tsx
git commit -m "The company decides what a battery is asked to carry"
```

---

## Task 7: The rebate catalogue

**Files:**
- Modify: `src/server/modules/solar/storage.ts`
- Create: `src/components/portal/solar-rebate-manager.tsx`
- Create: `src/app/portal/settings/solar-rebates/page.tsx`

- [ ] **Step 1: Extend the server module**

```ts
export type RebateRow = { id: string; name: string; amountCents: number; perBattery: boolean; rank: number; isActive: boolean };
export type DealRebateRow = { id: string; rebateId: string; name: string; qty: number; amountCents: number; totalCents: number };

export async function listRebates(companyId: string): Promise<RebateRow[]>;
export async function saveRebateAction(input: {
  id?: string; name: string; amountCents: number; perBattery: boolean; rank: number; isActive: boolean;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }>;
export async function deleteRebateAction(input: { id: string }): Promise<{ ok: true } | { ok: false; error: string }>;

/** The rebates applied to one deal, with `totalCents` already multiplied out. */
export async function listDealRebates(companyId: string, leadId: string): Promise<DealRebateRow[]>;

/**
 * Apply a rebate to a deal, copying the amount off the catalogue AT THIS
 * MOMENT. A later edit in Settings must not move a price already quoted.
 * `qty` is forced to the design's battery count on a per-battery rebate.
 */
export async function applyDealRebateAction(input: { leadId: string; rebateId: string }): Promise<{ ok: true } | { ok: false; error: string }>;
export async function removeDealRebateAction(input: { leadId: string; rebateId: string }): Promise<{ ok: true } | { ok: false; error: string }>;

/** Σ(amountCents × qty). The single number both pricing functions take. */
export async function dealRebateTotalCents(companyId: string, leadId: string): Promise<number>;
```

Validation: `amountCents` an integer 1–10,000,000. Deleting a catalogue rebate
that is applied to a deal must be **refused** with a message naming the count —
`SolarDealRebate.rebateId` is `onDelete: Restrict` and a raw Prisma error is not
a message a human can act on.

- [ ] **Step 2: Write the manager and the route**

Same pattern as Task 6: `solar-rebate-manager.tsx` and
`/portal/settings/solar-rebates`, plus a Settings hub card. Columns: Name,
Amount, Per battery / Per job, Active, Rank.

- [ ] **Step 3: Verify by hand**

Run: `npm run dev`, open `/portal/settings/solar-rebates`.
Add "Tesla battery rebate", $500, per battery. Expected: saves, lists, and
deleting it while unapplied succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/server/modules/solar/storage.ts src/components/portal/solar-rebate-manager.tsx src/app/portal/settings/solar-rebates src/app/portal/settings/page.tsx
git commit -m "The manufacturer's money, priced once and passed through"
```

---

## Task 8: TOU rates on the provider, the band on the lender, the flag on the product

Three small Settings edits, one commit each is overkill — one task.

**Files:**
- Modify: `src/components/portal/solar-provider-manager.tsx`
- Modify: `src/components/portal/solar-lender-manager.tsx`
- Modify: the finance-product editor inside `solar-lender-manager.tsx`
- Modify: their server actions in `src/server/modules/solar/`

- [ ] **Step 1: Provider TOU fields**

Add three inputs to the electric-provider row, beside the existing buyback rate:
Peak rate ($/kWh, stored as mills), Off-peak rate ($/kWh, stored as mills),
Peak window (free text, e.g. `4pm – 8pm`).

Validate: both rates 1–2000 mills, or both null. **A provider with one rate and
not the other is rejected** — a half-filled pair silently omits the savings line
with nothing on screen saying why.

- [ ] **Step 2: Lender per-battery band**

Add to the lender editor, in a "Storage" group under the existing $/W group:
Min base $/battery, Max final $/battery, and a cap/flat toggle bound to
`finalBatteryPriceMode`. Label the group so it is obvious these do not apply to
PV deals.

- [ ] **Step 3: Product storage flag**

Add a `financesStorageOnly` checkbox to each finance product row, labelled
"Funds storage-only deals".

- [ ] **Step 4: Verify by hand**

Run: `npm run dev`. Set TXU peak $0.24 / off-peak $0.09 / `4pm – 8pm`; set Amos
min base $9,000 and max final $16,000 flat; tick "Funds storage-only" on one
Amos loan product.
Expected: all three persist across a reload. Entering a peak rate with no
off-peak rate shows the rejection message.

- [ ] **Step 5: Commit**

```bash
git add src/components/portal/solar-provider-manager.tsx src/components/portal/solar-lender-manager.tsx src/server/modules/solar
git commit -m "Peak, off-peak, a floor per battery and paper that funds one"
```

---

## Task 9: The question at the top of step 1

**Files:**
- Modify: `src/components/portal/solar-proposal-builder.tsx:29-72` (`StepId`, `STEPS`)
- Modify: `src/components/portal/solar-customer-panel.tsx`
- Modify: `src/server/modules/solar/` — the customer-step save action
- Modify: `src/app/portal/leads/[id]/solar-proposal/design/page.tsx` — select `systemType`
- Test: `src/server/modules/solar/__tests__/system-type.itest.ts` (create)

- [ ] **Step 1: Write the failing integration test**

```ts
// src/server/modules/solar/__tests__/system-type.itest.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";

process.env.SOLAR_VERTICAL_ENABLED = "1";
const session = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { setSolarSystemTypeAction } = await import("../design-actions");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
let companyId: string;
let leadId: string;

// ... fixture setup mirroring src/server/modules/solar/__tests__/battery-qty.itest.ts ...

describe("systemType", () => {
  it("stores what the rep picked", async () => {
    const r = await runInVertical("solar", () => setSolarSystemTypeAction({ leadId, systemType: "storage" }));
    expect(r.ok).toBe(true);
    const d = await db.solarDesign.findUnique({ where: { leadId }, select: { systemType: true } });
    expect(d?.systemType).toBe("storage");
  });

  it("clears the array when a PV deal becomes storage-only", async () => {
    await db.solarDesign.update({
      where: { leadId },
      data: { systemSizeKwDc: 10.14, year1ProductionKwh: 14_500, offsetPct: 96 },
    });
    await runInVertical("solar", () => setSolarSystemTypeAction({ leadId, systemType: "storage" }));
    const d = await db.solarDesign.findUnique({
      where: { leadId },
      select: { systemSizeKwDc: true, year1ProductionKwh: true, offsetPct: true },
    });
    // A storage document must not be able to inherit a production figure from a
    // design the rep abandoned. Left behind, it reaches the snapshot.
    expect(d?.systemSizeKwDc).toBe(0);
    expect(d?.year1ProductionKwh).toBe(0);
    expect(d?.offsetPct).toBe(0);
  });

  it("rejects a value that is not one of the three", async () => {
    const r = await runInVertical("solar", () =>
      setSolarSystemTypeAction({ leadId, systemType: "batteries" as never })
    );
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:integration -- src/server/modules/solar/__tests__/system-type.itest.ts`
Expected: FAIL — `setSolarSystemTypeAction` does not exist.

- [ ] **Step 3: Write the action**

In the solar design actions module (`grep -rn "setSolarDesignEquipmentAction" src/server/modules/solar/` to find the file it belongs beside):

```ts
const SystemTypeInput = z.object({
  leadId: z.string().uuid(),
  systemType: z.enum(["pv", "pv_storage", "storage"]),
});

/**
 * What this deal is selling.
 *
 * Switching TO storage clears the array figures. A rep who designed 10 kW and
 * then decided the customer only wants the battery leaves a production number
 * on the row, and nothing downstream would know not to trust it — the snapshot
 * copies what it finds. Clearing here is the one place that can be sure.
 *
 * Switching AWAY from storage clears nothing: the roof was never drawn, so
 * there is nothing stale to remove, and the battery stays because a
 * solar-plus-storage deal wants it.
 */
export async function setSolarSystemTypeAction(input: unknown) {
  const parsed = SystemTypeInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Pick solar, solar + storage, or storage only." };
  const { leadId, systemType } = parsed.data;
  // ...auth + company scope exactly as setSolarDesignEquipmentAction does...

  await db.solarDesign.update({
    where: { leadId },
    data: {
      systemType,
      ...(systemType === "storage"
        ? { systemSizeKwDc: 0, year1ProductionKwh: 0, offsetPct: 0, layoutBlocks: [], layoutSetbacks: [], yieldSource: null, yieldStation: null, yieldArrays: 0 }
        : {}),
    },
  });
  revalidatePath(`/portal/leads/${leadId}/solar-proposal`);
  return { ok: true as const };
}
```

- [ ] **Step 4: Put the question on the Customer panel**

At the top of `SolarCustomerPanel`, above the name and address, a three-option
radio group:

```
What are we quoting?
( ) Solar        (•) Solar + Storage        ( ) Storage only
```

It saves on change (not behind the panel's Save button) because every other
step reshapes from it — a rep who picks "Storage only" and then walks to the
Design step must not find the roof designer still there. Guard the in-flight
state with a busy flag reset in a `finally`.

- [ ] **Step 5: Reshape the steps**

In `solar-proposal-builder.tsx`, take `systemType` as a prop and derive:

```tsx
const isStorage = systemType === "storage";

const STEPS: Step[] = [
  { id: "customer", label: "Customer", title: "Customer", blurb: "...", icon: User },
  { id: "energy", label: "Energy", title: "Energy", blurb: "...", icon: Zap },
  {
    id: "design",
    label: isStorage ? "Storage" : "System design",
    title: isStorage ? "Storage" : "System design",
    blurb: isStorage
      ? "Which battery, and how many. There is no array on this deal."
      : "The array on the roof, and the size and output that follow from it.",
    icon: isStorage ? BatteryCharging : Hammer,
  },
  { id: "financing", label: "Financing", title: "Price & financing", blurb: "...", icon: Landmark },
  { id: "generate", label: "Review & send", title: "Review & send", icon: Sun },
];
```

Import `BatteryCharging` from `lucide-react`. **The step list stays five long
and every step stays mounted** — the existing comment explains why unmounting
loses a rep's unsaved edits, and that reason does not change here.

- [ ] **Step 6: Run the test**

Run: `npm run test:integration -- src/server/modules/solar/__tests__/system-type.itest.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/portal/solar-proposal-builder.tsx src/components/portal/solar-customer-panel.tsx src/server/modules/solar src/app/portal/leads/\[id\]/solar-proposal
git commit -m "Ask what we are quoting before quoting it"
```

---

## Task 10: The Design step becomes a Storage step

**Files:**
- Create: `src/components/portal/solar-storage-panel.tsx`
- Modify: `src/components/portal/solar-proposal-builder.tsx`
- Modify: `src/app/portal/leads/[id]/solar-proposal/design/page.tsx`

- [ ] **Step 1: Write the panel**

`SolarStoragePanel` renders when `systemType === "storage"` in place of
`SolarDesignPanel`. It shows:

- The battery selector — the **same** catalogue query and the same
  approved-vendor-list filter `SolarDesignPanel` already uses, so a lender's AVL
  still binds. Reuse the existing picker component rather than writing a second one.
- Quantity, defaulting from the company's default battery quantity setting on
  first pick, exactly as the roof designer does today.
- Usable storage, derived and read-only: `usableKwh(battery.ratingW, qty)` kWh.
- The backup table from `backupTable(usableKwh, profiles)` — every active
  profile with its hours, so the rep sees what the customer will see.

It does **not** show: the roof designer, roof planes, the facing arrow, mount
type, TSRF, PVWatts, autofill, the layout upload or the layout approval control.

```tsx
export type SolarStorageView = {
  batteryId: string | null;
  batteryQty: number;
  batteryRatingWh: number | null;
  profiles: BackupProfile[];
};
```

- [ ] **Step 2: Branch the builder**

```tsx
{isStorage ? (
  <SolarStoragePanel leadId={leadId} canEdit={canEditDeal} view={storage} />
) : (
  <SolarDesignPanel {...designProps} />
)}
```

Keep both inside the same `display:none` wrapper the other steps use.

- [ ] **Step 3: Feed it from the page**

In `src/app/portal/leads/[id]/solar-proposal/design/page.tsx`, add `systemType`
to the design `select` and load the active backup profiles for the company.

- [ ] **Step 4: Verify by hand**

Run: `npm run dev`. On a lead, pick "Storage only", walk to the Storage step.
Expected: battery picker and quantity only; usable kWh updates as the quantity
changes; the backup table shows three rows with real hours. No roof designer
anywhere on the step.

- [ ] **Step 5: The per-deal TOU override on the Energy step**

`SolarDesign.touPeakRateMills` / `touOffPeakRateMills` exist from Task 5 and
nothing writes them yet. On the Energy step, when `systemType === "storage"`,
add below the existing rate control:

```
Peak rates
(o) Use TXU Energy's rates        $0.24 peak / $0.09 off-peak, 4pm - 8pm
( ) Override for this deal        [ peak $ ] [ off-peak $ ]
```

Selecting "Use the provider's" writes NULL to both columns — null means "read
the provider", which is what `touSavings` is handed. Overriding writes both.
**Reject one without the other**, the same rule the provider editor enforces in
Task 8: a half-filled pair silently omits the savings line with nothing on
screen saying why.

The control is hidden entirely on a PV deal — nothing reads these columns there.

- [ ] **Step 6: Verify by hand**

Run: `npm run dev`. On the storage deal, override the peak rate to $0.31.
Expected: persists across a reload; clearing back to "use the provider's" nulls
both columns.

- [ ] **Step 7: Commit**

```bash
git add src/components/portal/solar-storage-panel.tsx src/components/portal/solar-energy-panel.tsx src/components/portal/solar-proposal-builder.tsx src/app/portal/leads/\[id\]/solar-proposal/design/page.tsx
git commit -m "There is no roof to draw on a battery"
```

---

## Task 11: Pricing a storage deal in the Financing step

**Files:**
- Modify: `src/components/portal/solar-panels.tsx` (`SolarFinancePanel`)
- Modify: the finance save action and `src/lib/solar-finance-row.ts`
- Modify: `src/components/portal/solar-adders-panel.tsx` (rebate lines)

- [ ] **Step 1: Swap the rate box**

When `systemType === "storage"`, the "$/W" input becomes "**$ per battery**",
bound to `stickerPricePerBatteryCents` through the same
`grossPpwFromNet` / `basePpwFromSticker` conversion the $/W box uses — the rep
types the base, the row stores the sticker.

The price card's rows keep their words — Base, Adders, Rebate, Gross, Fee,
Final — and read `priceStorageStored(...)` instead of `priceStoredPurchase(...)`.
Per-unit figures read "per battery", never "/W".

- [ ] **Step 2: Enforce the band**

Reuse `underBaseFloor(stickerPricePerBatteryCents, dealerFeePct, lender.minBasePricePerBatteryCents)`
and surface the cap from `priceStorageStored`, with the same wording the $/W
path uses. **A price the lender's rule moved must say so on screen** — a price
that silently changed is a price nobody trusts, and that is why `cap.capped`
comes back at all.

- [ ] **Step 3: Filter the finance shelf**

On a storage deal, the shelf lists only products where
`financesStorageOnly === true`. When none qualify:

> No lender on file funds a storage-only job yet. Tick "Funds storage-only
> deals" on a finance product in Settings → Solar lenders.

An empty shelf with no explanation is a rep on the phone to the office.

- [ ] **Step 4: Add the rebate lines**

Below the adder lines, a "Rebates" group listing the company's active rebates
with an apply/remove control per row and the applied total. Per-battery rebates
show `qty × amount` using the design's battery count.

The total flows into `rebateTotalCents` on both pricing calls. **Nothing is
applied by default**, so every deal in flight prices exactly as it does today.

- [ ] **Step 5: Verify by hand**

Run: `npm run dev`. On the storage deal from Task 10: type $13,000 a battery on
a 25% product with a $2,700 adder and the $500 per-battery Tesla rebate.
Expected price card:

```
Base     2 x $13,000    $26,000
Adders                   $2,700
Rebate   2 x $500        -$1,000
Gross                   $27,700
Fee                      $9,233
Final                   $36,933
```

Then set the Amos min base to $14,000 and re-enter $13,000.
Expected: blocked, with the floor named.

- [ ] **Step 6: Commit**

```bash
git add src/components/portal/solar-panels.tsx src/components/portal/solar-adders-panel.tsx src/lib/solar-finance-row.ts src/server/modules/solar
git commit -m "A price per battery, held to the same floor and ceiling"
```

---

## Task 12: Readiness

`solar-validation.ts` exports `validateDesign(design, leadId?)` and
`validateFinance(...)`, over `DesignForValidation` / `FinanceForValidation`,
returning `ValidationIssue[]` whose `code` is stable and machine-readable. Those
are the names to use — there is no `proposalIssues`.

**Files:**
- Modify: `src/lib/solar-validation.ts:91-160` (the input types), `:216-380` (`validateDesign`), `:381-590` (`validateFinance`)
- Test: `src/lib/__tests__/solar-validation-storage.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/solar-validation-storage.test.ts
import { describe, it, expect } from "vitest";
import {
  validateDesign, validateFinance, canGenerate,
  type DesignForValidation, type FinanceForValidation,
} from "@/lib/solar-validation";

const STORAGE_DESIGN: DesignForValidation = {
  systemType: "storage",
  systemSizeKwDc: 0,
  year1ProductionKwh: 0,
  annualUsageKwh: 12_000,
  offsetPct: 0,
  moduleQty: 0,
  moduleRatingW: null,
  avgMonthlyBillCents: 250_00,
  hasBattery: true,
  batteryQty: 2,
  hasBackupProfile: true,
};

const STORAGE_FINANCE: FinanceForValidation = {
  systemType: "storage",
  product: "loan",
  grossPpwCents: 0,
  stickerPricePerBatteryCents: 17_333_33,
  minBasePricePerBatteryCents: 9_000_00,
  financesStorageOnly: true,
  dealerFeePct: 25,
  contractPriceCents: 36_933_33,
  rateMillsPerKwh: null,
  monthlyPaymentCents: 450_00,
  escalatorPct: null,
  termYears: null,
  downPaymentCents: 0,
  loanMonthlyPaymentCents: 450_00,
  aprPct: 6.99,
  loanTermMonths: 300,
};

const codes = (i: { code: string }[]) => i.map((x) => x.code).join(" ");

describe("storage readiness", () => {
  it("does not ask a battery for an array", () => {
    const c = codes(validateDesign(STORAGE_DESIGN));
    expect(c).not.toMatch(/module|plane|production|offset|layout|tsrf/i);
  });

  it("generates when the storage deal is complete", () => {
    expect(canGenerate([...validateDesign(STORAGE_DESIGN), ...validateFinance(STORAGE_FINANCE)])).toBe(true);
  });

  it("blocks on no battery", () => {
    expect(canGenerate(validateDesign({ ...STORAGE_DESIGN, hasBattery: false }))).toBe(false);
  });

  it("blocks on a zero battery count", () => {
    expect(canGenerate(validateDesign({ ...STORAGE_DESIGN, batteryQty: 0 }))).toBe(false);
  });

  it("blocks with no backup profile — the document could not state hours", () => {
    expect(canGenerate(validateDesign({ ...STORAGE_DESIGN, hasBackupProfile: false }))).toBe(false);
  });

  it("blocks on a zero price per battery", () => {
    expect(canGenerate(validateFinance({ ...STORAGE_FINANCE, stickerPricePerBatteryCents: 0 }))).toBe(false);
  });

  it("blocks under the lender's per-battery floor", () => {
    // $11,000 sticker at 25% leaves $8,250, under a $9,000 floor.
    expect(canGenerate(validateFinance({ ...STORAGE_FINANCE, stickerPricePerBatteryCents: 11_000_00 }))).toBe(false);
  });

  it("blocks on paper that does not fund storage", () => {
    expect(canGenerate(validateFinance({ ...STORAGE_FINANCE, financesStorageOnly: false }))).toBe(false);
  });
});

describe("a PV deal is judged exactly as before", () => {
  const PV: DesignForValidation = {
    systemType: "pv",
    systemSizeKwDc: 10.14,
    year1ProductionKwh: 14_500,
    annualUsageKwh: 15_000,
    offsetPct: 96,
    moduleQty: 26,
    moduleRatingW: 390,
    avgMonthlyBillCents: 250_00,
  };

  it("still validates without a systemType at all", () => {
    // Callers not yet updated must behave as they did: absent means pv.
    const { systemType: _drop, ...legacy } = PV;
    expect(validateDesign(legacy as DesignForValidation)).toEqual(validateDesign(PV));
  });

  it("still demands an array", () => {
    expect(canGenerate(validateDesign({ ...PV, moduleQty: 0 }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/lib/__tests__/solar-validation-storage.test.ts`
Expected: FAIL — the new fields are not on the types, and the PV gates fire on a
design with no array.

- [ ] **Step 3: Widen the input types**

```ts
export type DesignForValidation = {
  /**
   * What this deal sells. OPTIONAL and `pv` when absent, so a caller not yet
   * updated is judged exactly as it was — the safe direction, and the same one
   * `maxFinalPpwCents` already takes on the finance shape.
   */
  systemType?: "pv" | "pv_storage" | "storage";
  batteryQty?: number;
  /** Whether the company has any active backup profile for hours to come from. */
  hasBackupProfile?: boolean;
  // ...existing fields unchanged...
};

export type FinanceForValidation = {
  systemType?: "pv" | "pv_storage" | "storage";
  stickerPricePerBatteryCents?: number;
  minBasePricePerBatteryCents?: number | null;
  maxFinalPricePerBatteryCents?: number | null;
  finalBatteryPriceMode?: FinalPpwMode | null;
  /** Whether the chosen product's paper funds a battery with no array. */
  financesStorageOnly?: boolean;
  // ...existing fields unchanged...
};
```

- [ ] **Step 4: Branch the gates**

In `validateDesign`, wrap the array gates — module, roof planes, production,
offset, TSRF, layout — in `if (d.systemType !== "storage")`, and add a storage
group after them:

| `code` | severity | message |
|---|---|---|
| `storage_no_battery` | block | "Pick a battery before generating a proposal." |
| `storage_no_qty` | block | "Say how many batteries this deal installs." |
| `storage_no_backup_profile` | block | "Add a backup load profile in Settings so the proposal can state backup hours." |

In `validateFinance`, wrap the $/W gates in `if (f.systemType !== "storage")`
and add:

| `code` | severity | message |
|---|---|---|
| `storage_no_price` | block | "Price the batteries before generating a proposal." |
| `storage_under_floor` | block | "This price leaves less per battery than this lender allows." |
| `storage_product_not_eligible` | block | "This lender's paper does not fund a storage-only job." |

Each carries the same `action` link the neighbouring issues do — the readiness
report links straight to the screen that fixes each finding, and a storage issue
with no link is a rep hunting for the tab.

Use `underBaseFloor(f.stickerPricePerBatteryCents, f.dealerFeePct, f.minBasePricePerBatteryCents)`
for the floor. It is unit-agnostic already; do not write a second comparison.

- [ ] **Step 5: Run the tests**

Run: `npm test -- src/lib/__tests__/`
Expected: PASS, including every existing PV validation test.

- [ ] **Step 6: Commit**

```bash
git add src/lib/solar-validation.ts src/lib/__tests__/solar-validation-storage.test.ts
git commit -m "Do not ask a battery for an array"
```

---

## Task 13: Snapshot v5

**Files:**
- Modify: `src/lib/solar-proposal.ts:681-859` (`SolarProposalSnapshot`)
- Modify: `src/server/modules/solar/proposal-generate.ts`
- Test: `src/server/modules/solar/__tests__/storage-snapshot.itest.ts` (create)

- [ ] **Step 1: Widen the type**

```ts
  /**
   * v5 adds the system type and the storage block: a battery makes no
   * kilowatt-hours, so a document about one is argued from backup hours,
   * programme earnings and a time-of-use spread instead of from production.
   */
  schemaVersion: 1 | 2 | 3 | 4 | 5;

  /**
   * What this deal sold. ABSENT on every document generated before v5, and
   * absent means `pv` for rendering: those proposals were all arrays, and the
   * renderer must keep drawing them exactly as it does now.
   */
  systemType?: "pv" | "pv_storage" | "storage";

  /**
   * The storage argument, frozen. Null on a PV deal and on every older
   * document.
   *
   * `tou` is null — not zeroed — when the utility's peak rate is not on file.
   * The renderer omits the line. A zero beside a real backup figure reads as
   * "this battery saves you nothing", which is a different and untrue claim
   * from "we do not have your peak rate".
   */
  storage?: {
    batteryLabel: string | null;
    batteryQty: number;
    usableKwh: number;
    backup: { name: string; loadWatts: number; hours: number }[];
    tou: {
      peakRateMills: number;
      offPeakRateMills: number;
      peakWindow: string | null;
      shiftedKwhPerDay: number;
      annualSavingsCents: number;
      /** The assumptions this figure came from, frozen beside it. */
      peakSharePct: number;
      cyclesPerDay: number;
      roundTripEfficiencyPct: number;
    } | null;
    rebates: { name: string; qty: number; amountCents: number; totalCents: number }[];
  } | null;
```

- [ ] **Step 2: Write the failing integration test**

```ts
// src/server/modules/solar/__tests__/storage-snapshot.itest.ts
// Fixture setup mirrors src/server/modules/solar/__tests__/battery-qty.itest.ts:
// same hoisted session mock, same unextended PrismaClient, same runInVertical.

/** Generate and hand back the frozen document. */
const snapshotFor = async (id: string): Promise<SolarProposalSnapshot> => {
  const p = await runInVertical("solar", () => generateSolarProposal({ leadId: id }));
  if (!p.ok) throw new Error(`generation refused: ${p.error}`);
  return p.proposal.snapshot as SolarProposalSnapshot;
};

describe("generating a storage proposal", () => {
  it("writes v5 with a storage block and no production", async () => {
    const s = await snapshotFor(storageLeadId);
    expect(s.schemaVersion).toBe(5);
    expect(s.systemType).toBe("storage");
    expect(s.storage).not.toBeNull();
    expect(s.storage!.usableKwh).toBe(27);          // 2 x 13,500 Wh
    expect(s.storage!.backup).toHaveLength(3);
    expect(s.storage!.backup[0].name).toBe("Essentials");
    expect(s.system.sizeKwDc).toBe(0);
    expect(s.system.year1ProductionKwh).toBe(0);
    expect(s.monthly ?? null).toBeNull();
  });

  it("freezes the assumptions the TOU figure came from", async () => {
    const s = await snapshotFor(storageLeadId);
    expect(s.storage!.tou).not.toBeNull();
    expect(s.storage!.tou!.peakSharePct).toBe(30);
    expect(s.storage!.tou!.annualSavingsCents).toBeGreaterThan(0);
  });

  it("omits the TOU block — null, not zero — when the provider has no peak rate", async () => {
    await db.solarProvider.update({
      where: { id: providerId },
      data: { touPeakRateMills: null, touOffPeakRateMills: null },
    });
    const s = await snapshotFor(storageLeadId);
    expect(s.storage!.tou).toBeNull();
  });

  it("still carries the VPP credits with no array attached", async () => {
    const s = await snapshotFor(storageLeadId);
    expect((s.vpp ?? []).length).toBeGreaterThan(0);
  });

  it("a pv_storage deal is a v5 document with no storage block and real production", async () => {
    const s = await snapshotFor(pvStorageLeadId);
    expect(s.systemType).toBe("pv_storage");
    expect(s.storage ?? null).toBeNull();
    expect(s.system.year1ProductionKwh).toBeGreaterThan(0);
  });
});
```

The third assertion is the one flagged in the spec as unverified: `vpp-credits.ts`
keys off `batteryId`, `batteryQty`, the finance product and the provider, and
appears not to gate on system size. **This test is where that gets confirmed
rather than assumed.** If it fails, fix `vpp-credits.ts` — a VPP credit that
vanishes on storage-only deals removes the one earnings figure the document has.

- [ ] **Step 3: Run it and watch it fail**

Run: `npm run test:integration -- src/server/modules/solar/__tests__/storage-snapshot.itest.ts`
Expected: FAIL — `schemaVersion` is 4 and `storage` is undefined.

- [ ] **Step 4: Build the block in generation**

In `proposal-generate.ts`, alongside the existing equipment gathering
(around line 364 and 491):

```ts
const isStorage = design.systemType === "storage";

const kwh = usableKwh(design.battery?.ratingW ?? null, design.batteryQty);

const storage = isStorage
  ? {
      batteryLabel: design.battery ? solarEquipmentLabel(design.battery) : null,
      batteryQty: design.batteryQty,
      usableKwh: usableKwh(design.battery?.ratingW ?? null, design.batteryQty),
      backup: backupTable(kwh, profiles).map(({ name, loadWatts, hours }) => ({ name, loadWatts, hours })),
      tou: touRow,          // built from touSavings(...), null when it returns null
      rebates: rebateRows,  // from listDealRebates
    }
  : null;
```

Set `schemaVersion: 5`, `systemType: design.systemType`, and pass
`rebateTotalCents` into whichever pricing call the deal takes. Leave the
existing `system` block populated as it already is — on a storage deal its
production fields are genuinely 0 and printing them is not this layer's decision.

- [ ] **Step 5: Run the tests**

Run: `npm run test:integration -- src/server/modules/solar/__tests__/`
Expected: PASS, including every existing proposal-generation test.

- [ ] **Step 6: Commit**

```bash
git add src/lib/solar-proposal.ts src/server/modules/solar/proposal-generate.ts src/server/modules/solar/__tests__/storage-snapshot.itest.ts
git commit -m "A frozen document that knows it is about a battery"
```

---

## Task 14: The customer's document

**Files:**
- Create: `src/components/proposal/solar/storage.tsx`
- Modify: `src/components/proposal/solar/index.tsx` (route at the top only)
- Modify: `src/components/proposal/solar/print.tsx`

- [ ] **Step 1: Route on system type**

At the top of the exported component in `index.tsx`:

```tsx
  // A battery is a different argument, not a smaller one. Absent means a
  // document generated before v5 — all of those were arrays.
  if (snapshot.systemType === "storage") {
    return <SolarStorageProposal {...props} />;
  }
```

Everything below is untouched. That single `if` is the whole of the PV
document's change, which is what "Both is identical to today" means.

- [ ] **Step 2: Write the six chapters**

`src/components/proposal/solar/storage.tsx`, importing `Chapter`, `Stat`,
`SpecList`, `DarkRow`, `EquipCard`, `SourceLink` and `ContactCard` from
`./primitives` and reusing `cover.tsx`, `deck.tsx`, `accept.tsx` and
`certificate.tsx` unchanged.

```tsx
const chapters = [
  { id: "today", label: "Today" },
  { id: "system", label: "System" },
  { id: "protection", label: "Protection" },
  { id: "cost", label: "Your cost" },
  { id: "timeline", label: "Next" },
  { id: "accept", label: "Accept" },
];
```

| Chapter | Content | Omission rule |
|---|---|---|
| Today | Their bill, their derived rate, their provider | — |
| System | Battery label, quantity, usable kWh, inverter. **No module card** | — |
| Protection | The backup table, VPP earnings, TOU savings | Omitted entirely if backup is empty AND vpp is empty AND tou is null |
| Your cost | Base, adders, rebate lines, gross, fee, final, the payment menu | — |
| Next | The install timeline, unchanged from the PV document | — |
| Accept | Signature block, ESIGN certificate, battery FAQ | — |

The cover headlines usable kWh and the hours on `storage.backup[0]` — the
lowest-load profile, first because the list is rank-ordered.

**Do not render:** offset %, the production chart, the 25-year table, the
environmental equivalences, or the roof layout drawing. Rule 1 of the existing
document holds: a chapter with no data is omitted, never rendered empty.

- [ ] **Step 3: Replace the FAQ**

The PV FAQ in `solar-proposal.ts:177` answers "What happens when the power goes
out?" with a note about adding a battery — nonsense on a document selling one.
Add a storage FAQ list beside it: what the battery covers and for how long, what
happens when it runs down, whether it charges from the grid, what the programme
enrolment commits them to, and what the warranty covers.

- [ ] **Step 4: Print**

In `print.tsx`, route storage snapshots to the storage document under the same
`11in x 8.5in` landscape page box the PV proposal uses, keeping
`print-color-adjust` and `preferCSSPageSize`. The chosen seams are per-chapter,
so re-check that no storage chapter fragments across a sheet.

- [ ] **Step 5: Verify by eye**

Run: `npm run dev`, open the storage deal's proposal preview, then print to PDF.
Expected: six chapters, no zeroes standing in for production, backgrounds
intact, no blank sheets.

- [ ] **Step 6: Commit**

```bash
git add src/components/proposal/solar/storage.tsx src/components/proposal/solar/index.tsx src/components/proposal/solar/print.tsx src/lib/solar-proposal.ts
git commit -m "Six chapters about a battery"
```

---

## Task 15: Payroll

**Files:**
- Modify: `src/server/modules/payroll/solar-engine.ts:25-200`
- Test: `src/server/modules/payroll/__tests__/storage-commission.itest.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
describe("storage commissions", () => {
  it("pays the per-battery redline", async () => {
    // 2 batteries at $13,000 base, rep redline $9,000 => $8,000... check against
    // the ACTUAL base price the ladder produces, not the typed figure.
    const rows = await commissionsFor(projectId);
    expect(rows[0].amount).toBeGreaterThan(0);
    expect(rows[0].label).toMatch(/battery redline/i);
  });

  it("writes NO line and records the refusal when the lender pays per watt", async () => {
    await db.solarLender.update({ where: { id: lenderId }, data: { repPayMode: "per_watt" } });
    const rows = await commissionsFor(projectId);
    expect(rows.filter((r) => r.amount > 0)).toHaveLength(0);
    // and the run reports it — assert on whatever computeSolarCommissionsForProject
    // surfaces, not on a silent absence.
  });

  it("never pays the whole base price", async () => {
    await db.solarDesign.update({ where: { leadId }, data: { batteryQty: 0 } });
    const rows = await commissionsFor(projectId);
    expect(rows.every((r) => r.amount === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Teach `loadSolarDeal` about storage**

Replace the early return:

```ts
  if (!(design.systemSizeKwDc > 0)) return null;
```

with:

```ts
  const isStorage = design.systemType === "storage";
  // A PV deal with no array drawn still has nothing to pay on. A storage deal
  // with no batteries likewise. The two ask different questions of the row.
  if (isStorage ? !(design.batteryQty > 0) : !(design.systemSizeKwDc > 0)) return null;
```

Add `systemType`, `batteryQty` and the lender's per-battery band to the two
`select`s, and price storage through `priceStorageStored`:

```ts
  const purchase = isStorage
    ? (finance.product === "cash" || finance.product === "loan"
        ? priceStorageStored({
            product: finance.product,
            batteryQty: design.batteryQty,
            stickerPricePerBatteryCents: finance.stickerPricePerBatteryCents,
            dealerFeePct: finance.dealerFeePct,
            adderTotalCents: finance.adderTotalCents,
            onTopAdderTotalCents: finance.onTopAdderTotalCents,
            maxFinalPricePerBatteryCents: design.lender?.maxFinalPricePerBatteryCents ?? null,
            finalBatteryPriceMode: design.lender?.finalBatteryPriceMode,
          }).breakdown
        : null)
    : /* ...the existing priceStoredPurchase call, unchanged... */;
```

Return `systemType`, `batteryQty` and `systemWatts: isStorage ? 0 : ...` alongside
what it returns today.

- [ ] **Step 3: Handle the three-way resolution**

```ts
    const resolution =
      existing && snapshotFrom(existing)
        ? ({ kind: "terms", terms: snapshotFrom(existing)! } as const)
        : rep
          ? resolveSolarPay({
              systemType: deal?.systemType ?? "pv",
              product: deal!.product,
              lenderPayMode: deal!.lenderPayMode,
              rep,
            })
          : ({ kind: "unconfigured" } as const);

    if (resolution.kind === "refused") {
      // Surfaced, never swallowed. A rule that cannot price this deal is a
      // misconfiguration somebody has to fix, and it must not look like a rep
      // who is simply owed nothing.
      refusals.push({ projectId: project.id, repId, reason: resolution.reason });
    } else if (resolution.kind === "terms") {
      // ...the existing create/update path, with batteryQty passed to solarRepPayCents...
    } else if (existing) {
      await db.commission.delete({ where: { id: existing.id } });
    }
```

Return the refusals from `computeSolarCommissionsForProject` alongside the
created count, and surface them on the payroll run screen as unpayable lines
naming the deal and the reason.

- [ ] **Step 4: Widen `snapshotFrom`**

It currently narrows on `row.solarBasis !== "redline" && !== "per_watt"`. Add
`battery_redline` and read a stored per-battery redline. That needs a column:

```prisma
model Commission {
  solarRedlinePerBatteryCents Int?
}
```

Add it in a follow-up migration in this task — an existing line must keep the
redline it was sold against, which is the whole point of the snapshot columns.

- [ ] **Step 5: Run the tests**

Run: `npm run test:integration -- src/server/modules/payroll/`
Expected: PASS, including every existing solar payroll test.

- [ ] **Step 6: Full typecheck**

Run: `npm run typecheck`
Expected: clean. This is the task that closes the gap Task 4 opened.

- [ ] **Step 7: Commit**

```bash
git add src/server/modules/payroll prisma
git commit -m "Pay the battery deal, or say why you cannot"
```

---

## Task 16: End to end

**Files:**
- Create: `e2e/solar-storage-proposal.spec.ts`

- [ ] **Step 1: Read the existing spec first**

Run: `sed -n '1,80p' e2e/solar-proposal-builder.spec.ts`

Take from it: the login helper, how a solar lead is seeded, how the builder is
opened, and how it waits for each step. **Write the two tests below against
those helpers** — selectors invented here would be guesses.

Heed the **required-custom-field trap**: lead creation times out because a
seeded REQUIRED "Damage Type" field is unfilled, not because the form is broken.

- [ ] **Step 2: Write the spec**

```ts
test("a rep can build and generate a storage-only proposal", async ({ page }) => {
  // 1. Open a solar lead's proposal builder
  // 2. Step 1: choose "Storage only"
  // 3. Step 2: enter a bill and a rate
  // 4. Step 3: pick a battery, set the quantity to 2
  //    expect: usable kWh reads 27, three backup rows, NO roof designer
  // 5. Step 4: price $13,000 a battery on a storage-capable product,
  //    apply the Tesla rebate
  //    expect: the price card's Final matches the ladder
  // 6. Step 5: generate
  //    expect: six chapter links; no "offset", no 25-year table,
  //            no module card, no production chart
});

test("a solar + storage deal generates the document it always did", async ({ page }) => {
  // The regression guard. Build a pv_storage deal and assert the PV chapters
  // are all present and unchanged: offset %, the production chart, the
  // 25-year table and the environmental chapter.
  //
  // This is the promise "Both is identical" makes, and it is the one thing in
  // this feature that can break deals already in flight.
});
```

Use `getByRole` and visible text. Per the **aria-label trap**: an `aria-label`
on a wrapper hides the badge text underneath it from `getByText`, so assert on
the role and the accessible name, not on a bare string.

- [ ] **Step 3: Run it**

Run: `npx playwright test e2e/solar-storage-proposal.spec.ts`
Expected: PASS, both.

If port 3001 is held by another session, do not kill it — read the
**parallel-e2e memory** and use a separate port and build directory.

- [ ] **Step 4: Run the solar e2e suite**

Run: `npx playwright test e2e/solar-`
Expected: PASS, except the 8 specs that already fail on baseline. Compare
against baseline before blaming this change.

- [ ] **Step 5: Commit**

```bash
git add e2e/solar-storage-proposal.spec.ts
git commit -m "Prove the battery sells and the array still does"
```

---

## Task 17: Ship it

- [ ] **Step 1: Full verification**

```bash
npm run typecheck && npm test && npm run test:integration && npm run lint
```
Expected: all green. Do not proceed on a failure you have not explained.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: succeeds. Per the **next-dev duplicate-module memory**, a workspace
override that works under `next dev` can still be wrong — this build is where
that shows.

- [ ] **Step 3: Push**

```bash
git push origin main
```

The prod build applies migrations itself. Per the **prod migration URL memory**,
verify afterwards rather than trusting the log:

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'solar_designs' AND column_name = 'systemType';
SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 3;
SELECT "systemType", count(*) FROM solar_designs GROUP BY 1;
SELECT count(*) FROM solar_backup_profiles;
```

- [ ] **Step 4: Configure production**

The seeded backup profiles arrive with the migration. These do not, and the
feature is inert without them:

1. Settings → Providers: peak, off-peak and the window on each electric provider
2. Settings → Solar lenders: min base and max final per battery, and
   "Funds storage-only deals" on the products that do
3. Settings → Solar rebates: the Tesla rebate
4. Team: a per-battery redline on each solar rep — **without one no commission
   line is written at all**, silently, which is the failure this plan spent
   Task 4 preventing

- [ ] **Step 5: Smoke test on production**

Build one storage-only proposal end to end on a real lead and print it to PDF.

---

## Notes carried from memory

- **Busy-flag latch:** every new panel resets its busy flag in a `finally`. ~38
  components share the unguarded pattern; do not add the 39th.
- **Prisma stale dev server:** "Unknown field `systemType`" in dev after Task 5
  is a stale running dev server, not a code bug. Compare its start time to the
  schema's mtime.
- **Vertical scoping:** every new model carries `vertical @default(solar)` and
  every query runs inside `runInVertical("solar", ...)`. A company-wide count
  must not come from a scoped query.
- **Concurrent sessions:** another session may commit with `add -A`. A clean
  `git status` can mean your work is already in someone else's commit — check
  the log before assuming it was lost.
