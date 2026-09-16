/**
 * What the extra work on a solar job costs, and what it does to the price.
 *
 * An adder used to be a single number a rep typed into a box: "Adders $". That
 * box is why this module exists. It cannot be checked against anything, it
 * cannot say WHAT the money is for, and it silently goes stale — a $0.05/W
 * steep-roof charge is right for the 8 kW system it was typed on and wrong for
 * the 12 kW one the roof turned out to hold, with nothing on screen to say so.
 *
 * So an adder is a LINE now, and the total is derived from the lines.
 *
 * SIX WAYS TO PRICE ONE, because all six are real:
 *   - `flat`     — a catalogue price. A main panel upgrade is $2,700 whatever
 *                  the system size. ("Fixed" on screen.)
 *   - `perUnit`  — an amount times a count the rep enters. Attic runs, extra
 *                  optimisers, critter guard by the panel.
 *   - `perFoot`  — a rate times a length. Trenching is $10 a foot and the job
 *                  is 120 feet; one number cannot say that.
 *   - `perWatt`  — scales with the array. Steep-roof and small-system charges
 *                  are quoted this way, and they MUST follow the design: this is
 *                  the case the typed box got wrong every time the array changed.
 *   - `custom`   — a one-off the rep prices on the day. Still a line, still
 *                  labelled, still visible on the breakdown.
 *   - `discount` — money that comes OFF. Stored POSITIVE and negated when it is
 *                  priced, so the amount in the column is the amount somebody
 *                  typed, and a breakdown reading "-$1,000" is doing so because
 *                  of the BASIS rather than because of a minus sign nobody can
 *                  see in the database.
 *
 * UNITS, which are the thing to get wrong here: money is CENTS, and a per-watt
 * rate is MILLS PER WATT — tenths of a cent — because $0.05/W is five cents and
 * a rate of "5" in a cents column reading as $5.00/W is a 100x error on a line
 * nobody re-reads. The two live in separate columns for the same reason: one
 * number whose meaning depends on a sibling enum is a number that eventually
 * gets read with the wrong meaning.
 */

/** How a line works out its money. Mirrors the Prisma enum of the same name. */
export type AdderBasis = "flat" | "perUnit" | "perFoot" | "perWatt" | "custom" | "discount";

/**
 * Everything about a basis that a screen or a sum needs to know, in one table.
 *
 * The alternative is the same `switch` written out in the settings form, the
 * deal panel, the picker and the pricing function — four places that have to
 * agree about whether "per foot" has a quantity, and three that will not be
 * touched the day a seventh basis arrives.
 */
export const ADDER_BASES = {
  flat:     { label: "Fixed",    unit: null,     rate: false, counted: false, sign: 1 },
  perUnit:  { label: "Per Unit", unit: "unit",   rate: false, counted: true,  sign: 1 },
  perFoot:  { label: "Per Feet", unit: "ft",     rate: true,  counted: true,  sign: 1 },
  perWatt:  { label: "Per Watt", unit: "W",      rate: true,  counted: false, sign: 1 },
  custom:   { label: "Custom",   unit: null,     rate: false, counted: false, sign: 1 },
  discount: { label: "Discount", unit: null,     rate: false, counted: false, sign: -1 },
} as const satisfies Record<
  AdderBasis,
  {
    /** What it is called on screen. */
    label: string;
    /** The thing the price is per, if it is per anything. */
    unit: string | null;
    /** True when the stored amount is a RATE rather than a total. */
    rate: boolean;
    /** True when the rep enters a count — units, feet — that multiplies it. */
    counted: boolean;
    /** Which way the money goes. Only a discount comes off. */
    sign: 1 | -1;
  }
>;

/** The six, in the order a rep should be offered them. */
export const ADDER_BASIS_ORDER = [
  "perFoot",
  "perWatt",
  "perUnit",
  "flat",
  "custom",
  "discount",
] as const satisfies readonly AdderBasis[];

/** Whether a string off the wire is one of ours, for narrowing. */
export function isAdderBasis(v: unknown): v is AdderBasis {
  return typeof v === "string" && v in ADDER_BASES;
}

export type AdderLine = {
  id: string;
  label: string;
  basis: AdderBasis;
  /**
   * The money column. Its meaning depends on the basis, which is why the basis
   * is stored rather than guessed:
   *   `flat` / `custom` / `discount` — the whole amount, cents.
   *   `perUnit`                      — the amount for ONE, cents.
   *   `perFoot`                      — the amount for one FOOT, cents.
   *   `perWatt`                      — null; the rate lives in `millsPerWatt`.
   */
  flatCents: number | null;
  /** `perWatt`: tenths of a cent per installed watt. 50 = $0.05/W. */
  millsPerWatt: number | null;
  /** Units on `perUnit`, feet on `perFoot`, otherwise 1. */
  qty: number;
  /**
   * This work is added to the loan ON TOP of a partner's fixed or maximum
   * final $/W — the re-roof on Amos's flat $5.50/W paper — still grossed up by the dealer fee.
   *
   * Optional so that a caller assembling a line by hand cannot forget it into
   * being true; absent reads as false, which is the rule every adder followed
   * before this existed. See `capStickerToFinalPpw` for what it does to a price.
   */
  outsidePriceRule?: boolean;
};

/** Mills per watt → dollars per watt, for display. 50 → 0.05. */
export function millsPerWattToDollars(mills: number): number {
  return mills / 1000;
}

/** $0.05/W → 50 mills. The inverse, for reading a typed rate. */
export function dollarsToMillsPerWatt(dollars: number): number {
  return Math.round(dollars * 1000);
}

/**
 * The basis a CATALOGUE row is priced on, with the pre-column rule as the
 * fallback.
 *
 * `adderBasis` was added after the catalogue already had adders in it, and the
 * rule those rows were being priced by is written here rather than left implied
 * by a null: a per-watt rate makes it per-watt, everything else is a flat
 * amount. The migration backfills the column, so this is the belt to that
 * brace — and the one place either half is decided.
 */
export function catalogueBasis(item: {
  adderBasis: string | null;
  priceMillsPerWatt: number | null;
}): AdderBasis {
  if (isAdderBasis(item.adderBasis)) return item.adderBasis;
  return item.priceMillsPerWatt != null ? "perWatt" : "flat";
}

/**
 * Whether a system of this size falls in an auto-apply band.
 *
 * MINIMUM INCLUSIVE, MAXIMUM EXCLUSIVE, so bands written back to back — under
 * 5, then 5 to 8 — cannot both fire on a system that is exactly 5 kW and put
 * two charges on the same deal for the same reason.
 */
export function inAutoApplyBand(
  systemKwDc: number,
  rule: { autoApplyMinKw: number | null; autoApplyMaxKw: number | null }
): boolean {
  // Nothing drawn is not "a small system" — it is a design nobody has started,
  // and putting a small-system charge on it would price a roof sight unseen.
  if (!(systemKwDc > 0)) return false;
  if (rule.autoApplyMinKw != null && systemKwDc < rule.autoApplyMinKw) return false;
  if (rule.autoApplyMaxKw != null && systemKwDc >= rule.autoApplyMaxKw) return false;
  return true;
}

/**
 * What one line costs on a system of this size.
 *
 * `systemWatts` is DC watts as drawn — the same figure the price per watt is
 * multiplied by — so a per-watt adder and the base price scale together. A
 * negative or absent size prices per-watt lines at zero rather than at a
 * negative amount: a system with no panels on it has no steep roof to charge
 * for yet.
 */
export function adderAmountCents(line: AdderLine, systemWatts: number): number {
  const qty = Number.isFinite(line.qty) && line.qty > 0 ? Math.floor(line.qty) : 1;
  const sign = ADDER_BASES[line.basis]?.sign ?? 1;

  if (line.basis === "perWatt") {
    const mills = line.millsPerWatt;
    if (mills == null || !Number.isFinite(mills)) return 0;
    if (!(systemWatts > 0)) return 0;
    // mills → cents is a divide by ten, done ONCE and at the end, so a rate
    // that is not a whole number of cents per watt does not lose its fraction
    // on every watt.
    return Math.round((mills * systemWatts * qty) / 10);
  }

  const cents = line.flatCents;
  if (cents == null || !Number.isFinite(cents)) return 0;
  // A discount is stored positive and comes off HERE, once, at the only place
  // that turns a line into money. Storing it negative would mean every screen
  // that shows an amount has to remember not to put a minus in front of it.
  return sign * Math.round(cents) * qty;
}

/**
 * What this line does to the household's yearly consumption, kWh.
 *
 * Scales with the count, because two EV chargers draw twice what one does, and
 * a rep who enters `qty 2` on a per-unit charger adder has said exactly that.
 * Everything without an adjustment returns zero rather than null: this is
 * summed, and a null in a sum is a bug waiting for a `??`.
 */
export function adderConsumptionKwh(
  line: Pick<AdderLine, "basis" | "qty"> & { consumptionKwhPerYear?: number | null }
): number {
  const kwh = line.consumptionKwhPerYear;
  if (kwh == null || !Number.isFinite(kwh)) return 0;
  const counted = ADDER_BASES[line.basis]?.counted ?? false;
  const qty = counted && Number.isFinite(line.qty) && line.qty > 0 ? Math.floor(line.qty) : 1;
  return Math.round(kwh * qty);
}

export type AdderTotals<L extends AdderLine = AdderLine> = {
  lines: (L & { amountCents: number })[];
  /** Every line, whichever side of the partner's price it falls. */
  totalCents: number;
  /**
   * The lines that sit INSIDE the partner's price: they gross up by the dealer
   * fee and, under a ceiling, come out of the system's share of it.
   *
   * This is the figure pricing wants — `PurchaseInput.adderTotalCents` and the
   * `SolarFinance` column of the same name both mean this one, not the total.
   */
  financedInCents: number;
  /**
   * The lines financed ON TOP of the partner's price, at their own price.
   * `PurchaseInput.onTopAdderTotalCents`.
   */
  onTopCents: number;
  /**
   * The adders expressed per installed watt, cents.
   *
   * The figure that goes between base PPW and final PPW on the pricing
   * breakdown, and the reason a rep can see at a glance that a $14,500 re-roof
   * has moved the job by seventy cents a watt. ALL of them: this is what the
   * extra work on the job comes to, not what one side of the fee comes to.
   */
  ppwCents: number;
};

/**
 * Every line priced, plus what they come to. The one place that sums them.
 *
 * Generic in the line so a caller's own row type survives — the deal panel's
 * rows carry a description, a consumption figure and whether a rule put them
 * there, and widening them to the bare `AdderLine` here would strip all three
 * off the very list the screen renders.
 */
export function adderTotals<L extends AdderLine>(
  lines: L[],
  systemWatts: number
): AdderTotals<L> {
  const priced = lines.map((l) => ({ ...l, amountCents: adderAmountCents(l, systemWatts) }));
  const totalCents = priced.reduce((n, l) => n + l.amountCents, 0);
  // Split HERE rather than at each call site, because the two halves are priced
  // by different rules and a caller that sums them itself is one `filter` away
  // from putting a roof inside a ceiling it is supposed to sit on top of.
  const onTopCents = priced.reduce((n, l) => n + (l.outsidePriceRule ? l.amountCents : 0), 0);
  return {
    lines: priced,
    totalCents,
    financedInCents: totalCents - onTopCents,
    onTopCents,
    // Not rounded to the cent: this is a rate, and rounding it here before it is
    // added to a base rate is how a breakdown stops adding up on screen.
    ppwCents: systemWatts > 0 ? totalCents / systemWatts : 0,
  };
}

/**
 * How a line reads on a rate sheet: "$2,700" or "$0.05/W".
 *
 * Deliberately NOT the resolved amount — this is the RULE, and a rep comparing
 * two steep-roof charges needs to see the rate rather than two dollar figures
 * that differ only because the systems do.
 */
export function adderRateLabel(line: Pick<AdderLine, "basis" | "flatCents" | "millsPerWatt">): string {
  if (line.basis === "perWatt") {
    const mills = line.millsPerWatt ?? 0;
    return `$${millsPerWattToDollars(mills).toFixed(3).replace(/0$/, "")}/W`;
  }
  const cents = line.flatCents ?? 0;
  const money = `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (line.basis === "perFoot") return `${money}/ft`;
  if (line.basis === "perUnit") return `${money} each`;
  // The minus belongs on the RATE, where it is the whole point of the line. A
  // credit shown as "$1,000" beside "Discount" reads as a charge to anybody
  // skimming, which on a price breakdown is the wrong way round to be wrong.
  if (line.basis === "discount") return `−${money}`;
  return money;
}

/**
 * What the rep is being asked to count: "Feet", "Units", or nothing.
 *
 * Returned as the WORD rather than a boolean because every screen that offers
 * the box also has to label it, and "Qty" over a trenching run is how 120 feet
 * gets typed as 120 trenches.
 */
/**
 * What the price a rep types is PER, for the suffix beside the box: "/ft",
 * "/W", " each", or nothing at all.
 *
 * Separate from `adderRateLabel` on purpose. That renders the whole rule as one
 * read-only string — "$15/ft" — which is right beside a figure nobody can
 * change and wrong beside an input, where the dollars are already in the box
 * and only the unit is still missing.
 */
export function adderPriceUnit(basis: AdderBasis): string | null {
  if (basis === "perFoot") return "/ft";
  if (basis === "perWatt") return "/W";
  if (basis === "perUnit") return "each";
  return null;
}

export function adderCountLabel(basis: AdderBasis): string | null {
  if (basis === "perFoot") return "Feet";
  if (basis === "perUnit") return "Units";
  return null;
}
