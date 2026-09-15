import type { Db } from "@/server/db/types";
import { priceStoredPurchase, priceStorageStored, batteryChargeCents } from "@/lib/solar-money";

/**
 * WHAT A SOLAR COMMISSION IS MEASURED ON — the deal's size and the base price it
 * sold at — and the copy of both frozen when the customer signs.
 *
 * NOT a `"use server"` module, for the reason `deal-comp.ts` is not: every
 * function here takes a company the caller has already resolved.
 *
 * ── WHY THE PRICE IS FROZEN AS WELL AS THE RATES ────────────────────────────
 * `SolarDealComp` has always frozen the rep's RATES at signing. The number those
 * rates multiply was still read live off the design and finance rows every time
 * payroll ran, months later: a super admin's unlock, a recompute after a
 * catalogue change or a lender cap moving under a stored sticker all moved a
 * signed deal's commission. Rates without the measure are half a snapshot.
 *
 * ── CREDITS ────────────────────────────────────────────────────────────────
 * Nothing here reads a credit. The base is measured before any credit, so
 * claiming the ITC, adding a bonus credit or offering a sign-today credit never
 * changes what a rep is paid (`pricing-stage1.itest.ts`).
 */

/**
 * The deal as payroll prices it, read live. Null when it is not priced yet.
 *
 * Moved here from `payroll/solar-engine.ts` unchanged, apart from naming the
 * final price for what it is, so the signature can freeze exactly what payroll
 * would otherwise read.
 */
export async function loadCommissionDeal(db: Db, companyId: string, leadId: string) {
  const [finance, design] = await Promise.all([
    db.solarFinance.findUnique({
      where: { leadId },
      select: {
        product: true, grossPpwCents: true, dealerFeePct: true,
        adderTotalCents: true, onTopAdderTotalCents: true, contractPriceCents: true,
        stickerPricePerBatteryCents: true,
        // Which price the partner's figure fixes is the quoted programme's to
        // say. No programme quoted reads as `final`, the rule as it always was.
        lenderProduct: {
          select: {
            ppwBasis: true,
            batteryPriceBasis: true,
          },
        },
      },
    }),
    db.solarDesign.findUnique({
      where: { leadId },
      // The partner's ceiling comes with its pay mode: a capped lender funds
      // one number whatever was typed, and a commission measured on the typed
      // figure pays on money that never arrives.
      select: {
        systemSizeKwDc: true,
        systemType: true,
        batteryQty: true,
        // The catalogue price of the storage, because it is on the final price
        // the signed document is checked against. See `batteryChargeCents`.
        battery: { select: { priceCents: true } },
        lender: {
          select: {
            repPayMode: true,
            batteryPayMode: true,
            maxFinalPpwCents: true,
            finalPpwMode: true,
            maxFinalPricePerBatteryCents: true,
            finalBatteryPriceMode: true,
          },
        },
      },
    }),
  ]);
  if (!finance || !design) return null;

  // A storage deal has no array and never will. Asking it for one is how a
  // whole category of deal silently stops generating commissions -- so the two
  // kinds ask the row the question that applies to them.
  const isStorage = design.systemType === "storage";
  if (isStorage) {
    if (!(design.batteryQty > 0)) return null; // no batteries: nothing to pay on
  } else if (!(design.systemSizeKwDc > 0)) {
    return null; // no array drawn: nothing to pay on
  }

  // Cash and loan are priced per watt; lease and PPA sell electricity and have
  // no system price at all, so their base is zero and only a per-watt basis can
  // reach them. `pricePurchase` already refuses to apply a dealer fee to cash.
  //
  // HELD TO THE PARTNER'S CEILING, like every other screen that prices a saved
  // deal. On a capped lender the stored sticker is what the rep typed, not what
  // the bank funds — Amos at $5.50/W and a 65% fee leaves $1.93/W however
  // confidently $3.00 was entered — so paying a redline overage or an override
  // percentage on the uncapped figure pays out of money nobody is ever sent.
  // Kept as an inline comparison in both branches below rather than hoisted to
  // a boolean: a boolean does not narrow `finance.product`, and the cast that
  // would paper over that is a cast that survives the day a fifth product is
  // added.
  // Storage prices per battery, held to the partner's per-battery ceiling for
  // exactly the reason the array is held to its per-watt one: the stored
  // sticker is only as capped as the lender was on the day it was saved, and
  // paying a redline overage on an uncapped figure pays out of money nobody is
  // ever sent.
  const storagePurchase =
    isStorage && (finance.product === "cash" || finance.product === "loan")
      ? priceStorageStored({
          product: finance.product,
          batteryQty: design.batteryQty,
          stickerPricePerBatteryCents: finance.stickerPricePerBatteryCents,
          dealerFeePct: finance.dealerFeePct,
          adderTotalCents: finance.adderTotalCents,
          onTopAdderTotalCents: finance.onTopAdderTotalCents,
          maxFinalPricePerBatteryCents: design.lender?.maxFinalPricePerBatteryCents ?? null,
          finalBatteryPriceMode: design.lender?.finalBatteryPriceMode,
          batteryPriceBasis: finance.lenderProduct?.batteryPriceBasis,
        }).breakdown
      : null;

  const purchase =
    !isStorage && (finance.product === "cash" || finance.product === "loan")
      ? priceStoredPurchase({
          product: finance.product,
          systemSizeKwDc: design.systemSizeKwDc,
          stickerPpwCents: finance.grossPpwCents,
          dealerFeePct: finance.dealerFeePct,
          adderTotalCents: finance.adderTotalCents,
          onTopAdderTotalCents: finance.onTopAdderTotalCents,
          // ON THE FINAL PRICE, OUT OF THE BASE. The household signs for the
          // battery; a rep's redline is measured on `basePriceCents`, which the
          // battery deliberately stays out of — it is priced from the catalogue
          // to cover its own cost, exactly like an adder.
          batteryPriceCents: batteryChargeCents({
            systemType: design.systemType,
            batteryQty: design.batteryQty,
            dealPerBatteryCents: finance.stickerPricePerBatteryCents,
            cataloguePerBatteryCents: design.battery?.priceCents ?? null,
          }),
          maxFinalPpwCents: design.lender?.maxFinalPpwCents ?? null,
          finalPpwMode: design.lender?.finalPpwMode,
          ppwBasis: finance.lenderProduct?.ppwBasis,
        }).breakdown
      : null;

  const priced = purchase ?? storagePurchase;

  return {
    product: finance.product,
    systemType: design.systemType,
    lenderPayMode: design.lender?.repPayMode ?? null,

    // Zero on a storage deal, and zero is the truth there rather than a
    // conversion that did not happen.
    systemWatts: isStorage ? 0 : (purchase?.systemWatts ?? Math.round(design.systemSizeKwDc * 1000)),
    batteryQty: design.batteryQty,
    basePriceCents: priced?.basePriceCents ?? 0,
    /**
     * The final price, before any credit — what the signed document is checked
     * against when the measure is frozen. No pay is a share of it: an override
     * is a share of the rep's net.
     *
     * DERIVED, not the stored column: `SolarFinance.contractPriceCents` is only
     * as fresh as the last save, and a deal priced before adders were pulled
     * inside the dealer fee carries a figure several thousand dollars light.
     */
    finalPriceCents: priced?.contractPriceCents ?? finance.contractPriceCents,
  };
}

export type CommissionDeal = NonNullable<Awaited<ReturnType<typeof loadCommissionDeal>>>;

/** The three figures a commission multiplies. See `solarRepPayCents`. */
export type CommissionMeasure = {
  systemWatts: number;
  basePriceCents: number;
  batteryQty: number;
  /** True when these came from the copy frozen at signing. */
  frozen: boolean;
};

/** The columns on `SolarDealComp` that hold the frozen measure. */
export const FROZEN_MEASURE_SELECT = {
  systemWatts: true,
  basePriceCents: true,
  batteryQty: true,
  pricedAt: true,
} as const;

type FrozenMeasureColumns = {
  systemWatts: number | null;
  basePriceCents: number | null;
  batteryQty: number | null;
  pricedAt: Date | null;
};

/**
 * What this deal's commission is measured on: the copy frozen at signing when
 * there is one, the live deal otherwise.
 *
 * Null only when neither exists — an unsigned deal that is not priced yet.
 */
export function commissionMeasure(
  live: Pick<CommissionDeal, "systemWatts" | "basePriceCents" | "batteryQty"> | null,
  comp: FrozenMeasureColumns | null
): CommissionMeasure | null {
  if (
    comp?.pricedAt != null &&
    comp.systemWatts != null &&
    comp.basePriceCents != null &&
    comp.batteryQty != null
  ) {
    return {
      systemWatts: comp.systemWatts,
      basePriceCents: comp.basePriceCents,
      batteryQty: comp.batteryQty,
      frozen: true,
    };
  }
  return live
    ? {
        systemWatts: live.systemWatts,
        basePriceCents: live.basePriceCents,
        batteryQty: live.batteryQty,
        frozen: false,
      }
    : null;
}

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * Does the deal, as payroll prices it, agree with the document the customer
 * signed?
 *
 * Compared on the final price, and on the watts and the battery count where the
 * document carries them. The document's base is at sticker (fee included), so
 * it is not the base a commission is measured on and is not compared.
 *
 * `matches` is null when the document carries none of the three.
 */
export function compareWithSignedDocument(
  live: Pick<CommissionDeal, "systemType" | "systemWatts" | "batteryQty" | "finalPriceCents">,
  snapshot: unknown
): { matches: boolean | null; differences: string[] } {
  const s = (snapshot ?? {}) as {
    financing?: { contractPriceCents?: unknown; batteryQty?: unknown };
    system?: { sizeKwDc?: unknown };
    storage?: { batteryQty?: unknown };
  };
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const documentFinal = num(s.financing?.contractPriceCents);
  // A storage job has no watts; its design can still carry a stale size.
  const documentWatts = live.systemType === "storage" ? null : num(s.system?.sizeKwDc);
  // The charged battery count where the price carries one, else the storage block's.
  const documentBatteries = num(s.financing?.batteryQty) ?? num(s.storage?.batteryQty);

  if (documentFinal == null && documentWatts == null && documentBatteries == null) {
    return { matches: null, differences: [] };
  }

  const differences: string[] = [];
  if (documentFinal != null && documentFinal !== live.finalPriceCents) {
    differences.push(
      `final price ${usd(live.finalPriceCents)} on the deal, ${usd(documentFinal)} on the signed document`
    );
  }
  if (documentWatts != null && Math.round(documentWatts * 1000) !== live.systemWatts) {
    differences.push(
      `${live.systemWatts} W on the deal, ${Math.round(documentWatts * 1000)} W on the signed document`
    );
  }
  if (documentBatteries != null && documentBatteries !== live.batteryQty) {
    differences.push(
      `${live.batteryQty} batteries on the deal, ${documentBatteries} on the signed document`
    );
  }
  return { matches: differences.length === 0, differences };
}

export type FreezeOutcome =
  | {
      status: "frozen" | "would_freeze";
      measure: Omit<CommissionMeasure, "frozen">;
      finalPriceCents: number;
      proposalId: string | null;
      proposalVersion: number | null;
      matches: boolean | null;
      differences: string[];
    }
  | { status: "skipped"; reason: string };

/**
 * Freeze what this deal's commission is measured on.
 *
 * Takes the live measure — what payroll would read today — and checks it
 * against the signed document: the one named, or the latest signed one. A
 * disagreement is recorded on the row (`pricingMatchesSignedDocument`) and
 * returned; it never blocks, because this runs inside a customer's signature.
 *
 * `apply: false` reports what would be written and writes nothing.
 */
export async function freezeCommissionMeasure(
  db: Db,
  args: {
    companyId: string;
    leadId: string;
    proposalId?: string | null;
    pricedFrom: "signature" | "backfill";
    now: Date;
    apply?: boolean;
  }
): Promise<FreezeOutcome> {
  const comp = await db.solarDealComp.findFirst({
    where: { companyId: args.companyId, leadId: args.leadId },
    select: { id: true },
  });
  if (!comp) return { status: "skipped", reason: "no frozen terms on this deal" };

  const live = await loadCommissionDeal(db, args.companyId, args.leadId);
  if (!live) return { status: "skipped", reason: "the deal is not designed and priced" };

  const document = await db.solarProposal.findFirst({
    where: {
      companyId: args.companyId,
      leadId: args.leadId,
      signedAt: { not: null },
      ...(args.proposalId ? { id: args.proposalId } : {}),
    },
    orderBy: [{ signedAt: "desc" }, { version: "desc" }],
    select: { id: true, version: true, snapshot: true },
  });
  const check = document
    ? compareWithSignedDocument(live, document.snapshot)
    : { matches: null, differences: [] };

  const measure = {
    systemWatts: live.systemWatts,
    basePriceCents: live.basePriceCents,
    batteryQty: live.batteryQty,
  };
  const apply = args.apply !== false;
  if (apply) {
    await db.solarDealComp.update({
      where: { id: comp.id },
      data: {
        ...measure,
        pricedAt: args.now,
        pricedFrom: args.pricedFrom,
        pricedProposalId: document?.id ?? null,
        pricingMatchesSignedDocument: check.matches,
      },
    });
  }

  return {
    status: apply ? "frozen" : "would_freeze",
    measure,
    finalPriceCents: live.finalPriceCents,
    proposalId: document?.id ?? null,
    proposalVersion: document?.version ?? null,
    matches: check.matches,
    differences: check.differences,
  };
}

/**
 * Freeze the measure on every deal whose terms were frozen before the measure
 * was. See `scripts/backfill-deal-comp-pricing.ts`.
 *
 * Payroll reads the live deal on these rows today, and this freezes that same
 * live figure, so no commission moves on the day it runs. What it stops is the
 * figure moving afterwards.
 */
export async function backfillCommissionMeasure(
  db: Db,
  opts: { apply: boolean; now: Date; companyId?: string }
) {
  const comps = await db.solarDealComp.findMany({
    where: { pricedAt: null, ...(opts.companyId ? { companyId: opts.companyId } : {}) },
    orderBy: { signedAt: "asc" },
    select: { companyId: true, leadId: true, basis: true, signedAt: true },
  });
  const rows = [];
  for (const c of comps) {
    const outcome = await freezeCommissionMeasure(db, {
      companyId: c.companyId,
      leadId: c.leadId,
      pricedFrom: "backfill",
      now: opts.now,
      apply: opts.apply,
    });
    rows.push({ ...c, outcome });
  }
  return rows;
}
