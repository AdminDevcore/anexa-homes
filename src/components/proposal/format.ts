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

/**
 * A count of years, spelled out, for a chapter title.
 *
 * "Twenty-five years, both ways" was a string in the source until the
 * comparison horizon started following the loan term; on a thirty-year
 * programme it then titled a thirty-year table as twenty-five. Digits would
 * have been the easy fix and the wrong one — every other chapter title on the
 * document is a sentence, and "30 years, both ways" reads like a spreadsheet
 * tab in the middle of them.
 *
 * Only the range a horizon can actually take (see `savingsHorizonYears`), and
 * anything outside it falls back to the numeral rather than to a wrong word.
 */
const YEAR_WORDS: Record<number, string> = {
  25: "Twenty-five",
  26: "Twenty-six",
  27: "Twenty-seven",
  28: "Twenty-eight",
  29: "Twenty-nine",
  30: "Thirty",
  31: "Thirty-one",
  32: "Thirty-two",
  33: "Thirty-three",
  34: "Thirty-four",
  35: "Thirty-five",
  36: "Thirty-six",
  37: "Thirty-seven",
  38: "Thirty-eight",
  39: "Thirty-nine",
  40: "Forty",
};

export const yearsInWords = (n: number) => YEAR_WORDS[n] ?? String(n);
