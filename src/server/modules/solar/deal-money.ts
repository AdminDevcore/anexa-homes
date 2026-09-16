import { prisma } from "@/server/db/client";
import { batteryChargeCents, priceStorageStored } from "@/lib/solar-money";
import { financeRowForProduct, type FinanceInput } from "@/lib/solar-finance-row";
import { toLenderProductTerms, LENDER_TERMS_SELECT } from "./lender-terms";
import { resolveAdderTotal } from "./adders";
import { getSolarSettings } from "./settings";
import { economicWritesAllowed, auditDerivedWrite } from "./signed-lock";

/**
 * THE ONE DERIVATION OF WHAT A SOLAR DEAL COSTS.
 *
 * `SolarFinance` holds two very different kinds of column and the difference is
 * the whole point of this file:
 *
 *   INPUTS   what a person typed — the base $/W, the per-battery price, the
 *            product, the APR, the term, the down payment. Authoritative. Only
 *            ever written by somebody deliberately saving the financing step.
 *
 *   DERIVED  what those inputs come to once the design, the adders, the
 *            battery and the partner's rules are applied — `contractPriceCents`
 *            above all. A CACHE, and the only honest description of it.
 *
 * ── WHY THE CACHE HAD TO BE FIXED RATHER THAN TOLERATED ─────────────────────
 * The derived columns were written only when the financing step itself was
 * saved. Everything else that moves the price — redrawing the roof, adding a
 * battery, adding trenching, moving the deal to another lender — wrote its own
 * table and left the contract untouched. A deal could therefore sit at
 * $30,695.12 in the column while every screen that recomputed showed $74,695.12.
 *
 * Most readers already recompute and were never wrong. Two do not, and one of
 * them matters a great deal: `lender-submit.ts` sends
 * `contractPriceCents − downPayment` as the amount a partner is asked to
 * underwrite. A stale cache there is a household underwritten for the wrong
 * money.
 *
 * ── NO SECOND SOURCE OF TRUTH ───────────────────────────────────────────────
 * This is the derivation `saveSolarFinanceAction` always performed, lifted out
 * unchanged so that the save and every recompute run the SAME code over the
 * same inputs. A recompute that re-implemented the ladder would be a second
 * opinion about one house, which is the class of defect this repairs.
 *
 * ── IT NEVER REWRITES AN INPUT ──────────────────────────────────────────────
 * `financeRowForProduct` derives a sticker from the company's target net only
 * when `grossPpwCents` is absent. Passing the stored figure back in therefore
 * returns it untouched — except where a partner's ceiling lowers it, which is
 * the same thing the save does and is the correct answer either way.
 */

/** The design facts the price is worked out against. */
const DESIGN_SELECT = {
  systemSizeKwDc: true,
  lenderId: true,
  systemType: true,
  batteryQty: true,
  // What the catalogue sells this battery for — the price the deal falls back
  // to when nobody has typed one. See `batteryChargeCents`.
  battery: { select: { priceCents: true } },
  // The partner's per-battery rule, read off the LENDER rather than the
  // programme row — the same place the $/W ceiling is read from.
  lender: { select: { maxFinalPricePerBatteryCents: true, finalBatteryPriceMode: true } },
} as const;

/**
 * Every money column a save writes, derived from the inputs it was given.
 *
 * Returns the object to persist. The caller decides whether to write it, which
 * is what lets the recompute below skip a no-op.
 */
export async function dealMoneyColumns(
  companyId: string,
  leadId: string,
  f: FinanceInput & { stickerPricePerBatteryCents?: number | null }
) {
  const assumptions = await getSolarSettings(companyId);

  const design = await prisma.solarDesign.findUnique({
    where: { leadId },
    select: DESIGN_SELECT,
  });
  const lenderBand = design?.lender ?? null;

  /**
   * The quoted product's terms are READ HERE, from the row, and never taken
   * from the request. A rate sheet a caller can post arbitrary terms against is
   * not a rate sheet — the APR a customer is quoted has to be one this lender
   * actually offers. Scoped to the company, and to the lender the system was
   * designed for, so a product id from elsewhere resolves to nothing.
   */
  const lenderProduct = f.lenderProductId
    ? await prisma.solarLenderProduct.findFirst({
        where: {
          id: f.lenderProductId,
          companyId,
          ...(design?.lenderId ? { lenderId: design.lenderId } : {}),
        },
        select: LENDER_TERMS_SELECT,
      })
    : null;

  // The adders are the DEAL's, read here rather than taken from the request.
  const adders = await resolveAdderTotal(companyId, leadId);

  /**
   * WHAT THE STORAGE ADDS TO THIS CONTRACT.
   *
   * The rep's own per-battery price where the deal carries one, else the
   * catalogue's — the rule lives in `batteryChargeCents` so that this save, the
   * builder that called it, the proposal and payroll cannot disagree about one
   * house. Zero on a storage-only deal, which is priced per battery below.
   */
  const batteryPriceCents = batteryChargeCents({
    systemType: design?.systemType,
    batteryQty: design?.batteryQty,
    dealPerBatteryCents: f.stickerPricePerBatteryCents,
    cataloguePerBatteryCents: design?.battery?.priceCents ?? null,
  });

  // Every product-specific column is gated on the product — see
  // financeRowForProduct for why "most of them" was a customer-facing defect.
  /**
   * MAPPED, NEVER SPREAD.
   *
   * `resolveAdderTotal` answers in the COLUMN vocabulary
   * (`addersInsideRuleCents`); `FinanceInput` asks in the form's
   * (`adderTotalCents`) — and both of its adder fields are OPTIONAL. Spreading
   * the split therefore type-checks perfectly, contributes two keys nothing
   * reads, and leaves the two that ARE read undefined, so `?? 0` prices every
   * adder on the deal at nothing. `tsc` cannot see it: a spread is exempt from
   * excess-property checking and a missing optional is not an error. The only
   * symptom is the contract price quietly ceasing to follow the adders.
   */
  const rowData = financeRowForProduct(
    {
      ...f,
      adderTotalCents: adders.addersInsideRuleCents,
      onTopAdderTotalCents: adders.addersOutsideRuleCents,
      batteryPriceCents,
    },
    {
      systemSizeKwDc: design?.systemSizeKwDc ?? 0,
      assumptions,
      lenderProduct: toLenderProductTerms(lenderProduct),
      targetNetPpwCents: assumptions.targetNetPpwCents,
    }
  );

  /**
   * The storage sticker, and the contract that follows from it.
   *
   * `financeRowForProduct` prices per watt — the company default, the target
   * net, the partner's $/W ceiling. On a deal with no array every one of those
   * multiplies by zero, so a storage deal is priced here instead, through the
   * same ladder over batteries.
   */
  const isStorage = design?.systemType === "storage";
  const storageSticker = isStorage ? (f.stickerPricePerBatteryCents ?? 0) : 0;
  const storagePrice =
    isStorage && (f.product === "cash" || f.product === "loan") && storageSticker > 0
      ? priceStorageStored({
          product: f.product,
          batteryQty: design?.batteryQty ?? 0,
          stickerPricePerBatteryCents: storageSticker,
          dealerFeePct: f.product === "cash" ? 0 : (rowData.dealerFeePct ?? 0),
          adderTotalCents: adders.addersInsideRuleCents,
          onTopAdderTotalCents: adders.addersOutsideRuleCents,
          maxFinalPricePerBatteryCents: lenderBand?.maxFinalPricePerBatteryCents ?? null,
          finalBatteryPriceMode: lenderBand?.finalBatteryPriceMode ?? "cap",
          // Which price that figure fixes is the quoted programme's to say.
          batteryPriceBasis: lenderProduct?.batteryPriceBasis,
        })
      : null;

  /**
   * ONE VOCABULARY AT THE EXIT.
   *
   * `financeRowForProduct` speaks `FinanceRow` — the shape of the FORM — and it
   * keeps its own names. Everything this function RETURNS is written to
   * columns, so it is spelled the way the columns are spelled, and the
   * translation happens here, once, rather than at each of the three callers
   * that write it.
   *
   * IT HAS TO BE EXPLICIT, because nothing in the type system checks it: one
   * caller widens to `Record<string, unknown>` and two spread this object
   * straight into a Prisma `create`/`update`. A key misspelled here type-checks
   * perfectly and fails at runtime with `Unknown argument`, which is exactly
   * how the v9 column rename broke every save on this path.
   */
  const {
    grossPpwCents,
    adderTotalCents,
    onTopAdderTotalCents,
    contractPriceCents,
    monthlyPaymentCents,
    loanMonthlyPaymentCents,
    ...rest
  } = rowData;

  return {
    ...rest,
    /**
     * WHAT ONE BATTERY SELLS FOR ON THIS DEAL — on either kind of deal.
     *
     * Still zeroed on a deal with NO battery at all: a deal switched back to
     * solar-only must not keep a price per battery nothing reads.
     */
    baseFinalPerBatteryCents: isStorage
      ? storageSticker
      : (design?.batteryQty ?? 0) > 0
        ? (f.stickerPricePerBatteryCents ?? 0)
        : 0,
    // The $/W sticker is meaningless on storage and would be read as one.
    baseFinalPpwCents: isStorage ? 0 : grossPpwCents,
    addersInsideRuleCents: adderTotalCents,
    addersOutsideRuleCents: onTopAdderTotalCents,
    finalPriceCents: storagePrice ? storagePrice.breakdown.contractPriceCents : contractPriceCents,
    leaseMonthlyCents: monthlyPaymentCents,
    lenderMonthlyPaymentCents: loanMonthlyPaymentCents,
  };
}

/**
 * The columns this recompute is allowed to move.
 *
 * DERIVED ONLY. A recompute is triggered by something OTHER than the financing
 * step — a roof redrawn, a battery added, a lender changed — and the person who
 * did that was not editing the price. Writing the whole row back would let a
 * design edit silently restate an APR or a down payment, which is the opposite
 * of what this is for.
 */
/**
 * COLUMN NAMES, both sides of the comparison.
 *
 * These are used to read the derivation's answer, to read the stored row, and
 * as the keys written back — so all three must be the column's own spelling. A
 * retired name here reads `undefined` off the stored row, making every key look
 * changed, and then writes a column Prisma does not have.
 */
const DERIVED_KEYS = [
  "baseFinalPpwCents",
  "baseFinalPerBatteryCents",
  "dealerFeePct",
  "addersInsideRuleCents",
  "addersOutsideRuleCents",
  "finalPriceCents",
  "itcEstimateCents",
] as const;

/**
 * Put a deal's cached money back in step with its design, adders and partner.
 *
 * Call this from anything that changes what the deal costs WITHOUT going
 * through the financing step. Cheap and idempotent: it writes only when a
 * figure actually moved, so a recompute on an unchanged deal is one read.
 *
 * NOT CALLED ON AN UNPRICED DEAL. With no finance row there is nothing to keep
 * in step, and creating one here would put a contract price on a deal nobody
 * has quoted — which is the "a zero is not a price" rule the whole module
 * follows.
 *
 * Best-effort at the call sites: a rep adding an adder must not see their edit
 * fail because a recompute did. A stale figure is corrected by the next one,
 * and by generation, which re-derives and writes back regardless.
 */
export async function recomputeDealMoney(
  companyId: string,
  leadId: string
): Promise<{ changed: boolean; blocked?: boolean }> {
  /**
   * THE CHOKEPOINT. A signed contract's money is a record, and a recompute is
   * the one way it used to move without anybody deciding to move it: the
   * layout designer, the live re-price and anything else that changed the
   * design ended here, carrying whatever authority they happened to have.
   */
  const open = await economicWritesAllowed(companyId, leadId);
  if (open.blocked) return { changed: false, blocked: true };

  const current = await prisma.solarFinance.findUnique({
    where: { leadId },
    select: {
      companyId: true,
      product: true,
      baseFinalPpwCents: true,
      baseFinalPerBatteryCents: true,
      dealerFeePct: true,
      addersInsideRuleCents: true,
      addersOutsideRuleCents: true,
      finalPriceCents: true,
      itcEstimateCents: true,
      rateMillsPerKwh: true,
      leaseMonthlyCents: true,
      escalatorPct: true,
      termYears: true,
      aprPct: true,
      loanTermMonths: true,
      downPaymentCents: true,
      lenderMonthlyPaymentCents: true,
      lenderProductId: true,
    },
  });
  if (!current || current.companyId !== companyId) return { changed: false };

  const next = await dealMoneyColumns(companyId, leadId, {
    product: current.product,
    // The typed inputs, handed straight back so the derivation returns them
    // unchanged — see the note at the top of this file.
    grossPpwCents: current.baseFinalPpwCents,
    stickerPricePerBatteryCents: current.baseFinalPerBatteryCents,
    dealerFeePct: current.dealerFeePct,
    rateMillsPerKwh: current.rateMillsPerKwh,
    monthlyPaymentCents: current.leaseMonthlyCents,
    escalatorPct: current.escalatorPct,
    termYears: current.termYears,
    aprPct: current.aprPct,
    loanTermMonths: current.loanTermMonths,
    downPaymentCents: current.downPaymentCents,
    loanMonthlyPaymentCents: current.lenderMonthlyPaymentCents,
    lenderProductId: current.lenderProductId,
  });

  const data: Record<string, unknown> = {};
  for (const key of DERIVED_KEYS) {
    const after = (next as Record<string, unknown>)[key];
    if (after === undefined) continue;
    if (after !== (current as Record<string, unknown>)[key]) data[key] = after;
  }
  if (Object.keys(data).length === 0) return { changed: false };

  await prisma.solarFinance.update({ where: { leadId }, data });
  // On a reopened contract, every figure that moved, with both values.
  if (open.unlock) {
    await auditDerivedWrite(
      companyId,
      leadId,
      open.unlock,
      "the deal's money",
      Object.keys(data).map((field) => ({
        field,
        before: (current as Record<string, unknown>)[field],
        after: data[field],
      }))
    );
  }
  return { changed: true };
}
