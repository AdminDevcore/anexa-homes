import type { FinanceProduct } from "@prisma/client";
import { financeRowForProduct } from "./solar-finance-row";
import { customerProductLabel } from "./solar-lender-product";
import type { SignTodayMode } from "./solar-sign-today";
import type { ProposalAlternative, ProposalFinanceInput } from "./solar-proposal";
import {
  basePpwFromSticker,
  grossPpwFromNet,
  capStickerToFinalUnit,
  type SolarAssumptions,
  type FinalPpwMode,
  type PriceBasis,
} from "./solar-money";

/**
 * Turning a company's rate sheet into the menu a homeowner can actually choose
 * from.
 *
 * WHY THIS IS A PURE FUNCTION AND NOT A QUERY: the rules about what belongs on
 * that menu are business rules a customer reads the consequences of — which
 * lenders may be offered, what cash is priced at, how many options a household
 * can be asked to compare — and every one of them is a rule somebody will want
 * to argue about. Rules that can be argued about need to be testable without a
 * database.
 *
 * THE PRICES ARE COMPUTED HERE, ONCE, AT GENERATION. They are then frozen into
 * the snapshot with everything else. The customer's copy never derives a price:
 * it reads one. That is the difference between a document and a calculator, and
 * only one of the two is a record of what was offered.
 */

/** One row of the rate sheet, with the lender it belongs to. */
export type CatalogueProgramme = {
  id: string;
  product: FinanceProduct;
  name: string | null;
  aprPct: number | null;
  termMonths: number | null;
  dealerFeePct: number | null;
  leaseRateCentsPerKwMonth: number | null;
  rateMillsPerKwh: number | null;
  escalatorPct: number | null;
  termYears: number | null;
  factorWithPaydownMicros: number | null;
  factorWithoutPaydownMicros: number | null;
  paydownPct: number | null;
  paydownMonths: number | null;
  rank: number;
  /**
   * Whether this programme funds a job with NO ARRAY on it.
   *
   * Most lenders' paper is written against production and will not take a
   * battery on its own. Offering one of those on a storage menu is not an
   * option, it is a decline three weeks later — the same rule the builder's own
   * programme picker already applies when the design says storage.
   */
  financesStorageOnly?: boolean;
  /**
   * Which price the partner's figures below fix on THIS programme — per watt
   * and per battery. On the programme, not the lender: one partner's $5.50 is
   * the gross on one product and the base on another. Absent reads as `final`.
   */
  ppwBasis?: PriceBasis;
  batteryPriceBasis?: PriceBasis;
  lender: {
    id: string;
    name: string;
    rank: number;
    applyUrl: string | null;
    /** Our own serving URL for the partner's mark, never the bank's CDN. */
    logoUrl: string | null;
    /**
     * The partner's ceiling on the final price per watt, cents. On the LENDER
     * because it is the partner's rule and not one programme's — a menu that
     * offered a household a capped programme at the uncapped price would be
     * frozen into the snapshot and outlive anybody's chance to correct it.
     */
    maxFinalPpwCents: number | null;
    /** Ceiling, or this partner's flat price. See SolarFinalPpwMode. */
    finalPpwMode: FinalPpwMode;
    /** The same rule, counted in batteries, for a job with no array. */
    maxFinalPricePerBatteryCents?: number | null;
    finalBatteryPriceMode?: FinalPpwMode;
    /**
     * What this partner hands back for signing today, and how it is arrived
     * at. On the LENDER for the same reason the ceiling is, and carried into
     * the menu because each column is priced under its own partner's rule —
     * see `solar-sign-today`.
     */
    signTodayMode?: SignTodayMode;
    signTodayFixedCents?: number | null;
    signTodayCapPpwCents?: number | null;
  };
};

/**
 * How many ways of paying a household is asked to compare, in total.
 *
 * Six, including the quoted one. Not "all of them": a company with a full rate
 * sheet has forty rows, and forty prices in a menu is not a choice, it is a
 * spreadsheet handed to somebody who did not ask for one. The rep still leads
 * with one option — the quoted one is first and preselected — and the rest are
 * there for the household that wants to see them.
 */
export const MAX_PAYMENT_OPTIONS = 6;

export type AlternativesInput = {
  /** The deal's own terms, so the menu neither repeats nor contradicts them. */
  quoted: {
    product: FinanceProduct;
    /** The catalogue row this deal was quoted from, when it was quoted from one. */
    lenderProductId: string | null;
    /**
     * The PARTNER that row belongs to, so the one-programme-per-lender rule
     * below can count the quoted option as that lender's turn. Null when the
     * quoted option names no partner — a cash deal — which is the one case
     * where a lender's own loan still belongs on the menu underneath it.
     */
    lenderId: string | null;
    /** The deal's sticker per watt, cents. Carries the lender's fee on a loan. */
    grossPpwCents: number;
    dealerFeePct: number;
  };
  /** Every active rate-sheet row, already scoped to this company. */
  programmes: CatalogueProgramme[];
  /**
   * The lenders whose approved-vendor list covers the equipment on this design,
   * or NULL when nothing is constrained — a company that has not populated any
   * AVL constrains nothing, exactly as the equipment selectors already behave.
   *
   * A programme from a lender that will not finance this panel is not an option,
   * it is a phone call three weeks later.
   */
  approvedLenderIds: string[] | null;
  design: { systemSizeKwDc: number };
  /**
   * WHAT THE STORAGE ON THIS JOB ADDS, already resolved — see
   * `batteryChargeCents`.
   *
   * Carried onto EVERY alternative, not just the quoted option: the battery is
   * on the roof whichever way the household pays, and a menu that charged for
   * it on the loan and not in the cash column would be comparing two different
   * houses. Zero on a storage-only deal, where the battery is the unit the
   * whole menu is already priced by.
   */
  batteryPriceCents?: number;
  /**
   * What the deal sells, and therefore what the menu is priced by the unit of.
   * Absent means `pv`, which is what every caller written before storage is.
   */
  systemType?: "pv" | "pv_storage" | "storage";
  /**
   * STORAGE ONLY. The quoted deal's own per-battery sticker, and how many
   * batteries it is a price for.
   *
   * There is no company-wide "target net per battery" the way there is per
   * watt, so every alternative here is derived from what THIS deal was priced
   * at: take the quoted programme's fee back out to reach the base, then gross
   * that base up by the fee of whichever programme is being offered. It is the
   * same second branch `cashPpwCents` already falls back to, arrived at from
   * the same end.
   */
  storage?: { batteryQty: number; stickerPricePerBatteryCents: number } | null;
  /**
   * The extra work, at CATALOGUE price. Grossed up per option by its own fee —
   * every line, the ones flagged `financedOnTop` included; that flag only puts
   * them above a capped partner's $/W instead of inside it.
   */
  adders: { label: string; amountCents: number; financedOnTop?: boolean }[];
  /** The adders INSIDE each partner's price. See `PurchaseInput`. */
  adderTotalCents: number;
  /** The adders financed ON TOP of it — a roof on a flat-rate partner. */
  onTopAdderTotalCents: number;
  assumptions: SolarAssumptions;
  /** What the company must keep per watt after the lender's cut, cents. */
  targetNetPpwCents: number | null;
  max?: number;
};

export function proposalAlternatives(input: AlternativesInput): ProposalAlternative[] {
  const max = input.max ?? MAX_PAYMENT_OPTIONS;
  // One slot is already taken by the option the deal was quoted on.
  const room = Math.max(0, max - 1);
  if (room === 0) return [];

  const out: ProposalAlternative[] = [];

  /**
   * Which unit this menu counts, decided once.
   *
   * `storage` is only honoured when the deal actually carries a per-battery
   * price. A storage deal with none of that recorded would otherwise have every
   * alternative derived from zero — which is the same $0 menu the per-watt
   * ladder was already producing, arrived at more slowly.
   */
  /**
   * Whether this deal has an array on it, decided from what the deal SELLS.
   *
   * Separate from `storage` below, which additionally requires a per-battery
   * price and therefore answers a pricing question, not an eligibility one. A
   * storage deal missing its price must still be offered storage paper — the
   * old `!storage` test handed it the whole rate sheet instead.
   */
  const storageDeal = input.systemType === "storage";

  const storage =
    storageDeal &&
    input.storage != null &&
    input.storage.batteryQty > 0 &&
    input.storage.stickerPricePerBatteryCents > 0
      ? input.storage
      : null;

  /**
   * What the company keeps per battery, out of the sticker THIS deal quoted.
   * The base every alternative below is re-grossed from.
   */
  const baseBatteryCents = storage
    ? basePpwFromSticker(storage.stickerPricePerBatteryCents, input.quoted.dealerFeePct)
    : 0;

  /**
   * THE SAME RULE PER WATT: what the company keeps per watt out of the sticker
   * this deal was quoted at. Every other programme on the menu is re-grossed
   * from it by its own fee.
   *
   * The menu used to price every other programme with no sticker at all, so
   * each fell to the company's target net — or, with none set, the default
   * sticker — whatever the rep had actually sold. A household comparing lenders
   * was comparing different prices for one system (L15 in PRICING_LOGIC.md).
   *
   * Null when the quoted option has no per-watt price to take a base from — a
   * lease, a PPA, a storage job — and those keep the old derivation.
   */
  const dealBasePpwCents =
    !storageDeal && input.quoted.grossPpwCents > 0
      ? basePpwFromSticker(input.quoted.grossPpwCents, input.quoted.dealerFeePct)
      : null;

  // ── Cash, first among the alternatives ────────────────────────────────────
  // The one option every household understands, and the one a financed quote
  // never shows. Priced at this deal's base — NOT at the loan's sticker, which
  // carries a lender's fee for money nobody is borrowing. Quoting cash at the
  // financed price is how a customer who offered to write a cheque ends up
  // paying the bank's cut anyway.
  if (input.quoted.product !== "cash") {
    out.push({
      key: "cash",
      label: "Pay in full",
      lender: null,
      finance: purchaseFinance({
        product: "cash",
        grossPpwCents: storage ? 0 : cashPpwCents(input),
        // Cash has no lender, so the base IS the sticker — there is no cut for
        // it to be grossed up over.
        stickerPricePerBatteryCents: storage ? baseBatteryCents : undefined,
        dealerFeePct: 0,
        adders: input.adders,
        adderTotalCents: input.adderTotalCents,
        onTopAdderTotalCents: input.onTopAdderTotalCents,
        batteryPriceCents: input.batteryPriceCents ?? 0,
      }),
    });
  }

  // ── The rate sheet ────────────────────────────────────────────────────────
  const eligible = input.programmes
    .filter((p) => p.id !== input.quoted.lenderProductId)
    .filter((p) => lenderIsApproved(p.lender.id, input.approvedLenderIds))
    /**
     * THE STORAGE LINE, DRAWN IN BOTH DIRECTIONS.
     *
     * On a job with no array, only paper written to fund one — the same line
     * the builder's programme picker draws, because a menu that offered the
     * rest would be offering a household a decline.
     *
     * And the converse, which this filter used to let through: a programme a
     * lender publishes for BATTERIES ONLY is not an alternative way to pay for
     * an array. It priced a battery-term loan against the whole system and put
     * the result on the strip as a second offer — "Amos · 20 Year Battery,
     * $292/mo" beside a $70,180 solar job the programme will not fund.
     */
    .filter((p) =>
      storageDeal
        ? p.product === "loan" && p.financesStorageOnly === true
        : p.financesStorageOnly !== true
    )
    .sort(
      (a, b) =>
        a.lender.rank - b.lender.rank ||
        a.lender.name.localeCompare(b.lender.name) ||
        a.rank - b.rank
    );

  /**
   * At most ONE programme per lender. A homeowner comparing four of GoodLeap's
   * terms against nothing else is comparing paperwork, not offers; the point of
   * the menu is breadth across partners. The rate sheet's own ranking decides
   * which of a lender's rows leads, which is what `rank` is for.
   *
   * SEEDED WITH THE QUOTED OPTION'S OWN LENDER, and this is the half that was
   * missing: skipping the catalogue ROW the deal was quoted from is a narrower
   * rule than one row per PARTNER, and the gap between them is exactly one
   * extra row from the bank the customer is already being quoted by. A company
   * running a single partner with two programmes got both of them on the strip
   * — the quoted one badged, the other sitting under it looking like a second
   * offer — which is what the rule above exists to prevent.
   */
  const usedLenders = new Set<string>(
    input.quoted.lenderId ? [input.quoted.lenderId] : []
  );

  for (const p of eligible) {
    if (out.length >= room) break;
    if (usedLenders.has(p.lender.id)) continue;
    usedLenders.add(p.lender.id);

    const row = financeRowForProduct(
      {
        product: p.product,
        // THIS DEAL'S BASE, grossed up by this programme's own fee — see
        // `dealBasePpwCents`. The partner's ceiling still applies to it below.
        // Absent, the row falls back to the target net or the default sticker.
        grossPpwCents:
          dealBasePpwCents != null && p.product === "loan"
            ? (grossPpwFromNet(
                dealBasePpwCents,
                p.dealerFeePct ?? input.assumptions.defaultDealerFeePct
              ) ?? undefined)
            : undefined,
        adderTotalCents: input.adderTotalCents,
        onTopAdderTotalCents: input.onTopAdderTotalCents,
      },
      {
        systemSizeKwDc: input.design.systemSizeKwDc,
        assumptions: input.assumptions,
        lenderProduct: {
          id: p.id,
          product: p.product,
          aprPct: p.aprPct,
          termMonths: p.termMonths,
          dealerFeePct: p.dealerFeePct,
          leaseRateCentsPerKwMonth: p.leaseRateCentsPerKwMonth,
          rateMillsPerKwh: p.rateMillsPerKwh,
          escalatorPct: p.escalatorPct,
          termYears: p.termYears,
          maxFinalPpwCents: p.lender.maxFinalPpwCents,
          finalPpwMode: p.lender.finalPpwMode,
          ppwBasis: p.ppwBasis,
        },
        targetNetPpwCents: input.targetNetPpwCents,
      }
    );

    /**
     * The same programme's price, counted in batteries.
     *
     * `financeRowForProduct` above still resolves everything that is not money
     * — the APR, the term, the fee this partner charges — because those rules
     * are the partner's and do not change with the unit. Only the price is
     * rebuilt here, from the base this deal keeps, grossed up by THIS
     * programme's fee and then held to whatever this partner will fund a
     * battery for.
     */
    const storageSticker = storage
      ? capStickerToFinalUnit({
          stickerPerUnitCents:
            grossPpwFromNet(baseBatteryCents, row.dealerFeePct) ?? baseBatteryCents,
          maxFinalPerUnitCents: p.lender.maxFinalPricePerBatteryCents ?? null,
          mode: p.lender.finalBatteryPriceMode,
          basis: p.batteryPriceBasis,
          units: storage.batteryQty,
          dealerFeePct: row.dealerFeePct,
          adderTotalCents: input.adderTotalCents,
        }).stickerPerUnitCents
      : null;

    out.push({
      key: `${p.product}:${p.id}`,
      // Without the dealer fee: the menu is printed on the customer's document.
      label: `${p.lender.name} · ${customerProductLabel(p)}`,
      lender: p.lender.name,
      lenderLogoUrl: p.lender.logoUrl,
      lenderApplyUrl: p.lender.applyUrl,
      lenderProductLabel: customerProductLabel(p),
      // THIS partner's closing credit, not the deal partner's. A menu row is
      // an offer from whoever publishes it.
      signTodayRule: {
        mode: p.lender.signTodayMode ?? "none",
        fixedCents: p.lender.signTodayFixedCents ?? null,
        capPpwCents: p.lender.signTodayCapPpwCents ?? null,
      },
      loanFactors:
        p.product === "loan"
          ? {
              factorWithPaydownMicros: p.factorWithPaydownMicros,
              factorWithoutPaydownMicros: p.factorWithoutPaydownMicros,
              paydownPct: p.paydownPct,
              paydownMonths: p.paydownMonths,
            }
          : null,
      finance: {
        product: row.product,
        // Zeroed on storage: the per-watt figure is a rate on watts this job
        // does not have, and a renderer handed one prints it.
        grossPpwCents: storageSticker == null ? row.grossPpwCents : 0,
        ...(storageSticker == null
          ? {}
          : { stickerPricePerBatteryCents: storageSticker }),
        dealerFeePct: row.dealerFeePct,
        adderTotalCents: row.adderTotalCents,
        onTopAdderTotalCents: row.onTopAdderTotalCents,
        // At the same catalogue price on every programme, grossed up by each
        // column's own dealer fee when that column is priced.
        ...(input.batteryPriceCents && input.batteryPriceCents > 0
          ? { batteryPriceCents: input.batteryPriceCents }
          : {}),
        ...(row.adderTotalCents + row.onTopAdderTotalCents > 0
          ? { adders: input.adders }
          : {}),
        rateMillsPerKwh: row.rateMillsPerKwh,
        monthlyPaymentCents: row.monthlyPaymentCents,
        escalatorPct: row.escalatorPct,
        termYears: row.termYears,
        aprPct: row.aprPct,
        loanTermMonths: row.loanTermMonths,
        // Deliberately NOT carried across: the approved payment and the money
        // the customer put down belong to the deal that was actually
        // underwritten. Quoting another lender's programme with this lender's
        // approved figure is a payment nobody has agreed to.
        loanMonthlyPaymentCents: null,
        downPaymentCents: null,
      },
    });
  }

  return out;
}

/**
 * What cash is priced at: this deal's base per watt.
 *
 * The quoted sticker with its dealer fee taken back out. Cash has no lender and
 * no fee, so the base IS the cash price.
 *
 * The company's target net used to win whenever one was set, which priced
 * cash at $2.50/W on a deal the rep had sold at $3.10 (L15). It is now only the
 * fallback for a quote with no per-watt price to start from — a lease or a PPA.
 */
export function cashPpwCents(input: {
  quoted: { product: FinanceProduct; grossPpwCents: number; dealerFeePct: number };
  targetNetPpwCents: number | null;
}): number {
  if (input.quoted.grossPpwCents > 0) {
    return basePpwFromSticker(input.quoted.grossPpwCents, input.quoted.dealerFeePct);
  }
  if (input.targetNetPpwCents != null && input.targetNetPpwCents > 0) {
    return input.targetNetPpwCents;
  }
  return 0;
}

function lenderIsApproved(lenderId: string, approved: string[] | null): boolean {
  return approved === null || approved.includes(lenderId);
}

function purchaseFinance(a: {
  product: "cash";
  grossPpwCents: number;
  /** Storage only. Absent on a deal with an array — see `ProposalFinanceInput`. */
  stickerPricePerBatteryCents?: number;
  dealerFeePct: number;
  adders: { label: string; amountCents: number; financedOnTop?: boolean }[];
  adderTotalCents: number;
  onTopAdderTotalCents: number;
  /** The storage on the job, at its catalogue price. Zero where there is none. */
  batteryPriceCents: number;
}): ProposalFinanceInput {
  return {
    product: a.product,
    grossPpwCents: a.grossPpwCents,
    ...(a.batteryPriceCents > 0 ? { batteryPriceCents: a.batteryPriceCents } : {}),
    ...(a.stickerPricePerBatteryCents == null
      ? {}
      : { stickerPricePerBatteryCents: a.stickerPricePerBatteryCents }),
    dealerFeePct: a.dealerFeePct,
    adderTotalCents: a.adderTotalCents,
    onTopAdderTotalCents: a.onTopAdderTotalCents,
    ...(a.adderTotalCents + a.onTopAdderTotalCents > 0 ? { adders: a.adders } : {}),
    rateMillsPerKwh: null,
    monthlyPaymentCents: null,
    escalatorPct: null,
    termYears: null,
    aprPct: null,
  };
}
