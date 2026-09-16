import type { FinanceProduct } from "@prisma/client";
import type { Db } from "@/server/db/types";
import { priceStoredPurchase, priceStorageStored, batteryChargeCents } from "@/lib/solar-money";
import { readProposalSnapshot } from "@/lib/solar-proposal";

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
        product: true, baseFinalPpwCents: true, dealerFeePct: true,
        addersInsideRuleCents: true, addersOutsideRuleCents: true, finalPriceCents: true,
        baseFinalPerBatteryCents: true,
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
            priceRulePpwCents: true,
            priceRuleMode: true,
            priceRulePerBatteryCents: true,
            priceRuleBatteryMode: true,
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
          stickerPricePerBatteryCents: finance.baseFinalPerBatteryCents,
          dealerFeePct: finance.dealerFeePct,
          adderTotalCents: finance.addersInsideRuleCents,
          onTopAdderTotalCents: finance.addersOutsideRuleCents,
          maxFinalPricePerBatteryCents: design.lender?.priceRulePerBatteryCents ?? null,
          finalBatteryPriceMode: design.lender?.priceRuleBatteryMode,
          batteryPriceBasis: finance.lenderProduct?.batteryPriceBasis,
        }).breakdown
      : null;

  const purchase =
    !isStorage && (finance.product === "cash" || finance.product === "loan")
      ? priceStoredPurchase({
          product: finance.product,
          systemSizeKwDc: design.systemSizeKwDc,
          stickerPpwCents: finance.baseFinalPpwCents,
          dealerFeePct: finance.dealerFeePct,
          adderTotalCents: finance.addersInsideRuleCents,
          onTopAdderTotalCents: finance.addersOutsideRuleCents,
          // ON THE FINAL PRICE, OUT OF THE BASE. The household signs for the
          // battery; a rep's redline is measured on `baseKeptCents`, which the
          // battery deliberately stays out of — it is priced from the catalogue
          // to cover its own cost, exactly like an adder.
          batteryPriceCents: batteryChargeCents({
            systemType: design.systemType,
            batteryQty: design.batteryQty,
            dealPerBatteryCents: finance.baseFinalPerBatteryCents,
            cataloguePerBatteryCents: design.battery?.priceCents ?? null,
          }),
          maxFinalPpwCents: design.lender?.priceRulePpwCents ?? null,
          finalPpwMode: design.lender?.priceRuleMode,
          ppwBasis: finance.lenderProduct?.ppwBasis,
        }).breakdown
      : null;

  const priced = purchase ?? storagePurchase;

  return {
    product: finance.product,
    systemType: design.systemType,
    lenderPayMode: design.lender?.repPayMode ?? null,

    /**
     * The fee this deal carries. Read here because the signed document never
     * prints it — it is a term between the company and the lender — so the base
     * a commission is measured on cannot be taken off the document alone.
     */
    dealerFeePct: finance.dealerFeePct,

    // Zero on a storage deal, and zero is the truth there rather than a
    // conversion that did not happen.
    systemWatts: isStorage ? 0 : (purchase?.systemWatts ?? Math.round(design.systemSizeKwDc * 1000)),
    batteryQty: design.batteryQty,
    baseKeptCents: priced?.baseKeptCents ?? 0,
    /**
     * The final price, before any credit — what the signed document is checked
     * against when the measure is frozen. No pay is a share of it: an override
     * is a share of the rep's net.
     *
     * DERIVED, not the stored column. `SolarFinance.finalPriceCents` — the row,
     * which is still the column `contractPriceCents` on disk — is only as fresh
     * as the last save, and a deal priced before adders were pulled inside the
     * dealer fee carries a figure several thousand dollars light.
     *
     * The two are the same NAME on purpose (the figure is the same thing), so
     * the difference that matters is carried by the TYPE: this one is branded
     * `DerivedPriceCents` and the stored one is a plain `number`. A comment
     * saying "derived" is advice; a brand is something the compiler holds.
     */
    finalPriceCents: derivedPrice(priced?.contractPriceCents ?? finance.finalPriceCents),
  };
}

export type CommissionDeal = NonNullable<Awaited<ReturnType<typeof loadCommissionDeal>>>;

declare const DERIVED_PRICE: unique symbol;

/**
 * A CONTRACT PRICE WORKED OUT NOW, rather than the one sitting on the row.
 *
 * `finalPriceCents` is the right name for both — they are the same quantity —
 * but they are not interchangeable: the stored one is as old as the last save.
 * Branding the derived one makes the difference something the compiler can see,
 * so a figure that was freshly priced cannot be quietly swapped for a stale
 * column, or the reverse, by a refactor that only reads the names.
 *
 * Assignable to `number` in both directions of USE — every consumer keeps
 * working — but only `derivedPrice()` produces one.
 */
export type DerivedPriceCents = number & { readonly [DERIVED_PRICE]: true };

/** The only way to make one: say out loud that this figure was just derived. */
export const derivedPrice = (cents: number): DerivedPriceCents => cents as DerivedPriceCents;

/** The three figures a commission multiplies. See `solarRepPayCents`. */
export type CommissionMeasure = {
  systemWatts: number;
  baseKeptCents: number;
  batteryQty: number;
  /** True when these came from the copy frozen at signing. */
  frozen: boolean;
};

/** The columns on `SolarDealComp` that hold the frozen measure. */
export const FROZEN_MEASURE_SELECT = {
  systemWatts: true,
  baseKeptCents: true,
  batteryQty: true,
  pricedAt: true,
} as const;

type FrozenMeasureColumns = {
  systemWatts: number | null;
  baseKeptCents: number | null;
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
  live: Pick<CommissionDeal, "systemWatts" | "baseKeptCents" | "batteryQty"> | null,
  comp: FrozenMeasureColumns | null
): CommissionMeasure | null {
  if (
    comp?.pricedAt != null &&
    comp.systemWatts != null &&
    comp.baseKeptCents != null &&
    comp.batteryQty != null
  ) {
    return {
      systemWatts: comp.systemWatts,
      baseKeptCents: comp.baseKeptCents,
      batteryQty: comp.batteryQty,
      frozen: true,
    };
  }
  return live
    ? {
        systemWatts: live.systemWatts,
        baseKeptCents: live.baseKeptCents,
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
  // THROUGH THE READER, never straight at the stored JSON. Every document
  // signed before v9 spells this `contractPriceCents`, and reading today's name
  // off one of those rows yields undefined — which this function would report,
  // perfectly quietly, as a document that matches the deal in every particular.
  const s = (readProposalSnapshot(snapshot) ?? {}) as {
    financing?: { finalPriceCents?: unknown; batteryQty?: unknown };
    system?: { sizeKwDc?: unknown };
    storage?: { batteryQty?: unknown };
  };
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const documentFinal = num(s.financing?.finalPriceCents);
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

/** A number a snapshot carries, or null where it carries none. */
function snapshotNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * THE MEASURE, READ OFF THE DOCUMENT THE CUSTOMER SIGNED.
 *
 * The signed proposal is what the household agreed to, so it is what the
 * commission is measured on — not the deal as it stood that afternoon. The
 * document carries the system size, the base at sticker and the battery count.
 *
 * It deliberately does NOT carry the dealer fee, which is a term between the
 * company and the lender and is never printed for a customer. So the fee comes
 * off the deal row and turns the base at sticker into the base the company
 * keeps: the same subtraction `priceUnits` makes when it prices the deal.
 *
 * Null when the document carries no priced figures — a version generated before
 * the snapshot recorded them, or a lease or PPA, which has no system price.
 */
export function measureFromSignedDocument(
  snapshot: unknown,
  deal: {
    product: FinanceProduct;
    dealerFeePct: number;
    systemType: "pv" | "pv_storage" | "storage";
  }
): Omit<CommissionMeasure, "frozen"> | null {
  // Through the reader, for the reason given on `compareWithSignedDocument`:
  // every proposal signed to date predates v9, and freezing the measure from
  // the document is the whole point of this function.
  const s = (readProposalSnapshot(snapshot) ?? {}) as {
    financing?: { baseFinalCents?: unknown; batteryQty?: unknown };
    system?: { sizeKwDc?: unknown };
    storage?: { batteryQty?: unknown };
  };
  const baseStickerCents = snapshotNumber(s.financing?.baseFinalCents);
  if (baseStickerCents == null) return null;

  // The guard `priceUnits` applies, applied identically: cash carries no fee,
  // and a fee that cannot be grossed is stood down rather than made nonsense of.
  const raw = deal.product === "cash" ? 0 : deal.dealerFeePct;
  const f = Number.isFinite(raw) && raw > 0 && raw < 100 ? raw / 100 : 0;

  return {
    systemWatts:
      deal.systemType === "storage"
        ? 0
        : Math.round((snapshotNumber(s.system?.sizeKwDc) ?? 0) * 1000),
    baseKeptCents: baseStickerCents - Math.round(baseStickerCents * f),
    batteryQty: snapshotNumber(s.financing?.batteryQty) ?? snapshotNumber(s.storage?.batteryQty) ?? 0,
  };
}

export type FreezeOutcome =
  | {
      status: "frozen" | "would_freeze";
      measure: Omit<CommissionMeasure, "frozen">;
      /** Where those numbers came from. The document, unless it carries none. */
      basis: "signed_document" | "live_deal";
      /**
       * What the LIVE deal would have been measured on. Reported so a caller
       * that must not move an existing commission — the backfill — can see that
       * it would, and stop. See `backfillCommissionMeasure`.
       */
      live: Omit<CommissionMeasure, "frozen">;
      /** The live deal's own final price, which the comparison below reports on. */
      finalPriceCents: number;
      proposalId: string | null;
      proposalVersion: number | null;
      matches: boolean | null;
      differences: string[];
    }
  | { status: "skipped"; reason: string };

/**
 * Freeze what this deal's commission is measured on, FROM THE SIGNED PROPOSAL.
 *
 * The document is what the customer agreed to; the deal row is what the office
 * has since. Where the two disagree the document wins, and the disagreement is
 * recorded — on the row (`pricingMatchesSignedDocument`) and on the deal's
 * history — so that a person looks at it. It never blocks: this runs inside a
 * customer's signature.
 *
 * The live deal is still read, for two things it alone knows: the dealer fee,
 * which the document does not print, and what the deal says today, for the
 * comparison.
 *
 * `apply: false` reports what would be written and writes nothing.
 */
export async function freezeCommissionMeasure(
  db: Db,
  args: {
    companyId: string;
    leadId: string;
    proposalId?: string | null;
    pricedFrom: "signature" | "backfill" | "refreeze";
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

  const liveMeasure = {
    systemWatts: live.systemWatts,
    baseKeptCents: live.baseKeptCents,
    batteryQty: live.batteryQty,
  };
  const fromDocument = document ? measureFromSignedDocument(document.snapshot, live) : null;
  const measure = fromDocument ?? liveMeasure;
  const basis: "signed_document" | "live_deal" = fromDocument ? "signed_document" : "live_deal";

  const check = document
    ? compareWithSignedDocument(live, document.snapshot)
    : { matches: null, differences: [] };
  const differences = [...check.differences];
  // The figure the money actually turns on, reported beside the rest.
  if (fromDocument && fromDocument.baseKeptCents !== live.baseKeptCents) {
    differences.push(
      `base price ${usd(live.baseKeptCents)} on the deal, ${usd(fromDocument.baseKeptCents)} on the signed document`
    );
  }
  const matches = check.matches == null && fromDocument == null ? null : differences.length === 0;

  const apply = args.apply !== false;
  if (apply) {
    await db.solarDealComp.update({
      where: { id: comp.id },
      data: {
        ...measure,
        pricedAt: args.now,
        pricedFrom: args.pricedFrom,
        pricedBasis: basis,
        pricedProposalId: document?.id ?? null,
        pricingMatchesSignedDocument: matches,
      },
    });
  }

  return {
    status: apply ? "frozen" : "would_freeze",
    measure,
    basis,
    live: liveMeasure,
    finalPriceCents: live.finalPriceCents,
    proposalId: document?.id ?? null,
    proposalVersion: document?.version ?? null,
    matches,
    differences,
  };
}

/** Do two measures pay the same? */
function sameMeasure(a: Omit<CommissionMeasure, "frozen">, b: Omit<CommissionMeasure, "frozen">) {
  return (
    a.systemWatts === b.systemWatts &&
    a.baseKeptCents === b.baseKeptCents &&
    a.batteryQty === b.batteryQty
  );
}

/**
 * Freeze the measure on every deal whose terms were frozen before the measure
 * was. See `scripts/backfill-deal-comp-pricing.ts`.
 *
 * ── IT WILL NOT MOVE AN EXISTING COMMISSION BY ITSELF ───────────────────────
 * Payroll reads the LIVE deal on these rows today. Every signature from now on
 * freezes the measure from the signed document instead, and on an old row those
 * two can differ by thousands of dollars — a deal re-priced after it was signed
 * has drifted from the document ever since, and nobody has been paid on the
 * document. Backfilling it silently would be a pay change wearing the clothes
 * of a data migration.
 *
 * So a row whose document does not agree with the deal is REPORTED and SKIPPED,
 * and only `allowMoves` writes it. That is a decision for whoever runs the
 * script, made with the dollar figure in front of them, not a default.
 */
export async function backfillCommissionMeasure(
  db: Db,
  opts: { apply: boolean; now: Date; companyId?: string; allowMoves?: boolean }
) {
  const comps = await db.solarDealComp.findMany({
    where: { pricedAt: null, ...(opts.companyId ? { companyId: opts.companyId } : {}) },
    orderBy: { signedAt: "asc" },
    select: { companyId: true, leadId: true, basis: true, signedAt: true },
  });
  const rows = [];
  for (const c of comps) {
    // Always priced first without writing, so the decision below is made on
    // the same figures the report prints.
    const preview = await freezeCommissionMeasure(db, {
      companyId: c.companyId,
      leadId: c.leadId,
      pricedFrom: "backfill",
      now: opts.now,
      apply: false,
    });
    const movesPay = preview.status !== "skipped" && !sameMeasure(preview.measure, preview.live);
    const held = opts.apply && movesPay && !opts.allowMoves;
    const outcome =
      opts.apply && !held
        ? await freezeCommissionMeasure(db, {
            companyId: c.companyId,
            leadId: c.leadId,
            pricedFrom: "backfill",
            now: opts.now,
          })
        : preview;
    rows.push({ ...c, outcome, movesPay, held });
  }
  return rows;
}
