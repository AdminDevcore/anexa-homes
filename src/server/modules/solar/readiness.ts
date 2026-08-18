import { prisma } from "@/server/db/client";
import { getSolarSettings } from "./settings";
import { validateProposalReadiness, type ValidationIssue } from "@/lib/solar-validation";

/**
 * The one readiness computation, shared by the builder's check button and by
 * generation itself. Two copies of these rules is how a proposal gets generated
 * around its own guard rails, so there is exactly one.
 *
 * Deliberately NOT in actions.ts: every export of a "use server" module is a
 * callable endpoint, and this takes `companyId` as an argument. Exported from
 * there it would let anyone read any company's readiness by posting a different
 * id. Callers pass the id they already resolved from the session.
 */
export async function readSolarReadiness(
  companyId: string,
  leadId: string
): Promise<{ ok: true; issues: ValidationIssue[] } | { ok: false; error: string }> {
  const [lead, design, finance, assumptions, company] = await Promise.all([
    prisma.lead.findFirst({
      where: { companyId, id: leadId },
      select: {
        id: true, vertical: true, firstName: true, lastName: true,
        address: true, city: true, state: true, zip: true,
      },
    }),
    prisma.solarDesign.findUnique({
      where: { leadId },
      select: {
        systemSizeKwDc: true, year1ProductionKwh: true, annualUsageKwh: true,
        offsetPct: true, moduleQty: true, tsrfPct: true, avgMonthlyBillCents: true,
        ratePlan: true, utilityProvider: true, batteryId: true, layoutImageFileId: true,
        module: { select: { ratingW: true } },
      },
    }),
    prisma.solarFinance.findUnique({ where: { leadId } }),
    getSolarSettings(companyId),
    prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, phone: true, email: true, address: true },
    }),
  ]);

  if (!lead) return { ok: false, error: "Deal not found." };
  if (lead.vertical !== "solar") return { ok: false, error: "This is not a solar deal." };

  if (!design || !finance) {
    return {
      ok: true,
      issues: [
        {
          severity: "block",
          code: "design.not_started",
          group: "design",
          field: "design",
          message: "Complete the system design and financing before generating a proposal.",
          action: { label: "Open the builder", href: `/portal/leads/${leadId}/solar-proposal` },
        },
      ],
    };
  }

  return {
    ok: true,
    issues: validateProposalReadiness({
      leadId,
      customer: {
        firstName: lead.firstName, lastName: lead.lastName, address: lead.address,
        city: lead.city, state: lead.state, zip: lead.zip,
      },
      design: {
        systemSizeKwDc: design.systemSizeKwDc,
        year1ProductionKwh: design.year1ProductionKwh,
        annualUsageKwh: design.annualUsageKwh,
        offsetPct: design.offsetPct,
        moduleQty: design.moduleQty,
        moduleRatingW: design.module?.ratingW ?? null,
        tsrfPct: design.tsrfPct,
        avgMonthlyBillCents: design.avgMonthlyBillCents,
        ratePlan: design.ratePlan,
        utilityProvider: design.utilityProvider,
        hasLayoutImage: !!design.layoutImageFileId,
        hasBattery: !!design.batteryId,
      },
      finance: {
        product: finance.product,
        grossPpwCents: finance.grossPpwCents,
        dealerFeePct: finance.dealerFeePct,
        contractPriceCents: finance.contractPriceCents,
        rateMillsPerKwh: finance.rateMillsPerKwh,
        monthlyPaymentCents: finance.monthlyPaymentCents,
        escalatorPct: finance.escalatorPct,
        termYears: finance.termYears,
        downPaymentCents: finance.downPaymentCents,
        loanMonthlyPaymentCents: finance.loanMonthlyPaymentCents,
        aprPct: finance.aprPct,
        loanTermMonths: finance.loanTermMonths,
      },
      company: {
        name: company?.name ?? null,
        phone: company?.phone ?? null,
        email: company?.email ?? null,
        address: company?.address ?? null,
      },
      assumptions,
      incentiveDisclaimer: assumptions.incentiveDisclaimer,
    }),
  };
}
