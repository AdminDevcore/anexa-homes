"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getSolarSettings } from "./settings";
import { buildProposalSnapshot } from "@/lib/solar-proposal";
import { validateSolarDeal, canGenerate } from "@/lib/solar-validation";

const fail = (error: string) => ({ ok: false as const, error });

function label(e: { manufacturer: string | null; model: string; ratingW: number | null } | null) {
  if (!e) return null;
  return `${e.manufacturer ? `${e.manufacturer} ` : ""}${e.model}${e.ratingW ? ` · ${e.ratingW}W` : ""}`;
}

/**
 * Generate the next version of a customer-facing proposal.
 *
 * Built entirely from the VALIDATED, server-stored design and finance rows —
 * nothing is taken from client input, so the guard rails cannot be bypassed by
 * posting different numbers. Generation is refused outright while any blocking
 * validation issue stands.
 *
 * Regenerating supersedes the previous version rather than editing it: what a
 * customer was shown, and when, has to survive.
 */
export async function generateSolarProposalAction(leadId: string) {
  const user = await requireUser();
  if (!can(user, "create", "Proposal")) return fail("Not allowed.");

  const [lead, design, finance, assumptions, company] = await Promise.all([
    prisma.lead.findFirst({
      where: { companyId: user.companyId, id: leadId },
      select: {
        id: true, vertical: true, firstName: true, lastName: true,
        address: true, city: true, state: true, zip: true,
      },
    }),
    prisma.solarDesign.findUnique({
      where: { leadId },
      include: {
        module: { select: { manufacturer: true, model: true, ratingW: true } },
        inverter: { select: { manufacturer: true, model: true, ratingW: true } },
        battery: { select: { manufacturer: true, model: true, ratingW: true } },
      },
    }),
    prisma.solarFinance.findUnique({ where: { leadId } }),
    getSolarSettings(user.companyId),
    prisma.company.findUnique({
      where: { id: user.companyId },
      select: { name: true, phone: true, email: true, settings: { select: { logoUrl: true } } },
    }),
  ]);

  if (!lead) return fail("Deal not found.");
  if (lead.vertical !== "solar") return fail("This is not a solar deal.");
  if (!design || !finance) return fail("Complete the system design and financing first.");

  // The gate. Identical rules to the builder's readiness check, enforced here
  // so a proposal can never be generated around the UI.
  const issues = validateSolarDeal(
    {
      systemSizeKwDc: design.systemSizeKwDc,
      year1ProductionKwh: design.year1ProductionKwh,
      annualUsageKwh: design.annualUsageKwh,
      offsetPct: design.offsetPct,
      moduleQty: design.moduleQty,
      moduleRatingW: design.module?.ratingW ?? null,
    },
    {
      product: finance.product,
      grossPpwCents: finance.grossPpwCents,
      dealerFeePct: finance.dealerFeePct,
      contractPriceCents: finance.contractPriceCents,
      rateMillsPerKwh: finance.rateMillsPerKwh,
      monthlyPaymentCents: finance.monthlyPaymentCents,
      escalatorPct: finance.escalatorPct,
      termYears: finance.termYears,
    },
    assumptions
  );
  if (!canGenerate(issues)) {
    return { ok: false as const, error: "Fix the blocking issues before generating.", issues };
  }

  const approvedCredit = await prisma.creditApplication.findFirst({
    where: { companyId: user.companyId, leadId, status: { in: ["approved", "conditional"] } },
    orderBy: { decidedAt: "desc" },
    select: { lender: true },
  });

  const snapshot = buildProposalSnapshot({
    customer: {
      name: `${lead.firstName} ${lead.lastName}`.trim(),
      address: [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", "),
    },
    company: {
      name: company?.name ?? "",
      phone: company?.phone ?? null,
      email: company?.email ?? null,
      logoUrl: company?.settings?.logoUrl ?? null,
    },
    design: {
      systemSizeKwDc: design.systemSizeKwDc,
      year1ProductionKwh: design.year1ProductionKwh,
      offsetPct: design.offsetPct,
      annualUsageKwh: design.annualUsageKwh ?? 0,
      moduleLabel: label(design.module),
      moduleQty: design.moduleQty,
      inverterLabel: label(design.inverter),
      batteryLabel: label(design.battery),
      mountType: design.mountType,
      utilityProvider: design.utilityProvider,
      netMeteringProgram: design.netMeteringProgram,
      avgMonthlyBillCents: design.avgMonthlyBillCents,
    },
    finance: {
      product: finance.product,
      grossPpwCents: finance.grossPpwCents,
      dealerFeePct: finance.dealerFeePct,
      adderTotalCents: finance.adderTotalCents,
      rateMillsPerKwh: finance.rateMillsPerKwh,
      monthlyPaymentCents: finance.monthlyPaymentCents,
      escalatorPct: finance.escalatorPct,
      termYears: finance.termYears,
      aprPct: finance.aprPct,
    },
    lender: approvedCredit?.lender ?? null,
    assumptions,
    incentiveDisclaimer: assumptions.incentiveDisclaimer,
    now: new Date(),
  });

  const latest = await prisma.solarProposal.findFirst({
    where: { companyId: user.companyId, leadId },
    orderBy: { version: "desc" },
    select: { id: true, version: true },
  });

  const proposal = await prisma.solarProposal.create({
    data: {
      companyId: user.companyId,
      leadId,
      version: (latest?.version ?? 0) + 1,
      status: "generated",
      publicToken: randomBytes(24).toString("base64url"),
      snapshot: snapshot as never,
      createdById: user.userId,
      events: {
        create: {
          type: "generated",
          actorId: user.userId,
          actorName: user.fullName,
          detail: `v${(latest?.version ?? 0) + 1} · ${finance.product}`,
        },
      },
    },
    select: { id: true, version: true, publicToken: true },
  });

  // Supersede rather than delete: the old version stays readable.
  if (latest) {
    await prisma.solarProposal.update({
      where: { id: latest.id },
      data: {
        supersededAt: new Date(),
        events: { create: { type: "superseded", actorId: user.userId, actorName: user.fullName, detail: `replaced by v${proposal.version}` } },
      },
    });
  }

  revalidatePath(`/portal/leads/${leadId}`);
  return { ok: true as const, ...proposal, warnings: issues };
}

/** Record that the proposal was sent to the customer. */
export async function markProposalSentAction(proposalId: string) {
  const user = await requireUser();
  if (!can(user, "update", "Proposal")) return fail("Not allowed.");
  const p = await prisma.solarProposal.findFirst({
    where: { companyId: user.companyId, id: proposalId },
    select: { id: true, leadId: true },
  });
  if (!p) return fail("Proposal not found.");

  await prisma.solarProposal.update({
    where: { id: p.id },
    data: {
      status: "sent",
      sentAt: new Date(),
      events: { create: { type: "sent", actorId: user.userId, actorName: user.fullName } },
    },
  });
  revalidatePath(`/portal/leads/${p.leadId}`);
  return { ok: true as const };
}
