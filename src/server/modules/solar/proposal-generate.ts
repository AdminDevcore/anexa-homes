import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { lenderLogoUrl } from "@/lib/lender-mark";
import type { SessionUser } from "@/server/auth/session";
import { resolveVppCredits } from "@/server/modules/solar/vpp-credits";
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
import {
  capStickerToFinalPpw,
  capStickerToFinalUnit,
  pricePurchase,
  priceStoragePurchase,
} from "@/lib/solar-money";
import { contractReconciles, monthlyReconciles } from "@/lib/solar-contract-adjustment";
import { ladderReconciles } from "@/lib/solar-credit-ladder";
import { solarLeadValueCents } from "@/lib/solar-deal-value";
import { mayInheritLiveLink } from "@/lib/solar-proposal-state";
import { parseLayoutBlocks, panelCorners, MODULE_FALLBACK_MM } from "@/lib/solar-layout";
import { listDealAdders } from "./adders";
import { listBackupProfiles, listDealRebates, dealRebateTotalCents } from "./storage";
import { usableKwh, backupTable, touSavings } from "@/lib/solar-storage";
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

/** Money for an audit line, where whole dollars are what a person reads. */
const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

/**
 * The first way this finished document contradicts itself, or null.
 *
 * Checked over EVERY option, not just the quoted one. The menu is frozen into
 * the same file and a household can switch to any row in it, so an alternative
 * whose payment came off the wrong number is exactly as wrong as the quoted one
 * — it is simply one click further away from being noticed.
 */
function reconciliationProblem(snapshot: SolarProposalSnapshot): string | null {
  for (const option of snapshot.options ?? []) {
    const f = option.financing;
    const where = option.quoted ? "This deal" : `The "${option.label}" option`;

    const adjustment = f.lenderAdjustment;
    if (adjustment) {
      if (
        !contractReconciles({
          label: adjustment.label,
          adjustmentCents: adjustment.adjustmentCents,
          customerObligationCents: adjustment.customerObligationCents,
          lenderContractValueCents: adjustment.lenderContractValueCents,
          disclosure: adjustment.disclosure,
        })
      ) {
        return `${where} does not reconcile: the adjusted contract value is not the customer's price plus the ${adjustment.label}.`;
      }
      // The contract value and the price on the cost chapter are supposed to be
      // the SAME number said twice. They used to be the obligation instead —
      // reversed 2026-08-29 when the document moved onto the contract, because
      // the payment is written on the paper the household signs. If they ever
      // part, the document is arguing with itself about what was signed for.
      if (adjustment.lenderContractValueCents !== (f.contractPriceCents ?? 0)) {
        return `${where} shows a contract value that does not match its own printed price.`;
      }
    }

    /**
     * THE LADDER, checked on every option that carries one.
     *
     * The rows on that page are read as arithmetic by a household with a
     * calculator — five figures that subtract to a sixth — so "they add up" is
     * asserted rather than assumed. `ladderReconciles` also holds the property
     * the whole feature exists for: wherever anything was handed back, the
     * bottom line IS the price the system was quoted at.
     */
    const ladder = f.creditLadder;
    if (ladder) {
      if (!ladderReconciles(ladder)) {
        return `${where} shows a credit breakdown whose rows do not add up to the amount it says the customer pays.`;
      }
      if (adjustment && ladder.contractValueCents !== adjustment.lenderContractValueCents) {
        return `${where} works its credits out from a different contract value than the one it prints.`;
      }
      if (adjustment && ladder.quotedPriceCents !== adjustment.customerObligationCents) {
        return `${where} measures its incentive against a price it does not quote anywhere.`;
      }
    }

    if (
      f.financedAmountCents != null &&
      !monthlyReconciles({
        financedAmountCents: f.financedAmountCents,
        aprPct: f.aprPct,
        termMonths: f.loanTermMonths ?? null,
        monthlyCents: f.loanMonthlyPaymentCents,
        // The quoted figure on a paydown programme is the WITH-paydown one, so
        // the floor has to be measured against what it is actually repaying.
        paydownCents: f.loanPaydownCents,
      })
    ) {
      return `${where} quotes a monthly payment that does not reconcile with the amount the customer is financing and the term.`;
    }
  }
  return null;
}


type EquipRow = {
  id?: string;
  manufacturer: string | null;
  model: string;
  ratingW: number | null;
  specSheetUrl?: string | null;
  photoKey?: string | null;
  photoUpdatedAt?: Date | null;
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
    // Same rule for the photograph. The cache-buster is the item's own
    // photoUpdatedAt, so a re-photographed component is a different URL rather
    // than a stale image sitting in somebody's browser cache.
    ...(e.id && e.photoKey
      ? {
          photoUrl: `/api/solar/equipment-photo?equipment=${e.id}&v=${(e.photoUpdatedAt ?? new Date()).getTime()}`,
        }
      : {}),
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
            id: true, photoKey: true, photoUpdatedAt: true,
          },
        },
        inverter: { select: { id: true, manufacturer: true, model: true, ratingW: true, specSheetUrl: true, photoKey: true, photoUpdatedAt: true } },
        battery: { select: { id: true, manufacturer: true, model: true, ratingW: true, specSheetUrl: true, photoKey: true, photoUpdatedAt: true } },
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

  // A SIGNED VERSION DOES NOT CLOSE THE DEAL TO NEW ONES.
  //
  // This used to refuse outright: "v13 has already been accepted and cannot be
  // replaced." The instinct was right and the rule was wrong. What must survive
  // is the RECORD of what the customer agreed to -- and generating does not
  // touch it. A new version is a new row with its own snapshot, its own
  // reference and its own link; the signed one keeps its snapshot, its
  // signature, its certificate, its approval and its PDF, and gains only a
  // `supersededAt` that is simply true. Nothing is rewritten.
  //
  // And the deals that need a v14 are exactly the ones that got a signature:
  // the homeowner signs, then adds a battery, then the utility comes back with
  // a smaller system. Refusing there sent reps to build a second deal for the
  // same house.
  //
  // The one thing that WOULD rewrite the record is moving the customer's live
  // link off a signed document -- the URL they signed at quietly resolving to
  // an unsigned newer draft. That is a re-price, it is guarded where it belongs
  // (`repriceProposalAction` refuses on a signed proposal), and it is refused
  // again below where the token would actually move.

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
            // The same rule counted in batteries, for a job with no array.
            maxFinalPricePerBatteryCents: true,
            finalBatteryPriceMode: true,
            // The partner's ceiling, needed HERE and not only on the payment
            // menu below — see the re-cap immediately after this.
            maxFinalPpwCents: true,
            // …and whether that figure is a ceiling or this partner's flat
            // price. A flat partner overrides the stored sticker in BOTH
            // directions, so a document generated without it would quote a
            // cheap deal under the price list its own lender publishes.
            finalPpwMode: true,
            /**
             * The partner's programme contribution and the wording that goes
             * with it, read HERE and frozen with everything else.
             *
             * The alternative — a customer's copy that looked the figure up at
             * render time — would let an admin editing Settings next month
             * change the contract value printed on a document a household has
             * already signed, which is exactly what the snapshot exists to stop.
             */
            contractAdjustmentEnabled: true,
            contractAdjustmentType: true,
            contractAdjustmentCents: true,
            contractAdjustmentLabel: true,
            contractAdjustmentDisclosure: true,
            contractAdjustmentEffectiveAt: true,
            /// What the household ends up owning, in this partner's own words.
            ownershipDisclosure: true,
          },
        })
      : null;

  /**
   * The partner's programme, in the shape the pricing code reads.
   *
   * Assembled once and used three times — the reconciliation on the document,
   * the readiness gate below, and the audit line — because three readings of
   * the same six columns is three chances for them to disagree about whether
   * this deal carries a contribution.
   */
  const dealAdjustment = dealLender
    ? {
        enabled: dealLender.contractAdjustmentEnabled,
        type: dealLender.contractAdjustmentType,
        fixedCents: dealLender.contractAdjustmentCents,
        label: dealLender.contractAdjustmentLabel,
        disclosure: dealLender.contractAdjustmentDisclosure,
        effectiveAt: dealLender.contractAdjustmentEffectiveAt,
      }
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
  const isStorage = design.systemType === "storage";

  /**
   * Somebody else's money, off this contract. Read once, because it is priced
   * into the contract AND printed as its own line on the customer's document —
   * two readings of the same rows is two chances for them to disagree.
   */
  const rebateTotalCents = isStorage ? await dealRebateTotalCents(user.companyId, leadId) : 0;

  const capped = capStickerToFinalPpw({
    stickerPpwCents: finance.grossPpwCents,
    maxFinalPpwCents: dealLender?.maxFinalPpwCents ?? null,
    mode: dealLender?.finalPpwMode,
    systemSizeKwDc: design.systemSizeKwDc,
    dealerFeePct: finance.dealerFeePct,
    // The adders the partner's figure is a price FOR. A roof financed on top
    // rides above it and is added back by `pricePurchase` below.
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
      onTopAdderTotalCents: finance.onTopAdderTotalCents,
    }).contractPriceCents;
    await prisma.solarFinance.update({
      where: { leadId },
      data: {
        grossPpwCents: finance.grossPpwCents,
        contractPriceCents: finance.contractPriceCents,
      },
    });
  }

  /**
   * The same last look, counted in batteries.
   *
   * Everything the note above says holds here word for word — the ceiling is
   * the partner's, it binds the DOCUMENT rather than the saved deal, and a flat
   * partner's figure overrides in both directions. Only the unit differs, and
   * the block above cannot do this one: it divides by installed watts, of which
   * a storage job has none, so it stands down and changes nothing.
   */
  if (isStorage && (finance.product === "cash" || finance.product === "loan")) {
    const storageCap = capStickerToFinalUnit({
      stickerPerUnitCents: finance.stickerPricePerBatteryCents,
      maxFinalPerUnitCents: dealLender?.maxFinalPricePerBatteryCents ?? null,
      mode: dealLender?.finalBatteryPriceMode,
      units: design.batteryQty,
      dealerFeePct: finance.dealerFeePct,
      adderTotalCents: finance.adderTotalCents,
    });

    const priced = priceStoragePurchase({
      product: finance.product,
      batteryQty: design.batteryQty,
      stickerPricePerBatteryCents: storageCap.stickerPerUnitCents,
      dealerFeePct: finance.dealerFeePct,
      adderTotalCents: finance.adderTotalCents,
      onTopAdderTotalCents: finance.onTopAdderTotalCents,
      rebateTotalCents,
    });

    // Written back for the same reason the per-watt block writes back: the deal
    // screen and the paper a household is holding have to agree. Only when
    // something actually moved — an unconditional write would touch every row
    // on every generation for nothing.
    if (
      storageCap.stickerPerUnitCents !== finance.stickerPricePerBatteryCents ||
      priced.contractPriceCents !== finance.contractPriceCents
    ) {
      finance.stickerPricePerBatteryCents = storageCap.stickerPerUnitCents;
      finance.contractPriceCents = priced.contractPriceCents;
      await prisma.solarFinance.update({
        where: { leadId },
        data: {
          stickerPricePerBatteryCents: finance.stickerPricePerBatteryCents,
          contractPriceCents: finance.contractPriceCents,
        },
      });
    }
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
      // Whether this paper funds a job with no array on it. Selected because
      // the menu is frozen: a storage document that offered a programme which
      // will not take a battery on its own is a decline nobody can correct.
      financesStorageOnly: true,
      lender: {
        select: {
          id: true, name: true, rank: true, applyUrl: true, logoUpdatedAt: true,
          // The partner's rule, counted in batteries.
          maxFinalPricePerBatteryCents: true,
          finalBatteryPriceMode: true,
          // The partner's price rule for the final price per watt. Selected
          // here because the menu is PRICED at generation and frozen; a rule
          // missing from this select quotes a household a number the lender
          // does not fund, in a document nobody can correct afterwards.
          maxFinalPpwCents: true,
          finalPpwMode: true,
          // …and the same argument for the programme contribution: the menu is
          // frozen, so an option offered without its partner's reconciliation
          // is a document that shows one contract value on the quoted option
          // and none on the identical partner one row down.
          contractAdjustmentEnabled: true,
          contractAdjustmentCents: true,
          contractAdjustmentLabel: true,
          contractAdjustmentDisclosure: true,
          contractAdjustmentEffectiveAt: true,
          ownershipDisclosure: true,
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

  /**
   * What the battery earns, if this deal clears the programme's conditions.
   *
   * Read at GENERATION and frozen onto the snapshot with everything else: a
   * utility that ends its programme next spring must not quietly rewrite the
   * savings figure on a document a homeowner has already signed.
   */
  const vppCredits = await resolveVppCredits({
    companyId: user.companyId,
    utilityProvider: design.utilityProvider,
    electricProvider: design.electricProvider,
    batteryId: design.batteryId,
    batteryQty: design.batteryQty,
    batteryLabel: label(design.battery),
    financeProduct: finance.product,
    financeProductId: finance.lenderProductId,
  });

  /**
   * The storage argument, resolved here and frozen with everything else.
   *
   * Only on a storage deal. Every figure is DERIVED — usable capacity from the
   * catalogue's watt-hours, hours from the company's load profiles, the saving
   * from the provider's peak spread — because the customer's document derives
   * them the same way, and a rep who could type one would be typing a promise.
   *
   * `tou` comes back NULL when the peak rate is not on file, and the renderer
   * omits the line. A zero beside a real backup figure reads as "this battery
   * saves you nothing", which is a different and untrue claim.
   */
  const storage = await (async () => {
    if (design.systemType !== "storage") return null;

    const [profiles, rebates] = await Promise.all([
      listBackupProfiles(user.companyId),
      listDealRebates(user.companyId, leadId),
    ]);

    const kwh = usableKwh(design.battery?.ratingW ?? null, design.batteryQty);

    // The deal's own rates first, the provider's otherwise. Null on the design
    // means "read the provider", never "no rates".
    const provider = design.electricProvider
      ? await prisma.solarProvider.findFirst({
          where: { companyId: user.companyId, name: design.electricProvider },
          select: { touPeakRateMills: true, touOffPeakRateMills: true, touPeakWindow: true },
        })
      : null;
    const peakMills = design.touPeakRateMills ?? provider?.touPeakRateMills ?? null;
    const offPeakMills = design.touOffPeakRateMills ?? provider?.touOffPeakRateMills ?? null;

    const tou = touSavings({
      usableKwh: kwh,
      annualUsageKwh: design.annualUsageKwh ?? 0,
      peakRateMills: peakMills,
      offPeakRateMills: offPeakMills,
      peakSharePct: assumptions.touPeakSharePct,
      cyclesPerDay: assumptions.touCyclesPerDay,
      roundTripEfficiencyPct: assumptions.touRoundTripEfficiency,
    });

    return {
      batteryLabel: label(design.battery),
      batteryQty: design.batteryQty,
      usableKwh: kwh,
      backup: backupTable(kwh, profiles).map(({ name, loadWatts, hours }) => ({
        name,
        loadWatts,
        hours,
      })),
      tou:
        tou && peakMills != null && offPeakMills != null
          ? {
              peakRateMills: peakMills,
              offPeakRateMills: offPeakMills,
              peakWindow: provider?.touPeakWindow ?? null,
              shiftedKwhPerDay: tou.shiftedKwhPerDay,
              annualSavingsCents: tou.annualSavingsCents,
              // Frozen beside the figure they produced. An assumption the
              // company changes next month must not silently rewrite a number
              // on a document somebody has already signed.
              peakSharePct: assumptions.touPeakSharePct,
              cyclesPerDay: assumptions.touCyclesPerDay,
              roundTripEfficiencyPct: assumptions.touRoundTripEfficiency,
            }
          : null,
      rebates: rebates.map((r) => ({
        name: r.name,
        qty: r.qty,
        amountCents: r.amountCents,
        totalCents: r.totalCents,
      })),
    };
  })();

  const alternatives = proposalAlternatives({
    quoted: {
      product: finance.product,
      lenderProductId: finance.lenderProductId,
      // The partner the quoted option actually names — `dealLender`, not
      // `design.lenderId`, because a cash deal can still carry a lender on the
      // design and the menu must not suppress that lender's loan underneath a
      // cash quote that never mentioned them.
      lenderId: dealLender?.id ?? null,
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
          finalPpwMode: p.lender.finalPpwMode,
          maxFinalPricePerBatteryCents: p.lender.maxFinalPricePerBatteryCents,
          finalBatteryPriceMode: p.lender.finalBatteryPriceMode,
          contractAdjustment: {
            enabled: p.lender.contractAdjustmentEnabled,
            fixedCents: p.lender.contractAdjustmentCents,
            label: p.lender.contractAdjustmentLabel,
            disclosure: p.lender.contractAdjustmentDisclosure,
            effectiveAt: p.lender.contractAdjustmentEffectiveAt,
          },
          ownershipDisclosure: p.lender.ownershipDisclosure,
        },
      })
    ),
    approvedLenderIds,
    design: { systemSizeKwDc: design.systemSizeKwDc },
    systemType: design.systemType,
    storage: isStorage
      ? {
          batteryQty: design.batteryQty,
          stickerPricePerBatteryCents: finance.stickerPricePerBatteryCents,
        }
      : null,
    adders: adderLines.map((l) => ({
      label: l.label,
      amountCents: adderAmountCents(l, Math.round(design.systemSizeKwDc * 1000)),
      description: l.description,
      showOnProposal: l.showOnProposal,
      financedOnTop: l.financedOnTop,
    })),
    adderTotalCents: finance.adderTotalCents,
    onTopAdderTotalCents: finance.onTopAdderTotalCents,
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
    // `signedAt` because a signed row may not give its live link up — see the
    // note on `carried` below.
    select: { id: true, version: true, publicToken: true, status: true, sentAt: true, signedAt: true },
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
      // The unit a storage deal is actually priced by. Without it the document
      // prices the whole system at zero installed watts — see the field's note.
      stickerPricePerBatteryCents: finance.stickerPricePerBatteryCents,
      dealerFeePct: finance.dealerFeePct,
      adderTotalCents: finance.adderTotalCents,
      onTopAdderTotalCents: finance.onTopAdderTotalCents,
      // Named and priced HERE, then frozen into the snapshot. Reading them back
      // through the catalogue at render time would let a later rename retitle a
      // line on a document a homeowner has already been shown.
      adders: adderLines.map((l) => ({
        label: l.label,
        amountCents: adderAmountCents(l, Math.round(design.systemSizeKwDc * 1000)),
        description: l.description,
        showOnProposal: l.showOnProposal,
        financedOnTop: l.financedOnTop,
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
    lenderProductLabel: quotedProductLabel,
    // The partner's programme, read above and reconciled inside the snapshot.
    // Only a loan carries one: cash has no lender advancing anything, and a
    // lease or PPA has no system price for a contribution to come off.
    contractAdjustment: finance.product === "loan" ? dealAdjustment : null,
    /**
     * The federal credits: the company's percentages and the wording, and the
     * answers this job gave about which of them it earns.
     *
     * Passed unconditionally. Whether a ladder is DRAWN is decided inside the
     * snapshot by whether that option's partner carries a contract adjustment,
     * so a menu offering Participate alongside a GoodLeap loan puts the ladder
     * under exactly one of them without the caller having to know which.
     */
    creditRates: assumptions.creditRates,
    creditIncentiveLabel: assumptions.creditIncentiveLabel,
    creditDisclaimer: assumptions.creditDisclaimer,
    creditClaims: {
      itc: finance.claimItc,
      energyCommunity: finance.claimEnergyCommunity,
      domesticContent: finance.claimDomesticContent,
    },
    ownershipNote: finance.product === "loan" ? (dealLender?.ownershipDisclosure ?? null) : null,
    alternatives,
    // How the deal's own terms read in the menu. The catalogue row's own label
    // when it was quoted from one, so the option a homeowner picks is findable
    // on the same rate sheet the rep is looking at.
    quotedLabel: quotedProductLabel
      ? `${dealLender?.name ?? ""} · ${quotedProductLabel}`.replace(/^ · /, "")
      : undefined,
    assumptions,
    homeValueUpliftPct: assumptions.homeValueUpliftPct,
    vppCredits,
    systemType: design.systemType,
    storage,
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
   * THE LAST GATE, over the finished document rather than over its inputs.
   *
   * Readiness has already refused a half-configured programme, an unpriced
   * deal and a price outside the band — all of them checks on what went IN.
   * This one reads what came OUT, option by option, and refuses to save a
   * document whose own figures contradict each other.
   *
   * It exists because the two failures it catches are both silent. A
   * reconciliation that does not add up prints three plausible numbers a
   * household is invited to sum; a payment worked out from the contract value
   * instead of the obligation prints $328.89 where $134.44 is owed. Neither
   * looks like an error on the page, and both are on paper by the time anybody
   * would notice.
   */
  const mismatch = reconciliationProblem(snapshot);
  if (mismatch) return fail(mismatch);

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
    // NEVER off a signed row — see `mayInheritLiveLink`. The caller that
    // re-prices already refuses on a signed proposal; this is the same rule
    // stated where the token actually changes hands, so no future caller can
    // walk past it.
    opts.carryPublicToken && mayInheritLiveLink(previous)
      ? {
          publicToken: previous!.publicToken,
          // No "signed becomes generated" special case any more: the only row
          // whose status this could have been wrong for is a signed one, and a
          // signed row no longer gives its link up at all.
          status: previous!.status,
          sentAt: previous!.sentAt,
        }
      : null;

  // ONE transaction. `publicToken` is unique, so the old row must give the
  // token up in the same breath the new one takes it — two statements leave a
  // window where a unique-constraint failure has already blanked the customer's
  // live link and put nothing in its place.
  /**
   * THE NEW ROW IS THE LAST STATEMENT, NOT THE SECOND ONE.
   *
   * This was `const [, proposal] = …`, which is right only when there IS a
   * previous version to supersede. On the FIRST version of a deal the array
   * holds one statement, index 1 is undefined, and generation returned
   * `{ ok: true, id: undefined, version: undefined }` — succeeding, writing the
   * row, and handing its caller nothing to point at. The live re-price never
   * saw it because a re-price always has a previous version; v1 always did.
   */
  const written = await prisma.$transaction([
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
            /**
             * WHICH SETTING WAS APPLIED TO THIS DOCUMENT.
             *
             * The snapshot already holds the three figures, so the money is
             * recoverable from the row itself. What the audit trail needs on
             * top of that is the SENTENCE — that at this moment, this partner's
             * programme was on and stood at this amount — so that a change made
             * in Settings a fortnight later can be read against the documents
             * generated either side of it without opening two blobs of JSON.
             */
            detail: [
              `v${version}`,
              finance.product,
              snapshot.financing.lenderAdjustment
                ? `${snapshot.financing.lenderAdjustment.label} ${usd(
                    snapshot.financing.lenderAdjustment.adjustmentCents
                  )} · contract ${usd(snapshot.financing.lenderAdjustment.lenderContractValueCents)} · customer ${usd(
                    snapshot.financing.lenderAdjustment.customerObligationCents
                  )}`
                : null,
              carried ? "live link kept" : null,
            ]
              .filter(Boolean)
              .join(" · "),
          },
        },
      },
      select: { id: true, version: true, publicToken: true },
    }),
  ]);
  const proposal = written[written.length - 1];

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
