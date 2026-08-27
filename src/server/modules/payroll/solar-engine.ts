import type { Prisma } from "@prisma/client";
import type { Db } from "@/server/db/types";
import { priceStoredPurchase } from "@/lib/solar-money";
import { resolveSolarPayTerms, solarRepPayCents, solarPayLabel, type SolarPayTerms } from "@/lib/solar-pay";
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
      },
    }),
    db.solarDesign.findUnique({
      where: { leadId },
      // The partner's ceiling comes with its pay mode: a capped lender funds
      // one number whatever was typed, and a commission measured on the typed
      // figure pays on money that never arrives.
      select: {
        systemSizeKwDc: true,
        lender: { select: { repPayMode: true, maxFinalPpwCents: true, finalPpwMode: true } },
      },
    }),
  ]);
  if (!finance || !design) return null;
  if (!(design.systemSizeKwDc > 0)) return null; // no array drawn: nothing to pay on

  // Cash and loan are priced per watt; lease and PPA sell electricity and have
  // no system price at all, so their base is zero and only a per-watt basis can
  // reach them. `pricePurchase` already refuses to apply a dealer fee to cash.
  //
  // HELD TO THE PARTNER'S CEILING, like every other screen that prices a saved
  // deal. On a capped lender the stored sticker is what the rep typed, not what
  // the bank funds — Amos at $5.50/W and a 65% fee leaves $1.93/W however
  // confidently $3.00 was entered — so paying a redline overage or an override
  // percentage on the uncapped figure pays out of money nobody is ever sent.
  const purchase =
    finance.product === "cash" || finance.product === "loan"
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

  return {
    product: finance.product,
    lenderPayMode: design.lender?.repPayMode ?? null,
    systemWatts: purchase?.systemWatts ?? Math.round(design.systemSizeKwDc * 1000),
    basePriceCents: purchase?.basePriceCents ?? 0,
    /**
     * What the customer signs. The basis every override is a percentage of.
     *
     * DERIVED, not the stored column: `SolarFinance.contractPriceCents` is only
     * as fresh as the last save, and a deal priced before adders were pulled
     * inside the dealer fee carries a figure several thousand dollars light. An
     * override is a percentage of what the customer actually signs.
     */
    contractPriceCents: purchase?.contractPriceCents ?? finance.contractPriceCents,
  };
}

/** The snapshot on an existing line, when it carries one. */
function snapshotFrom(row: {
  solarBasis: string | null;
  solarRedlineCentsPerWatt: number | null;
  solarMillsPerWatt: number | null;
}): SolarPayTerms | null {
  if (row.solarBasis !== "redline" && row.solarBasis !== "per_watt") return null;
  return {
    basis: row.solarBasis,
    redlineCentsPerWatt: row.solarRedlineCentsPerWatt,
    millsPerWatt: row.solarMillsPerWatt,
  };
}

/**
 * Computes and persists commissions for one solar project.
 *
 * Returns the number of commission records created.
 */
export async function computeSolarCommissionsForProject(
  db: Db,
  companyId: string,
  project: { id: string; leadId: string | null; assignedRepId: string | null; repName: string }
): Promise<number> {
  if (!project.leadId) return 0;
  // Null when the deal has no design or no priced finance yet. Deliberately not
  // an early return: a FLAT override does not need a price, and refusing to pay
  // one because a design row is missing would be another silent zero.
  const deal = await loadSolarDeal(db, companyId, project.leadId);

  let created = 0;
  const repId = project.assignedRepId;

  // ---- The rep's own line ------------------------------------------------
  // Only on a deal that is actually designed and priced. Both bases are per
  // installed watt, and there is no honest number to pay before there are any.
  if (repId && deal) {
    const rep = await db.user.findFirst({
      where: { id: repId, companyId },
      select: { solarRedlineCentsPerWatt: true, solarPerWattMills: true },
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
      select: { id: true, solarBasis: true, solarRedlineCentsPerWatt: true, solarMillsPerWatt: true },
    });

    // LOCKED terms: an existing line keeps the redline it was sold against, so
    // raising a rep's redline never re-prices a deal already in the pipeline.
    // Only watts and price refresh — a design that grows before install should
    // move the number, exactly as job costs move a roofing pool.
    const terms =
      (existing && snapshotFrom(existing)) ??
      (rep
        ? resolveSolarPayTerms({ product: deal.product, lenderPayMode: deal.lenderPayMode, rep })
        : null);

    if (terms) {
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

  return created;
}
