import type { FinanceProduct } from "@prisma/client";
import { factorQuote, factorMonthlyCents, hasPaymentFactor, type PaymentFactors } from "./solar-loan";
import { resolveUtilityRateMills } from "./solar-energy";
import {
  apportionCents,
  pricePurchase,
  priceStoragePurchase,
  purchaseFromUnits,
  priceThirdParty,
  productionInYear,
  loanPaymentCents,
  PRODUCTION_MARGIN_PCT,
  type SolarAssumptions,
  type PurchaseBreakdown,
  type ThirdPartyBreakdown,
} from "./solar-money";
import {
  reconcileContract,
  type ContractReconciliation,
  type LenderContractAdjustment,
} from "./solar-contract-adjustment";
import {
  buildCreditLadder,
  CREDIT_RATES_DEFAULT,
  type CreditClaims,
  type CreditLadder,
  type CreditRates,
} from "./solar-credit-ladder";

/**
 * Builds the frozen customer-facing proposal.
 *
 * Two rules govern this file:
 *
 * 1. NOTHING IS HARDCODED. Utility escalation, degradation, the ITC percentage,
 *    default PPW — every assumption arrives as data from Solar Settings, on the
 *    same discipline as the ITC. A number in this file that a homeowner reads
 *    is a number nobody can correct without a deploy.
 *
 * 2. THE SNAPSHOT IS FROZEN. The output is stored verbatim on the proposal row.
 *    Change an assumption tomorrow and an already-sent proposal still shows what
 *    that customer was shown — otherwise the document is worthless as a record
 *    of what was offered, and arguably misleading.
 *
 * Every monetary figure is an estimate and travels with its disclaimer.
 */

/**
 * Who does the work at each step.
 *
 * Named because "we handle everything" is the sentence every solar company
 * says, and a homeowner who has been told it twice does not believe it a third
 * time. A step that says plainly "you, and the city" is more convincing than
 * one that claims nothing is asked of them — and it is also true, which matters
 * on the day the city takes five weeks.
 */
export type TimelineOwner = "You" | "Us" | "Install team" | "Your city" | "Your utility";

/** The 6 steps a homeowner goes through, in order. */
export const SOLAR_TIMELINE = [
  {
    key: "site_survey",
    title: "Site Survey",
    blurb: "We measure the roof, check the electrical panel and confirm the design fits your home.",
    duration: "30–60 minutes",
    owners: ["You", "Us"],
  },
  {
    key: "design",
    title: "Design & Engineering",
    blurb: "Engineers produce the stamped plan set and single-line diagram for your system.",
    duration: "2–4 days",
    owners: ["Us"],
  },
  {
    key: "permitting",
    title: "Permitting & Interconnection",
    blurb: "We file with your city and your utility. This is the longest wait, and it is not in our hands.",
    duration: "2–6 weeks",
    owners: ["Us", "Your city", "Your utility"],
  },
  {
    key: "installation",
    title: "Installation",
    blurb: "Most systems go on in one to two days.",
    duration: "1–2 days",
    owners: ["Install team"],
  },
  {
    key: "inspection",
    title: "Inspection",
    blurb: "Your city inspects the work and signs it off.",
    duration: "1–3 weeks",
    owners: ["Us", "Your city"],
  },
  {
    key: "pto",
    title: "Permission to Operate",
    blurb: "The utility gives the green light and your system switches on.",
    duration: "1–3 weeks",
    owners: ["Us", "Your utility"],
  },
] as const satisfies readonly {
  key: string;
  title: string;
  blurb: string;
  /**
   * A RANGE, always. "2 weeks" on a permit that regularly takes five is the
   * promise the customer remembers and the one the install date is measured
   * against — and the range is what the company can actually stand behind.
   */
  duration: string;
  owners: readonly TimelineOwner[];
}[];

/**
 * Where the environmental equivalences come from.
 *
 * Cited on the page rather than kept in a comment. A homeowner reading "153
 * trees" has no way to check it, and a number nobody can check is a number that
 * reads as marketing — which is a shame, because these ones are the EPA's.
 */
export const IMPACT_SOURCES = {
  co2: {
    label: "EPA eGRID, US average emissions rate",
    url: "https://www.epa.gov/egrid",
  },
  trees: {
    label: "EPA Greenhouse Gas Equivalencies Calculator",
    url: "https://www.epa.gov/energy/greenhouse-gas-equivalencies-calculator",
  },
  coal: {
    label: "EPA Greenhouse Gas Equivalencies Calculator",
    url: "https://www.epa.gov/energy/greenhouse-gas-equivalencies-calculator",
  },
  miles: {
    label: "EPA Greenhouse Gas Equivalencies Calculator",
    url: "https://www.epa.gov/energy/greenhouse-gas-equivalencies-calculator",
  },
  homeValue: {
    label: "Berkeley Lab, Selling Into the Sun",
    url: "https://emp.lbl.gov/publications/selling-sun-price-premium-analysis",
  },
} as const;

export const SOLAR_FAQS = [
  { q: "What happens if the system makes more power than I use?", a: "Extra production goes back to the grid. What you are credited for it depends on your utility's net-metering or buyback programme — your consultant can tell you which one your address falls under." },
  { q: "What happens when the power goes out?", a: "A standard grid-tied system shuts off during an outage for the safety of line workers. Adding a battery keeps selected circuits running." },
  { q: "Does my roof need work first?", a: "If the roof has less life left than the system, we replace it first. Your surveyor will tell you plainly — it is cheaper to do it now than to remove and reinstall panels later." },
  { q: "What maintenance is there?", a: "Very little. Panels have no moving parts. Rain handles most cleaning, and your system is monitored so we see faults before you do." },
  { q: "What if I sell the house?", a: "An owned system generally transfers with the property. A lease or PPA transfers to the buyer or is bought out — the terms are in your agreement." },
] as const;

/** Environmental impact, from lifetime kWh. Standard EPA-equivalent factors. */
export function environmentalImpact(lifetimeKwh: number) {
  // EPA eGRID US average ~0.855 lb CO2 per kWh.
  const lbsCo2 = lifetimeKwh * 0.855;
  const tonsCo2 = lbsCo2 / 2000;
  return {
    tonsCo2Avoided: Math.round(tonsCo2),
    // EPA: an urban tree sequesters ~0.06 tons CO2/yr over 20 years.
    treesEquivalent: Math.round(tonsCo2 / (0.06 * 20)),
    // EPA: ~1.09 lbs CO2 per pound of coal burned → lbs coal not burned.
    poundsCoalAvoided: Math.round(lbsCo2 / 1.09),
    milesNotDriven: Math.round(lbsCo2 / 0.89), // ~0.89 lb CO2 per mile
  };
}

export type SavingsYear = {
  year: number;
  productionKwh: number;
  /** What the utility would have charged for the WHOLE home, this year. */
  utilityCostCents: number;
  /** Grid power still bought after solar, this year. */
  residualGridCents: number;
  /**
   * The utility's fixed charges for the year — the monthly meter fee times
   * twelve, escalated with the rate like everything else the utility bills.
   *
   * ABSENT on every snapshot generated before the fee was modelled; read it
   * through `postSolarUtilityCents()` rather than directly, so a document
   * priced without it keeps reporting the number it was priced at.
   */
  meterFeeCents: number;
  /** What solar itself costs this year (purchase price in yr 1, or the lease/PPA payment). */
  solarPaymentCents: number;
  /**
   * What a battery programme pays the homeowner this year — the VPP money,
   * already multiplied by how many batteries are on the design, plus the
   * one-off enrolment payment in year one.
   *
   * SUBTRACTED from `solarCostCents` rather than added to the utility side,
   * because it is not a smaller bill: it is income, and folding it into
   * "utility bill avoided" would overstate a figure whose whole job is to say
   * what the utility stops charging.
   *
   * ABSENT on every snapshot generated before this existed — read it through
   * `vppCreditCents()` rather than directly, for the reason `meterFeeCents`
   * gives above.
   */
  vppCreditCents: number;
  /**
   * The federal credits and the signing incentive, in the year they land.
   *
   * Year one only, and zero everywhere else and on every document generated
   * before the ladder existed. RECORDED rather than quietly netted off the
   * payment, because a year-one row that is $70,000 better than year two with
   * nothing on the page saying why is exactly the kind of figure a homeowner
   * asks about and a rep cannot answer.
   *
   * ABSENT on older snapshots — read it through `creditReliefCents()`.
   */
  creditReliefCents: number;
  /** residualGrid + meterFee + solarPayment − vppCredit − creditRelief. */
  solarCostCents: number;
  cumulativeSavingsCents: number;
};

/**
 * A battery programme's money, as it lands on ONE customer's proposal.
 *
 * The figures are already multiplied by the battery count: the office records
 * what one battery earns, the design says how many there are, and multiplying
 * at the boundary keeps the arithmetic out of every renderer downstream.
 *
 * Frozen onto the snapshot with everything else. A programme the utility ends
 * next year must not silently rewrite a document a homeowner has already
 * signed — the same rule the adder lines and the lender's terms follow.
 */
export type VppCredit = {
  /** What the customer signs up to — "Renew Home", not the retailer's name. */
  programme: string;
  /** Who runs it, for the sentence that says where the money comes from. */
  provider: string;
  /** Money a year, already × the battery count. Flat: a programme pays what it
   *  pays, and escalating it would be inventing a raise nobody has promised. */
  annualCents: number;
  /** One-off enrolment money, already × the battery count. Year one only. */
  upfrontCents: number;
  /** How many batteries the figures were multiplied by, so the document can say. */
  batteryQty: number;
};

export type SavingsModel = {
  years: SavingsYear[];
  /**
   * Utility bill avoided, BEFORE paying for the system:
   * Σ(utility) − Σ(residual grid + meter fee).
   *
   * This is the number most solar proposals print as "25-year savings". It is
   * not savings — it is the gross reduction in the utility bill, and it ignores
   * the cheque the customer writes for the system. Anexa labels it exactly what
   * it is and shows `netSavingsCents` as the headline.
   */
  utilityCostAvoidedCents: number;
  /** Σ(solar payments): the purchase price, or the lease/PPA payments over the term. */
  solarPaidCents: number;
  /**
   * The honest figure: utility avoided − what solar cost.
   *   net = Σ(utility) − Σ(residual grid) − Σ(solar payments)
   * Negative is a legitimate answer and is rendered as such.
   */
  netSavingsCents: number;
  /** Kept as an alias of netSavingsCents so existing callers stay correct. */
  totalSavingsCents: number;
  /** Σ(battery-programme payments) over the horizon. Zero when there are none. */
  vppCreditTotalCents: number;
  /**
   * The credits and incentive, once, in year one. Zero on every deal that
   * quotes none — which is every deal without a contract adjustment.
   */
  creditReliefTotalCents: number;
  /** First year in which cumulative savings turn positive; null if never. */
  paybackYear: number | null;
};

/**
 * HOW MANY YEARS THE COMPARISON RUNS FOR, on one payment option.
 *
 * Twenty-five was a constant here until 2026-08-29, and on a thirty-year loan
 * it was quietly wrong in both columns: the table stopped after 300 of the
 * loan's 360 payments, so it under-counted what the household hands over AND
 * cut five years off the utility bill they avoid. A comparison that stops while
 * somebody is still paying is not a comparison.
 *
 * So a LOAN's term decides it, and only a loan's. A lease or a PPA keeps
 * twenty-five, which is what those pages have always said, and cash has no term
 * to follow.
 *
 * FLOORED AT TWENTY-FIVE, deliberately. A short loan — five years, ten — would
 * otherwise produce a five-row page whose utility column has barely begun to
 * compound, and it would SHORTEN documents that read at twenty-five today. The
 * floor means this change can only ever extend a proposal, never truncate one.
 * Those deals keep the free years after payoff that they already had; that is
 * the pre-existing shape of the model and not something this function invented.
 *
 * Capped, because the horizon sizes a table and a chart, and a term typed with
 * an extra digit should not print a hundred rows at a homeowner.
 */
export const SAVINGS_HORIZON_MIN_YEARS = 25;
export const SAVINGS_HORIZON_MAX_YEARS = 40;

export function savingsHorizonYears(input: {
  product: FinanceProduct;
  /** The loan's own term. Null on cash, on a lease and on a PPA. */
  loanTermMonths?: number | null;
}): number {
  if (input.product !== "loan") return SAVINGS_HORIZON_MIN_YEARS;
  const months = input.loanTermMonths;
  if (months == null || !Number.isFinite(months) || months <= 0) {
    return SAVINGS_HORIZON_MIN_YEARS;
  }
  // Rounded UP: 354 months is a household paying into year thirty, and a
  // twenty-nine-year table would drop the last payments it exists to show.
  const years = Math.ceil(months / 12);
  return Math.min(SAVINGS_HORIZON_MAX_YEARS, Math.max(SAVINGS_HORIZON_MIN_YEARS, years));
}

/**
 * Utility-vs-solar comparison over `years` — see `savingsHorizonYears` for how
 * long that is and why it is not a constant.
 *
 * The utility side compounds at the configured escalation rate; the solar side
 * depends entirely on the product. This is the single most persuasive — and
 * most abusable — number on the page, which is why every input is a stated
 * assumption rather than a constant.
 */
export function savingsModel(args: {
  product: FinanceProduct;
  year1ProductionKwh: number;
  annualUsageKwh: number;
  currentRateMillsPerKwh: number;
  purchase?: PurchaseBreakdown;
  thirdParty?: ThirdPartyBreakdown;
  ppaRateMills?: number | null;
  leaseMonthlyCents?: number | null;
  escalatorPct?: number | null;
  termYears?: number | null;
  assumptions: SolarAssumptions;
  years?: number;
  /**
   * Battery programmes this customer qualifies for. Empty — the ordinary case
   * — leaves every figure exactly as it was before this existed.
   */
  vppCredits?: VppCredit[];
  /**
   * THE PRICE THIS DOCUMENT QUOTES, where it is not the price the purchase
   * ladder computed.
   *
   * One case only: a partner whose contract is written above the quoted price.
   * The years have to bill what the paper says, or the twenty-five years and
   * the cost chapter describe two different loans. Absent means "read the
   * breakdown", which is what every other deal does.
   */
  purchasePriceCents?: number | null;
  /**
   * The federal credits and the signing incentive, landing in year one.
   *
   * The counterpart to `purchasePriceCents`: billing the larger contract
   * without ever crediting what comes back off it would model a household
   * paying $125,000 for a $55,000 system, and print a twenty-five-year loss
   * that is not the deal anybody signed.
   *
   * CASH ONLY, because cash is the product where the whole price lands in year
   * one and the whole relief lands beside it. A FINANCED deal must not be
   * modelled this way: the relief would land inside the horizon in full while
   * a 30-year loan leaves a sixth of its payments outside it, and the
   * twenty-five-year figure would come out $11,000 better than the same deal
   * priced the old way — flattering the document by an accident of where the
   * window ends. A loan steps its payment DOWN instead; see `loan` below.
   */
  creditReliefCents?: number | null;
  /**
   * A LOAN's actual repayment schedule, so the model bills what the household
   * is billed: twelve payments a year for the term, and nothing afterwards.
   *
   * Without this the loan branch below charges the whole contract price to
   * year one. That is right for cash and wrong for finance, and it is wrong in
   * the most alarming way a proposal can be: a homeowner on a $168 payment
   * opened year one and read "$60,500 — the system itself, paid for this
   * year", a number they will never be asked for and cannot pay.
   *
   * OPTIONAL, and ignored unless it carries both a payment and a term. A
   * programme that publishes neither a factor nor an APR and term has no
   * schedule to spread, and inventing one would be quoting a payment nobody
   * offered — so that deal keeps the lump-sum shape it has always had.
   */
  loan?: {
    /** The same monthly the document prints, cents. See `priceOption`. */
    monthlyPaymentCents: number | null;
    termMonths: number | null;
    /** Paid at signing, on top of the payments. Always 0 today. */
    downPaymentCents?: number | null;
    /**
     * WHAT THE PAYMENT BECOMES once the credits and the incentive have been
     * applied to the principal, cents.
     *
     * The real shape of a credit-funded loan, and the reason the relief is not
     * modelled as a lump on a financed deal: the household does not pocket
     * $70,000, they put it against the loan and the payment re-amortises. So
     * the years bill the full payment while the credits are outstanding and
     * the smaller one afterwards, which is the cashflow they will actually
     * see. Null — the ordinary case — bills one payment for the whole term,
     * exactly as this model always has.
     */
    afterCreditMonthlyCents?: number | null;
    /**
     * How many months of the higher payment come first.
     *
     * The rate sheet's own paydown window where the programme publishes one,
     * because that is the month the lender re-amortises at. Otherwise twelve:
     * a credit is claimed on the following year's return, so the first
     * realistic month to apply it is a year out. Ignored without a step-down
     * payment above.
     */
    creditAppliedAfterMonths?: number | null;
  } | null;
}): SavingsModel {
  const a = args.assumptions;
  const horizon = args.years ?? SAVINGS_HORIZON_MIN_YEARS;
  const rows: SavingsYear[] = [];
  let cumulative = 0;
  let utilityTotal = 0;
  let residualTotal = 0;
  let solarPaidCents = 0;
  let vppCreditTotalCents = 0;
  let creditReliefTotalCents = 0;
  let paybackYear: number | null = null;

  /**
   * The credits and incentive as a year-one lump — CASH ONLY.
   *
   * Suppressed the moment the loan above carries a step-down, because there
   * the same money is already modelled where it actually goes: against the
   * principal, lowering every payment after the paydown month. Counting it
   * both ways would credit a household $70,000 twice.
   */
  const year1ReliefCents =
    (args.loan?.afterCreditMonthlyCents ?? 0) > 0
      ? 0
      : Math.max(0, Math.round(args.creditReliefCents ?? 0));

  const vppAnnualCents = (args.vppCredits ?? []).reduce((n, v) => n + v.annualCents, 0);
  const vppUpfrontCents = (args.vppCredits ?? []).reduce((n, v) => n + v.upfrontCents, 0);

  /**
   * The loan, as a schedule rather than a price — but only when there IS one.
   *
   * Both halves are required. A payment with no term cannot be spread over
   * anything, and a term with no payment has nothing to spread; either way the
   * honest answer is to fall back to the contract price in year one rather
   * than to guess at the missing half in a document a household signs.
   */
  const loanMonthlyCents =
    args.product === "loan" &&
    (args.loan?.monthlyPaymentCents ?? 0) > 0 &&
    (args.loan?.termMonths ?? 0) > 0
      ? args.loan!.monthlyPaymentCents!
      : null;
  const loanTermMonths = loanMonthlyCents != null ? args.loan!.termMonths! : 0;
  const loanDownCents =
    loanMonthlyCents != null ? Math.max(0, args.loan?.downPaymentCents ?? 0) : 0;

  /**
   * The smaller payment, and the month it starts — both or neither.
   *
   * A step-down with no month to start at, or a month with nothing to step
   * down to, is not a schedule; the honest answer there is the flat payment
   * this model has always billed rather than a guess at the missing half.
   */
  const afterCreditMonthlyCents =
    loanMonthlyCents != null && (args.loan?.afterCreditMonthlyCents ?? 0) > 0
      ? args.loan!.afterCreditMonthlyCents!
      : null;
  const creditAppliedAfterMonths =
    afterCreditMonthlyCents == null
      ? 0
      : Math.max(0, Math.round(args.loan?.creditAppliedAfterMonths ?? 12));

  for (let year = 1; year <= horizon; year++) {
    const production = productionInYear(args.year1ProductionKwh, year, a);

    // What the utility would have charged for the whole home's usage.
    const utilityRate = args.currentRateMillsPerKwh * Math.pow(1 + a.utilityEscalationPct / 100, year - 1);
    const utilityCostCents = Math.round((args.annualUsageKwh * utilityRate) / 10);

    // Grid power still needed after solar covers what it can.
    const gridKwh = Math.max(0, args.annualUsageKwh - production);
    const residualGridCents = Math.round((gridKwh * utilityRate) / 10);

    // The half of the bill that has nothing to do with kilowatt-hours. It is
    // escalated with the utility's own rate rather than held flat: this model
    // already assumes the utility raises what it charges every year, and a
    // standing charge frozen at today's figure for 25 years is the optimistic
    // reading of that same assumption.
    const meterFeeCents = Math.round(
      a.utilityMeterFeeCents * 12 * Math.pow(1 + a.utilityEscalationPct / 100, year - 1)
    );

    // Everything the utility still bills after the system is switched on.
    const postSolarUtility = residualGridCents + meterFeeCents;

    // What the solar itself costs this year — kept SEPARATE from the residual
    // grid bill so the proposal can show "bill avoided" and "net of what you
    // paid for the system" as two different, correctly-labelled numbers.
    let solarPaymentCents = 0;
    if (args.product === "cash" || args.product === "loan") {
      if (loanMonthlyCents != null) {
        // Financed: twelve payments a year until the term runs out, and a
        // final year that carries only the months actually left in it. A
        // 30-year loan therefore bills all twenty-five years of this model and
        // a 10-year loan stops billing in year 11 — which is the whole reason
        // the payment is spread rather than lumped.
        const monthsPaid = Math.min(12, Math.max(0, loanTermMonths - (year - 1) * 12));
        if (afterCreditMonthlyCents == null) {
          solarPaymentCents = loanMonthlyCents * monthsPaid;
        } else {
          // How many of THIS year's payments still fall before the credits are
          // applied. Split rather than switched at a year boundary, because a
          // paydown month published as 18 lands halfway through year two.
          const monthsBefore = Math.max(
            0,
            Math.min(monthsPaid, creditAppliedAfterMonths - (year - 1) * 12)
          );
          solarPaymentCents =
            loanMonthlyCents * monthsBefore +
            afterCreditMonthlyCents * (monthsPaid - monthsBefore);
        }
        solarPaymentCents += year === 1 ? loanDownCents : 0;
      } else if (year === 1) {
        // Bought outright — or financed on terms this document could not
        // resolve — so year one carries the contract price and later years
        // carry nothing. The override, where there is one, is a partner's
        // contract value: the figure printed on the cost chapter, so that the
        // years bill what the page above them says.
        solarPaymentCents = args.purchasePriceCents ?? args.purchase?.contractPriceCents ?? 0;
      }
    } else {
      const esc = Math.pow(1 + (args.escalatorPct ?? 0) / 100, year - 1);
      const withinTerm = !args.termYears || year <= args.termYears;
      if (withinTerm) {
        solarPaymentCents =
          args.product === "ppa"
            ? Math.round((production * (args.ppaRateMills ?? 0) * esc) / 10)
            : Math.round((args.leaseMonthlyCents ?? 0) * 12 * esc);
      }
    }

    // What the battery earns, flat. The enrolment payment is a one-off, so it
    // lands in year one and never again — and it is the reason payback can
    // arrive a year sooner on a system with a battery than without one.
    const vppCredit = vppAnnualCents + (year === 1 ? vppUpfrontCents : 0);

    // The credits and the incentive, in the year they are claimed. Kept as its
    // own term rather than folded into the battery money above: one is income
    // from a programme every year, the other is a one-off against the price of
    // the system, and a chart that draws them as one line explains neither.
    const creditRelief = year === 1 ? year1ReliefCents : 0;

    const solarCostCents = postSolarUtility + solarPaymentCents - vppCredit - creditRelief;
    cumulative += utilityCostCents - solarCostCents;
    utilityTotal += utilityCostCents;
    residualTotal += postSolarUtility;
    solarPaidCents += solarPaymentCents;
    vppCreditTotalCents += vppCredit;
    creditReliefTotalCents += creditRelief;
    if (paybackYear === null && cumulative > 0) paybackYear = year;

    rows.push({
      year,
      productionKwh: Math.round(production),
      utilityCostCents,
      residualGridCents,
      meterFeeCents,
      solarPaymentCents,
      vppCreditCents: vppCredit,
      creditReliefCents: creditRelief,
      solarCostCents,
      cumulativeSavingsCents: cumulative,
    });
  }

  return {
    years: rows,
    utilityCostAvoidedCents: utilityTotal - residualTotal,
    solarPaidCents,
    netSavingsCents: cumulative,
    totalSavingsCents: cumulative,
    vppCreditTotalCents,
    creditReliefTotalCents,
    paybackYear,
  };
}

/**
 * What the utility still bills in a given year: grid power plus fixed charges.
 *
 * Every renderer goes through this rather than reading `residualGridCents`,
 * because a proposal generated before the meter fee was modelled has no
 * `meterFeeCents` on its years at all. Defaulting the missing key to zero means
 * an old document keeps reporting exactly the figure it was priced at, and a
 * new one reports the whole bill — which is the entire point of freezing a
 * snapshot in the first place.
 */
export function postSolarUtilityCents(y: SavingsYear): number {
  return y.residualGridCents + ((y as Partial<SavingsYear>).meterFeeCents ?? 0);
}

/**
 * What a battery programme paid in a given year, zero on any document priced
 * before programmes were modelled.
 *
 * Same rule as the meter fee above, and for the same reason: an old snapshot
 * has no such key, and reading it raw would print `undefined` on a proposal a
 * homeowner already holds.
 */
export function vppCreditCents(y: SavingsYear): number {
  return (y as Partial<SavingsYear>).vppCreditCents ?? 0;
}

/**
 * The credit-and-incentive money that landed in a given year, zero on any
 * document generated before the ladder existed.
 *
 * Same rule as the two above, and for the same reason: an old snapshot has no
 * such key, and reading it raw would print `undefined` on a proposal a
 * homeowner already holds.
 */
export function creditReliefCents(y: SavingsYear): number {
  return (y as Partial<SavingsYear>).creditReliefCents ?? 0;
}

/** An equipment line as the customer sees it — catalogue data only, never invented. */
export type SnapshotEquipment = {
  manufacturer: string | null;
  model: string;
  /** Modules: watts/panel. Inverters: rated output W. Batteries: usable Wh. */
  ratingW: number | null;
  qty: number;
  /**
   * The manufacturer's datasheet. v4 and later; absent on older snapshots.
   *
   * A LINK, frozen like everything else. Frozen matters here in the ordinary
   * direction — the customer's copy keeps pointing at whatever we recorded on
   * the day, so re-cataloguing a panel does not silently repoint a document
   * somebody is holding at a different component's spec sheet.
   */
  specSheetUrl?: string | null;
  /**
   * A photograph of the component. v5 and later; absent on older snapshots.
   *
   * A URL to our own serving route, carrying the item's `photoUpdatedAt` as a
   * cache-buster — the same treatment `lenderLogoUrl` gets, and frozen the same
   * way: the document keeps the URL it was generated with. The BYTES behind it
   * are live, so re-photographing a panel updates it everywhere, which is the
   * right answer for a product shot and the wrong one for a price. Nothing
   * quoted is stored this way.
   */
  photoUrl?: string | null;
};

/**
 * Which model produced a proposal's production figure.
 *
 * Recorded on the document because the document lists the assumptions its
 * numbers came from, and "1,450 kWh per kW per year" is a false sentence on a
 * proposal whose production was simulated per plane instead.
 */
export type YieldBasis = {
  source: "pvwatts";
  /** The NSRDB station that answered. */
  station: string | null;
  /** How many arrays were simulated, out of how many there are. */
  arrays: number;
  totalArrays: number;
};

/**
 * The money on one way of paying, frozen.
 *
 * Extracted from the snapshot so a document can hold SEVERAL of these — the
 * option the deal was quoted on plus every other one the customer was offered —
 * without two shapes drifting apart. The quoted one still sits at
 * `snapshot.financing`, exactly where it always has.
 */
export type SnapshotFinancing = {
  product: FinanceProduct;
  /** Cash/loan only. */
  contractPriceCents: number | null;
  grossPpwCents: number | null;
  basePriceCents: number | null;
  adderTotalCents: number | null;
  /**
   * The extra work, named, as it was priced on the day.
   *
   * v3 and later. A homeowner reading "Additional work — $14,500" on an
   * $82,660 contract, alone at their kitchen table with nobody to ask, has
   * one obvious question and no way to answer it. Naming the line is the
   * difference between a number that looks arbitrary and one that looks
   * justified.
   *
   * COPIED, like every other figure here: a later rename or reprice in the
   * catalogue must not rewrite what this customer was shown. Undefined on a
   * proposal generated before v3, which keeps rendering its single total.
   */
  adders?: {
    label: string;
    amountCents: number;
    /**
     * What the work actually is, in the company's words. v4 and later, and
     * only on the lines the company chose to explain — see `showcase`.
     */
    description?: string;
    /**
     * Name this one to the customer under "Additional services", with its
     * description, rather than only as a figure in the price breakdown.
     *
     * FROZEN like everything else here. Un-ticking the flag in the catalogue
     * tomorrow must not silently remove a service from a document a homeowner
     * has already read and agreed to.
     */
    showcase?: boolean;
  }[];
  finalPpwCents: number | null;
  /** Lease/PPA only. */
  monthlyPaymentCents: number | null;
  rateMillsPerKwh: number | null;
  escalatorPct: number | null;
  termYears: number | null;
  aprPct: number | null;
  /** Loan only: what the customer pays each month. */
  loanMonthlyPaymentCents: number | null;
  /**
   * How many payments there are. Loan only, and ABSENT on every snapshot
   * generated before the savings model spread a loan over its term — guard on
   * `!= null` rather than on the key, so an old document simply omits the row.
   */
  loanTermMonths?: number | null;
  /**
   * True when that figure is the lender's own from an approval, false when it
   * is amortised from the quoted product. The document says which, because a
   * homeowner reading a payment is entitled to know whether it is settled.
   */
  loanPaymentApproved: boolean;
  /**
   * What the payment becomes if the paydown is never made.
   *
   * Frozen next to the quoted payment ON PURPOSE. A document that prints only
   * the low, paydown-contingent figure is the most misleading thing a solar
   * proposal can do, and a customer who never applies the credit finds out
   * from a bank statement.
   */
  loanMonthlyWithoutPaydownCents: number | null;
  loanPaydownCents: number | null;
  loanPaydownMonths: number | null;
  loanPaydownPct: number | null;
  /**
   * The lender's CUSTOMER application link, frozen at generation.
   *
   * Frozen like everything else here: the document has to keep working as
   * issued. Change a lender's link and already-sent proposals keep the old
   * one until they are regenerated — the same trade every other figure in
   * this snapshot makes. Never the dealer portal: that one is not put in a
   * document a homeowner can open.
   */
  applyUrl: string | null;
  lender: string | null;
  /**
   * The lender's mark, as a URL to our own serving route.
   *
   * A URL rather than the bytes, and our route rather than the bank's, for
   * the same two reasons the company logo is: a snapshot with images inlined
   * would be a megabyte of JSON per proposal, and hotlinking a bank's own CDN
   * would let someone else's cache-bust break a document a customer keeps.
   * Null when the partner has no logo — the view falls back to a monogram.
   * Optional rather than required because proposals generated before logos
   * existed have no such key at all, and their JSON is not rewritten: the
   * view treats a missing key exactly as it treats null.
   */
  lenderLogoUrl?: string | null;
  /**
   * The rate-sheet row this was quoted from, by name. v6 and later.
   *
   * Frozen because the funder's submission summary has to name the product the
   * deal was written on, and a catalogue row can be renamed or retired long
   * before anybody goes looking for it.
   */
  lenderProductLabel?: string | null;
  /**
   * WHAT THE CUSTOMER IS FINANCING. v6 and later.
   *
   * The contract price less anything put down — and, on a partner carrying a
   * programme contribution, emphatically NOT the contract value that partner's
   * paper is written at. It is stored rather than left to be derived because
   * this is the one number the payment must come off, and a document that lets
   * a renderer choose which figure to amortise is a document that will
   * eventually amortise the wrong one.
   *
   * Absent on every snapshot generated before v6, which renders no such row.
   */
  financedAmountCents?: number | null;
  /**
   * THE CONTRACT VALUE, WHERE IT DIFFERS FROM WHAT THE CUSTOMER OWES.
   * v6 and later, and null on every deal that is not on such a partner —
   * which is all of them until an admin configures one.
   *
   * Three figures that must add up, frozen together with the wording that
   * explains them. Nothing else on the document reads it: the payment, the
   * financed amount, the savings, the payback and the price per watt are all
   * worked out from `contractPriceCents`, which is the household's actual
   * obligation and is not touched by any of this.
   */
  lenderAdjustment?: SnapshotContractAdjustment | null;
  /**
   * WHAT THE HOUSEHOLD ACTUALLY PAYS. v7 and later, and present only on an
   * option whose partner carries a contract adjustment.
   *
   * The contract above, less the federal credits it earns, less the incentive
   * that makes up whatever difference is left — ending on the price the system
   * was quoted at. Its own chapter on the document, because it is the answer to
   * the only question a $125,000 contract raises.
   *
   * Structurally `CreditLadder`; frozen here because statute moves and a
   * document a customer signed has to keep showing the ladder it was signed
   * against.
   */
  creditLadder?: CreditLadder | null;
  /**
   * The monthly once that ladder has been applied, cents. v7 and later.
   *
   * Derived through the same terms and the same function as the headline
   * payment — see `monthlyOn` — so the two figures on this document can never
   * imply two different loans. Null on cash and on every deal with no ladder.
   */
  netMonthlyPaymentCents?: number | null;
  /**
   * What the homeowner ends up owning, in this partner's own words. v6 and
   * later.
   *
   * The closing paragraph of the savings chapter tells a household it owns the
   * system outright and that it transfers with the house. True of a loan, false
   * of a prepaid lease, and until this key existed the document had no way to
   * say anything else. Null keeps the generic sentence, which is what every
   * document already issued carries.
   */
  ownershipNote?: string | null;
  /**
   * Legacy incentive fields. No credit is quoted anywhere in the product, so
   * these are always null on anything generated now; the keys stay so that
   * proposals issued while incentives existed still parse and render.
   */
  itcEstimateCents: number | null;
  itcPct: number | null;
  stateIncentiveNote: string | null;
};

/**
 * The contract reconciliation, frozen onto one option of one document.
 *
 * Structurally `ContractReconciliation` — same three figures, same wording —
 * but declared here as its own type because this one is JSON in a database
 * column that has to keep parsing for as long as the proposal exists. The
 * computation may be refactored; this shape may not.
 */
export type SnapshotContractAdjustment = {
  /** The approved customer-facing term, as it stood on the day. */
  label: string;
  /** The partner's contribution, cents. */
  adjustmentCents: number;
  /** What the household owes — the same figure as `contractPriceCents`. */
  customerObligationCents: number;
  /** What the partner's paper is written at. */
  lenderContractValueCents: number;
  /** The reconciliation paragraph, its figures already substituted in. */
  disclosure: string;
};

/**
 * One way to pay, as the homeowner can pick it.
 *
 * Each option carries its OWN price and its OWN twenty-five-year model, because
 * they are not variations of one number: a lender's fee changes what the system
 * costs, and a lease has no system price at all. Computing the alternatives in
 * the browser from the quoted one would mean re-deriving prices from a rate
 * sheet in front of the customer, which is precisely what the snapshot exists
 * to stop.
 *
 * The quoted option is always present and always first. A document with one
 * option renders exactly as one without any: there is nothing to choose.
 */
export type ProposalPaymentOption = {
  /** Stable within this document: "cash", "loan:<productId>", "lease:<id>". */
  key: string;
  /** How the option reads in the menu: "Pay in full", "GoodLeap · 25 yr · 4.99%". */
  label: string;
  /** True for the option the deal was actually quoted on. Exactly one is. */
  quoted: boolean;
  financing: SnapshotFinancing;
  savings: SavingsModel;
  /**
   * What this costs a month in year one — the loan or lease payment, a PPA's
   * first-year average, null on cash, which has no monthly.
   *
   * Stored rather than derived because the menu is read by this number and the
   * three products arrive at it three different ways.
   */
  monthlyCents: number | null;
  /**
   * THE SAME OPTION WITH THE HOUSEHOLD'S TAX CREDITS CLAIMED. v8 and later.
   *
   * The document carries a switch, and this is what it switches TO: the payment
   * once the credits have been applied to the loan, and the whole horizon
   * re-modelled on that payment — so flipping it moves the year-by-year table,
   * the chart, the payback year and the lifetime figure together with the
   * headline instead of leaving a stale table under a changed number.
   *
   * The fields above are the switch OFF: the credits are never claimed, which
   * is the pessimistic reading and therefore the default.
   *
   * NULL, or absent entirely on a document generated before v8, means there is
   * nothing to claim — no ladder, no partner programme — and the document shows
   * no switch at all rather than one that changes nothing.
   */
  creditsApplied?: {
    savings: SavingsModel;
    monthlyCents: number | null;
    /**
     * THE PRICE THIS READING QUOTES, and what is left to finance under it.
     *
     * A scenario is not a payment with the rest of the document unchanged
     * around it. "You claimed the credits" changes what the household ends up
     * paying and what the loan is carrying, so the price sheet and the terms
     * list have to move with the payment or the reader is handed a $161 payment
     * beside a $128,080 amount financed and no arithmetic that joins them.
     *
     * On a programme deal `totalCents` is the household's own price and the two
     * are the same figure. On an ordinary deal the price is what they pay US —
     * unchanged, because the credit comes back on their return rather than off
     * our invoice — while `financedAmountCents` is the balance once they have
     * applied it to the loan. Both are frozen here rather than derived on the
     * page, like every other figure in this snapshot.
     *
     * Absent on a document generated before this existed, which is what makes
     * the renderer's fallback to the OFF figures the right reading of an older
     * proposal rather than a guess.
     */
    totalCents?: number | null;
    financedAmountCents?: number | null;
  } | null;
  /**
   * What the customer still pays the utility each month afterwards: the grid
   * power the system does not cover, PLUS the utility's fixed meter charge —
   * which is billed at full offset exactly as it is billed at half.
   *
   * The same on both sides of the switch: a tax credit changes what the loan
   * asks for, never what the wires company bills.
   */
  postSolarMonthlyCents: number;
};

/**
 * The payment this option asks for under the scenario currently on screen.
 *
 * One function rather than a ternary at each of the eight places that read it,
 * because the failure mode is a page showing the switched figure in one panel
 * and the unswitched one in the next — which is exactly the confusion the
 * switch was added to clear up.
 */
export function optionMonthlyCents(
  o: ProposalPaymentOption,
  creditsApplied: boolean
): number | null {
  return creditsApplied && o.creditsApplied ? o.creditsApplied.monthlyCents : o.monthlyCents;
}

/** The horizon this option was modelled over, under the same scenario. */
export function optionSavings(o: ProposalPaymentOption, creditsApplied: boolean): SavingsModel {
  return creditsApplied && o.creditsApplied ? o.creditsApplied.savings : o.savings;
}

/**
 * THE PRICE, as opposed to what the paper is written at.
 *
 * On an ordinary deal these are the same figure and this returns the contract
 * price, unchanged. On a deal carrying a programme contribution they are not:
 * the partner's paper is written at $118,400 and the household was quoted
 * $48,400, and which of the two a page prints is not a detail. A homeowner who
 * reads "System price $118,400 · $13.45 per watt" has been shown a number that
 * matches nothing they have been told and nothing they can check against
 * another quote — the market is $3 to $6 a watt — and the credits that bring it
 * back down are read as an apology for it rather than as the mechanism.
 *
 * So every customer-facing surface that says "the price" says THIS, and the
 * contract keeps its own block, underneath, where the arithmetic that gets from
 * one to the other is set out in full. Nothing is hidden by the change: the
 * contract, the credits and the incentive are all still printed, and the
 * funder's submission summary still leads with the contract, because that is
 * the number its file reviewer is checking.
 *
 * `quotedPriceCents` rather than the ladder's bottom line on purpose. The two
 * are equal whenever anything was handed back — that equality is the ladder's
 * whole feature — but on a system large enough that the credits alone take the
 * contract BELOW the quoted price, the net is lower than the price, and the
 * price is still what the system is being sold for.
 */
export function quotedTotalCents(f: SnapshotFinancing): number | null {
  return f.creditLadder ? f.creditLadder.quotedPriceCents : f.contractPriceCents;
}

/**
 * What the household's own price works out at per installed watt.
 *
 * DERIVED FROM THE PRINTED TOTAL, exactly as `finalPpwCents` is derived from
 * the contract, so the two figures on the page divide into each other. Reading
 * the stored `grossPpwCents` instead would be a third number arrived at another
 * way, and a page whose price and rate disagree is the failure this file has
 * been bitten by most often.
 *
 * Null when there is nothing to divide — no price, or no watts, which is every
 * storage document.
 */
export function quotedPpwCents(f: SnapshotFinancing, sizeKwDc: number): number | null {
  const total = quotedTotalCents(f);
  if (total == null || !(sizeKwDc > 0)) return null;
  return Math.round(total / (sizeKwDc * 1000));
}

export type SolarProposalSnapshot = {
  /**
   * Bumped when the shape changes, so old proposals still render.
   * v2 adds the energy profile, equipment detail, layout image, company
   * identity, representative and the utility-avoided/net-savings split.
   * v3 names the adders instead of showing one "Additional work" total.
   * v4 adds the payment menu, the site coordinate and the shape of the year.
   * v5 adds the system type and the storage block — a battery makes no
   * kilowatt-hours, so a document about one is argued from backup hours,
   * programme earnings and a time-of-use spread instead of from production.
   * v6 splits the contract value from the customer's obligation: the financed
   * amount, the partner's programme contribution and its reconciliation, the
   * lender's product name, and the partner's own ownership wording.
   * v7 quotes the CONTRACT rather than the obligation, and adds the credit
   * ladder that brings it back down — the federal credits, the derived signing
   * incentive, the net cost and the payment the household ends up on.
   * v8 models each option's horizon TWICE — with the household's credits
   * claimed and without — so the document's tax-credit switch moves the
   * year-by-year table with the headline instead of only the headline.
   */
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  /**
   * Which revision of the pricing arithmetic produced these figures.
   *
   * SEPARATE FROM `schemaVersion`, and the distinction is load-bearing: that
   * one says what SHAPE this JSON is, so a renderer knows which keys to expect.
   * This one says how the numbers inside it were WORKED OUT, so a dispute about
   * a figure on a two-year-old proposal can be settled against the rules that
   * were in force rather than against today's. A shape can change without the
   * maths moving, and the maths can move inside an unchanged shape.
   *
   * Absent on everything generated before v6, which reads as revision 1.
   */
  calculationVersion?: number;
  /**
   * What this deal sold.
   *
   * ABSENT on every document generated before v5, and absent reads as `pv`:
   * those proposals were all arrays, and the renderer must keep drawing them
   * exactly as it does today.
   */
  systemType?: "pv" | "pv_storage" | "storage";
  /**
   * The storage argument, frozen. Null on a PV deal and on every older document.
   *
   * `tou` is NULL — not zeroed — when the utility's peak rate is not on file,
   * and the renderer omits the line. A zero beside a real backup figure reads
   * as "this battery saves you nothing", which is a different and untrue claim
   * from "we do not have your peak rate".
   */
  storage?: {
    batteryLabel: string | null;
    batteryQty: number;
    usableKwh: number;
    backup: { name: string; loadWatts: number; hours: number }[];
    tou: {
      peakRateMills: number;
      offPeakRateMills: number;
      peakWindow: string | null;
      shiftedKwhPerDay: number;
      annualSavingsCents: number;
      /** The assumptions this figure came from, frozen beside it. */
      peakSharePct: number;
      cyclesPerDay: number;
      roundTripEfficiencyPct: number;
    } | null;
    rebates: { name: string; qty: number; amountCents: number; totalCents: number }[];
  } | null;
  generatedAt: string;
  /** Who generated it — recorded on the document, not shown to the customer. */
  generatedById: string | null;
  /** Human-facing document reference, e.g. "SP-1042-V2". */
  reference: string;
  customer: { name: string; address: string };
  company: {
    name: string;
    phone: string | null;
    email: string | null;
    logoUrl: string | null;
    address: string | null;
  };
  /** The rep the homeowner actually deals with. Null fields are omitted. */
  representative: { name: string; phone: string | null; email: string | null } | null;
  /** Section 2 — what the customer pays for power today. */
  energy: {
    utilityProvider: string | null;
    /**
     * HISTORICAL. Nothing collects a rate plan any more, so this is null on
     * every new snapshot — but proposals already sent carry a value, and the
     * snapshot is what those customers were shown. Kept so old documents keep
     * rendering exactly as they did.
     */
    ratePlan: string | null;
    annualUsageKwh: number;
    avgMonthlyBillCents: number | null;
    /** usage × derived rate. Null when the rate could not be derived. */
    currentAnnualCostCents: number | null;
  };
  system: {
    sizeKwDc: number;
    year1ProductionKwh: number;
    offsetPct: number;
    moduleLabel: string | null;
    moduleQty: number;
    inverterLabel: string | null;
    batteryLabel: string | null;
    mountType: string;
    utilityProvider: string | null;
    /**
     * HISTORICAL, like `tsrfPct` below. The net-metering programme was a
     * company setting that got stamped onto every proposal; the setting is
     * gone, so this is null on every new snapshot. It stays in the type because
     * a proposal already sent is a frozen document — it keeps printing the
     * programme it was sold with rather than losing a line retroactively.
     */
    netMeteringProgram: string | null;
    /** HISTORICAL, like `energy.ratePlan`. Null on every new snapshot. */
    tsrfPct: number | null;
    module: SnapshotEquipment | null;
    inverter: SnapshotEquipment | null;
    battery: SnapshotEquipment | null;
  };
  /**
   * The panel layout drawing. Null means no usable layout — the section is
   * OMITTED rather than rendered with a placeholder or an aerial photo.
   *
   * Holds the FILE ID, not a URL. A URL would have had to embed the public
   * share token, which would then be frozen into the snapshot and leak into
   * every internal preview of it. Each renderer builds its own URL from this id:
   * the portal uses the authenticated file route, the customer's copy uses the
   * token-scoped one. The id is an identity, not a secret.
   */
  layout: {
    fileId: string;
    provider: string | null;
    externalRef: string | null;
    /** True until an authorised user marks the drawing final. */
    preliminary: boolean;
  } | null;
  financing: SnapshotFinancing;
  savings: SavingsModel;
  /**
   * The battery programmes priced into the model above, so the document can say
   * where the money comes from rather than showing a savings figure that is
   * simply larger than the arithmetic on the page explains.
   *
   * ABSENT, not empty, on any proposal generated before programmes existed —
   * and absent is the honest answer there: those documents were priced without
   * one, and the renderer says nothing rather than implying a zero.
   */
  vpp?: VppCredit[];
  /**
   * Every way this customer may pay, the quoted one first. v4 and later.
   *
   * Absent on an older document, and absent is not the same as empty: a
   * proposal generated before the menu existed offers exactly what it was
   * quoted on, which is what `financing` above already says. The renderer
   * falls back to a single option built from `financing`, so one code path
   * draws both.
   */
  options?: ProposalPaymentOption[];
  /**
   * Where the house is, so the array can be drawn on its own roof. v4.
   *
   * The COORDINATE, not a picture: imagery is fetched at render time through a
   * route that holds the API key, and a URL frozen into the snapshot would
   * either carry that key or rot when the route moves. Null when the deal was
   * never geocoded, which omits the drawing rather than centring it on the
   * middle of the ocean.
   */
  site?: {
    lat: number;
    lng: number;
    /**
     * The array AS DRAWN, frozen: every panel as four corners in ground metres
     * east and north of the coordinate above.
     *
     * Corners rather than the blocks they came from, for two reasons. The
     * customer's page then needs no geometry library at all — it projects four
     * points and fills a polygon — so nine hundred lines of roof-drawing maths
     * stay out of a bundle a homeowner downloads on a driveway. And the
     * drawing is frozen the same way every figure is: redraw the roof tomorrow
     * and the document a customer is holding still shows the array they were
     * shown.
     */
    panels?: { e: number; n: number }[][];
  } | null;
  /**
   * The shape of the customer's year: twelve months of production against
   * twelve months of usage, Jan..Dec, in kWh. v4.
   *
   * Both halves must be REAL or this is null. Production comes from the same
   * PVWatts simulation the annual figure does, and usage from the twelve
   * readings on the design. Splitting an annual total across the months with a
   * modelled curve and drawing it beside a measured one is the thing the
   * energy chart already refuses to do, and a customer-facing document is a
   * worse place to start.
   */
  monthly?: { productionKwh: number[]; usageKwh: number[] } | null;
  environmental: ReturnType<typeof environmentalImpact>;
  /** Every assumption, recorded so the document explains its own numbers. */
  assumptions: SolarAssumptions & {
    currentRateMillsPerKwh: number;
    /**
     * WHERE the production figure came from.
     *
     * Absent or null means `kwhPerKwYear` above — the company's market average,
     * scaled by a clear-sky ratio. Present means PVWatts simulated these planes
     * against this site's own weather record and the market average did not
     * enter into the number, which is exactly why the document must stop
     * listing it as though it had.
     */
    yieldBasis?: YieldBasis | null;
    /**
     * How far UNDER the model this document's production was quoted, %.
     *
     * Frozen rather than read live from `PRODUCTION_MARGIN_PCT`, and absent on
     * every proposal built before the margin existed. Those documents were
     * built at full model output, and printing today's constant on one would
     * make the assumptions list — the one section whose whole job is to be
     * true — describe a haircut that number never took.
     */
    productionMarginPct?: number;
    /**
     * What the company is willing to claim an owned system adds to a home's
     * value, %. v4.
     *
     * Frozen like every other assumption, and DATA rather than the 4.1% the
     * studies are usually quoted at: the published figures disagree and vary by
     * market, so the number a homeowner reads is one somebody at the company
     * decided to stand behind. Absent or zero means the claim is not made and
     * the card is omitted — never printed as "0%".
     */
    homeValueUpliftPct?: number;
  };
  /** `incentive` only ever appears on legacy snapshots; nothing renders it. */
  disclaimers: { incentive?: string; estimate: string };
};

/**
 * Which revision of the pricing arithmetic a document was built by.
 *
 * BUMP THIS when the maths that turns a design and a rate sheet into the
 * figures a homeowner reads actually changes — not when a renderer moves, not
 * when a key is added. It is stamped onto every snapshot so that an argument
 * about a number on an old proposal can be settled against the rules that were
 * in force when it was made.
 *
 * 2 — the contract value and the customer's obligation became separate figures.
 *     Before this there was only one, so every document at revision 1 is one in
 *     which they were necessarily equal.
 * 3 — the document moved ONTO the contract value. The price, the price per
 *     watt, the amount financed, the payment and the twenty-five years are all
 *     worked out from the partner's contract; the federal credits and the
 *     derived signing incentive bring it back to the quoted price on a page of
 *     their own. A revision-2 document quoted the obligation from page one.
 */
export const PRICING_CALCULATION_VERSION = 3;

/** The standing non-binding-estimate wording. Shown on every proposal. */
export const ESTIMATE_DISCLAIMER =
  "This proposal is an estimate, not a binding offer or a guarantee of financing. Production, savings and utility rates are projections based on the assumptions listed and will vary with weather, usage, equipment availability and utility rate changes. Financing is subject to credit approval and lender terms. Figures do not constitute tax advice.";

/**
 * The money for ONE way of paying, as the caller hands it over.
 *
 * Named rather than left inline because the document now prices several of
 * these — the deal's own terms and every alternative the customer is offered —
 * and two shapes for the same thing is how a lease's escalator ends up on a
 * loan.
 */
export type ProposalFinanceInput = {
  product: FinanceProduct;
  grossPpwCents: number;
  /**
   * STORAGE ONLY. What ONE battery stickers at, the partner's fee already
   * inside it — exactly what `grossPpwCents` is on a deal with an array.
   *
   * A storage job has no installed watts, so the per-watt figure beside this
   * one is zero and multiplying by it prices the whole document at nothing.
   * That was the defect: the deal screen quoted $18,000 and the customer's
   * document said $0, because only the deal screen knew the unit was a battery.
   */
  stickerPricePerBatteryCents?: number;
  dealerFeePct: number;
  /** The adders INSIDE the partner's price. See `PurchaseInput`. */
  adderTotalCents: number;
  /** The adders financed ON TOP of it — a roof on a flat-rate partner. */
  onTopAdderTotalCents?: number;
  /** The lines behind BOTH totals, already priced against this system. */
  adders?: {
    label: string;
    amountCents: number;
    description?: string | null;
    showOnProposal?: boolean;
    /** True on a line that rides on top of the partner's price. */
    financedOnTop?: boolean;
  }[];
  rateMillsPerKwh: number | null;
  monthlyPaymentCents: number | null;
  escalatorPct: number | null;
  termYears: number | null;
  aprPct: number | null;
  /** Loan only. The lender's own figure once an approval exists. */
  loanMonthlyPaymentCents?: number | null;
  loanTermMonths?: number | null;
  downPaymentCents?: number | null;
};

/**
 * One alternative way to pay, offered alongside the quoted one.
 *
 * Priced HERE, at generation, from terms the caller has already resolved and
 * authorised — never re-derived in the browser from a rate sheet. A menu whose
 * prices are computed client-side is a menu whose prices can be edited by
 * anyone with a developer console, in a document whose whole purpose is to be
 * a record of what was offered.
 */
export type ProposalAlternative = {
  /** Stable within the document: "cash", "loan:<productId>", "lease:<id>". */
  key: string;
  /** How it reads in the menu. */
  label: string;
  finance: ProposalFinanceInput;
  lender: string | null;
  lenderLogoUrl?: string | null;
  lenderApplyUrl?: string | null;
  loanFactors?: PaymentFactors | null;
  /** The rate-sheet row's own name, frozen for the funder's paperwork. */
  lenderProductLabel?: string | null;
  /**
   * This partner's programme contribution, as configured. Carried per
   * ALTERNATIVE and not once for the document, because the menu offers several
   * partners and only some of them run such a programme — a contribution
   * resolved once and applied to every option would put Participate's
   * reconciliation under a GoodLeap loan.
   */
  contractAdjustment?: LenderContractAdjustment | null;
  /** This partner's ownership wording, if it publishes one. */
  ownershipNote?: string | null;
};

/**
 * Price one way of paying, and model twenty-five years of it.
 *
 * Everything the quoted option used to do inline, so that the alternatives go
 * through EXACTLY the same arithmetic. A second code path for "the other
 * options" would be a second place for the dealer fee to be applied to the
 * adders, or not to be.
 */
function priceOption(args: {
  design: {
    systemSizeKwDc: number;
    year1ProductionKwh: number;
    annualUsageKwh: number;
    /** How many batteries. The UNIT a storage deal is priced by. */
    batteryQty: number;
  };
  /**
   * What this deal sells, and therefore which ladder prices it. Solar counts
   * installed watts; storage counts batteries. Same arithmetic, same file — see
   * `priceUnits` — but a storage deal run through the per-watt one multiplies
   * every figure by zero watts and quotes the household nothing.
   */
  systemType: "pv" | "pv_storage" | "storage";
  /**
   * Somebody else's money, already off the contract. Passed to EVERY option for
   * the same reason the VPP credits are: the rebate belongs to the equipment,
   * not to the way it is paid for.
   */
  rebateTotalCents: number;
  finance: ProposalFinanceInput;
  lender: string | null;
  lenderLogoUrl: string | null;
  lenderApplyUrl: string | null;
  loanFactors: PaymentFactors | null;
  lenderProductLabel?: string | null;
  /**
   * This partner's programme contribution, as an admin configured it. Resolved
   * into the frozen three-figure reconciliation below, or into nothing.
   */
  contractAdjustment?: LenderContractAdjustment | null;
  /**
   * The company's federal-credit percentages, and which of them THIS deal
   * earns. Read only where a contract adjustment exists, because that is the
   * only structure the product quotes a credit on at all.
   */
  creditRates?: CreditRates | null;
  creditClaims?: CreditClaims | null;
  creditIncentiveLabel?: string | null;
  creditDisclaimer?: string | null;
  /** This partner's ownership wording, where it publishes one. */
  ownershipNote?: string | null;
  /** When the document is being made — the date an effective date is read against. */
  now?: Date;
  assumptions: SolarAssumptions;
  currentRateMillsPerKwh: number;
  /**
   * The battery programmes this customer qualifies for. Passed to EVERY option,
   * not just the quoted one: the battery is on the roof whichever way they pay,
   * so a menu that credited it on the loan and not on the cash column would be
   * comparing two different houses.
   */
  vppCredits: VppCredit[];
}): {
  financing: SnapshotFinancing;
  savings: SavingsModel;
  monthlyCents: number | null;
  /** The same option with the credits claimed. Null where there are none. */
  creditsApplied: NonNullable<ProposalPaymentOption["creditsApplied"]> | null;
  postSolarMonthlyCents: number;
} {
  const { design, finance, assumptions: a } = args;
  const isPurchase = finance.product === "cash" || finance.product === "loan";
  const isStorage = args.systemType === "storage";

  const purchase = !isPurchase
    ? undefined
    : isStorage
      ? // Same ladder, counted in batteries. `purchaseFromUnits` renames the
        // answer so everything downstream — the savings model, the menu, the
        // customer's own breakdown — reads it exactly as it reads a PV one.
        purchaseFromUnits(
          priceStoragePurchase({
            product: finance.product as "cash" | "loan",
            batteryQty: design.batteryQty,
            stickerPricePerBatteryCents: finance.stickerPricePerBatteryCents ?? 0,
            dealerFeePct: finance.dealerFeePct,
            adderTotalCents: finance.adderTotalCents,
            onTopAdderTotalCents: finance.onTopAdderTotalCents ?? 0,
            rebateTotalCents: args.rebateTotalCents,
          })
        )
      : pricePurchase({
          product: finance.product as "cash" | "loan",
          systemSizeKwDc: design.systemSizeKwDc,
          stickerPpwCents: finance.grossPpwCents,
          dealerFeePct: finance.dealerFeePct,
          adderTotalCents: finance.adderTotalCents,
          onTopAdderTotalCents: finance.onTopAdderTotalCents ?? 0,
        });

  const thirdParty = !isPurchase
    ? priceThirdParty(
        {
          product: finance.product as "lease" | "ppa",
          rateMillsPerKwh: finance.rateMillsPerKwh ?? undefined,
          monthlyPaymentCents: finance.monthlyPaymentCents ?? undefined,
          escalatorPct: finance.escalatorPct ?? 0,
          termYears: finance.termYears ?? 25,
          year1ProductionKwh: design.year1ProductionKwh,
          systemSizeKwDc: design.systemSizeKwDc,
        },
        a
      )
    : undefined;

  /**
   * THE CONTRACT VALUE, WHERE THIS PARTNER'S PAPER IS WRITTEN FOR MORE THAN THE
   * SYSTEM WAS PRICED AT.
   *
   * Resolved from `purchase.contractPriceCents` — the price the ladder above
   * computed — and then, unlike every other figure in this file, fed BACK into
   * what the document quotes. That is the whole of the 2026-08-29 change and it
   * reverses the rule this block shipped with that morning.
   *
   * WHY IT REVERSED. The contribution is not money coming off the household's
   * bill; it is money added to the paper so the federal credits are earned on
   * the larger figure. A household on this programme signs for $125,000, is
   * billed a payment on $125,000, claims fifty percent of $125,000 and lands —
   * after the credits and the incentive that makes up the difference — on the
   * $55,000 they were quoted. Quoting them a payment on $55,000 from the first
   * page described a loan nobody was writing. The ladder that gets them back
   * down is `creditLadder` below, and it is a chapter of its own.
   *
   * Null on every deal whose partner has no such programme, which is all of
   * them until an admin configures one, and on lease and PPA, which have no
   * system price for a contribution to sit on. Null means NOTHING here changes:
   * `documentPriceCents` falls through to the price it always was.
   */
  const reconciliation: ContractReconciliation | null = purchase
    ? reconcileContract({
        customerObligationCents: purchase.contractPriceCents,
        adjustment: args.contractAdjustment,
        lenderName: args.lender,
        at: args.now,
      })
    : null;

  /**
   * THE ONE PRICE THIS DOCUMENT QUOTES.
   *
   * The contract value where there is one, the ordinary price where there is
   * not — resolved once, here, and read by the total, the price per watt, the
   * principal, the payment and the twenty-five years. One figure in one place
   * is the only defence against the failure this codebase keeps re-learning:
   * two numbers on one page that do not divide into each other.
   */
  const documentPriceCents = reconciliation
    ? reconciliation.lenderContractValueCents
    : (purchase?.contractPriceCents ?? 0);

  /**
   * What a payment factor gets applied to: the price above, less anything the
   * customer puts down. Never the gross — a down payment is not borrowed, and
   * applying the factor to it quotes a payment on money nobody owes.
   */
  const loanPrincipalCents = documentPriceCents - (finance.downPaymentCents ?? 0);

  /**
   * WHAT THE HOUSEHOLD ACTUALLY PAYS, once the credits and the incentive are
   * taken off the contract above.
   *
   * Only ever built where there is a reconciliation, because only there is the
   * contract bigger than the price and only there is there a remainder to hand
   * back. On every other deal this is null and the document quotes no credit at
   * all — which is what the product has always done.
   */
  const creditLadder: CreditLadder | null = purchase
    ? buildCreditLadder({
        contractValueCents: documentPriceCents,
        // THE LADDER'S TARGET — where it has to land after the credits.
        //
        // On a programme deal, the household's own obligation, which is below
        // the contract and is what the remainder gets handed back to reach. On
        // an ordinary deal the two ARE the same figure: nothing is being handed
        // back, the ladder is the price with the credits taken off it, and
        // `buildCreditLadder` drops the incentive row rather than printing a
        // zero. Passing the price to both sides is what makes that degenerate
        // case fall out of the same arithmetic instead of a second branch.
        quotedPriceCents: reconciliation
          ? reconciliation.customerObligationCents
          : documentPriceCents,
        rates: args.creditRates ?? CREDIT_RATES_DEFAULT,
        claims: args.creditClaims,
        incentiveLabel: args.creditIncentiveLabel,
        disclaimer: args.creditDisclaimer,
      })
    : null;

  /**
   * THE LADDER ON A PARTNER PROGRAMME, and null everywhere else.
   *
   * Nothing customer-facing reads this any more — both readings of the document
   * come off `creditLadder` above. It survives for the FUNDER's own summary,
   * which prints "monthly once the credits are applied" beside the contract it
   * is submitting, and that sentence is only true where a programme applies
   * them as a matter of course.
   */
  const programmeLadder: CreditLadder | null = reconciliation ? creditLadder : null;
  const loanFactorQuote =
    finance.product === "loan" && args.loanFactors && hasPaymentFactor(args.loanFactors)
      ? factorQuote(args.loanFactors, loanPrincipalCents)
      : null;

  /**
   * WHAT THESE TERMS ASK FOR ON A GIVEN PRINCIPAL — one function, because this
   * document now quotes a payment on two of them.
   *
   * The headline comes off the contract the household signs. The ladder's own
   * page comes off what is left after the credits and the incentive. Deriving
   * the second one any other way — a ratio of the first, a fresh amortisation
   * that ignores the rate sheet — is how a document ends up with two payments
   * that imply two different loans, so both go through here.
   *
   * The precedence is the one this file has always used:
   *   1. the lender's own figure from a real approval
   *   2. the rate sheet's published payment factor
   *   3. our amortisation of the quoted APR and term
   *
   * (1) IS SCALED when it is asked about a principal other than the one it was
   * issued on. An approval is a figure for a specific amount; the honest way to
   * carry it to a smaller amount is in proportion, and the alternative — quoting
   * the approval unchanged against a principal half its size — is a payment
   * that repays nearly twice what is owed. At the headline principal the scale
   * is exactly 1, so the quoted figure is untouched.
   */
  const monthlyOn = (principalCents: number): number | null => {
    if (finance.product !== "loan") return null;
    const principal = Math.round(principalCents);
    if (principal <= 0) return null;

    if (finance.loanMonthlyPaymentCents != null) {
      if (loanPrincipalCents <= 0) return finance.loanMonthlyPaymentCents;
      return Math.round(finance.loanMonthlyPaymentCents * (principal / loanPrincipalCents));
    }
    if (args.loanFactors && hasPaymentFactor(args.loanFactors)) {
      const m = factorMonthlyCents(factorQuote(args.loanFactors, principal));
      if (m != null) return m;
    }
    return (
      loanPaymentCents({
        principalCents: principal,
        aprPct: finance.aprPct,
        termMonths: finance.loanTermMonths ?? null,
      }) ?? null
    );
  };

  /**
   * The loan's monthly, resolved ONCE — before the twenty-five years are
   * modelled, because the model now bills it.
   *
   * Two sources, in order of authority:
   *   1. the rate sheet's PUBLISHED payment factor
   *   2. our amortisation of the quoted APR and term
   * (1) beats (2) because a factor bakes in the dealer fee and the promotional
   * structure, so the two disagree — and quoting the derived one when the
   * lender printed a factor misquotes the customer.
   *
   * `finance.loanMonthlyPaymentCents` still leads where a row carries one. No
   * form sets it any more, but proposals are regenerated from rows that were
   * written when one did.
   *
   * Where the programme has a paydown, this is the WITH-paydown figure — the
   * same one printed on the cost chapter, and the one the higher
   * `loanMonthlyWithoutPaydownCents` is shown directly beneath. Modelling one
   * payment for the whole term and the other beside it would put two different
   * twenty-five-year answers on one page; the caveat carries that instead.
   */
  const loanMonthlyCents = monthlyOn(loanPrincipalCents);

  /**
   * THE PAYMENT ONCE THE CREDITS ARE APPLIED TO THE PRINCIPAL.
   *
   * The ladder's bottom line, less anything already put down, run through the
   * SAME terms as the headline — so the two figures can never be derived two
   * different ways. Null on cash, which has no payment for a credit to lower,
   * and on lease and PPA, which have no ladder at all.
   *
   * This is the figure the switch turns ON, and it exists on every purchase
   * deal. What follows it — `netMonthlyCents` — is the same number on a
   * programme deal, kept apart only because the funder's summary may print it
   * and the customer's document may not read it.
   */
  const creditsAppliedMonthlyCents = creditLadder
    ? monthlyOn(creditLadder.netCostCents - (finance.downPaymentCents ?? 0))
    : null;

  /**
   * THE SAME PAYMENT, for the FUNDER's paperwork only.
   *
   * Identical arithmetic to the figure above and identical to it in value on
   * every programme deal — the two differ only in where they may be read. This
   * one reaches `netMonthlyPaymentCents` on the snapshot, which the submission
   * summary prints as "monthly once the credits are applied"; the customer's
   * own document reads the scenario, never this.
   */
  const netMonthlyCents = programmeLadder
    ? monthlyOn(programmeLadder.netCostCents - (finance.downPaymentCents ?? 0))
    : null;

  /**
   * ONE SCENARIO OF THIS DEAL, over its whole horizon.
   *
   * The years are modelled TWICE on a deal that earns credits, because the
   * document carries a switch and a switch that moved a headline figure while
   * the thirty-year table underneath it stayed put would be the worst version
   * of this feature: two answers about the same deal on the same sheet, one of
   * them silently stale.
   *
   * Everything that is not the money is identical between the two runs, so it
   * is stated once here. Only the payment schedule and the year-one relief
   * differ, and both are the caller's to name.
   */
  const modelYears = (scenario: {
    /** What the loan bills each month before anything is applied to it. */
    monthlyCents: number | null;
    /** What it becomes afterwards, and null for a schedule that never steps. */
    afterCreditMonthlyCents: number | null;
    /** How many months of the first figure come first. */
    creditAppliedAfterMonths: number;
    /** The credits as a year-one lump. Cash only — see `savingsModel`. */
    reliefCents: number;
  }): SavingsModel =>
    savingsModel({
      product: finance.product,
      year1ProductionKwh: design.year1ProductionKwh,
      annualUsageKwh: design.annualUsageKwh,
      currentRateMillsPerKwh: args.currentRateMillsPerKwh,
      purchase,
      thirdParty,
      ppaRateMills: finance.rateMillsPerKwh,
      leaseMonthlyCents: finance.monthlyPaymentCents,
      escalatorPct: finance.escalatorPct,
      termYears: finance.termYears,
      assumptions: a,
      // Long enough to carry every payment this option asks for. Per OPTION,
      // not per document: switching the payment menu from a thirty-year
      // programme to a twenty-five-year one re-reads the whole chapter, and
      // each answer covers its own schedule.
      years: savingsHorizonYears({
        product: finance.product,
        loanTermMonths: finance.loanTermMonths,
      }),
      vppCredits: args.vppCredits,
      // The years bill the price the cost chapter prints — the partner's
      // contract value where there is one — and credit back whatever this
      // scenario says the household actually claims.
      purchasePriceCents: purchase ? documentPriceCents : null,
      creditReliefCents: scenario.reliefCents,
      // A financed system is paid for monthly, so the years carry the payments
      // rather than the price. Both halves or neither — see `savingsModel`.
      loan:
        finance.product === "loan"
          ? {
              monthlyPaymentCents: scenario.monthlyCents,
              termMonths: finance.loanTermMonths ?? null,
              downPaymentCents: finance.downPaymentCents ?? 0,
              afterCreditMonthlyCents: scenario.afterCreditMonthlyCents,
              creditAppliedAfterMonths: scenario.creditAppliedAfterMonths,
            }
          : null,
    });

  /**
   * THE DOCUMENT WITH THE SWITCH OFF: the deal with NO CREDIT CLAIMED.
   *
   * The full payment, every month, for the whole term — and not a cent of
   * relief anywhere in the thirty years. It is the household that signs the
   * contract and never files for the credit, and it is the honest floor of this
   * deal.
   *
   * IT USED TO BE A HYBRID, AND THAT WAS THE BUG (fixed 2026-08-30). The years
   * billed the full payment for twelve months and the after-credit one for the
   * remaining three hundred and forty-eight, which is a household that DID
   * claim the credit and merely claimed it late. So on a $128,080 contract
   * "credits off" totalled $60,412 against "credits on" at $58,079 — a gap of
   * one year's extra payment, on a deal where the credits are worth $64,040 —
   * and the payback year moved from 4 to 1 while the totals barely moved at
   * all. Two scenarios that differ by 4% cannot be a choice a household is
   * being asked to understand.
   *
   * The switch now separates the two things it says it separates: this is the
   * deal without the credit, `creditsAppliedSavings` below is the deal with it,
   * and each is complete. Nothing in between is modelled, because nothing in
   * between is what either half of the switch means.
   */
  const savings = modelYears({
    monthlyCents: loanMonthlyCents,
    // No step-down and no relief: the credit is not part of this reading of the
    // deal at all. A document with no credits to claim reaches exactly the same
    // model, which is why nothing here is conditional.
    afterCreditMonthlyCents: null,
    creditAppliedAfterMonths: 0,
    reliefCents: 0,
  });

  /**
   * THE SAME DEAL WITH THE SWITCH ON: the credits are already applied.
   *
   * The household has claimed them and the lender has re-amortised, so the
   * lower payment runs from the first month rather than from the twelfth.
   * It is the OPTIMISTIC end of the same deal, and it is a scenario rather
   * than a quote — which is why the sheet that shows it also says, in as many
   * words, what the payment is until the credits land.
   *
   * Null wherever there is nothing to claim — a lease, a PPA, or a company
   * whose admin has zeroed every percentage — and null is what removes the
   * control entirely: a document with no credits shows no switch rather than
   * one that changes nothing.
   *
   * On a LOAN the relief is inside the lower payment, so the year-one lump is
   * zero — crediting both would hand the household the same money twice. On
   * CASH there is no payment to lower, so it lands as the lump it actually is.
   */
  const creditsAppliedSavings = creditLadder
    ? modelYears({
        monthlyCents: creditsAppliedMonthlyCents ?? loanMonthlyCents,
        afterCreditMonthlyCents: null,
        creditAppliedAfterMonths: 0,
        reliefCents:
          finance.product === "loan" && creditsAppliedMonthlyCents != null
            ? 0
            : creditLadder.reliefCents,
      })
    : null;

  const financing: SnapshotFinancing = {
    product: finance.product,
    // THE PRICE THE DOCUMENT QUOTES — the partner's contract value where there
    // is one. Identical to `purchase.contractPriceCents` on every deal without
    // a contract adjustment, which is all of them until an admin configures a
    // partner that runs one.
    contractPriceCents: purchase ? documentPriceCents : null,
    // Null on storage rather than the row's zero: there are no installed watts
    // for a rate to be per, and a renderer handed 0 prints "$0.00/W".
    grossPpwCents: purchase && !isStorage ? finance.grossPpwCents : null,
    // The system AT STICKER — the dealer fee included — because these three
    // rows are read as arithmetic by a homeowner: system price, plus extra
    // work, equals total. Quoting the pre-fee figure here would leave the
    // customer's own breakdown several thousand dollars short of the total
    // printed under it.
    basePriceCents: purchase?.baseStickerCents ?? null,
    // Likewise at sticker: the lender takes its percentage of the re-roof as
    // well as of the array, so the re-roof appears on the contract carrying
    // its share of the fee — unless it is financed ON TOP, in which case it
    // appears at exactly its own price, which is what `adderStickerCents`
    // already holds. Null, not 0, when there are no adders — the renderer omits
    // the row rather than printing an "Adders $0" line the customer has to
    // parse.
    adderTotalCents:
      purchase && purchase.adderStickerCents > 0 ? purchase.adderStickerCents : null,
    // Only lines that cost something, and only on a purchase. A lease or a
    // PPA has no system price for an adder to sit on top of, and a $0 line
    // is a row the customer has to read to learn nothing.
    //
    // SPREAD rather than assigned undefined: the snapshot is asserted to hold
    // no undefined anywhere, because an undefined that reaches a renderer
    // prints as "undefined" in front of a homeowner. A key that is not there
    // is the honest way to say "this document predates named adders".
    //
    // Each line is rebuilt as a NEW object, not just filtered into a new
    // array. `filter` copies the array and keeps the caller's objects, so a
    // snapshot built that way still points at whatever the caller mutates
    // next — which is precisely the freezing this whole module exists to do.
    //
    // APPORTIONED, not grossed up one line at a time: each line has to carry
    // its share of the dealer fee, and the lines have to add up to the total
    // printed beneath them to the cent. Rounding each line's own gross-up
    // leaves a breakdown a few cents out from its own total, which is a
    // question a homeowner with a calculator is entitled to ask.
    //
    // APPORTIONED WITHIN THE FEE-BEARING HALF ONLY. A line financed on top does
    // not carry a share of the dealer fee — that is the whole meaning of the
    // flag — so it is printed at its own amount, and only the rest is spread
    // across the grossed-up total. Sharing the fee out over all of them would
    // put part of the array's cut on the roof line and leave the roof reading
    // $20,000 on a contract that added $7,000 for it.
    ...(purchase && finance.adders?.some((x) => x.amountCents > 0)
      ? (() => {
          const lines = finance.adders!.filter((x) => x.amountCents > 0);
          const inside = lines.filter((x) => !x.financedOnTop);
          const grossedInside = apportionCents(
            purchase.adderStickerCents - purchase.onTopAdderTotalCents,
            inside.map((x) => x.amountCents)
          );
          const byLine = new Map<(typeof lines)[number], number>();
          inside.forEach((x, i) => byLine.set(x, grossedInside[i]));
          return {
            adders: lines.map((x) => ({
              label: x.label,
              amountCents: x.financedOnTop ? x.amountCents : (byLine.get(x) ?? 0),
              // Spread, not assigned undefined: the snapshot is asserted to
              // hold no undefined anywhere, because an undefined reaching a
              // renderer prints as "undefined" in front of a homeowner.
              ...(x.description ? { description: x.description } : {}),
              ...(x.showOnProposal ? { showcase: true } : {}),
            })),
          };
        })()
      : {}),
    // DERIVED FROM THE PRINTED TOTAL, not carried over from the ladder.
    // "$5.50/W · $125,000" is two figures that do not divide into each other,
    // which is the single failure this file has been bitten by most often —
    // see the cap-at-pricing note in solar-money. Where there is no adjustment
    // this is byte-identical to `purchase.finalPpwCents`.
    finalPpwCents:
      purchase && !isStorage
        ? design.systemSizeKwDc > 0
          ? Math.round(documentPriceCents / (design.systemSizeKwDc * 1000))
          : Math.round(purchase.finalPpwCents)
        : null,
    // Lease/PPA carry no APR. Gating here as well as at the write means a
    // stale value left on the row by a product switch can never reach a
    // customer as a fabricated lender term.
    monthlyPaymentCents: isPurchase ? null : finance.monthlyPaymentCents,
    rateMillsPerKwh: finance.product === "ppa" ? finance.rateMillsPerKwh : null,
    escalatorPct: isPurchase ? null : finance.escalatorPct,
    termYears: finance.termYears,
    aprPct: finance.product === "loan" ? finance.aprPct : null,
    // Resolved above, BEFORE the savings model, because the model bills it.
    // One figure, one place: the payment the customer reads on this chapter is
    // the payment the twenty-five years were built from.
    loanMonthlyPaymentCents: loanMonthlyCents,
    loanPaymentApproved:
      finance.product === "loan" && finance.loanMonthlyPaymentCents != null,
    /**
     * How long the payments run, in months.
     *
     * On the document because the years now show them running: a household
     * reading twelve payments in year one is entitled to know how many years
     * of them there are, and `termYears` is a LEASE's field — no loan row has
     * ever carried one, so the cost chapter showed a payment with no term
     * beside it. Null on anything that is not a loan, and absent on every
     * snapshot generated before this existed, which renders as no row at all.
     */
    loanTermMonths: finance.product === "loan" ? (finance.loanTermMonths ?? null) : null,
    loanMonthlyWithoutPaydownCents: loanFactorQuote?.withoutPaydownMonthlyCents ?? null,
    loanPaydownCents: loanFactorQuote?.paydownCents ?? null,
    loanPaydownMonths: loanFactorQuote?.paydownMonths ?? null,
    loanPaydownPct: loanFactorQuote?.paydownPct ?? null,
    lender: finance.product === "loan" ? args.lender : null,
    lenderLogoUrl: finance.product === "loan" ? args.lenderLogoUrl : null,
    // Loan only: a cash, lease or PPA deal has no credit to pre-qualify for.
    applyUrl: finance.product === "loan" ? args.lenderApplyUrl : null,
    // Spread, not assigned null — the snapshot holds no undefined, and a key
    // that is simply not there is how a pre-v6 document says "nobody recorded
    // this", which is exactly what happened.
    ...(finance.product === "loan" && args.lenderProductLabel
      ? { lenderProductLabel: args.lenderProductLabel }
      : {}),
    /**
     * The money the payment is actually taken from.
     *
     * Written for a purchase only, and set to the same principal the factor and
     * the amortisation above were handed — one figure, resolved once. On a
     * partner carrying a programme contribution this is the household's
     * obligation and NOT the contract value, which is the entire point: it is
     * the number Section 1 of the customer's document prints under "Amount
     * financed", directly above a payment that has to divide into it.
     */
    ...(purchase ? { financedAmountCents: loanPrincipalCents } : {}),
    /**
     * The reconciliation, frozen. Read by exactly one block of the customer's
     * document and by the funder's submission summary; by nothing that computes
     * a payment, a saving or a rate.
     */
    ...(reconciliation
      ? {
          lenderAdjustment: {
            label: reconciliation.label,
            adjustmentCents: reconciliation.adjustmentCents,
            customerObligationCents: reconciliation.customerObligationCents,
            lenderContractValueCents: reconciliation.lenderContractValueCents,
            disclosure: reconciliation.disclosure,
          },
        }
      : {}),
    /**
     * THE ONE PAGE THAT SAYS WHAT THE HOUSEHOLD ACTUALLY PAYS, frozen.
     *
     * Statute moves and a company's percentages move with it; a document a
     * customer signed has to keep showing the ladder it was signed against.
     * Absent on every deal without a contract adjustment and on every document
     * generated before this existed — both of which render no such chapter.
     */
    ...(creditLadder ? { creditLadder } : {}),
    /**
     * The payment once the credits and the incentive are applied — the figure
     * the ladder's own page prints, and the one the household ends up on.
     *
     * Resolved through the SAME function as the headline payment, on a smaller
     * principal, so the two can never be derived two different ways. Null where
     * there is no ladder, no loan, or no terms to derive anything from.
     */
    ...(netMonthlyCents != null ? { netMonthlyPaymentCents: netMonthlyCents } : {}),
    // What the household ends up owning, in this partner's words. Absent leaves
    // the document's own sentence standing, which is what every proposal
    // generated before this key carries.
    ...(args.ownershipNote?.trim() ? { ownershipNote: args.ownershipNote.trim() } : {}),
    // Always null: no incentive is quoted, so nothing to record. Kept as
    // keys rather than dropped so older snapshots stay type-compatible.
    itcEstimateCents: null,
    itcPct: null,
    stateIncentiveNote: null,
  };

  // The one number the menu is read by. Three products reach it three ways, so
  // it is resolved once here rather than in the renderer.
  const year1 = savings.years[0];
  const monthlyCents =
    finance.product === "cash"
      ? null
      : finance.product === "loan"
        ? financing.loanMonthlyPaymentCents
        : finance.product === "lease"
          ? financing.monthlyPaymentCents
          : year1
            ? Math.round(year1.solarPaymentCents / 12)
            : null;

  return {
    financing,
    savings,
    monthlyCents,
    /**
     * The other side of the switch, or null where there is no switch.
     *
     * Frozen beside the first rather than derived on the page for exactly the
     * reason every other figure here is: a document that recomputes one of its
     * two answers in the browser is a document whose two answers can be made to
     * disagree by anyone with a developer console.
     */
    creditsApplied: creditsAppliedSavings
      ? {
          savings: creditsAppliedSavings,
          monthlyCents:
            finance.product === "cash"
              ? null
              : finance.product === "loan"
                ? (creditsAppliedMonthlyCents ?? financing.loanMonthlyPaymentCents)
                : monthlyCents,
          // The price the household lands on. `quotedPriceCents` is the ladder's
          // target: the customer's own obligation on a programme deal, and the
          // price itself where there is no second figure to reconcile.
          totalCents: creditLadder ? creditLadder.quotedPriceCents : null,
          // What the loan is carrying once the credits are against it — the
          // very principal `creditsAppliedMonthlyCents` was quoted on, so the
          // two divide into each other on the page.
          financedAmountCents: creditLadder
            ? creditLadder.netCostCents - (finance.downPaymentCents ?? 0)
            : null,
        }
      : null,
    // What still goes to the utility afterwards — grid power AND the standing
    // meter charge. Year one, because that is the year sitting next to the
    // customer's current bill. The same either way: a tax credit does not
    // change what the wires company bills.
    postSolarMonthlyCents: year1 ? Math.round(postSolarUtilityCents(year1) / 12) : 0,
  };
}
export function buildProposalSnapshot(args: {
  reference: string;
  generatedById: string | null;
  customer: { name: string; address: string };
  company: {
    name: string;
    phone: string | null;
    email: string | null;
    logoUrl: string | null;
    address?: string | null;
  };
  representative?: { name: string; phone: string | null; email: string | null } | null;
  design: {
    systemSizeKwDc: number;
    year1ProductionKwh: number;
    offsetPct: number;
    annualUsageKwh: number;
    moduleLabel: string | null;
    moduleQty: number;
    inverterLabel: string | null;
    batteryLabel: string | null;
    mountType: string;
    utilityProvider: string | null;
    avgMonthlyBillCents: number | null;
    /** The rate a rep was told, when there is one. See resolveUtilityRateMills. */
    utilityRateMills?: number | null;
    module?: SnapshotEquipment | null;
    inverter?: SnapshotEquipment | null;
    battery?: SnapshotEquipment | null;
    /** Twelve readings, Jan..Dec, kWh. Fewer than twelve omits the chart. */
    monthlyUsageKwh?: number[] | null;
    /** Twelve simulated months of production, Jan..Dec, kWh. */
    monthlyProductionKwh?: number[] | null;
  };
  layout?: { fileId: string; provider: string | null; externalRef: string | null; preliminary: boolean } | null;
  /** Where the house is, so the array can be drawn on its own roof. */
  site?: { lat: number; lng: number } | null;
  finance: ProposalFinanceInput;
  lender: string | null;
  /** The lender's mark at generation time. Null falls back to a monogram. */
  lenderLogoUrl?: string | null;
  /** The quoted product's payment factors, when its rate sheet publishes any. */
  loanFactors?: PaymentFactors | null;
  /** The lender's CUSTOMER application link. Never the dealer portal. */
  lenderApplyUrl?: string | null;
  /** The quoted rate-sheet row's own name, for the funder's paperwork. */
  lenderProductLabel?: string | null;
  /**
   * The quoted partner's programme contribution, as configured in Settings.
   *
   * Read at generation and reconciled here, so the three figures a household is
   * shown are frozen with everything else on the document. Editing the figure
   * in Settings tomorrow moves nothing already generated — the same trade every
   * other number in this snapshot makes.
   */
  contractAdjustment?: LenderContractAdjustment | null;
  /**
   * The federal credits, as the company states them and as this deal earns
   * them. Document-wide rather than per option: the statute does not change
   * between two rows of a payment menu, and neither does whether this roof
   * sits in an energy community. Which options SHOW a ladder is decided by
   * whether that option's partner carries a contract adjustment.
   */
  creditRates?: CreditRates | null;
  creditClaims?: CreditClaims | null;
  creditIncentiveLabel?: string | null;
  creditDisclaimer?: string | null;
  /** The quoted partner's ownership wording, where it publishes one. */
  ownershipNote?: string | null;
  /**
   * The other ways this customer may pay, already resolved and authorised by
   * the caller. Empty is the ordinary case and reads exactly as it always did.
   */
  alternatives?: ProposalAlternative[];
  /** How the quoted option reads in the menu. Ignored when there is no menu. */
  quotedLabel?: string;
  assumptions: SolarAssumptions;
  /** What the company claims an owned system adds to a home's value, %. */
  homeValueUpliftPct?: number | null;
  /** Which model produced the design's production figure, if not the average. */
  yieldBasis?: YieldBasis | null;
  /**
   * Battery programmes this customer qualifies for, already resolved against
   * the provider list and already multiplied by the battery count.
   *
   * Resolved by the CALLER rather than here, because eligibility is a database
   * question — which providers the deal names, what each one enrols, which
   * lender product it was quoted on — and this module prices what it is given.
   */
  vppCredits?: VppCredit[];
  /**
   * What this deal sells. Absent means `pv`, which is what every caller written
   * before storage existed is quoting.
   */
  systemType?: "pv" | "pv_storage" | "storage";
  /**
   * The storage argument, already resolved by the CALLER — the backup table
   * needs the company's profiles and the time-of-use figures need the
   * provider's rates, and both are database questions. This module prices and
   * freezes what it is given, exactly as it does with the VPP credits above.
   */
  storage?: SolarProposalSnapshot["storage"];
  now: Date;
}): SolarProposalSnapshot {
  const { design, finance, assumptions: a } = args;
  const vppCredits = (args.vppCredits ?? []).filter(
    (v) => v.annualCents > 0 || v.upfrontCents > 0
  );

  // Today's rate, derived from the customer's OWN bill. There is deliberately no
  // fallback: this used to default to 150 mills when the bill was missing, which
  // produced a confident 25-year savings projection built on a rate nobody had
  // ever seen. The readiness validator blocks generation when it cannot be
  // derived, so by the time we get here it is a real number.
  const currentRateMillsPerKwh = resolveUtilityRateMills(design) ?? 0;

  const systemType = args.systemType ?? "pv";

  const shared = {
    design: {
      systemSizeKwDc: design.systemSizeKwDc,
      year1ProductionKwh: design.year1ProductionKwh,
      annualUsageKwh: design.annualUsageKwh,
      // Read off the storage block rather than taken as a second argument: it
      // is the same count the backup table was built from, and two ways to say
      // how many batteries are on this job is one way for them to disagree.
      batteryQty: args.storage?.batteryQty ?? 0,
    },
    systemType,
    // Likewise the rebates: the lines the customer reads on the cost chapter
    // are the lines the contract was priced from, summed once, here.
    rebateTotalCents: (args.storage?.rebates ?? []).reduce((n, r) => n + r.totalCents, 0),
    assumptions: a,
    currentRateMillsPerKwh,
    vppCredits,
    creditRates: args.creditRates ?? null,
    creditClaims: args.creditClaims ?? null,
    creditIncentiveLabel: args.creditIncentiveLabel ?? null,
    creditDisclaimer: args.creditDisclaimer ?? null,
  };

  // The deal's own terms. This is the option the document is ABOUT: it stays at
  // `snapshot.financing` and `snapshot.savings`, where every renderer, every
  // older proposal and every test already expects it.
  const quoted = priceOption({
    ...shared,
    finance,
    lender: args.lender,
    lenderLogoUrl: args.lenderLogoUrl ?? null,
    lenderApplyUrl: args.lenderApplyUrl ?? null,
    loanFactors: args.loanFactors ?? null,
    lenderProductLabel: args.lenderProductLabel ?? null,
    contractAdjustment: args.contractAdjustment ?? null,
    ownershipNote: args.ownershipNote ?? null,
    now: args.now,
  });

  const lifetimeKwh = quoted.savings.years.reduce((n, y) => n + y.productionKwh, 0);

  /**
   * The menu, quoted option first.
   *
   * Deduplicated on `key` with the quoted one WINNING: a caller that offers the
   * catalogue row this deal was already quoted from must not put the same
   * programme in the list twice, and the copy that survives has to be the one
   * carrying the deal's own approved payment and down payment rather than the
   * rate sheet's generic terms.
   */
  const options: ProposalPaymentOption[] = [
    {
      key: quotedKey(finance),
      label: args.quotedLabel?.trim() || defaultOptionLabel(finance, args.lender),
      quoted: true,
      financing: quoted.financing,
      savings: quoted.savings,
      monthlyCents: quoted.monthlyCents,
      // Spread, not assigned null: a document with nothing to claim has no such
      // key, which is how every proposal generated before v8 already reads.
      ...(quoted.creditsApplied ? { creditsApplied: quoted.creditsApplied } : {}),
      postSolarMonthlyCents: quoted.postSolarMonthlyCents,
    },
  ];
  const seen = new Set([options[0].key]);
  for (const alt of args.alternatives ?? []) {
    if (seen.has(alt.key)) continue;
    /**
     * NO CASH ROW ON A DEAL QUOTED AGAINST A PARTNER'S CONTRACT VALUE.
     *
     * Every other row in the menu is compared by its MONTHLY, which is the
     * like-for-like figure; cash is the one row that shows a raw price, and on
     * a programme deal the two prices are not describing the same offer. The
     * loan quotes the partner's contract — $128,080, which the credits then
     * bring back down — while cash is priced at the company's own net rate,
     * $31,680. Printed on the same strip they read as a $96,400 mark-up for
     * borrowing, which is not what either figure means, and a homeowner has no
     * way to tell that from the page.
     *
     * Decided HERE rather than in `proposalAlternatives` because it turns on
     * the RESOLVED reconciliation — a programme that is switched off, still
     * misconfigured or not yet effective produces no adjustment and the cash
     * row belongs back on the menu. That answer only exists once the option has
     * been priced.
     */
    if (alt.finance.product === "cash" && quoted.financing.lenderAdjustment) continue;
    seen.add(alt.key);
    const priced = priceOption({
      ...shared,
      finance: alt.finance,
      lender: alt.lender,
      lenderLogoUrl: alt.lenderLogoUrl ?? null,
      lenderApplyUrl: alt.lenderApplyUrl ?? null,
      loanFactors: alt.loanFactors ?? null,
      lenderProductLabel: alt.lenderProductLabel ?? null,
      // Each option carries its OWN partner's programme, so a household
      // switching from Participate to a GoodLeap loan in the menu sees the
      // reconciliation disappear with the partner it belongs to.
      contractAdjustment: alt.contractAdjustment ?? null,
      ownershipNote: alt.ownershipNote ?? null,
      now: args.now,
    });
    options.push({
      key: alt.key,
      label: alt.label,
      quoted: false,
      financing: priced.financing,
      savings: priced.savings,
      monthlyCents: priced.monthlyCents,
      ...(priced.creditsApplied ? { creditsApplied: priced.creditsApplied } : {}),
      postSolarMonthlyCents: priced.postSolarMonthlyCents,
    });
  }

  /**
   * The shape of the year, but only when BOTH halves are real.
   *
   * Twelve simulated months against twelve measured ones is a comparison. Twelve
   * simulated months against an annual total spread evenly is a drawing of an
   * assumption, and a homeowner cannot tell the two apart by looking.
   */
  const monthlyUsage = twelve(design.monthlyUsageKwh);
  const monthlyProduction = twelve(design.monthlyProductionKwh);
  const monthly =
    monthlyUsage && monthlyProduction
      ? { productionKwh: monthlyProduction, usageKwh: monthlyUsage }
      : null;

  return {
    schemaVersion: 8,
    calculationVersion: PRICING_CALCULATION_VERSION,
    systemType,
    // Null on anything that is not a storage deal, so a PV document cannot
    // inherit a block that would make it argue two ways at once.
    storage: systemType === "storage" ? (args.storage ?? null) : null,
    generatedAt: args.now.toISOString(),
    generatedById: args.generatedById,
    reference: args.reference,
    customer: args.customer,
    company: {
      name: args.company.name,
      phone: args.company.phone,
      email: args.company.email,
      logoUrl: args.company.logoUrl,
      address: args.company.address ?? null,
    },
    representative: args.representative ?? null,
    energy: {
      utilityProvider: design.utilityProvider,
      ratePlan: null,
      annualUsageKwh: design.annualUsageKwh,
      avgMonthlyBillCents: design.avgMonthlyBillCents,
      // usage × today's rate. Null rather than 0 when the rate is unknown, so
      // the renderer omits the line instead of printing "$0 a year".
      currentAnnualCostCents:
        currentRateMillsPerKwh > 0
          ? Math.round((design.annualUsageKwh * currentRateMillsPerKwh) / 10)
          : null,
    },
    system: {
      sizeKwDc: design.systemSizeKwDc,
      year1ProductionKwh: design.year1ProductionKwh,
      offsetPct: design.offsetPct,
      moduleLabel: design.moduleLabel,
      moduleQty: design.moduleQty,
      inverterLabel: design.inverterLabel,
      batteryLabel: design.batteryLabel,
      mountType: design.mountType,
      utilityProvider: design.utilityProvider,
      // Historical, like tsrfPct — see the snapshot type.
      netMeteringProgram: null,
      tsrfPct: null,
      module: design.module ?? null,
      inverter: design.inverter ?? null,
      battery: design.battery ?? null,
    },
    layout: args.layout ?? null,
    site: args.site ?? null,
    financing: quoted.financing,
    savings: quoted.savings,
    // Spread, not assigned an empty array: a document priced without a
    // programme has no such key, and the renderer prints nothing rather than
    // an empty "battery programme" heading.
    ...(vppCredits.length > 0 ? { vpp: vppCredits } : {}),
    options,
    monthly,
    environmental: environmentalImpact(lifetimeKwh),
    // Spread, not assigned null: the snapshot is asserted to hold no undefined
    // and an older document simply has no such key.
    assumptions: {
      ...a,
      currentRateMillsPerKwh,
      productionMarginPct: PRODUCTION_MARGIN_PCT,
      ...(args.yieldBasis ? { yieldBasis: args.yieldBasis } : {}),
      ...(args.homeValueUpliftPct && args.homeValueUpliftPct > 0
        ? { homeValueUpliftPct: args.homeValueUpliftPct }
        : {}),
    },
    disclaimers: { estimate: ESTIMATE_DISCLAIMER },
  };
}

/**
 * Twelve real readings, or nothing.
 *
 * A partly-filled year is not a year: eight months of usage padded to twelve
 * draws four months the customer never used, in a chart whose entire claim is
 * that it is their own bill.
 */
function twelve(v: number[] | null | undefined): number[] | null {
  if (!Array.isArray(v) || v.length !== 12) return null;
  if (!v.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) return null;
  if (v.every((n) => n === 0)) return null;
  return v.map((n) => Math.round(n));
}

/**
 * The quoted option's key.
 *
 * Cash is always "cash" — there is only one way to pay in full. Anything with a
 * lender is keyed by product and lender name, which is what an alternative
 * built from the same rate sheet will collide with, and colliding is the point:
 * the deal's own terms must win over the catalogue's.
 */
function quotedKey(f: ProposalFinanceInput): string {
  return f.product === "cash" ? "cash" : `quoted:${f.product}`;
}

/** How an option reads when the caller gave it no name of its own. */
function defaultOptionLabel(f: ProposalFinanceInput, lender: string | null): string {
  if (f.product === "cash") return "Pay in full";
  const bits = [lender?.trim() || PRODUCT_NOUN[f.product]];
  if (f.product === "loan") {
    if (f.loanTermMonths) bits.push(`${Math.round(f.loanTermMonths / 12)} yr`);
    if (f.aprPct != null) bits.push(`${Number(f.aprPct.toFixed(2))}%`);
  } else {
    if (f.termYears) bits.push(`${f.termYears} yr`);
    if (f.escalatorPct != null) bits.push(`${Number(f.escalatorPct.toFixed(2))}% a year`);
  }
  return bits.join(" · ");
}

const PRODUCT_NOUN: Record<FinanceProduct, string> = {
  cash: "Pay in full",
  loan: "Monthly payments",
  lease: "Lease",
  ppa: "Power purchase",
};

/**
 * DOES THIS FROZEN DOCUMENT CARRY THE TAX-CREDIT SWITCH?
 *
 * One definition, because three places answer it and they must agree: the
 * document itself (which renders the control), the filing (which files a copy
 * per reading), and the version row on the deal (which says whether both copies
 * are there yet). Two of them disagreeing shows up as a row that reports a
 * missing par copy forever, on a proposal that was never going to have one.
 *
 * Two conditions. The option the document opens on has to carry a second,
 * credits-applied scenario — absent on a lease, a PPA, a company that quotes no
 * credits, and every proposal generated before both scenarios were frozen. And
 * it must not be the battery-only deck, which is a different document with no
 * switch on it, whatever its snapshot happens to hold.
 *
 * Takes `unknown` on purpose: every caller is reading a Prisma `Json` column.
 */
export function hasCreditSwitch(snapshot: unknown): boolean {
  const s = snapshot as
    | { systemType?: string; options?: { creditsApplied?: unknown }[] }
    | null
    | undefined;
  if (!s || s.systemType === "storage") return false;
  return s.options?.[0]?.creditsApplied != null;
}
