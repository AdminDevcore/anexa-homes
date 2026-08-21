import type { FinanceProduct, SolarRepPayMode } from "@prisma/client";

/**
 * What a solar rep earns, and on which basis.
 *
 * Pure functions, money in CENTS, no I/O — so the commission engine, the worked
 * example on the team page and anything that later shows a rep their number on
 * the deal all compute it from the same code.
 *
 * THE CENTRAL POINT: solar does not pay out of a profit pool. Roofing splits
 * (contract − costs − overhead) between the company and the rep; solar pays one
 * of exactly two ways, and which one applies is a property of the LENDER, not
 * of the rep:
 *
 *   REDLINE   — the company keeps a fixed net price per watt and the rep keeps
 *               every cent above it. The default, and how most partners work.
 *   PER-WATT  — the rep earns a fixed rate per installed watt whatever the deal
 *               prices at. What a fixed-pay partner (Amos) pays, and the only
 *               thing that can pay on a lease or PPA.
 *
 * Nothing in here prices a deal. Price comes from `pricePurchase` /
 * `priceThirdParty` in solar-money.ts and is passed in, so there is one pricing
 * model and this file cannot drift from it.
 */

export type SolarPayBasis = "redline" | "per_watt";

/**
 * The terms one deal is paid on. Deliberately flat and serialisable: these are
 * the exact three values snapshotted onto the Commission row at generation, so
 * raising a rep's redline never re-prices a deal they already sold.
 */
export type SolarPayTerms = {
  basis: SolarPayBasis;
  /** Cents per watt, NET of the lender's fee. Set only on `redline`. */
  redlineCentsPerWatt: number | null;
  /** Mills (tenths of a cent) per watt. Set only on `per_watt`. */
  millsPerWatt: number | null;
};

/** The rep's own configured terms, straight off their User row. */
export type SolarRepConfig = {
  solarRedlineCentsPerWatt: number | null;
  solarPerWattMills: number | null;
};

/**
 * Which basis this deal pays on, and on what terms.
 *
 * Returns null when the rep has no figure for the basis that applies — which is
 * NOT the same as zero. A null means "nobody has set this rep up for this kind
 * of deal", and the caller generates no commission line at all rather than a $0
 * one that reads as a deal genuinely worth nothing. A configured 0 is a real
 * answer and produces a real (zero) line.
 */
export function resolveSolarPayTerms(input: {
  product: FinanceProduct;
  /** The deal's lender pay mode. Null when the deal has no lender yet. */
  lenderPayMode: SolarRepPayMode | null;
  rep: SolarRepConfig;
}): SolarPayTerms | null {
  const { product, lenderPayMode, rep } = input;

  // A lease or PPA installs a real array but sells no system, so there is no
  // price for a redline to be measured against. Per-watt regardless of what the
  // lender's mode says — without this a rep on a TPO deal would earn a share of
  // a price that does not exist, which is to say nothing, silently.
  const basis: SolarPayBasis =
    product === "lease" || product === "ppa"
      ? "per_watt"
      : // Cash has no lender by definition; a loan not yet routed to one has no
        // mode to read. Both fall to the redline, which is the company default.
        (lenderPayMode ?? "redline") === "per_watt"
        ? "per_watt"
        : "redline";

  if (basis === "per_watt") {
    if (rep.solarPerWattMills == null) return null;
    return { basis, redlineCentsPerWatt: null, millsPerWatt: rep.solarPerWattMills };
  }
  if (rep.solarRedlineCentsPerWatt == null) return null;
  return { basis, redlineCentsPerWatt: rep.solarRedlineCentsPerWatt, millsPerWatt: null };
}

export type SolarPayResult = {
  amountCents: number;
  /** What the amount was computed from: the net price on `redline`, watts on `per_watt`. */
  basisCents: number;
  /** The deal's net price per watt, cents. Zero on a system with no watts. */
  netPpwCents: number;
  /** How far above the redline the deal landed, cents per watt. Zero on `per_watt`. */
  overageCentsPerWatt: number;
};

/**
 * What the terms pay on this deal.
 *
 * `netPriceCents` is the NET system price — gross minus the lender's cut, and
 * before adders. Net rather than gross because moving a deal onto expensive
 * money has to come out of the rep, not the company: the same $3.20/W sticker
 * is worth $6,240 to the rep through an 18% partner and $1,760 through a 32%
 * one. Before adders because a steep-roof charge is priced from the catalogue
 * to cover its own cost — it is not rep overage.
 */
export function solarRepPayCents(
  terms: SolarPayTerms,
  deal: { systemWatts: number; netPriceCents: number }
): SolarPayResult {
  const watts = Math.max(0, Math.round(deal.systemWatts));
  const netPpwCents = watts > 0 ? deal.netPriceCents / watts : 0;

  if (terms.basis === "per_watt") {
    // Mills are tenths of a cent, so the rate divides by 10 — not 1000. A $0.40/W
    // rate is 400 mills, and 10,000 W of it is $4,000.
    const amountCents = Math.round((watts * (terms.millsPerWatt ?? 0)) / 10);
    return { amountCents: Math.max(0, amountCents), basisCents: watts, netPpwCents, overageCentsPerWatt: 0 };
  }

  const redline = terms.redlineCentsPerWatt ?? 0;
  // Integer throughout: subtracting the redline's whole-system value beats
  // multiplying a per-watt overage that has already been rounded.
  const amountCents = Math.max(0, deal.netPriceCents - redline * watts);
  return {
    amountCents,
    basisCents: Math.max(0, deal.netPriceCents),
    netPpwCents,
    overageCentsPerWatt: watts > 0 ? Math.max(0, netPpwCents - redline) : 0,
  };
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** `$0.40/W` from 400 mills. Two decimals, because a rate is cents-per-watt. */
export function millsPerWattLabel(mills: number): string {
  return `$${(mills / 1000).toFixed(2)}/W`;
}

/** `$2.00/W` from 200 cents. */
export function centsPerWattLabel(cents: number): string {
  return `$${(cents / 100).toFixed(2)}/W`;
}

/**
 * The line a rep reads on their commissions page. Says the basis, the terms and
 * the size, so a number can be checked without opening the deal.
 */
export function solarPayLabel(terms: SolarPayTerms, watts: number, result: SolarPayResult): string {
  const size = `${watts.toLocaleString("en-US")} W`;
  if (terms.basis === "per_watt") {
    return `Solar per-watt (${millsPerWattLabel(terms.millsPerWatt ?? 0)} · ${size})`;
  }
  const over = `$${(result.overageCentsPerWatt / 100).toFixed(2)}/W`;
  return `Solar redline (${over} over ${centsPerWattLabel(terms.redlineCentsPerWatt ?? 0)} · ${size})`;
}

/** The one-line explanation under the worked example on the team page. */
export function solarPayExplanation(terms: SolarPayTerms, result: SolarPayResult): string {
  if (terms.basis === "per_watt") return `Flat rate, whatever the deal prices at.`;
  return `Nets ${centsPerWattLabel(Math.round(result.netPpwCents))} against a ${centsPerWattLabel(
    terms.redlineCentsPerWatt ?? 0
  )} redline — ${usd(result.amountCents)} to the rep.`;
}
