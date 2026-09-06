import { prisma } from "@/server/db/client";
import { resolveSolarPay } from "@/lib/solar-pay";

/**
 * The compensation terms one solar deal is paid on, frozen at signing.
 *
 * NOT a `"use server"` module: every function here takes a `companyId` or acts
 * on behalf of a caller that has already resolved one, which is exactly the
 * shape that must not be reachable as an endpoint. Same split as
 * `readiness.ts`, `adders.ts` and `storage-queries.ts`.
 *
 * ── WHY SIGNING AND NOT GENERATION ─────────────────────────────────────────
 * The terms were already snapshotted onto the `Commission` row — but that row
 * is not written until M1, which is months later. In between, a rep's redline
 * can be raised, their basis switched by a lender change, or the deal handed to
 * somebody else, and the deal would quietly reprice against terms nobody agreed
 * to when it sold. The customer signing is the moment the arrangement stops
 * being negotiable, so that is when it is recorded.
 *
 * ── ONE REP ────────────────────────────────────────────────────────────────
 * There is no split and no second earner. Managers are paid through
 * `CommissionOverride`, which is an arrangement between the company and the
 * manager and never comes out of the rep's number.
 */

/** Everything `resolveSolarPay` needs, read off the deal. */
async function dealTerms(companyId: string, leadId: string, repId: string) {
  const [design, finance, rep] = await Promise.all([
    prisma.solarDesign.findUnique({
      where: { leadId },
      select: {
        systemType: true,
        lender: { select: { repPayMode: true } },
      },
    }),
    prisma.solarFinance.findUnique({ where: { leadId }, select: { product: true } }),
    prisma.user.findFirst({
      where: { id: repId, companyId },
      select: {
        solarRedlineCentsPerWatt: true,
        solarPerWattMills: true,
        solarBatteryPayPlan: true,
        solarRedlinePerBatteryCents: true,
        solarPerBatteryFlatCents: true,
      },
    }),
  ]);
  if (!design || !finance || !rep) return null;

  const resolved = resolveSolarPay({
    systemType: design.systemType,
    product: finance.product,
    lenderPayMode: design.lender?.repPayMode ?? null,
    rep,
  });
  return resolved.kind === "terms" ? resolved.terms : null;
}

/**
 * Freeze this deal's compensation terms, if they are not frozen already.
 *
 * IDEMPOTENT AND CREATE-ONLY. A deal that is signed, superseded and signed
 * again keeps the terms of the FIRST signature — re-signing is how a customer
 * corrects a name, not how a rep's pay is renegotiated. Reassignment is the one
 * thing that may change this row, and it goes through `reassignSolarDealRep`
 * so it leaves a trail.
 *
 * BEST-EFFORT FOR THE CUSTOMER, FAIL-SAFE FOR THE MONEY. It is called from the
 * customer's own signing request, and a customer must never see their signature
 * fail because the company had not finished configuring a rep's redline.
 *
 * But "could not resolve" must not mean "carry on and use whatever the profile
 * says at M1" — that reprices a signed sale against terms nobody agreed to. So
 * when terms cannot be resolved a row is still written, carrying
 * `basis = "unresolved"` and `needsReview = true`. The deal is then FINDABLE and
 * BLOCKED: no commission generates until an admin establishes what it was sold
 * on, through `establishHistoricalComp`.
 */
export async function snapshotSolarDealComp(args: {
  companyId: string;
  leadId: string;
  signedAt: Date;
}): Promise<{ written: boolean; reason?: string }> {
  try {
    const existing = await prisma.solarDealComp.findUnique({
      where: { leadId: args.leadId },
      select: { id: true },
    });
    if (existing) return { written: false, reason: "already frozen" };

    const lead = await prisma.lead.findFirst({
      where: { id: args.leadId, companyId: args.companyId },
      select: { assignedRepId: true },
    });

    // No rep at all: there is nobody to freeze terms FOR, and no row can name
    // one. Recorded on the deal's activity so it is not merely absent.
    if (!lead?.assignedRepId) {
      await prisma.activityLog.create({
        data: {
          companyId: args.companyId,
          type: "system",
          message:
            "Signed with no assigned rep — commission is blocked until a rep and terms are set.",
          leadId: args.leadId,
        },
      });
      return { written: false, reason: "no assigned rep" };
    }

    const terms = await dealTerms(args.companyId, args.leadId, lead.assignedRepId);

    await prisma.solarDealComp.create({
      data: {
        companyId: args.companyId,
        leadId: args.leadId,
        repId: lead.assignedRepId,
        // "unresolved" is a real, findable state — not an absent row and not a
        // guess. `snapshotFromDealComp` refuses it, so the engine blocks.
        basis: terms?.basis ?? "unresolved",
        redlineCentsPerWatt: terms?.redlineCentsPerWatt ?? null,
        millsPerWatt: terms?.millsPerWatt ?? null,
        redlinePerBatteryCents: terms?.redlinePerBatteryCents ?? null,
        perBatteryFlatCents: terms?.perBatteryFlatCents ?? null,
        signedAt: args.signedAt,
        needsReview: !terms,
        reviewNote: terms
          ? null
          : "Signed before this rep had pay terms configured for this kind of deal.",
        // Deliberately NOT decided here. Lead origin is finalised at M1 — see
        // finalizeLeadClassification.
        companyProvidedLead: null,
      },
    });
    if (!terms) {
      await prisma.activityLog.create({
        data: {
          companyId: args.companyId,
          type: "system",
          message:
            "Signed without usable compensation terms — flagged for admin review before payroll.",
          leadId: args.leadId,
        },
      });
    }
    return { written: true, reason: terms ? undefined : "needs review" };
  } catch (err) {
    // Never fails a customer's signature. A missing snapshot degrades to the
    // previous behaviour (terms resolved at generation), which is wrong-ish but
    // not broken; a thrown error here would lose the signature itself.
    console.error(`[solar-comp] could not freeze terms for lead ${args.leadId}:`, err);
    return { written: false, reason: "error" };
  }
}

/**
 * Settle whether this deal's lead came from the company, at M1.
 *
 * WHY M1 AND NOT SIGNING. A lead's origin is routinely still being argued about
 * while the job is being built — a self-generated referral that turned out to be
 * a company marketing lead, a canvassed door that a manager had already worked.
 * M1 is the first moment the answer has to be right, because it is the moment
 * the money moves.
 *
 * The rate is COPIED off the rep now rather than read later, for the same reason
 * the basis is copied at signing: raising the company take next quarter must not
 * reprice a deal that has already funded.
 *
 * Idempotent on the classification: once finalised it stays finalised, and
 * changing it afterwards is a deliberate correction, not a re-run of M1.
 */
export async function finalizeLeadClassification(args: {
  companyId: string;
  leadId: string;
  companyProvided: boolean;
  finalizedBy: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  const comp = await prisma.solarDealComp.findUnique({
    where: { leadId: args.leadId },
    select: { id: true, repId: true, leadClassFinalizedAt: true },
  });
  if (!comp) return { ok: false, reason: "This deal has no frozen compensation terms." };
  if (comp.leadClassFinalizedAt) return { ok: true, reason: "already finalised" };

  const rep = await prisma.user.findFirst({
    where: { id: comp.repId, companyId: args.companyId },
    select: {
      solarLeadAdjustMode: true,
      solarCompanyLeadTakePct: true,
      solarCompanyLeadFlatCents: true,
    },
  });

  // Copy WHICH method as well as the amount. Storing only an amount would let a
  // rep moved from a percentage to a flat deduction next quarter change how a
  // funded deal was adjusted.
  const mode = args.companyProvided ? (rep?.solarLeadAdjustMode ?? "none") : "none";

  await prisma.solarDealComp.update({
    where: { id: comp.id },
    data: {
      companyProvidedLead: args.companyProvided,
      leadAdjustMode: mode,
      companyLeadTakePct: mode === "percentage" ? (rep?.solarCompanyLeadTakePct ?? 0) : null,
      companyLeadFlatCents: mode === "flat" ? (rep?.solarCompanyLeadFlatCents ?? 0) : null,
      leadClassFinalizedAt: new Date(),
      leadClassFinalizedBy: args.finalizedBy,
    },
  });
  return { ok: true };
}

/**
 * Move a signed deal's commission to a different rep.
 *
 * SUPER ADMIN ONLY, and the caller enforces that — this function refuses to run
 * without an actor and a reason because the whole point is the trail. It records
 * who it was taken from, who moved it, when, and why; nothing here is silent.
 *
 * The TERMS DO NOT MOVE WITH THE DEAL. The new rep inherits the basis and rates
 * the deal was sold on, because those are a property of the sale, not of the
 * person — repricing a signed deal against a different rep's redline would
 * change what the customer's system earns the company after the customer already
 * signed. If the intent is to pay the new rep on their own terms, that is a
 * different decision and needs a different row.
 */
export async function reassignSolarDealRep(args: {
  companyId: string;
  leadId: string;
  newRepId: string;
  actorId: string;
  reason: string;
}): Promise<{ ok: boolean; error?: string }> {
  const reason = args.reason.trim();
  if (reason.length < 3) return { ok: false, error: "Give a reason for the reassignment." };

  const comp = await prisma.solarDealComp.findUnique({
    where: { leadId: args.leadId },
    select: { id: true, repId: true, companyId: true },
  });
  if (!comp || comp.companyId !== args.companyId) {
    return { ok: false, error: "This deal has no frozen compensation terms to reassign." };
  }
  if (comp.repId === args.newRepId) return { ok: false, error: "That is already the deal's rep." };

  const newRep = await prisma.user.findFirst({
    where: { id: args.newRepId, companyId: args.companyId },
    select: { id: true },
  });
  if (!newRep) return { ok: false, error: "That person is not on this company." };

  await prisma.solarDealComp.update({
    where: { id: comp.id },
    data: {
      repId: args.newRepId,
      reassignedFromId: comp.repId,
      reassignedById: args.actorId,
      reassignedAt: new Date(),
      reassignReason: reason,
    },
  });

  await prisma.activityLog.create({
    data: {
      companyId: args.companyId,
      type: "assignment",
      message: `Solar commission reassigned to a different rep — ${reason}`,
      actorId: args.actorId,
      leadId: args.leadId,
    },
  });

  return { ok: true };
}

/**
 * Establish, after the fact, the terms a signed deal was actually sold on.
 *
 * THE ESCAPE HATCH FOR `needsReview`, and the only one. A deal that signed
 * without usable pay terms — legacy data, a rep configured late, a failure
 * during signing — is blocked rather than paid on today's profile. Somebody with
 * authority has to say what was agreed, and that statement is recorded as
 * theirs.
 *
 * Deliberately takes the RATES rather than reading them off the rep now. The
 * whole reason the deal is blocked is that the rep's current profile is not
 * evidence of what was agreed six months ago; re-reading it here would defeat
 * the block while appearing to satisfy it.
 *
 * Authorisation is the caller's job (super admin / admin). This refuses without
 * an actor and a note because the point of the record is that somebody owns it.
 */
export async function establishHistoricalComp(args: {
  companyId: string;
  leadId: string;
  actorId: string;
  note: string;
  terms: {
    basis: "redline" | "per_watt" | "battery_redline" | "battery_flat";
    redlineCentsPerWatt?: number | null;
    millsPerWatt?: number | null;
    redlinePerBatteryCents?: number | null;
    perBatteryFlatCents?: number | null;
  };
}): Promise<{ ok: boolean; error?: string }> {
  const note = args.note.trim();
  if (note.length < 3) return { ok: false, error: "Say what these terms are based on." };

  const comp = await prisma.solarDealComp.findUnique({
    where: { leadId: args.leadId },
    select: { id: true, companyId: true, needsReview: true },
  });
  if (!comp || comp.companyId !== args.companyId) {
    return { ok: false, error: "This deal has no compensation record to establish." };
  }
  if (!comp.needsReview) {
    // Not an error to ask twice, but it must not overwrite terms that were
    // resolved correctly at signing — those are what the customer signed under.
    return { ok: false, error: "This deal's terms are already established." };
  }

  // Exactly the rate the chosen basis reads, and nothing else. A stale value on
  // another column would be picked up by a later basis change.
  const t = args.terms;
  await prisma.solarDealComp.update({
    where: { id: comp.id },
    data: {
      basis: t.basis,
      redlineCentsPerWatt: t.basis === "redline" ? (t.redlineCentsPerWatt ?? 0) : null,
      millsPerWatt: t.basis === "per_watt" ? (t.millsPerWatt ?? 0) : null,
      redlinePerBatteryCents: t.basis === "battery_redline" ? (t.redlinePerBatteryCents ?? 0) : null,
      perBatteryFlatCents: t.basis === "battery_flat" ? (t.perBatteryFlatCents ?? 0) : null,
      needsReview: false,
      reviewNote: note,
      reviewResolvedById: args.actorId,
      reviewResolvedAt: new Date(),
    },
  });

  await prisma.activityLog.create({
    data: {
      companyId: args.companyId,
      type: "system",
      message: `Historical solar compensation established (${t.basis}) — ${note}`,
      actorId: args.actorId,
      leadId: args.leadId,
    },
  });

  return { ok: true };
}

/**
 * Signed solar deals that cannot pay until somebody says what they were sold on.
 *
 * The migration queue for legacy data: every deal that signed before terms were
 * frozen, or whose rep had nothing configured at the time. Read-only.
 */
export async function dealsNeedingCompReview(companyId: string) {
  return prisma.solarDealComp.findMany({
    where: { companyId, needsReview: true },
    orderBy: { signedAt: "asc" },
    select: {
      leadId: true,
      repId: true,
      signedAt: true,
      reviewNote: true,
      rep: { select: { firstName: true, lastName: true } },
      lead: { select: { firstName: true, lastName: true, address: true } },
    },
  });
}
