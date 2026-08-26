/**
 * What a provider does for a solar customer, as one line.
 *
 * Two screens ask this — the settings list, where the office fills it in, and
 * the Energy step, where a rep reads it back the moment they pick a provider —
 * and they have to agree to the word. A rep quoting "they buy back at nine and
 * a half cents" from a summary the settings page wrote differently is the
 * failure this exists to prevent.
 *
 * NOTHING HERE REACHES A HOMEOWNER'S DOCUMENT. This is the office's own record
 * of what it has confirmed with each provider; the proposal's arithmetic does
 * not read it. A buyback rate that priced exported kWh into a 25-year model
 * would be a promise, and this is a note.
 */
export type ProviderTerms = {
  buyback: boolean;
  /** Mills per exported kWh. 95 = $0.095/kWh. */
  buybackRateMills: number | null;
  vpp: boolean;
  vppProgramme: string | null;
  vppUpfrontCents: number | null;
  vppAnnualCents: number | null;
  notes: string | null;
};

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

/**
 * The buyback half. Null when nobody has said either way.
 *
 * "Buys back" with no rate is a real and useful answer — plenty of providers
 * buy back at a figure that moves with the market — so the flag prints on its
 * own rather than waiting for a number that may never exist.
 */
export function buybackLine(t: ProviderTerms): string | null {
  if (!t.buyback) return null;
  return t.buybackRateMills && t.buybackRateMills > 0
    ? `Buyback $${(t.buybackRateMills / 1000).toFixed(3)}/kWh`
    : "Buys back exported power";
}

/**
 * The battery-programme half.
 *
 * The programme's own name leads when it has one, because that is what the
 * customer signs up to and what they will see on their own statement — a rep
 * saying "your retailer pays you" when the paperwork says Renew Home has just
 * created a question they cannot answer.
 */
export function vppLine(t: ProviderTerms): string | null {
  if (!t.vpp) return null;
  const money = [
    t.vppUpfrontCents && t.vppUpfrontCents > 0 ? `${usd(t.vppUpfrontCents)} upfront` : null,
    t.vppAnnualCents && t.vppAnnualCents > 0 ? `${usd(t.vppAnnualCents)}/yr` : null,
  ].filter(Boolean);
  const name = t.vppProgramme?.trim();
  const head = name ? `VPP · ${name}` : "Battery programme";
  return money.length > 0 ? `${head} — ${money.join(" + ")}` : head;
}

/**
 * Both halves, for a one-line summary beside a provider's name.
 *
 * Empty means NOTHING IS RECORDED, which the callers render as its own
 * sentence rather than as blank space: on a screen whose whole job is to answer
 * "do they buy back?", silence reads as "no" when it means "nobody checked".
 */
export function providerTermsLine(t: ProviderTerms): string {
  return [buybackLine(t), vppLine(t)].filter(Boolean).join(" · ");
}

/** True when somebody has actually recorded something about this provider. */
export function hasProviderTerms(t: ProviderTerms): boolean {
  return t.buyback || t.vpp || !!t.notes?.trim();
}
