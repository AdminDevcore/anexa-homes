import type { Prisma } from "@prisma/client";
import type { Db } from "@/server/db/types";
import { priceStoredPurchase, priceStorageStored } from "@/lib/solar-money";
import {
  resolveSolarPay,
  solarRepPayCents,
  solarPayLabel,
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
          maxFinalPpwCents: design.lender?.maxFinalPpwCents ?? null,
          finalPpwMode: design.lender?.finalPpwMode,
        }).breakdown
      : null;

  const priced = purchase ?? storagePurchase;

  return {
    product: finance.product,
    systemType: design.systemType,
    lenderPayMode: design.lender?.repPayMode ?? null,
    // Its own setting, not a fallback off the one above: a storage job has no
    // watts for that one to measure, and a partner holds different opinions
    // about the two. See SolarBatteryPayMode.
    lenderBatteryPayMode: design.lender?.batteryPayMode ?? null,
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
  if (repId && deal) {
    const rep = await db.user.findFirst({
      where: { id: repId, companyId },
      select: {
        solarRedlineCentsPerWatt: true,
        solarPerWattMills: true,
        solarRedlinePerBatteryCents: true,
        solarPerBatteryFlatCents: true,
      },
    });

    // Anything the rep carries on this deal that ISN'T a solar line is stale —
    // a pool split generated before this engine existed, say. Paid lines are
    // left alone as history.
    await db.commission.deleteMany({
      where: {
        projectId: project.id,
        userId: repId,
        overrideId: null,
        status: { in: ["pending", "approved"] },
        NOT: { label: { startsWith: "Solar " } },
      },
    });

    const existing = await db.commission.findFirst({
      where: {
        projectId: project.id,
        userId: repId,
        overrideId: null,
        ruleId: null,
        status: { in: ["pending", "approved"] },
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
    const snapshot = existing && snapshotFrom(existing);
    const resolution: SolarPayResolution = snapshot
      ? { kind: "terms", terms: snapshot }
      : rep
        ? resolveSolarPay({
            systemType: deal.systemType,
            product: deal.product,
            lenderPayMode: deal.lenderPayMode,
            lenderBatteryPayMode: deal.lenderBatteryPayMode,
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
      const data = {
        // Stamped explicitly rather than left to the isolation extension. A
        // tagged row's vertical is normally derived from its project, but that
        // derivation is skipped entirely when the caller is unscoped — which is
        // what a payroll cron is. The department is not in doubt here: this
        // function only ever runs on a solar project.
        vertical: "solar" as const,
        label: solarPayLabel(terms, deal.systemWatts, pay),
        baseAmount: pay.basisCents,
        amount: pay.amountCents,
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
  await db.commission.deleteMany({
    where: { projectId: project.id, overrideId: { not: null }, status: { in: ["pending", "approved"] } },
  });
  if (repId) {
    const overrides = await db.commissionOverride.findMany({
      where: { companyId, sourceId: repId, vertical: "solar" },
    });
    const rows: Prisma.CommissionCreateManyInput[] = [];
    for (const o of overrides) {
      // The contract price, not the Project's zero. This is the line that was
      // silently paying nothing.
      const contractCents = deal?.contractPriceCents ?? 0;
      const amount =
        o.type === "flat" ? o.flatAmount : Math.round((contractCents * o.percent) / 100);
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
            : `${side} override on ${project.repName} (${o.percent}% of contract)`,
        baseAmount: contractCents,
        amount,
        status: "pending",
      });
    }
    if (rows.length) created += (await db.commission.createMany({ data: rows })).count;
  }

  return { created, refusals };
}
