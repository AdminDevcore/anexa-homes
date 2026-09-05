/**
 * Guessing which of a lender's catalogue entries is the item we sell.
 *
 * A SUGGESTION AND NEVER A DECISION. Nothing here reaches a lender: it fills a
 * dropdown in Settings that an admin confirms and saves, and the submission
 * reads only what was saved. That boundary is the whole safety argument for
 * having a heuristic at all — a wrong guess costs somebody a glance, where a
 * wrong SUBMISSION puts a panel the customer is not getting onto a real credit
 * application.
 *
 * Which is why it returns null so readily. It is trying to be right or silent,
 * not helpful. Every rule below is a convention their catalogue actually
 * follows — a marketing prefix, a part number in parentheses, an `xxx` where a
 * wattage goes — and none of them is a similarity score. A fuzzy match returns
 * an answer for two products that merely look alike, which is the one outcome
 * this file may not produce.
 */

/** One line of a partner's approved-vendor list, in their words. */
export type PartnerItem = {
  kind: "panel" | "inverter" | "battery" | "racking";
  brand: string;
  model: string;
};

/** Our own catalogue item, with the two halves kept apart. */
export type OurItem = {
  kind: PartnerItem["kind"];
  manufacturer: string | null;
  model: string;
};

/**
 * Comparable form: lowercase, and everything that is not a letter or a digit
 * removed.
 *
 * The gap between the two catalogues is largely punctuation — "ML-G10.C+"
 * against "ML G10.C+", "SIL440-QD-DCA2" against "SIL440QD-DCA2" — and a
 * trailing wattage. Flattening the first leaves the second as the only
 * remaining difference, and therefore as the only thing to reason about.
 */
export const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Same brand if either name contains the other: "REC" is inside "REC Group". */
export function sameBrand(a: string, b: string): boolean {
  const [x, y] = [normalise(a), normalise(b)];
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * Nothing shorter than this may be the thing two names agree on.
 *
 * Without a floor, a three-character fragment shared by half a catalogue makes
 * every row look like a match, and which row wins is then decided by the
 * tie-break rather than by any real agreement.
 */
const MIN_SIGNIFICANT = 4;

/**
 * The distinct strings one of their entries can be recognised by.
 *
 * Their list writes a DISPLAY name where ours writes a SKU, and it does so in
 * three shapes, all of which appear in Amos's live catalogue:
 *
 *   family, ours adds a wattage   "Q.PEAK DUO BLK ML G10.C+"
 *   part number in parentheses    "PRIME DCA2 (SIL440QD-DCA2)"
 *   marketing prefix, code last   "Nexis Inverter UNX13000T-00UCY"
 *
 * So the whole string, each parenthesised group, what is left outside them,
 * and the final token are each treated as a name the entry answers to.
 */
function recognisableAs(model: string): string[] {
  const keys = new Set<string>();
  const add = (s: string) => {
    const n = normalise(s);
    if (n.length >= MIN_SIGNIFICANT) keys.add(n);
  };

  add(model);
  for (const m of model.matchAll(/\(([^)]*)\)/g)) add(m[1]);

  const outside = model.replace(/\([^)]*\)/g, " ").trim();
  add(outside);

  /**
   * The last token, but only when it carries a digit.
   *
   * That is what separates a model code from the marketing word in front of
   * it — "Nexis Inverter UNX13000T-00UCY" ends in a code, "PV Standalone
   * Inverter (…)" ends in the word "Inverter", and our own catalogue contains
   * a Tesla row whose entire model is the word "Inverter". Without the digit
   * the two would agree perfectly on nothing at all.
   */
  const tokens = outside.split(/\s+/).filter(Boolean);
  const last = tokens.length > 1 ? tokens[tokens.length - 1] : null;
  if (last && /\d/.test(last)) add(last);

  return [...keys];
}

/**
 * How much of one of their names agrees with ours, in characters.
 *
 * Containment either way, plus their `xxx` convention: they stand a run of x's
 * where the varying part of a part number goes — "RECxxxAA Pure-RX-DC" covers
 * our REC450AA, REC460AA and REC470AA; "TSP-4xx" covers the whole Tesla panel
 * line. A run of TWO OR MORE is required, because a single x is a letter that
 * appears in real model codes.
 *
 * The agreement is the length of the SHORTER side, never of their key. That
 * distinction is the difference between a match and a coincidence: our Tesla
 * row literally called "Inverter" is contained in their "PV Standalone
 * Inverter", and crediting that with twenty characters would rank a generic
 * word above a real part number.
 */
function agreement(key: string, mine: string): number {
  if (key.includes(mine) || mine.includes(key)) return Math.min(key.length, mine.length);

  if (/xx+/.test(key)) {
    const pattern = key
      .split(/x{2,}/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[a-z0-9]{1,6}");
    if (new RegExp(`^${pattern}$`).test(mine)) return Math.min(key.length, mine.length);
  }

  return 0;
}

/**
 * How much of each name the agreement has to cover before it counts.
 *
 * Two thresholds, because the two names are unequal by construction: theirs is
 * a display name and ours is a SKU that also carries a wattage their family
 * name omits. So the agreed part must be MOST of their name, and a decent
 * fraction of ours.
 *
 * These are what stop the two false positives the live catalogues produce:
 * our "SIL530-XM-DCA2" agreeing with their "PRIME DCA2" on the four characters
 * "dca2" — a genuinely different panel — and the "Inverter" row above.
 */
const MIN_SHARE_OF_THEIRS = 0.5;
const MIN_SHARE_OF_OURS = 0.4;

/**
 * Our item's match on their list, or null when it is not clear-cut.
 *
 * Candidates are same-kind, same-brand entries with a key that agrees with our
 * model. Among those, THE LONGEST agreeing key wins: "Q.PEAK DUO BLK ML G10.C+"
 * beats "Q.PEAK DUO BLK ML-G10+" for our "Q.PEAK DUO BLK ML-G10.C+ 405",
 * because it agrees with more of it.
 *
 * A TIE RETURNS NULL. Two of their products fitting ours equally well means
 * the thing that distinguishes them is not in our name at all, so there is
 * nothing to choose between them and the honest answer is an empty dropdown.
 * An empty dropdown asks a question; a confident wrong answer does not.
 */
export function suggestPartnerItem<T extends PartnerItem>(
  ours: OurItem,
  catalogue: T[],
): T | null {
  const mine = normalise(ours.model);
  if (mine.length < MIN_SIGNIFICANT) return null;

  let best: T | null = null;
  let bestLen = 0;
  let bestExact = false;
  let tied = false;

  for (const item of catalogue) {
    if (item.kind !== ours.kind) continue;
    if (!sameBrand(item.brand, ours.manufacturer ?? "")) continue;

    let agreed = 0;
    let exact = false;
    for (const key of recognisableAs(item.model)) {
      if (key === mine) exact = true;
      const n = agreement(key, mine);
      if (n < MIN_SIGNIFICANT) continue;
      if (n < key.length * MIN_SHARE_OF_THEIRS) continue;
      if (n < mine.length * MIN_SHARE_OF_OURS) continue;
      agreed = Math.max(agreed, n);
    }
    if (agreed === 0) continue;

    /**
     * AN EXACT NAME BEATS A LONGER ONE THAT MERELY CONTAINS IT.
     *
     * Their list carries families and the SKUs inside them side by side, so
     * our "SE7600H-US" is a prefix of their "SE7600H-USMNUBL15" and also the
     * whole of their "HD-Wave SE7600H-US". Ranking on agreed length alone
     * makes those a three-way tie and the answer becomes nothing — when one
     * of the three is our name, letter for letter.
     */
    const better = exact !== bestExact ? exact : agreed > bestLen;
    const same = exact === bestExact && agreed === bestLen;

    if (better) {
      best = item;
      bestLen = agreed;
      bestExact = exact;
      tied = false;
    } else if (same && best && normalise(item.model) !== normalise(best.model)) {
      tied = true;
    }
  }

  return tied ? null : best;
}
