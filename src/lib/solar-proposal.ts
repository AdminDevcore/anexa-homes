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
 * How solar works, in five steps, before any number is shown.
 *
 * The document opens on the money because that is what a homeowner asked for.
 * This sits after it, for the half of them reading it alone at ten at night who
 * have never had anyone explain what an inverter is and are not going to ask.
 *
 * Deliberately generic: it describes solar, not this system, so nothing here
 * can go stale against a design or contradict a figure elsewhere on the page.
 */
export const SOLAR_HOW_IT_WORKS = [
  {
    key: "panels",
    title: "The panels",
    blurb:
      "Sunlight knocks electrons loose inside each panel. That flow of electrons is electricity — no moving parts, no fuel, nothing to refill.",
  },
  {
    key: "inverter",
    title: "The inverter",
    blurb:
      "Panels make DC power and your house runs on AC. The inverter converts one into the other, and it is what monitors the system for faults.",
  },
  {
    key: "house",
    title: "Your house first",
    blurb:
      "Everything the system makes goes to your own appliances before anything else happens. You are not buying that power from anybody.",
  },
  {
    key: "grid",
    title: "The grid, both ways",
    blurb:
      "Make more than you use and the surplus goes out to the grid for credit. Make less — at night, in December — and you buy the difference as you always have.",
  },
  {
    key: "bill",
    title: "The bill",
    blurb:
      "You stay connected and you keep an account. What changes is how much of it you are paying for, which is the whole of what this document is about.",
  },
] as const;

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
  /** residualGrid + meterFee + solarPayment − vppCredit. The solar path, this year. */
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
  /** First year in which cumulative savings turn positive; null if never. */
  paybackYear: number | null;
};

/**
 * 25-year utility-vs-solar comparison.
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
  } | null;
}): SavingsModel {
  const a = args.assumptions;
  const horizon = args.years ?? 25;
  const rows: SavingsYear[] = [];
  let cumulative = 0;
  let utilityTotal = 0;
  let residualTotal = 0;
  let solarPaidCents = 0;
  let vppCreditTotalCents = 0;
  let paybackYear: number | null = null;

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
        solarPaymentCents = loanMonthlyCents * monthsPaid + (year === 1 ? loanDownCents : 0);
      } else if (year === 1) {
        // Bought outright — or financed on terms this document could not
        // resolve — so year one carries the contract price and later years
        // carry nothing.
        solarPaymentCents = args.purchase?.contractPriceCents ?? 0;
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

    const solarCostCents = postSolarUtility + solarPaymentCents - vppCredit;
    cumulative += utilityCostCents - solarCostCents;
    utilityTotal += utilityCostCents;
    residualTotal += postSolarUtility;
    solarPaidCents += solarPaymentCents;
    vppCreditTotalCents += vppCredit;
    if (paybackYear === null && cumulative > 0) paybackYear = year;

    rows.push({
      year,
      productionKwh: Math.round(production),
      utilityCostCents,
      residualGridCents,
      meterFeeCents,
      solarPaymentCents,
      vppCreditCents: vppCredit,
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
   * Legacy incentive fields. No credit is quoted anywhere in the product, so
   * these are always null on anything generated now; the keys stay so that
   * proposals issued while incentives existed still parse and render.
   */
  itcEstimateCents: number | null;
  itcPct: number | null;
  stateIncentiveNote: string | null;
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
   * What the customer still pays the utility each month afterwards: the grid
   * power the system does not cover, PLUS the utility's fixed meter charge —
   * which is billed at full offset exactly as it is billed at half.
   */
  postSolarMonthlyCents: number;
};

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
   */
  schemaVersion: 1 | 2 | 3 | 4 | 5;
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
   * What a payment factor gets applied to: the contract price less anything the
   * customer puts down. Never the gross — a down payment is not borrowed, and
   * applying the factor to it quotes a payment on money nobody owes.
   */
  const loanPrincipalCents =
    (purchase?.contractPriceCents ?? 0) - (finance.downPaymentCents ?? 0);
  const loanFactorQuote =
    finance.product === "loan" && args.loanFactors && hasPaymentFactor(args.loanFactors)
      ? factorQuote(args.loanFactors, loanPrincipalCents)
      : null;

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
  const loanMonthlyCents =
    finance.product === "loan"
      ? (finance.loanMonthlyPaymentCents ??
        (loanFactorQuote && factorMonthlyCents(loanFactorQuote)) ??
        loanPaymentCents({
          principalCents: loanPrincipalCents,
          aprPct: finance.aprPct,
          termMonths: finance.loanTermMonths ?? null,
        }) ??
        null)
      : null;

  const savings = savingsModel({
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
    vppCredits: args.vppCredits,
    // A financed system is paid for monthly, so the years carry the payments
    // rather than the price. Both halves or neither — see `savingsModel`.
    loan:
      finance.product === "loan"
        ? {
            monthlyPaymentCents: loanMonthlyCents,
            termMonths: finance.loanTermMonths ?? null,
            downPaymentCents: finance.downPaymentCents ?? 0,
          }
        : null,
  });

  const financing: SnapshotFinancing = {
    product: finance.product,
    contractPriceCents: purchase?.contractPriceCents ?? null,
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
    finalPpwCents: purchase && !isStorage ? Math.round(purchase.finalPpwCents) : null,
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
    // What still goes to the utility afterwards — grid power AND the standing
    // meter charge. Year one, because that is the year sitting next to the
    // customer's current bill.
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
      postSolarMonthlyCents: quoted.postSolarMonthlyCents,
    },
  ];
  const seen = new Set([options[0].key]);
  for (const alt of args.alternatives ?? []) {
    if (seen.has(alt.key)) continue;
    seen.add(alt.key);
    const priced = priceOption({
      ...shared,
      finance: alt.finance,
      lender: alt.lender,
      lenderLogoUrl: alt.lenderLogoUrl ?? null,
      lenderApplyUrl: alt.lenderApplyUrl ?? null,
      loanFactors: alt.loanFactors ?? null,
    });
    options.push({
      key: alt.key,
      label: alt.label,
      quoted: false,
      financing: priced.financing,
      savings: priced.savings,
      monthlyCents: priced.monthlyCents,
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
    schemaVersion: 5,
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
