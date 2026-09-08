import type { Prisma } from "@prisma/client";
import type { Db } from "@/server/db/types";
import { priceStoredPurchase, priceStorageStored, batteryChargeCents } from "@/lib/solar-money";
import {
  resolveSolarPay,
  solarRepPayCents,
  solarPayLabel,
  applyCompanyLeadTake,
  managerOverrideCents,
  type SolarPayTerms,
  type SolarPayResolution,
} from "@/lib/solar-pay";
import { VERTICAL_LABEL } from "@/lib/vertical";

/**
 * Commissions for one SOLAR deal.
 *
 * A separate file from engine.ts, not a branch inside it, because the two pay
 * models share no arithmetic. Roofing splits a profit pool (contract − costs −
 * overhead) between the rep and every active sales manager. Solar pays the rep
 * either the overage above their redline or a flat rate per watt, and pays
 * managers nothing automatic — there is no pool for a manager split to be a
 * share OF, so solar managers earn through CommissionOverride, configured per
 * rep on the same team page. Folding the two together produces one function
 * where half the locals are meaningless on any given call.
 *
 * THE PRICE DOES NOT COME FROM THE PROJECT. `Project.contractValue` is 0 on
 * every solar row and always has been — nothing writes a solar deal's price
 * onto its Project. Reading it is why solar deals, and every manager override on
 * them, generated $0. The truth is SolarFinance, and that is what this reads.
 */

/** Everything the payout needs, in one read. Null when the deal isn't priced yet. */
async function loadSolarDeal(db: Db, companyId: string, leadId: string) {
  const [finance, design] = await Promise.all([
    db.solarFinance.findUnique({
      where: { leadId },
      select: {
        product: true, grossPpwCents: true, dealerFeePct: true,
        adderTotalCents: true, onTopAdderTotalCents: true, contractPriceCents: true,
        stickerPricePerBatteryCents: true,
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
        // The catalogue price of the storage, because it is on the contract an
        // override is a percentage OF. See `batteryChargeCents`.
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
          // ON THE CONTRACT, OUT OF THE BASE. A manager's override is a
          // percentage of what the household signs, and they signed for the
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
     * What the customer signs. The basis every override is a percentage of.
     *
     * DERIVED, not the stored column: `SolarFinance.contractPriceCents` is only
     * as fresh as the last save, and a deal priced before adders were pulled
     * inside the dealer fee carries a figure several thousand dollars light. An
     * override is a percentage of what the customer actually signs.
     */
    contractPriceCents: priced?.contractPriceCents ?? finance.contractPriceCents,
  };
}

/**
 * The terms frozen when the customer signed, if this deal has them.
 *
 * READ BEFORE the rep's current configuration and before the commission row's
 * own snapshot, because it is the earliest and therefore the most authoritative
 * of the three: the commission row is not written until M1, months after the
 * customer agreed to anything.
 */
function snapshotFromDealComp(row: {
  basis: string;
  redlineCentsPerWatt: number | null;
  millsPerWatt: number | null;
  redlinePerBatteryCents: number | null;
  perBatteryFlatCents: number | null;
}): SolarPayTerms | null {
  return snapshotFrom({
    solarBasis: row.basis,
    solarRedlineCentsPerWatt: row.redlineCentsPerWatt,
    solarMillsPerWatt: row.millsPerWatt,
    solarRedlinePerBatteryCents: row.redlinePerBatteryCents,
    solarPerBatteryFlatCents: row.perBatteryFlatCents,
  });
}

/** The snapshot on an existing line, when it carries one. */
function snapshotFrom(row: {
  solarBasis: string | null;
  solarRedlineCentsPerWatt: number | null;
  solarRedlinePerBatteryCents: number | null;
  solarPerBatteryFlatCents: number | null;
  solarMillsPerWatt: number | null;
}): SolarPayTerms | null {
  if (
    row.solarBasis !== "redline" &&
    row.solarBasis !== "per_watt" &&
    row.solarBasis !== "battery_redline" &&
    row.solarBasis !== "battery_flat"
  ) {
    return null;
  }
  return {
    basis: row.solarBasis,
    redlineCentsPerWatt: row.solarRedlineCentsPerWatt,
    millsPerWatt: row.solarMillsPerWatt,
    redlinePerBatteryCents: row.solarRedlinePerBatteryCents,
    perBatteryFlatCents: row.solarPerBatteryFlatCents,
  };
}

/**
 * A rule that could not price the deal in front of it.
 *
 * Returned rather than logged-and-forgotten because "no commission line" has
 * two very different causes: a rep who is genuinely owed nothing, and a lender
 * paying per watt on a deal that has none. The first is correct and silent; the
 * second is a misconfiguration that will keep paying nobody until somebody is
 * told. `Project.contractValue = 0` zeroed every solar commission for weeks on
 * exactly that ambiguity.
 */
export type SolarPayRefusal = { projectId: string; userId: string; reason: string };

export type SolarCommissionResult = {
  /** How many commission records were created. */
  created: number;
  /** Rules that could not price this deal. Empty on a healthy run. */
  refusals: SolarPayRefusal[];
};

/**
 * Computes and persists commissions for one solar project.
 */
export async function computeSolarCommissionsForProject(
  db: Db,
  companyId: string,
  project: { id: string; leadId: string | null; assignedRepId: string | null; repName: string }
): Promise<SolarCommissionResult> {
  if (!project.leadId) return { created: 0, refusals: [] };
  // Null when the deal has no design or no priced finance yet. Deliberately not
  // an early return: a FLAT override does not need a price, and refusing to pay
  // one because a design row is missing would be another silent zero.
  const deal = await loadSolarDeal(db, companyId, project.leadId);

  let created = 0;
  const repId = project.assignedRepId;

  // Rules that cannot price the deal in front of them. Surfaced to the caller
  // rather than swallowed: a misconfiguration and a rep who is genuinely owed
  // nothing must not look alike on a payroll run.
  const refusals: SolarPayRefusal[] = [];

  // ---- The rep's own line ------------------------------------------------
  // Only on a deal that is actually designed and priced. There is no honest
  // number to pay before there is an array, or a battery.
  // The terms frozen at signing, and the lead classification M1 finalised.
  // Read once and used by BOTH the rep's line and every override below, because
  // an override percentage is a share of what the rep is actually paid.
  const dealComp = await db.solarDealComp.findUnique({
    where: { leadId: project.leadId },
    select: {
      repId: true,
      basis: true,
      redlineCentsPerWatt: true,
      millsPerWatt: true,
      redlinePerBatteryCents: true,
      perBatteryFlatCents: true,
      companyProvidedLead: true,
      leadAdjustMode: true,
      companyLeadTakePct: true,
      companyLeadFlatCents: true,
      needsReview: true,
    },
  });

  /**
   * A SIGNED deal whose terms could not be resolved must FAIL SAFE.
   *
   * The old precedence ended in "the rep's configuration today", and for an
   * unsigned estimate that is right — there is nothing else to use. For a signed
   * deal it is wrong in the most expensive way available: it reprices a sale
   * that a customer already put their name to, against terms nobody agreed to,
   * and it does it silently. A redline raised in the six months between contract
   * and M1 would simply change what the deal pays.
   *
   * So: signed and unresolved means no commission, a flag, and a human. See
   * `SolarDealComp.needsReview` and `establishHistoricalComp`.
   */
  const blockedForReview = dealComp?.needsReview === true;

  /**
   * Has a customer put their name to this deal?
   *
   * Read from the proposal rather than the pipeline stage: a stage can be
   * dragged backwards, and "signed" is a fact about a document, not a position
   * on a board.
   */
  const isSigned =
    (await db.solarProposal.count({
      where: { leadId: project.leadId, signedAt: { not: null } },
    })) > 0;

  /**
   * What the rep is actually owed, after the company's cut on a company-provided
   * lead. Every override percentage is a share of THIS, not of the contract —
   * an override is a share of what the rep earned, and paying it off the
   * contract made a manager's cut independent of the rep's.
   */
  let repNetCents = 0;

  if (repId && deal) {
    const rep = await db.user.findFirst({
      where: { id: repId, companyId },
      select: {
        solarRedlineCentsPerWatt: true,
        solarPerWattMills: true,
        solarBatteryPayPlan: true,
        solarRedlinePerBatteryCents: true,
        solarPerBatteryFlatCents: true,
      },
    });

    /**
     * Anything the rep carries on this deal that ISN'T a solar line is stale —
     * a pool split generated before this engine existed, say.
     *
     * PENDING ONLY, everywhere in this function. An APPROVED commission is a
     * record of what somebody was told they had earned, and an admin put their
     * name to it; a later run must not delete it, and must not quietly move its
     * amount either. Corrections to an approved line go through an explicit
     * adjustment, reversal or chargeback, each of which leaves its own record.
     * Paid lines were already safe; approved ones were not.
     */
    await db.commission.deleteMany({
      where: {
        projectId: project.id,
        userId: repId,
        overrideId: null,
        status: "pending",
        NOT: { label: { startsWith: "Solar " } },
      },
    });

    const existing = await db.commission.findFirst({
      where: {
        projectId: project.id,
        userId: repId,
        overrideId: null,
        ruleId: null,
        // Pending only — an approved line is history. See the note above.
        status: "pending",
        label: { startsWith: "Solar " },
      },
      select: {
        id: true,
        solarBasis: true,
        solarRedlineCentsPerWatt: true,
        solarRedlinePerBatteryCents: true,
        solarPerBatteryFlatCents: true,
        solarMillsPerWatt: true,
      },
    });

    // LOCKED terms: an existing line keeps the redline it was sold against, so
    // raising a rep's redline never re-prices a deal already in the pipeline.
    // Only watts and price refresh — a design that grows before install should
    // move the number, exactly as job costs move a roofing pool.
    /**
     * Precedence, earliest wins:
     *   1. the terms agreed at SIGNING (`SolarDealComp`)
     *   2. the terms the commission row was written with
     *   3. the rep's configuration today — UNSIGNED DEALS ONLY
     *
     * (3) is the estimate path. A deal that has not sold has nothing else to be
     * measured against, and showing a rep a number from their current profile is
     * exactly right. A SIGNED deal must never reach it: `isSigned` below is what
     * stops today's redline repricing a sale that closed six months ago.
     */
    const snapshot =
      (dealComp && snapshotFromDealComp(dealComp)) || (existing && snapshotFrom(existing));
    const resolution: SolarPayResolution = snapshot
      ? { kind: "terms", terms: snapshot }
      : isSigned
        ? {
            kind: "refused",
            reason: blockedForReview
              ? "Flagged for compensation review: this deal signed before its rep had terms for " +
                "this kind of deal. An admin must establish what it was sold on before it pays."
              : "This deal was signed without usable compensation terms. An admin must establish " +
                "the terms it was sold on before it can pay — the rep's current profile is not a " +
                "substitute for what was agreed.",
          }
        : rep
          ? resolveSolarPay({
              systemType: deal.systemType,
              product: deal.product,
              lenderPayMode: deal.lenderPayMode,
              rep,
            })
          : { kind: "unconfigured" };

    if (resolution.kind === "refused") {
      // NOT a zero line, and not silence either. The rule is wrong for this
      // deal and somebody has to change one of them; payroll shows it as
      // unpayable and names the reason.
      refusals.push({ projectId: project.id, userId: repId, reason: resolution.reason });
    } else if (resolution.kind === "terms") {
      const terms = resolution.terms;
      const pay = solarRepPayCents(terms, deal);
      // The company's cut on a company-provided lead. `companyProvidedLead` is
      // NULL until M1 finalises it, and null is deliberately treated as "not
      // company-provided": taking money off a rep on a classification nobody has
      // decided yet is the wrong way round. See SolarDealComp.
      const payout = applyCompanyLeadTake(pay.amountCents, {
        companyProvided: dealComp?.companyProvidedLead === true,
        mode: dealComp?.leadAdjustMode ?? "none",
        takePct: dealComp?.companyLeadTakePct ?? null,
        flatCents: dealComp?.companyLeadFlatCents ?? null,
      });
      repNetCents = payout.netCents;
      const data = {
        // Stamped explicitly rather than left to the isolation extension. A
        // tagged row's vertical is normally derived from its project, but that
        // derivation is skipped entirely when the caller is unscoped — which is
        // what a payroll cron is. The department is not in doubt here: this
        // function only ever runs on a solar project.
        vertical: "solar" as const,
        label: solarPayLabel(terms, deal.systemWatts, pay),
        baseAmount: pay.basisCents,
        // The NET figure. `solarGrossAmount` keeps what the basis produced, so a
        // pay stub can show a rep both numbers and the rate between them.
        amount: payout.netCents,
        solarGrossAmount: payout.grossCents,
        solarCompanyLeadTakePct: payout.appliedMode === "percentage" ? payout.appliedTakePct : null,
        solarCompanyLeadFlatCents: payout.appliedMode === "flat" ? payout.appliedFlatCents : null,
        solarBasis: terms.basis,
        solarRedlineCentsPerWatt: terms.redlineCentsPerWatt,
        solarRedlinePerBatteryCents: terms.redlinePerBatteryCents,
        solarPerBatteryFlatCents: terms.perBatteryFlatCents,
        solarMillsPerWatt: terms.millsPerWatt,
      };
      if (existing) {
        await db.commission.update({ where: { id: existing.id }, data });
      } else {
        await db.commission.create({
          data: { companyId, projectId: project.id, userId: repId, ruleId: null, status: "pending", ...data },
        });
        created += 1;
      }
    } else if (existing) {
      // The rep's terms were cleared and this line was never snapshotted (only
      // possible on a line written before the snapshot columns existed). Drop
      // it rather than leave a number nothing can explain.
      await db.commission.delete({ where: { id: existing.id } });
    }
  }

  // ---- Overrides: people who earn off this deal's rep ---------------------
  // Recomputed from scratch each run; paid lines survive as history. Matched on
  // the DEAL's vertical, never the session's — payroll can run from a cron with
  // no workspace context, and CommissionOverride is a shared model.
  // Pending only. An approved override has been signed off by an admin and is
  // no more rewritable than the rep's own line.
  await db.commission.deleteMany({
    where: { projectId: project.id, overrideId: { not: null }, status: "pending" },
  });
  /**
   * A blocked deal pays NOBODY. A manager's percentage override is a share of a
   * rep commission that has not been established, and a $/W or flat override on
   * a deal whose terms are under review would pay out ahead of the rep whose
   * sale it rides on.
   */
  if (repId && !(isSigned && blockedForReview)) {
    const overrides = await db.commissionOverride.findMany({
      where: { companyId, sourceId: repId, vertical: "solar" },
    });
    const rows: Prisma.CommissionCreateManyInput[] = [];
    for (const o of overrides) {
      /**
       * A PERCENTAGE OVERRIDE IS A SHARE OF WHAT THE REP EARNED — specifically
       * of the rep's FINAL commission, after the company's lead take.
       *
       * It used to be a percentage of the CONTRACT PRICE, and that was wrong in
       * both directions. A manager's cut moved with the size of the system
       * rather than with the rep's performance, so a rep who sold at their
       * redline earned nothing while their manager still earned thousands; and
       * on a company-provided lead the manager was paid a share of money the
       * company had already taken back off the rep.
       *
       * A FLAT override is unchanged: a flat amount is a flat amount, agreed per
       * deal, and is deliberately not a function of anything.
       *
       * The rep's number never moves because of this. An override is the
       * COMPANY's arrangement with a manager, paid alongside the rep's
       * commission and never out of it — multiple managers can each hold one on
       * the same rep, and they do not compete.
       */
      // `job_cost` and `margin` are roofing-era values. A solar override on one
      // of them is a misconfiguration, not a zero — skip it loudly rather than
      // paying nothing and looking settled.
      if (o.type !== "percentage" && o.type !== "flat" && o.type !== "ppw") {
        refusals.push({
          projectId: project.id,
          userId: o.beneficiaryId,
          reason: `Override type "${o.type}" is not a solar override basis. Use $/W, a percentage of the rep's commission, or a flat amount.`,
        });
        continue;
      }
      const result = managerOverrideCents(
        { type: o.type, percent: o.percent, flatAmount: o.flatAmount, perWattMills: o.perWattMills },
        { systemWatts: deal?.systemWatts ?? 0, repNetCents }
      );
      const basisCents = result.basisCents;
      const amount = result.amountCents;
      if (amount <= 0) continue;
      const side = VERTICAL_LABEL[o.vertical];
      rows.push({
        companyId,
        vertical: "solar" as const,
        projectId: project.id,
        userId: o.beneficiaryId,
        overrideId: o.id,
        label:
          o.type === "flat"
            ? `${side} override on ${project.repName} (flat)`
            : o.type === "ppw"
              ? `${side} override on ${project.repName} ($${(o.perWattMills / 1000).toFixed(2)}/W)`
              : `${side} override on ${project.repName} (${o.percent}% of their commission)`,
        baseAmount: basisCents,
        amount,
        status: "pending",
      });
    }
    if (rows.length) created += (await db.commission.createMany({ data: rows })).count;
  }

  return { created, refusals };
}

/**
 * What this deal is expected to pay its rep, for the deal page.
 *
 * ESTIMATED, and the word is load-bearing. The number a rep reads on a deal is
 * what the sale is currently worth to them; it is not a promise about a payroll
 * cheque. A later trenching deduction or a bonus changes the CHEQUE and must
 * never come back and rewrite this — the deal goes on saying $10,000 while
 * payroll says $9,500, and both are true.
 *
 * PRECEDENCE, identical to `computeSolarCommissionsForProject` and deliberately
 * sharing `loadSolarDeal` with it so the screen and the payout cannot drift:
 *   • SIGNED   → the frozen snapshot, always. Never the rep's profile today,
 *                because the sale closed under different terms and repricing it
 *                on screen would show a rep a number payroll will not pay.
 *   • UNSIGNED → the rep's current configuration, which is the right basis for
 *                a quote and the only one available.
 *
 * Returns a non-estimate state rather than a number whenever there is nothing
 * honest to show. A blank beats a figure nobody can stand behind.
 */
export type SolarCommissionEstimate =
  | { state: "estimate"; grossCents: number; netCents: number; basis: string; fromSnapshot: boolean }
  | { state: "needs_review" }
  | { state: "unavailable"; reason: string };

export async function estimatedSolarCommission(
  db: Db,
  companyId: string,
  leadId: string
): Promise<SolarCommissionEstimate> {
  const [comp, deal, lead] = await Promise.all([
    db.solarDealComp.findUnique({
      where: { leadId },
      select: {
        basis: true, redlineCentsPerWatt: true, millsPerWatt: true,
        redlinePerBatteryCents: true, perBatteryFlatCents: true,
        needsReview: true, companyProvidedLead: true,
        leadAdjustMode: true, companyLeadTakePct: true, companyLeadFlatCents: true,
      },
    }),
    loadSolarDeal(db, companyId, leadId),
    db.lead.findFirst({ where: { id: leadId, companyId }, select: { assignedRepId: true } }),
  ]);

  if (comp?.needsReview) return { state: "needs_review" };
  if (!deal) return { state: "unavailable", reason: "This deal is not designed and priced yet." };

  let terms = comp ? snapshotFromDealComp(comp) : null;
  const fromSnapshot = terms != null;

  if (!terms) {
    if (!lead?.assignedRepId) return { state: "unavailable", reason: "No rep is assigned." };
    const rep = await db.user.findFirst({
      where: { id: lead.assignedRepId, companyId },
      select: {
        solarRedlineCentsPerWatt: true, solarPerWattMills: true,
        solarBatteryPayPlan: true, solarRedlinePerBatteryCents: true,
        solarPerBatteryFlatCents: true,
      },
    });
    if (!rep) return { state: "unavailable", reason: "No rep is assigned." };
    const resolved = resolveSolarPay({
      systemType: deal.systemType,
      product: deal.product,
      lenderPayMode: deal.lenderPayMode,
      rep,
    });
    if (resolved.kind !== "terms") {
      return {
        state: "unavailable",
        reason:
          resolved.kind === "refused"
            ? resolved.reason
            : "This rep has no pay terms configured for this kind of deal.",
      };
    }
    terms = resolved.terms;
  }

  const pay = solarRepPayCents(terms, deal);
  const payout = applyCompanyLeadTake(pay.amountCents, {
    companyProvided: comp?.companyProvidedLead === true,
    mode: comp?.leadAdjustMode ?? "none",
    takePct: comp?.companyLeadTakePct ?? null,
    flatCents: comp?.companyLeadFlatCents ?? null,
  });

  return {
    state: "estimate",
    grossCents: payout.grossCents,
    netCents: payout.netCents,
    basis: terms.basis,
    fromSnapshot,
  };
}
