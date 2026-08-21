/**
 * How the customer-facing proposal writes numbers.
 *
 * Shared by the document and every panel inside it, because the alternative is
 * two formatters and therefore two answers: a payment card reading "$362" beside
 * a table reading "$361.50" is a question a homeowner asks, and neither figure
 * is wrong.
 */

/**
 * Money, always from cents. `maximumFractionDigits: 0` on the big numbers so a
 * 25-year projection does not read as false precision to the cent.
 */
export const usd = (cents: number, digits = 0) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });

export const kwh = (n: number) => `${Math.round(n).toLocaleString()} kWh`;

/**
 * Money for a chart axis, where the exact figure is stated in words below the
 * plot and only the SCALE has to survive being 10px wide on a phone.
 */
export const usdCompact = (cents: number) => {
  const d = Math.round(cents / 100);
  return d >= 1000 ? `$${Math.round(d / 1000)}k` : `$${d}`;
};

/**
 * Percentages a homeowner reads. Whole numbers unless the value genuinely has a
 * fraction — "2.9%" must not become "3%", and "87.0%" must not appear at all.
 */
export const pct = (n: number) => `${Number(n.toFixed(2))}%`;

/**
 * The offset, as a HEADLINE.
 *
 * "71.97% of what your home uses" is false precision on a 25-year projection
 * and reads like a machine talking. The two decimals stay everywhere the number
 * is an assumption being audited; the sentence a homeowner reads gets "72%".
 */
export const pctWhole = (n: number) => `${Math.round(n)}%`;

/** "$3.50/W" from cents per watt. */
export const ppw = (cents: number) => `$${(cents / 100).toFixed(2)}/W`;

/** "$0.145 per kWh" from mills. Three decimals, because mills are tenths of a cent. */
export const perKwh = (mills: number) => `$${(mills / 1000).toFixed(3)} per kWh`;

export const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;
