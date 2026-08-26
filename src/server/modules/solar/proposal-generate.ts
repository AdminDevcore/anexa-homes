import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { lenderLogoUrl } from "@/lib/lender-mark";
import type { SessionUser } from "@/server/auth/session";
import { resolveLayoutAsset } from "./layout-asset";
import { getSolarSettings } from "./settings";
import { readSolarReadiness } from "./readiness";
import {
  buildProposalSnapshot,
  type SnapshotEquipment,
  type SolarProposalSnapshot,
} from "@/lib/solar-proposal";
import { proposalAlternatives, type CatalogueProgramme } from "@/lib/solar-proposal-options";
import { lenderProductLabel } from "@/lib/solar-lender-product";
import { canGenerate, type ValidationIssue } from "@/lib/solar-validation";
import { adderAmountCents } from "@/lib/solar-adders";
import { capStickerToFinalPpw, pricePurchase } from "@/lib/solar-money";
import { solarLeadValueCents } from "@/lib/solar-deal-value";
import { parseLayoutBlocks, panelCorners, MODULE_FALLBACK_MM } from "@/lib/solar-layout";
import { listDealAdders } from "./adders";
import { monthlyProductionForDesign, readMonthlyUsage } from "./monthly";

/**
 * Building one version of a customer-facing proposal.
 *
 * DELIBERATELY NOT a "use server" module. Every export from one of those is a
 * client-callable endpoint, and this function takes an already-authenticated
 * user as its first argument — exported from an actions file it would be an
 * endpoint anybody could call with any user object they cared to construct.
 * The two callers (generate, and the live re-price) do their own `requireUser`
 * and their own permission check, then come here.
 */

const fail = (error: string) => ({ ok: false as const, error });


type EquipRow = {
  manufacturer: string | null;
  model: string;
  ratingW: number | null;
  specSheetUrl?: string | null;
} | null;

function label(e: EquipRow) {
  if (!e) return null;
  return `${e.manufacturer ? `${e.manufacturer} ` : ""}${e.model}${e.ratingW ? ` · ${e.ratingW}W` : ""}`;
}

/** Centimetres. See the note where the array is frozen onto the snapshot. */
const round2 = (n: number) => Math.round(n * 100) / 100;

function equip(e: EquipRow, qty: number): SnapshotEquipment | null {
  if (!e) return null;
  return {
    manufacturer: e.manufacturer,
    model: e.model,
    ratingW: e.ratingW,
    qty,
    // Spread rather than assigned null: an item with no datasheet has no key,
    // which is how the snapshot says "this document predates spec sheets" and
    // how it says "nobody recorded one" in exactly the same way — both render
    // no link, and neither prints the word undefined at a homeowner.
    ...(e.specSheetUrl ? { specSheetUrl: e.specSheetUrl } : {}),
  };
}


export type GenerateOptions = {
  /**
   * Move the customer's live link onto the new version. See the note at the
   * write. False — the default — is ordinary generation.
   */
  carryPublicToken?: boolean;
  /** Presentation flags to carry across from the version being replaced. */
  showComparison?: boolean;
  showPaymentOptions?: boolean;
};

export type GenerateResult =
  | { ok: false; error: string; issues?: ValidationIssue[] }
  | {
      ok: true;
      id: string;
      version: number;
      publicToken: string | null;
      snapshot: SolarProposalSnapshot;
      /** Non-blocking issues. The rep is told; the document still generates. */
      warnings: ValidationIssue[];
    };

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
export async function generateProposalVersion(
  user: SessionUser,
  leadId: string,
  opts: GenerateOptions = {}
): Promise<GenerateResult> {
  const [lead, design, finance, assumptions, company] = await Promise.all([
    prisma.lead.findFirst({
      where: { companyId: user.companyId, id: leadId },
      select: {
        id: true, vertical: true, firstName: true, lastName: true,
        address: true, city: true, state: true, zip: true,
        // The coordinate the array is drawn on. Null omits the drawing rather
        // than centring a customer's roof on the middle of the ocean.
        lat: true, lng: true,
        assignedRep: { select: { firstName: true, lastName: true, phone: true, email: true } },
      },
    }),
    prisma.solarDesign.findUnique({
      where: { leadId },
      include: {
        // The module carries its physical size too: the array is frozen onto the
        // document as real-world corners, and a panel drawn at the fallback size
        // is a panel in the wrong place on the customer's own roof.
        module: {
          select: {
            manufacturer: true, model: true, ratingW: true,
            widthMm: true, heightMm: true, specSheetUrl: true,
          },
        },
        inverter: { select: { manufacturer: true, model: true, ratingW: true, specSheetUrl: true } },
        battery: { select: { manufacturer: true, model: true, ratingW: true, specSheetUrl: true } },
      },
    }),
    prisma.solarFinance.findUnique({ where: { leadId } }),
    getSolarSettings(user.companyId),
    prisma.company.findUnique({
      where: { id: user.companyId },
      select: {
        name: true, phone: true, email: true,
        address: true, city: true, state: true, zip: true,
        settings: { select: { logoUrl: true } },
      },
    }),
  ]);

  if (!lead) return fail("Deal not found.");
  if (lead.vertical !== "solar") return fail("This is not a solar deal.");
  if (!design || !finance) return fail("Complete the system design and financing first.");

  // An accepted proposal is the record of what the customer agreed to.
  // Regenerating over it would rewrite that record.
  const accepted = await prisma.solarProposal.findFirst({
    where: { companyId: user.companyId, leadId, signedAt: { not: null } },
    select: { version: true },
  });
  if (accepted) {
    return fail(
      `Proposal v${accepted.version} has already been accepted by the customer and cannot be replaced.`
    );
  }

  // The gate. Identical rules to the builder's readiness check — literally the
  // same function — so a proposal can never be generated around the UI.
  const readiness = await readSolarReadiness(user.companyId, leadId);
  if (!readiness.ok) return fail(readiness.error);
  if (!canGenerate(readiness.issues)) {
    return { ok: false as const, error: "Fix the blocking issues before generating.", issues: readiness.issues };
  }

  // The extra work on this job, read at generation and frozen with everything
  // else. The same discipline as the lender's rate sheet below: a document that
  // looked its lines up later would re-title or re-price work a customer has
  // already been shown.
  const adderLines = await listDealAdders(user.companyId, leadId);

  const approvedCredit =
    finance.product === "loan"
      ? await prisma.creditApplication.findFirst({
          where: { companyId: user.companyId, leadId, status: { in: ["approved", "conditional"] } },
          orderBy: { decidedAt: "desc" },
          select: { lender: true },
        })
      : null;

  // The partner this deal is on, and the rate-sheet row it was quoted from.
  // Read at generation and FROZEN into the snapshot: rate sheets change every
  // quarter, and a document that looked its own terms up later would silently
  // re-quote a customer who has already been shown a number.
  const dealLender =
    finance.product === "loan" && design.lenderId
      ? await prisma.solarLender.findFirst({
          where: { companyId: user.companyId, id: design.lenderId },
          select: {
            id: true, name: true, applyUrl: true, logoUpdatedAt: true,
            // The partner's ceiling, needed HERE and not only on the payment
            // menu below — see the re-cap immediately after this.
            maxFinalPpwCents: true,
          },
        })
      : null;

  /**
   * The deal's own price, held to the partner's ceiling one last time.
   *
   * `financeRowForProduct` already caps at save, so on a deal saved since the
   * ceiling was set this changes nothing. It exists for the deal saved BEFORE
   * it: the stored sticker is then the uncapped one, the builder's price card
   * recomputes live and shows the capped figure, and generation froze the
   * stored number — so a rep was promised $5.50/W and $60,500 on screen while
   * the document went out at $8.57/W and $94,270. The payment menu on that
   * same document IS capped, which left the two halves of one page disagreeing
   * by thirty-four thousand dollars.
   *
   * Setting a cap in Settings deliberately does not re-price live designs — a
   * deal in flight should not move under a rep. But a DOCUMENT may never quote
   * above what the partner funds, so the ceiling is applied at the moment the
   * document is made, and written back so the deal screen agrees with the
   * paper a household is holding.
   */
  const capped = capStickerToFinalPpw({
    stickerPpwCents: finance.grossPpwCents,
    maxFinalPpwCents: dealLender?.maxFinalPpwCents ?? null,
    systemSizeKwDc: design.systemSizeKwDc,
    dealerFeePct: finance.dealerFeePct,
    adderTotalCents: finance.adderTotalCents,
  });
  if (capped.capped) {
    finance.grossPpwCents = capped.stickerPpwCents;
    finance.contractPriceCents = pricePurchase({
      product: "loan",
      systemSizeKwDc: design.systemSizeKwDc,
      stickerPpwCents: capped.stickerPpwCents,
      dealerFeePct: finance.dealerFeePct,
      adderTotalCents: finance.adderTotalCents,
    }).contractPriceCents;
    await prisma.solarFinance.update({
      where: { leadId },
      data: {
        grossPpwCents: finance.grossPpwCents,
        contractPriceCents: finance.contractPriceCents,
      },
    });
  }

  // The catalogue row this deal was quoted from — its payment factors, and the
  // label it carries on the rate sheet. Read for EVERY product, not just a
  // loan: a lease quoted from a programme should name that programme in the
  // menu, and only the factor block below is loan-only.
  const quotedRow = finance.lenderProductId
    ? await prisma.solarLenderProduct.findFirst({
        where: { companyId: user.companyId, id: finance.lenderProductId },
        select: {
          product: true, name: true,
          aprPct: true, termMonths: true, dealerFeePct: true,
          leaseRateCentsPerKwMonth: true, rateMillsPerKwh: true,
          escalatorPct: true, termYears: true,
          factorWithPaydownMicros: true, factorWithoutPaydownMicros: true,
          paydownPct: true, paydownMonths: true,
        },
      })
    : null;

  const quotedProduct =
    finance.product === "loan" && quotedRow
      ? {
          factorWithPaydownMicros: quotedRow.factorWithPaydownMicros,
          factorWithoutPaydownMicros: quotedRow.factorWithoutPaydownMicros,
          paydownPct: quotedRow.paydownPct,
          paydownMonths: quotedRow.paydownMonths,
        }
      : null;

  const quotedProductLabel = quotedRow ? lenderProductLabel(quotedRow) : null;

  /**
   * The menu the homeowner gets to choose from.
   *
   * Read at generation and PRICED at generation, like everything else on the
   * document. The alternative — a customer's copy that recomputes prices from a
   * live rate sheet — would mean the figures moved under a household that had
   * already been shown them, and would put the pricing model itself in a
   * browser where anyone can edit it.
   *
   * `showPaymentOptions` on the proposal row decides whether the menu is put in
   * front of THIS household; the options are frozen either way, so a rep can
   * turn it on later without reissuing the document.
   */
  const programmes = await prisma.solarLenderProduct.findMany({
    where: { companyId: user.companyId, isActive: true, lender: { isActive: true } },
    select: {
      id: true, product: true, name: true,
      aprPct: true, termMonths: true, dealerFeePct: true,
      leaseRateCentsPerKwMonth: true, rateMillsPerKwh: true,
      escalatorPct: true, termYears: true,
      factorWithPaydownMicros: true, factorWithoutPaydownMicros: true,
      paydownPct: true, paydownMonths: true,
      rank: true,
      lender: {
        select: {
          id: true, name: true, rank: true, applyUrl: true, logoUpdatedAt: true,
          // The partner's ceiling on the final price per watt. Selected here
          // because the menu is PRICED at generation and frozen; a cap missing
          // from this select quotes a household a number the lender does not
          // fund, in a document nobody can correct afterwards.
          maxFinalPpwCents: true,
        },
      },
    },
  });

  /**
   * Which lenders will actually finance the panel on this design.
   *
   * A programme from a lender whose approved-vendor list does not cover this
   * module is not an option, it is a phone call three weeks later. NULL — no
   * approval recorded against the module at all — constrains nothing, exactly
   * as the equipment selectors already behave for a company that has not
   * populated any AVL.
   */
  const approvals = design.moduleId
    ? await prisma.solarEquipmentLender.findMany({
        where: { equipmentId: design.moduleId },
        select: { lenderId: true },
      })
    : [];
  const approvedLenderIds = approvals.length > 0 ? approvals.map((a) => a.lenderId) : null;

  const alternatives = proposalAlternatives({
    quoted: {
      product: finance.product,
      lenderProductId: finance.lenderProductId,
      grossPpwCents: finance.grossPpwCents,
      dealerFeePct: finance.dealerFeePct,
    },
    programmes: programmes.map(
      (p): CatalogueProgramme => ({
        ...p,
        lender: {
          id: p.lender.id,
          name: p.lender.name,
          rank: p.lender.rank,
          applyUrl: p.lender.applyUrl,
          logoUrl: lenderLogoUrl(p.lender.id, p.lender.logoUpdatedAt),
          maxFinalPpwCents: p.lender.maxFinalPpwCents,
        },
      })
    ),
    approvedLenderIds,
    design: { systemSizeKwDc: design.systemSizeKwDc },
    adders: adderLines.map((l) => ({
      label: l.label,
      amountCents: adderAmountCents(l, Math.round(design.systemSizeKwDc * 1000)),
      description: l.description,
      showOnProposal: l.showOnProposal,
    })),
    adderTotalCents: finance.adderTotalCents,
    assumptions,
    targetNetPpwCents: assumptions.targetNetPpwCents,
  });

  // The shape of the customer's year. Cache-only — see monthlyProductionForDesign.
  const monthlyProductionKwh = await monthlyProductionForDesign(user.companyId, leadId);

  /**
   * The array, frozen onto the document as ground metres.
   *
   * Computed here, once, from the blocks a rep drew — the customer's page then
   * projects four points per panel and never loads the geometry library at all.
   * Rounded to the centimetre: a residential array spans tens of metres and the
   * imagery is served at about three centimetres a pixel, so a millimetre in
   * the snapshot is several kilobytes of JSON buying nothing anybody can see.
   */
  const moduleMm = {
    widthMm: design.module?.widthMm ?? MODULE_FALLBACK_MM.widthMm,
    heightMm: design.module?.heightMm ?? MODULE_FALLBACK_MM.heightMm,
  };
  const sitePanels = parseLayoutBlocks(design.layoutBlocks)
    .flatMap((b) => panelCorners(b, moduleMm))
    .map((quad) => quad.map((c) => ({ e: round2(c.e), n: round2(c.n) })));

  const previous = await prisma.solarProposal.findFirst({
    where: { companyId: user.companyId, leadId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, publicToken: true, status: true, sentAt: true },
  });
  const version = (previous?.version ?? 0) + 1;

  // The layout drawing — included ONLY if the file row AND the bytes behind it
  // are both really there. A FileAsset whose object has since gone (a bucket
  // lifecycle rule, a database restored without its storage) would otherwise be
  // frozen into the snapshot and render as a broken image in front of a
  // customer. Verified now, and verified again at render.
  const layoutAsset = await resolveLayoutAsset(user.companyId, leadId, design.layoutImageFileId);
  const layout = layoutAsset
    ? {
        fileId: layoutAsset.id,
        provider: design.designProvider,
        externalRef: design.designExternalRef,
        // Preliminary unless somebody accountable has marked it final.
        preliminary: !design.layoutApproved,
      }
    : null;

  const companyAddress = company
    ? [company.address, [company.city, company.state].filter(Boolean).join(", "), company.zip]
        .filter(Boolean)
        .join(" · ") || null
    : null;

  const snapshot = buildProposalSnapshot({
    reference: `SP-${leadId.slice(0, 8).toUpperCase()}-V${version}`,
    generatedById: user.userId,
    customer: {
      name: `${lead.firstName} ${lead.lastName}`.trim(),
      address: [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", "),
    },
    company: {
      name: company?.name ?? "",
      phone: company?.phone ?? null,
      email: company?.email ?? null,
      logoUrl: company?.settings?.logoUrl ?? null,
      address: companyAddress,
    },
    representative: lead.assignedRep
      ? {
          name: `${lead.assignedRep.firstName} ${lead.assignedRep.lastName}`.trim(),
          phone: lead.assignedRep.phone ?? null,
          email: lead.assignedRep.email ?? null,
        }
      : null,
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
      avgMonthlyBillCents: design.avgMonthlyBillCents,
      utilityRateMills: design.utilityRateMills,
      module: equip(design.module, design.moduleQty),
      inverter: equip(design.inverter, 1),
      battery: equip(design.battery, design.batteryQty || (design.battery ? 1 : 0)),
      monthlyUsageKwh: readMonthlyUsage(design.monthlyUsageKwh),
      monthlyProductionKwh,
    },
    layout,
    // Both or nothing: half a coordinate cannot centre anything. And no
    // coordinate at all means no drawing, rather than a picture of the ocean.
    site:
      lead.lat != null && lead.lng != null
        ? {
            lat: lead.lat,
            lng: lead.lng,
            ...(sitePanels.length > 0 ? { panels: sitePanels } : {}),
          }
        : null,
    finance: {
      product: finance.product,
      grossPpwCents: finance.grossPpwCents,
      dealerFeePct: finance.dealerFeePct,
      adderTotalCents: finance.adderTotalCents,
      // Named and priced HERE, then frozen into the snapshot. Reading them back
      // through the catalogue at render time would let a later rename retitle a
      // line on a document a homeowner has already been shown.
      adders: adderLines.map((l) => ({
        label: l.label,
        amountCents: adderAmountCents(l, Math.round(design.systemSizeKwDc * 1000)),
        description: l.description,
        showOnProposal: l.showOnProposal,
      })),
      rateMillsPerKwh: finance.rateMillsPerKwh,
      monthlyPaymentCents: finance.monthlyPaymentCents,
      escalatorPct: finance.escalatorPct,
      termYears: finance.termYears,
      aprPct: finance.aprPct,
      // These three arrived together with the loan payment row on the customer
      // proposal, which is the condition the previous note here set: the
      // snapshot is what the customer was SHOWN, frozen, so a figure goes in
      // only once the layout renders it. The proposal now shows a monthly for a
      // loan — the lender's approved figure when one exists, otherwise the
      // product's terms amortised — and these are what it is computed from.
      loanMonthlyPaymentCents: finance.loanMonthlyPaymentCents,
      loanTermMonths: finance.loanTermMonths,
      downPaymentCents: finance.downPaymentCents,
    },
    // The lender chosen on the design wins over whatever a credit application
    // recorded: the design is the current answer, the application is history.
    lender: dealLender?.name ?? approvedCredit?.lender ?? null,
    // Only the partner on the design has a logo to show: the credit
    // application records its lender as free text from a webhook, which is a
    // name and nothing more.
    lenderLogoUrl: dealLender ? lenderLogoUrl(dealLender.id, dealLender.logoUpdatedAt) : null,
    loanFactors: quotedProduct,
    lenderApplyUrl: dealLender?.applyUrl ?? null,
    alternatives,
    // How the deal's own terms read in the menu. The catalogue row's own label
    // when it was quoted from one, so the option a homeowner picks is findable
    // on the same rate sheet the rep is looking at.
    quotedLabel: quotedProductLabel
      ? `${dealLender?.name ?? ""} · ${quotedProductLabel}`.replace(/^ · /, "")
      : undefined,
    assumptions,
    homeValueUpliftPct: assumptions.homeValueUpliftPct,
    // What the design recorded about which model produced its production
    // figure. Null keeps the document listing the market average, which is what
    // it was built on.
    yieldBasis:
      design.yieldSource === "pvwatts" && design.yieldArrays > 0
        ? {
            source: "pvwatts" as const,
            station: design.yieldStation,
            arrays: design.yieldArrays,
            totalArrays: Math.max(design.yieldArrays, parseLayoutBlocks(design.layoutBlocks).length),
          }
        : null,
    now: new Date(),
  });

  /**
   * Whether the customer's live link follows the new version.
   *
   * ORDINARY GENERATION: no. A new version is a new document, it is not public
   * until somebody sends it, and the copy a customer already has keeps showing
   * exactly what they were shown with a banner saying a newer one exists.
   *
   * A LIVE RE-PRICE: yes. The rep is sitting with the homeowner, has just
   * changed the price in front of them, and the tab open on the kitchen table
   * is the customer's own link. Leaving the token on the old row means the
   * document they are both looking at goes stale mid-sentence and starts
   * telling them to ask their consultant for the current one.
   *
   * The previous row keeps its snapshot either way — the record of what was
   * offered survives; only which document that URL resolves to moves.
   */
  const carried =
    opts.carryPublicToken && previous?.publicToken
      ? {
          publicToken: previous.publicToken,
          status: previous.status === "signed" ? "generated" : previous.status,
          sentAt: previous.sentAt,
        }
      : null;

  // ONE transaction. `publicToken` is unique, so the old row must give the
  // token up in the same breath the new one takes it — two statements leave a
  // window where a unique-constraint failure has already blanked the customer's
  // live link and put nothing in its place.
  const [, proposal] = await prisma.$transaction([
    ...(previous
      ? [
          prisma.solarProposal.update({
            where: { id: previous.id },
            data: {
              supersededAt: new Date(),
              ...(carried ? { publicToken: null } : {}),
              events: {
                create: {
                  type: "superseded",
                  actorId: user.userId,
                  actorName: user.fullName,
                  detail: carried
                    ? `replaced by v${version} · live link moved`
                    : `replaced by v${version}`,
                },
              },
            },
          }),
        ]
      : []),
    prisma.solarProposal.create({
      data: {
        companyId: user.companyId,
        leadId,
        version,
        // NO public token by default. Generating is internal; a token is minted
        // only when the proposal is actually sent. See the note on
        // SolarProposal.publicToken.
        status: "generated",
        publicToken: null,
        ...(carried ?? {}),
        showComparison: opts.showComparison ?? true,
        showPaymentOptions: opts.showPaymentOptions ?? true,
        snapshot: snapshot as never,
        createdById: user.userId,
        events: {
          create: {
            type: "generated",
            actorId: user.userId,
            actorName: user.fullName,
            detail: `v${version} · ${finance.product}${carried ? " · live link kept" : ""}`,
          },
        },
      },
      select: { id: true, version: true, publicToken: true },
    }),
  ]);

  /**
   * The deal's own value, stamped from the document that was just made.
   *
   * `Lead.value` is what the pipeline board, the dashboard and the funnel
   * report add up, and nothing on a solar deal ever wrote to it — so a
   * department selling eighty-thousand-dollar systems showed a pipeline worth
   * nothing. The deal page derives its figure from the snapshot and never
   * needed this; every list that reads the column does.
   *
   * OUTSIDE the transaction above, with the activity log. That one exists to
   * keep the customer's live link and the new version in step, and a
   * denormalised total is not worth widening its blast radius: a failure here
   * leaves the proposal standing and one number stale, which the next
   * generation corrects.
   */
  await prisma.lead.update({
    where: { id: leadId },
    data: { value: solarLeadValueCents(snapshot.financing) },
  });

  await prisma.activityLog.create({
    data: {
      companyId: user.companyId,
      type: "system",
      message: `${user.fullName} generated solar proposal v${version}`,
      leadId,
      actorId: user.userId,
    },
  });

  revalidatePath(`/portal/leads/${leadId}`);
  return {
    ok: true as const,
    ...proposal,
    snapshot,
    warnings: readiness.issues,
  };
}
