import { prisma } from "@/server/db/client";
import { getSolarSettings } from "./settings";
import { builderHref, validateProposalReadiness, type ValidationIssue } from "@/lib/solar-validation";

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
        utilityRateMills: true,
        ratePlan: true, utilityProvider: true, batteryId: true, layoutImageFileId: true,
        lenderId: true,
        // The partner's margin floor travels with the deal it was designed for.
        // A cash deal has no lender and therefore no floor, which falls out of
        // this being null rather than needing a rule of its own.
        lender: { select: { minBasePpwCents: true } },
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

  // Nothing saved yet on one side or the other. Reported as one finding PER
  // missing half, each pointing at the step that fixes it and worded the way
  // every other finding is — "complete the design and financing" told a rep
  // standing in the builder to go to the builder, and said so even when only
  // the financing was missing.
  if (!design || !finance) {
    const issues: ValidationIssue[] = [];
    if (!design) {
      issues.push({
        severity: "block",
        code: "design.not_started",
        group: "design",
        field: "design",
        message: "The system design has not been started. Pick a module, how many, and the annual usage.",
        action: { label: "Open system design", href: builderHref(leadId, "design") },
      });
    }
    if (!finance) {
      issues.push({
        severity: "block",
        code: "finance.not_started",
        group: "financing",
        field: "finance",
        message: "No financing has been set up. Choose the product and its terms.",
        action: { label: "Open financing", href: builderHref(leadId, "financing") },
      });
    }
    return { ok: true, issues };
  }

  // Quoted from the rate sheet, or from memory?
  //
  // Only asked when there IS a rate sheet to quote from: a company that has not
  // entered its lenders' terms yet still sells deals, and blocking every one of
  // them on a catalogue nobody has filled in would be a migration that broke
  // production. So the finding appears exactly when the terms exist and the deal
  // ignores them.
  const productIssues: ValidationIssue[] = [];
  if (finance.product !== "cash" && !finance.lenderProductId && design.lenderId) {
    const available = await prisma.solarLenderProduct.count({
      where: {
        companyId,
        lenderId: design.lenderId,
        product: finance.product,
        isActive: true,
      },
    });
    if (available > 0) {
      productIssues.push({
        severity: "block",
        code: "finance.no_product",
        group: "financing",
        field: "lenderProductId",
        message:
          "This deal is not quoted from any of the lender's products, so its terms are typed rather than priced.",
        action: { label: "Open financing", href: builderHref(leadId, "financing") },
      });
    }
  }

  return {
    ok: true,
    issues: [...productIssues, ...validateProposalReadiness({
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
        avgMonthlyBillCents: design.avgMonthlyBillCents,
        utilityRateMills: design.utilityRateMills,
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
        minBasePpwCents: design.lender?.minBasePpwCents ?? null,
      },
      company: {
        name: company?.name ?? null,
        phone: company?.phone ?? null,
        email: company?.email ?? null,
        address: company?.address ?? null,
      },
      assumptions,
    })],
  };
}
