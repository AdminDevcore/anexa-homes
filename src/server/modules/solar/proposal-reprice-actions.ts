"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getSolarSettings } from "./settings";
import { lineFromCatalogue, resolveAdderTotal } from "./adders";
import { recomputeDesignFigures } from "./recompute";
import { generateProposalVersion } from "./proposal-generate";
import { financeRowForProduct } from "@/lib/solar-finance-row";
import { LENDER_TERMS_SELECT, toLenderProductTerms } from "./lender-terms";
import { annualUsageFromBill, effectiveUsageKwh, monthlyBillFromUsage } from "@/lib/solar-energy";
import { bandPpwCents, basePpwFromSticker, offsetPct, underBaseFloor } from "@/lib/solar-money";
import type { SolarProposalSnapshot } from "@/lib/solar-proposal";
import type { ValidationIssue } from "@/lib/solar-validation";

/**
 * Changing the deal while the homeowner is looking at it.
 *
 * A rep at a kitchen table is asked "what if we dropped the battery" or "what
 * would that be at three-fifty a watt". Until now the answer was to leave the
 * document, walk back through a five-step builder, regenerate, and come back —
 * by which point the conversation has moved on and the customer has watched
 * somebody fight a CRM for four minutes.
 *
 * WHAT THIS IS NOT: an edit. Nothing about the version on screen changes. A new
 * version is generated from the same validated, server-side path ordinary
 * generation uses, the old one is superseded and keeps its snapshot, and the
 * trail of what was offered and when survives intact. The only thing that is
 * different from pressing Generate in the builder is that the customer's live
 * link follows the new version, because the tab open on the table between them
 * IS that link.
 *
 * EVERY GUARD RAIL STILL APPLIES. The readiness validator runs, the pricing
 * bounds in Solar Settings are enforced by the same code the builder uses, and
 * a lender programme's terms still win over anything sent from a browser. This
 * is a shortcut through the UI, not around it.
 */

const fail = (error: string) => ({ ok: false as const, error });

const schema = z.object({
  proposalId: z.string().min(1),
  /** The sticker, in cents per watt. Bounds enforced against Solar Settings. */
  grossPpwCents: z.number().int().min(0).max(5_000).nullable().optional(),
  /** Move the deal onto a different rate-sheet row. */
  lenderProductId: z.string().min(1).nullable().optional(),
  /** The catalogue adders that should be on the deal when this returns. */
  adderEquipmentIds: z.array(z.string().min(1)).max(200).optional(),
  /** What the customer pays a month today, cents. */
  avgMonthlyBillCents: z.number().int().min(0).max(1_000_000).nullable().optional(),
  /** What they use in a year. */
  annualUsageKwh: z.number().int().min(0).max(1_000_000).nullable().optional(),
});

export type RepriceResult =
  | {
      ok: false;
      error: string;
      /**
       * What is actually blocking, when the readiness validator is what
       * refused. Passed through rather than collapsed into the message: a rep
       * standing in front of a customer needs to know WHICH figure is wrong,
       * and "fix the blocking issues" tells them only that something is.
       */
      issues?: ValidationIssue[];
      /**
       * True when the deal itself was updated even though the document could
       * not be reissued — the same state the builder leaves behind when
       * generation is refused. Said out loud, because a rep who assumes
       * nothing was saved will type it all in again.
       */
      dealUpdated?: boolean;
    }
  | {
      ok: true;
      version: number;
      snapshot: SolarProposalSnapshot;
      /** True when the customer's open tab now shows this version. */
      linkMoved: boolean;
    };

export async function repriceProposalAction(
  input: z.infer<typeof schema>
): Promise<RepriceResult> {
  const user = await requireUser();
  // BOTH permissions. This writes to the deal AND issues a customer-facing
  // document; somebody who may do one but not the other may not do this.
  if (!can(user, "update", "Proposal") || !can(user, "update", "Lead")) {
    return fail("Not allowed.");
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail("Those changes could not be read.");
  const d = parsed.data;

  const proposal = await prisma.solarProposal.findFirst({
    where: { companyId: user.companyId, id: d.proposalId },
    select: {
      id: true, leadId: true, version: true, signedAt: true, publicToken: true,
      showComparison: true, showPaymentOptions: true,
    },
  });
  if (!proposal) return fail("Proposal not found.");

  // An accepted proposal is the record of what the customer agreed to.
  // Re-pricing over it would rewrite that record — and would move the live link
  // off a document somebody has signed.
  if (proposal.signedAt) {
    return fail("This proposal has been accepted and can no longer be re-priced.");
  }

  const leadId = proposal.leadId;
  const lead = await prisma.lead.findFirst({
    where: { companyId: user.companyId, id: leadId },
    select: { vertical: true },
  });
  if (!lead) return fail("Deal not found.");
  if (lead.vertical !== "solar") return fail("This is not a solar deal.");

  // ── Consumption ───────────────────────────────────────────────────────────
  // Written first, because the design's usage is what offset and every saving
  // figure hang off, and the layout recompute below reads it back.
  if (d.avgMonthlyBillCents !== undefined || d.annualUsageKwh !== undefined) {
    const design = await prisma.solarDesign.findUnique({
      where: { leadId },
      select: {
        avgMonthlyBillCents: true, annualUsageKwh: true, usageAdjustmentKwh: true,
        utilityRateMills: true, usageBasis: true, year1ProductionKwh: true,
      },
    });
    if (!design) return fail("Complete the system design first.");

    const bill = d.avgMonthlyBillCents ?? design.avgMonthlyBillCents;
    /**
     * Usage follows the basis the deal was built on.
     *
     * A deal captured on the BILL basis derives its usage from bill ÷ rate, so
     * changing the bill has to re-derive it — storing the old kWh against a new
     * bill would leave a rate nobody quoted sitting behind every savings figure
     * on the document. A deal captured on usage keeps whatever was typed.
     */
    const usage =
      d.annualUsageKwh !== undefined
        ? d.annualUsageKwh
        : design.usageBasis === "bill"
          ? (annualUsageFromBill(bill, design.utilityRateMills) ?? design.annualUsageKwh)
          : design.annualUsageKwh;

    await prisma.solarDesign.update({
      where: { leadId },
      data: {
        /**
         * On the RATE basis the bill is the derived side — usage × rate — so a
         * figure posted here is recomputed rather than stored. Keeping a typed
         * bill next to a typed rate and a typed usage is the three-editable-
         * boxes problem the Energy step exists to prevent, and it would show up
         * as a document whose "you pay today" disagreed with its own rate.
         */
        avgMonthlyBillCents:
          design.usageBasis === "rate"
            ? (monthlyBillFromUsage(usage, design.utilityRateMills) ?? bill)
            : bill,
        annualUsageKwh: usage,
        // Plus whatever this deal's adders add to the household's year — an EV
        // charger on the quote is load the array has to cover.
        offsetPct: (() => {
          const total = effectiveUsageKwh(usage, design.usageAdjustmentKwh);
          return total && design.year1ProductionKwh
            ? offsetPct(design.year1ProductionKwh, total)
            : 0;
        })(),
      },
    });
  }

  // ── Adders ────────────────────────────────────────────────────────────────
  if (d.adderEquipmentIds) {
    const wanted = [...new Set(d.adderEquipmentIds)];
    // Every id has to be one of OUR adders. An id from another company, or a
    // module id, would put a line on the quote the catalogue disowns.
    const items = await prisma.solarEquipment.findMany({
      where: { id: { in: wanted }, companyId: user.companyId, kind: "adder" },
      select: {
        id: true, manufacturer: true, model: true, description: true,
        adderBasis: true, priceCents: true, priceMillsPerWatt: true,
        showOnProposal: true, rank: true,
      },
      orderBy: [{ rank: "asc" }, { model: "asc" }],
    });
    if (items.length !== wanted.length) return fail("One of those adders is not in the catalogue.");

    const existing = await prisma.solarDealAdder.findMany({
      // ONE-OFF LINES ARE NEVER TOUCHED: a line typed on this deal has no
      // catalogue item behind it and so cannot be represented by a checkbox.
      // Deleting it because it is not in the ticked set would take money off a
      // quote from a screen that never showed it.
      where: { companyId: user.companyId, leadId, equipmentId: { not: null } },
      select: { id: true, equipmentId: true },
    });
    const onDeal = new Set(existing.map((l) => l.equipmentId!));
    const drop = existing.filter((l) => !wanted.includes(l.equipmentId!)).map((l) => l.id);
    const add = items.filter((i) => !onDeal.has(i.id));

    const last = await prisma.solarDealAdder.findFirst({
      where: { companyId: user.companyId, leadId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    let sortOrder = last?.sortOrder ?? 0;

    await prisma.$transaction([
      ...(drop.length ? [prisma.solarDealAdder.deleteMany({ where: { id: { in: drop } } })] : []),
      ...add.map((i) =>
        prisma.solarDealAdder.create({
          data: {
            companyId: user.companyId,
            leadId,
            // The one place that turns a catalogue row into a deal line, so a
            // re-price and a rep's own picker cannot disagree about what the
            // basis, the description or the money column should be.
            ...lineFromCatalogue(i),
            qty: 1,
            sortOrder: ++sortOrder,
          },
        })
      ),
    ]);
  }

  /**
   * The design's derived figures, refreshed BEFORE anything is priced off them.
   *
   * The order matters and getting it wrong is silent. A per-watt adder is a
   * rate, and usage moves the offset, so this can change the system size — and
   * pricing first would write a contract price computed against the size the
   * deal had a moment ago. The customer then reads a total that does not
   * divide by the kW printed three lines above it.
   */
  await recomputeDesignFigures(user.companyId, leadId);

  // ── Pricing ───────────────────────────────────────────────────────────────
  // Read AFTER the recompute, so the size and the adder total are the ones the
  // price is actually about.
  const design = await prisma.solarDesign.findUnique({
    where: { leadId },
    select: {
      systemSizeKwDc: true,
      lenderId: true,
      lender: { select: { minBasePpwCents: true, finalPpwMode: true, maxFinalPpwCents: true } },
    },
  });
  const finance = await prisma.solarFinance.findUnique({ where: { leadId } });
  if (!design || !finance) return fail("Complete the system design and financing first.");

  const assumptions = await getSolarSettings(user.companyId);

  if (
    d.grossPpwCents !== undefined ||
    d.lenderProductId !== undefined ||
    d.adderEquipmentIds
  ) {
    const lenderProductId =
      d.lenderProductId === undefined ? finance.lenderProductId : d.lenderProductId;

    // The programme has to be ours, and — when the design is built for a lender
    // — that lender's. Its terms then WIN over anything sent from a browser: a
    // rate sheet a rep can edit per deal is not a rate sheet.
    const lenderProduct = lenderProductId
      ? await prisma.solarLenderProduct.findFirst({
          where: {
            id: lenderProductId,
            companyId: user.companyId,
            ...(design.lenderId ? { lenderId: design.lenderId } : {}),
          },
          select: LENDER_TERMS_SELECT,
        })
      : null;
    if (lenderProductId && !lenderProduct) return fail("That financing programme is not available.");

    const adders = await resolveAdderTotal(user.companyId, leadId);

    const row = financeRowForProduct(
      {
        // The PRODUCT never changes here. Moving a deal between cash, a loan
        // and a lease changes which columns mean anything and which equipment
        // is even sellable; that belongs in the builder, with the validation
        // that goes with it.
        product: lenderProduct?.product ?? finance.product,
        grossPpwCents: d.grossPpwCents ?? finance.grossPpwCents,
        dealerFeePct: finance.dealerFeePct,
        ...adders,
        rateMillsPerKwh: finance.rateMillsPerKwh,
        monthlyPaymentCents: finance.monthlyPaymentCents,
        escalatorPct: finance.escalatorPct,
        termYears: finance.termYears,
        aprPct: finance.aprPct,
        loanTermMonths: finance.loanTermMonths,
        downPaymentCents: finance.downPaymentCents,
        loanMonthlyPaymentCents: finance.loanMonthlyPaymentCents,
        lenderProductId,
      },
      {
        systemSizeKwDc: design.systemSizeKwDc,
        assumptions,
        lenderProduct: toLenderProductTerms(lenderProduct),
        targetNetPpwCents: assumptions.targetNetPpwCents,
      }
    );

    // ── The guard rails ───────────────────────────────────────────────────
    // Asked of the PRICED ROW, not of what arrived from the browser, and asked
    // before anything is written.
    //
    // Both halves of that matter. The row is what the fee and the lender's cap
    // have actually done to the number — a capped partner lowers the sticker
    // after the fact, so the figure a rep typed is not the figure to police —
    // and re-pricing is the one path where a rejection after the update leaves
    // the deal changed and only the document refused.
    const isPurchase = row.product === "cash" || row.product === "loan";
    if (isPurchase) {
      // TWO DIFFERENT NUMBERS ON PURPOSE. The company's band asks what the
      // partner's price leaves for the job; the lender's floor asks what is
      // left for the SYSTEM once the extra work is paid for. On every lender
      // but a flat one they are the same figure — see `bandPpwCents`.
      const bandPpw = bandPpwCents({
        stickerPpwCents: row.grossPpwCents,
        dealerFeePct: row.dealerFeePct,
        maxFinalPpwCents: design.lender?.maxFinalPpwCents ?? null,
        finalPpwMode: design.lender?.finalPpwMode ?? null,
      });
      if (bandPpw < assumptions.minPpwCents || bandPpw > assumptions.maxPpwCents) {
        return fail(
          `$${(bandPpw / 100).toFixed(2)}/W before the lender's cut is outside the allowed range of $${(assumptions.minPpwCents / 100).toFixed(2)}–$${(assumptions.maxPpwCents / 100).toFixed(2)}.`
        );
      }
      const floor = design.lender?.minBasePpwCents ?? null;
      if (underBaseFloor(row.grossPpwCents, row.dealerFeePct, floor)) {
        return fail(
          `That leaves $${(basePpwFromSticker(row.grossPpwCents, row.dealerFeePct) / 100).toFixed(2)}/W before the lender's cut, under this lender's $${((floor ?? 0) / 100).toFixed(2)}/W minimum.`
        );
      }
    }

    await prisma.solarFinance.update({ where: { leadId }, data: row });
  }

  // ── The new version ───────────────────────────────────────────────────────
  const result = await generateProposalVersion(user, leadId, {
    // The whole point: the tab open between the rep and the homeowner is the
    // customer's own link, and it has to follow.
    carryPublicToken: true,
    // Presentation choices are the rep's and were made about THIS household.
    // Re-pricing must not quietly turn the comparison table back on.
    showComparison: proposal.showComparison,
    showPaymentOptions: proposal.showPaymentOptions,
  });
  if (!result.ok) {
    // The deal HAS been changed; only the document was refused. Saying so is
    // the difference between a rep fixing one figure and a rep retyping four.
    return {
      ok: false as const,
      error: result.error,
      ...(result.issues ? { issues: result.issues } : {}),
      dealUpdated: true,
    };
  }

  await prisma.activityLog.create({
    data: {
      companyId: user.companyId,
      type: "system",
      message: `${user.fullName} re-priced the proposal live · v${result.version}`,
      leadId,
      actorId: user.userId,
    },
  });

  revalidatePath(`/portal/leads/${leadId}`);
  revalidatePath(`/portal/leads/${leadId}/solar-proposal`);
  return {
    ok: true as const,
    version: result.version,
    snapshot: result.snapshot,
    linkMoved: !!proposal.publicToken,
  };
}

/**
 * Show or hide the payment menu on the customer's copy.
 *
 * Does NOT reissue the proposal, exactly like the comparison toggle beside it:
 * the options are frozen into the snapshot either way, and whether to put a
 * menu of them in front of THIS household is a decision made at the table.
 */
export async function setProposalPaymentOptionsAction(proposalId: string, show: boolean) {
  const user = await requireUser();
  if (!can(user, "update", "Proposal")) return fail("Not allowed.");
  const p = await prisma.solarProposal.findFirst({
    where: { companyId: user.companyId, id: proposalId },
    select: { id: true, leadId: true },
  });
  if (!p) return fail("Proposal not found.");

  await prisma.solarProposal.update({
    where: { id: p.id },
    data: { showPaymentOptions: show },
  });
  revalidatePath(`/portal/leads/${p.leadId}/solar-proposal`);
  return { ok: true as const };
}
