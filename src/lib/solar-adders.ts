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
 * THREE WAYS TO PRICE ONE, because all three are real:
 *   - `flat`    — a catalogue price. A main panel upgrade is $2,700 whatever
 *                 the system size.
 *   - `perWatt` — scales with the array. Steep-roof and small-system charges
 *                 are quoted this way, and they MUST follow the design: this is
 *                 the case the typed box got wrong every time the array changed.
 *   - `custom`  — a one-off the rep prices on the day. Still a line, still
 *                 labelled, still visible on the breakdown.
 *
 * UNITS, which are the thing to get wrong here: money is CENTS, and a per-watt
 * rate is MILLS PER WATT — tenths of a cent — because $0.05/W is five cents and
 * a rate of "5" in a cents column reading as $5.00/W is a 100x error on a line
 * nobody re-reads. The two live in separate columns for the same reason: one
 * number whose meaning depends on a sibling enum is a number that eventually
 * gets read with the wrong meaning.
 */

/** How a line works out its money. Mirrors the Prisma enum of the same name. */
export type AdderBasis = "flat" | "perWatt" | "custom";

export type AdderLine = {
  id: string;
  label: string;
  basis: AdderBasis;
  /** `flat` and `custom`: the whole amount, cents. Null on `perWatt`. */
  flatCents: number | null;
  /** `perWatt`: tenths of a cent per installed watt. 50 = $0.05/W. */
  millsPerWatt: number | null;
  qty: number;
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
  return Math.round(cents) * qty;
}

export type AdderTotals = {
  lines: (AdderLine & { amountCents: number })[];
  totalCents: number;
  /**
   * The adders expressed per installed watt, cents.
   *
   * The figure that goes between base PPW and final PPW on the pricing
   * breakdown, and the reason a rep can see at a glance that a $14,500 re-roof
   * has moved the job by seventy cents a watt.
   */
  ppwCents: number;
};

/** Every line priced, plus what they come to. The one place that sums them. */
export function adderTotals(lines: AdderLine[], systemWatts: number): AdderTotals {
  const priced = lines.map((l) => ({ ...l, amountCents: adderAmountCents(l, systemWatts) }));
  const totalCents = priced.reduce((n, l) => n + l.amountCents, 0);
  return {
    lines: priced,
    totalCents,
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
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
