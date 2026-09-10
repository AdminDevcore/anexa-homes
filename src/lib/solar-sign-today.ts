/**
 * WHAT THIS DEAL HANDS BACK FOR SIGNING TODAY, and who decided it.
 *
 * The credit is display-only wherever it is shown: it comes off what the
 * household NETS once the federal credits are claimed, never off the price,
 * the payment, the contract or the rep's commission. What this module answers
 * is only how much of it there is — because that is not one rule.
 *
 *   none       The partner has no rule, so the figure is the rep's own and he
 *              types it on the deal. Every lender behaved this way until the
 *              rules existed, and most still do.
 *   fixed      The partner gives a figure. Automatic on every deal written on
 *              it: not editable, not removable. It is the partner's offer, and
 *              a rep who could switch it off could quietly keep it.
 *   above_cap  Whatever the system is priced ABOVE the partner's cap. Derived,
 *              never typed — price the job above the cap and the excess is the
 *              household's; price it at or under and there is nothing to give.
 *
 * MEASURED ON THE SYSTEM PRICE, which is the array at sticker with the fee in
 * it and adders and battery excluded. Adders are work the household is being
 * charged for and a battery is hardware at its catalogue price; neither is
 * margin anyone can hand back. A cap read against the whole contract would
 * turn a $120,000 Powerwall order into a $120,000 discount.
 *
 * ONE FUNCTION, because the figure is asked for in five places — the credits
 * card as a rep works, the live ladder beside it, every column of the
 * comparison shelf (each on its OWN lender's rule), the document at
 * generation, and the frozen ladder a household reads. Five copies of "which
 * rule, over which price" is five chances for the card and the document to
 * disagree about what was offered.
 *
 * PURE. Cents in, cents out, no I/O and no React.
 */

/** The three answers. Mirrors `SolarSignTodayMode` in the schema. */
export type SignTodayMode = "none" | "fixed" | "above_cap";

/** One partner's rule, as it stands on the lender row. */
export type SignTodayRule = {
  mode: SignTodayMode;
  /** `fixed`: what this partner gives, cents. */
  fixedCents: number | null;
  /** `above_cap`: the cap, cents per installed watt. */
  capPpwCents: number | null;
};

/** Where the figure on screen came from — the card says which, in words. */
export type SignTodaySource = "typed" | "lender_fixed" | "above_cap";

export type SignToday = {
  cents: number;
  source: SignTodaySource;
  /** False when the partner decided it, so the box is shown read-only. */
  editable: boolean;
  /** The cap that produced it, for the sentence under a derived figure. */
  capPpwCents: number | null;
};

/** The ceiling on any credit, typed or derived. Also the field's own limit. */
export const SIGN_TODAY_MAX_CENTS = 100_000_00;

/** Nothing offered, by anybody. The shape every "no" returns. */
const NOTHING: SignToday = {
  cents: 0,
  source: "typed",
  editable: true,
  capPpwCents: null,
};

/**
 * The credit on one deal, under one partner's rule.
 *
 * `typedCents` is what the rep entered and is READ ONLY under `none`. Under a
 * partner rule it is ignored rather than cleared: a deal that moves from a
 * ruled partner back to an unruled one gets the rep's own figure back rather
 * than a zero he has to remember to retype.
 *
 * A rule with its figure missing — `fixed` and nobody typed an amount, or
 * `above_cap` with no cap — is a half-configured partner, and the honest
 * answer there is no credit rather than a silent fallback to the rep's own
 * number under a partner's name.
 */
export function resolveSignToday(input: {
  rule: SignTodayRule | null | undefined;
  /** The array at sticker, fee included, adders and battery excluded. Cents. */
  systemPriceCents: number;
  /** Installed watts, for the per-watt cap. Zero on a storage-only job. */
  systemWatts: number;
  /** What the rep typed on the deal. Only consulted under `none`. */
  typedCents: number | null | undefined;
}): SignToday {
  const mode = input.rule?.mode ?? "none";

  if (mode === "fixed") {
    const fixed = clamp(input.rule?.fixedCents ?? 0);
    return {
      cents: fixed,
      source: "lender_fixed",
      editable: false,
      capPpwCents: null,
    };
  }

  if (mode === "above_cap") {
    const capPpwCents = input.rule?.capPpwCents ?? null;
    // A storage-only job has no installed watts for a per-watt cap to be per,
    // so there is no excess to compute and nothing to hand back. Priced as if
    // the cap were zero it would give away the whole battery.
    if (capPpwCents == null || !(input.systemWatts > 0)) {
      return { ...NOTHING, source: "above_cap", editable: false, capPpwCents };
    }
    const allowed = Math.round(capPpwCents * input.systemWatts);
    const excess = clamp(Math.round(input.systemPriceCents) - allowed);
    return { cents: excess, source: "above_cap", editable: false, capPpwCents };
  }

  return { ...NOTHING, cents: clamp(input.typedCents ?? 0) };
}

/** Never negative, never past the ceiling, never a NaN on a household's page. */
function clamp(cents: number): number {
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  return Math.min(Math.round(cents), SIGN_TODAY_MAX_CENTS);
}
