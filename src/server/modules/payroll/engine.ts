import type { Prisma, PrismaClient } from "@prisma/client";
import { computeDealSplit, resolveSplitSnapshot, applySplitSnapshot } from "@/lib/commission";
import { getDealJobCost } from "@/server/modules/costs/job-cost";

function splitLabelFor(pct: number, flatCents: number, provided: boolean): string {
  if (flatCents > 0) {
    const fee = (flatCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    return `Deal split (${pct}% − ${fee} lead fee · provided lead)`;
  }
  return `Deal split (${pct}%${provided ? " · provided lead" : ""})`;
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Computes and persists commissions for a single project.
 *
 * Pay model:
 *  - Sales reps & sales managers are each paid their own SPLIT % of the deal's
 *    profit pool (contract − job costs − company overhead). Someone with no
 *    split % configured is skipped. These lines are recomputed on every run so
 *    they always reflect current costs (no stale amounts), except already-paid
 *    ones, which are preserved as history.
 *  - Crew/installer and project-manager pay stay rule-based (flat or %), via
 *    active CommissionRules. Idempotent (won't duplicate).
 *
 * Returns the number of commission records created.
 */
export async function computeCommissionsForProject(
  db: Db,
  companyId: string,
  projectId: string
): Promise<number> {
  const project = await db.project.findFirst({
    where: { id: projectId, companyId },
    include: {
      company: { select: { overheadPct: true } },
      lead: { select: { assignedRep: { select: { id: true, firstName: true, lastName: true, commissionSplitPct: true, providedLeadType: true, providedLeadSplitPct: true, providedLeadFlatCents: true, deductiblePct: true } } } },
      crewAssignments: { include: { crew: { include: { members: true } } } },
    },
  });
  if (!project) return 0;

  // Adjusted contract (company revenue) counts every piece; rules/overrides use it.
  // Depreciation has been retired from the deal split.
  const contract =
    project.contractValue + project.supplementCents + project.deductibleCents;
  // The SPLIT pool excludes the deductible and any supplement the rep doesn't get
  // on this deal (company keeps that share / pays the rep upfront).
  const splitBaseContract =
    project.contractValue +
    (project.repGetsSupplement ? project.supplementCents : 0);
  // Job cost comes from bookkeeping: approved deal-tagged expenses, excluding
  // contractor/sales payouts (which are paid via this very split).
  const { totalCents: costTotal } = await getDealJobCost(companyId, projectId);
  const { poolCents: pool } = computeDealSplit({
    contractCents: splitBaseContract,
    costCents: costTotal,
    overheadPct: project.company.overheadPct,
    repSplitPct: 0,
  });

  let created = 0;

  // ---- Split commissions: assigned rep + active sales managers --------------
  const managers = await db.user.findMany({
    where: { companyId, role: "manager", status: "active" },
    select: { id: true, commissionSplitPct: true, providedLeadType: true, providedLeadSplitPct: true, providedLeadFlatCents: true },
  });
  const rep = project.lead?.assignedRep ?? null;
  const provided = project.companyProvidedLead;
  // Each split person's CURRENT config (used only for brand-new deal-split lines).
  const cfgByUser = new Map<string, { selfGenPct: number | null; providedType: string; providedPct: number | null; providedFlatCents: number | null }>();
  const putCfg = (u: { id: string; commissionSplitPct: number | null; providedLeadType: string; providedLeadSplitPct: number | null; providedLeadFlatCents: number | null }) =>
    cfgByUser.set(u.id, { selfGenPct: u.commissionSplitPct, providedType: u.providedLeadType, providedPct: u.providedLeadSplitPct, providedFlatCents: u.providedLeadFlatCents });
  if (rep) putCfg(rep);
  for (const m of managers) putCfg(m);
  const splitRoleUserIds = [...cfgByUser.keys()];

  if (splitRoleUserIds.length) {
    // Clear legacy/non-split own lines (old rule-based + deductible-share) so they
    // recompute — but PRESERVE existing "Deal split" lines: their terms are
    // snapshotted, so editing a rep's split must never change an already-sold deal.
    await db.commission.deleteMany({
      where: { projectId, userId: { in: splitRoleUserIds }, overrideId: null, status: { in: ["pending", "approved"] }, NOT: { label: { startsWith: "Deal split" } } },
    });
    const existingSplits = await db.commission.findMany({
      where: { projectId, userId: { in: splitRoleUserIds }, overrideId: null, ruleId: null, status: { in: ["pending", "approved"] }, label: { startsWith: "Deal split" } },
      select: { id: true, userId: true, splitPct: true, splitFlatCents: true },
    });
    const existingByUser = new Map(existingSplits.map((e) => [e.userId, e]));

    for (const userId of splitRoleUserIds) {
      const existing = existingByUser.get(userId);
      if (existing) {
        // LOCKED: keep the snapshotted terms, only refresh the amount from current
        // costs. Backfill the snapshot from current config if a legacy line lacks it.
        let sp = existing.splitPct;
        let sf = existing.splitFlatCents;
        if (sp == null) {
          const snap = resolveSplitSnapshot(provided, cfgByUser.get(userId)!);
          if (!snap) continue;
          sp = snap.splitPct;
          sf = snap.splitFlatCents;
        }
        await db.commission.update({
          where: { id: existing.id },
          data: { splitPct: sp, splitFlatCents: sf, baseAmount: pool, amount: applySplitSnapshot(pool, sp, sf), label: splitLabelFor(sp, sf, provided) },
        });
      } else {
        // Brand-new deal-split line → snapshot the rep's CURRENT terms.
        const snap = resolveSplitSnapshot(provided, cfgByUser.get(userId)!);
        if (!snap) continue;
        await db.commission.create({
          data: {
            companyId, projectId, userId, ruleId: null,
            label: splitLabelFor(snap.splitPct, snap.splitFlatCents, provided),
            baseAmount: pool, amount: applySplitSnapshot(pool, snap.splitPct, snap.splitFlatCents),
            splitPct: snap.splitPct, splitFlatCents: snap.splitFlatCents, status: "pending",
          },
        });
        created += 1;
      }
    }
    // Rep's separate share of the customer-paid deductible (not part of the pool).
    if (rep && rep.deductiblePct && project.deductibleCents > 0) {
      const amount = Math.round((project.deductibleCents * rep.deductiblePct) / 100);
      if (amount > 0) {
        await db.commission.create({
          data: {
            companyId,
            projectId,
            userId: rep.id,
            ruleId: null,
            label: `Deductible share (${rep.deductiblePct}% of ${(project.deductibleCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })})`,
            baseAmount: project.deductibleCents,
            amount,
            status: "pending",
          },
        });
        created += 1;
      }
    }
  }

  // ---- Rule-based commissions: crew (installer) + project manager -----------
  const rules = await db.commissionRule.findMany({
    where: { companyId, active: true, role: { in: ["installer", "project_manager"] } },
  });
  const installerUserIds = new Set<string>();
  for (const a of project.crewAssignments) for (const m of a.crew.members) if (m.userId) installerUserIds.add(m.userId);

  const existing = await db.commission.findMany({ where: { projectId }, select: { userId: true, ruleId: true } });
  const seen = new Set(existing.map((e) => `${e.userId}:${e.ruleId ?? ""}`));
  const flat: Prisma.CommissionCreateManyInput[] = [];
  for (const rule of rules) {
    if (
      rule.projectType &&
      project.roofingType &&
      !project.roofingType.toLowerCase().includes(rule.projectType.toLowerCase())
    ) {
      continue;
    }
    let recipients: string[] = [];
    if (rule.role === "installer") recipients = [...installerUserIds];
    else if (rule.role === "project_manager") recipients = project.managerId ? [project.managerId] : [];
    const amount = rule.type === "flat" ? rule.flatAmount : Math.round((contract * rule.percent) / 100);
    for (const userId of recipients) {
      const key = `${userId}:${rule.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      flat.push({ companyId, projectId, userId, ruleId: rule.id, label: rule.name, baseAmount: contract, amount, status: "pending" });
    }
  }
  if (flat.length) {
    const r = await db.commission.createMany({ data: flat, skipDuplicates: true });
    created += r.count;
  }

  // ---- Override commissions: people who earn off this deal's rep -------------
  // Recompute from scratch each run (paid lines preserved as history).
  await db.commission.deleteMany({
    where: { projectId, overrideId: { not: null }, status: { in: ["pending", "approved"] } },
  });
  if (rep) {
    const repName = `${rep.firstName} ${rep.lastName}`.trim();
    const overrides = await db.commissionOverride.findMany({ where: { companyId, sourceId: rep.id } });
    const ovData: Prisma.CommissionCreateManyInput[] = [];
    for (const o of overrides) {
      const amount = o.type === "flat" ? o.flatAmount : Math.round((contract * o.percent) / 100);
      if (amount <= 0) continue;
      const label =
        o.type === "flat"
          ? `Override on ${repName} (flat)`
          : `Override on ${repName} (${o.percent}% of contract)`;
      ovData.push({ companyId, projectId, userId: o.beneficiaryId, overrideId: o.id, label, baseAmount: contract, amount, status: "pending" });
    }
    if (ovData.length) {
      const r = await db.commission.createMany({ data: ovData });
      created += r.count;
    }
  }

  return created;
}
