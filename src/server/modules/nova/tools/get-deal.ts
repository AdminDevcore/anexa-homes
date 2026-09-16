import type { FinanceProduct } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { formatMailingAddress } from "@/lib/address";
import { daysInStage, stageTiming } from "@/lib/stage-status";
import {
  REPORTED_PROPOSAL_ORDER,
  resolveReportedSystem,
  type DesignSystem,
} from "@/lib/solar-system-of-record";
import { readProposalSnapshot } from "@/lib/solar-proposal";
import { resolveDeal } from "../access";
import { NOT_SET, formatDateTime, formatKw, formatMoney, formatPct } from "../format";
import { defineTool, z } from "./define";

export const PRODUCT_LABEL: Record<FinanceProduct, string> = {
  cash: "Cash",
  loan: "Loan",
  lease: "Lease",
  ppa: "PPA",
};

export const getDeal = defineTool({
  name: "get_deal",
  kind: "read",
  description:
    "Details of one Solar deal: stage, days in stage, assigned rep, appointment, system size, panel count, offset, financing product, lender and contract price. Omit deal_id to use the deal on screen.",
  input: z.object({
    deal_id: z.guid().optional().describe("From find_deal. Omit for the deal on screen."),
  }),
  async run(ctx, { deal_id }) {
    const deal = await resolveDeal(ctx, deal_id);
    if (!deal.ok) return deal;
    const { leadId } = deal;
    const { companyId } = ctx.user;

    const [lead, design, finance, proposal] = await Promise.all([
      prisma.lead.findFirst({
        where: { id: leadId, companyId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          email: true,
          address: true,
          city: true,
          state: true,
          zip: true,
          createdAt: true,
          stageChangedAt: true,
          appointmentAt: true,
          appointmentDisposition: true,
          stage: { select: { name: true, targetDays: true, stageType: true } },
          assignedRep: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.solarDesign.findUnique({
        where: { leadId },
        select: {
          systemSizeKwDc: true,
          moduleQty: true,
          offsetPct: true,
          year1ProductionKwh: true,
          annualUsageKwh: true,
          batteryQty: true,
          lender: { select: { name: true } },
        },
      }),
      prisma.solarFinance.findUnique({
        where: { leadId },
        select: { product: true, leaseMonthlyCents: true, rateMillsPerKwh: true },
      }),
      // The deal page's own question: the approved version, else the newest.
      prisma.solarProposal.findFirst({
        where: { companyId, leadId },
        orderBy: REPORTED_PROPOSAL_ORDER,
        select: {
          version: true,
          status: true,
          sentAt: true,
          createdAt: true,
          approvedAt: true,
          snapshot: true,
        },
      }),
    ]);
    if (!lead) return { ok: false, reason: "not_found", message: "That deal no longer exists." };

    const designSystem: DesignSystem | null = design
      ? {
          sizeKwDc: design.systemSizeKwDc,
          moduleQty: design.moduleQty,
          moduleRatingW: null,
          year1ProductionKwh: design.year1ProductionKwh,
          offsetPct: design.offsetPct,
          annualUsageKwh: design.annualUsageKwh,
          moduleLabel: null,
          inverterLabel: null,
          batteryLabel: null,
          batteryQty: design.batteryQty,
          product: finance?.product ?? null,
          // No second derivation of the working price. The deal page re-prices
          // an unproposed design inline; copying that here would be a second
          // place that can disagree with it. Without a proposal there is no
          // contract price, and Nova says so.
          contractPriceCents: null,
          netAfterCreditsCents: null,
          monthlyPaymentCents: finance?.leaseMonthlyCents ?? null,
          rateMillsPerKwh: finance?.rateMillsPerKwh ?? null,
        }
      : null;

    const reported = resolveReportedSystem({
      proposal: proposal
        ? {
            version: proposal.version,
            status: proposal.status,
            at: (proposal.sentAt ?? proposal.createdAt).toISOString(),
            approved: proposal.approvedAt != null,
            snapshot: readProposalSnapshot(proposal.snapshot)!,
          }
        : null,
      design: designSystem,
    });

    const drawn = reported != null && reported.sizeKwDc > 0;
    let contractPrice = NOT_SET;
    let contractPriceSource: string;
    let figuresFrom: string;
    if (reported?.source.kind === "proposal") {
      const label = `Proposal v${reported.source.version}${
        reported.source.approved ? " (approved)" : " (the newest; none is approved)"
      }`;
      figuresFrom = label;
      if (reported.product === "lease" || reported.product === "ppa") {
        contractPriceSource = `${label} is a ${PRODUCT_LABEL[reported.product]}, which has no contract price`;
      } else if (reported.contractPriceCents != null && reported.contractPriceCents > 0) {
        contractPrice = formatMoney(reported.contractPriceCents);
        contractPriceSource = label;
      } else {
        contractPriceSource = `${label} carries no contract price`;
      }
    } else {
      figuresFrom = reported ? "the working design (no proposal yet)" : NOT_SET;
      contractPriceSource = "no proposal has been generated, so there is no contract price yet";
    }

    const timing =
      lead.stage && lead.stage.stageType === "internally_owned"
        ? stageTiming(lead.stageChangedAt, lead.createdAt, lead.stage.targetDays, ctx.now.getTime())
        : null;

    return {
      ok: true,
      leadId,
      data: {
        deal_id: lead.id,
        customer: `${lead.firstName} ${lead.lastName}`.trim(),
        phone: lead.phone ?? NOT_SET,
        email: lead.email ?? NOT_SET,
        address: formatMailingAddress(lead) || NOT_SET,
        stage: lead.stage?.name ?? NOT_SET,
        days_in_stage: daysInStage(lead.stageChangedAt, lead.createdAt, ctx.now.getTime()),
        stage_day_limit: timing && timing.targetDays > 0 ? timing.targetDays : NOT_SET,
        overdue_by_days: timing?.status === "overdue" ? timing.overdueBy : 0,
        assigned_rep: lead.assignedRep
          ? `${lead.assignedRep.firstName} ${lead.assignedRep.lastName}`.trim()
          : NOT_SET,
        appointment: formatDateTime(lead.appointmentAt, ctx.timeZone),
        appointment_outcome: lead.appointmentDisposition ?? NOT_SET,
        system_size: drawn ? formatKw(reported.sizeKwDc) : NOT_SET,
        panel_count: drawn && reported.moduleQty > 0 ? String(reported.moduleQty) : NOT_SET,
        offset: drawn ? formatPct(reported.offsetPct) : NOT_SET,
        financing_product: reported?.product ? PRODUCT_LABEL[reported.product] : NOT_SET,
        lender: design?.lender?.name ?? NOT_SET,
        contract_price: contractPrice,
        contract_price_source: contractPriceSource,
        system_figures_from: figuresFrom,
      },
    };
  },
});
