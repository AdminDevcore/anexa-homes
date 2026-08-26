import type { FinanceProduct } from "@prisma/client";

/**
 * What a solar deal is worth, said the way the customer was told it.
 *
 * `Lead.value` is roofing's field: somebody types a contract total into the
 * deal and every list in the app reads it back. Nothing on a solar deal ever
 * typed into it — the price is derived from the design and the lender's
 * programme — so a sold solar deal sat at $0 on its own summary card while the
 * homeowner was holding a document quoting eighty thousand dollars.
 *
 * THE PROPOSAL IS THE ANSWER. Not the design, not the finance row: the frozen
 * snapshot of the version this customer was last quoted. Same rule as the
 * System info slide — a design keeps moving while a rep redraws a roof, and the
 * deal screen must not disagree with the paper on the kitchen table.
 *
 * THE PRODUCT DECIDES WHAT KIND OF NUMBER IT IS. A purchase has a price, a
 * lease has a monthly, a PPA has a rate per kWh — and quoting a PPA a contract
 * price is how a customer ends up arguing about a number nobody offered them.
 * There is deliberately no attempt to turn a lease's monthly into a "deal
 * value" by multiplying it out: a figure nobody signed does not belong in a
 * field that reads as what somebody signed.
 */
export type SolarPriceSource = {
  product: FinanceProduct | null;
  /** Cash and loan only: what the customer signs. */
  contractPriceCents: number | null;
  /** Lease only: the fixed monthly. */
  monthlyPaymentCents: number | null;
  /** PPA only: price per kWh, in tenths of a cent. */
  rateMillsPerKwh: number | null;
};

export type SolarDealValue =
  | { kind: "total"; cents: number }
  | { kind: "monthly"; cents: number }
  | { kind: "rate"; millsPerKwh: number }
  /** Nothing priced yet — which is NOT the same as priced at zero. */
  | { kind: "none" };

const NONE: SolarDealValue = { kind: "none" };

/**
 * The one figure this deal is about.
 *
 * A zero is treated as "not priced yet" rather than as a price, because that is
 * what it always means here: every route into these columns computes them from
 * an array and a rate, and neither an array of no panels nor a rate of nothing
 * is a quote. Reporting `$0` as though somebody had agreed to it is the whole
 * defect this module exists to stop.
 */
export function solarDealValue(src: SolarPriceSource | null | undefined): SolarDealValue {
  if (!src) return NONE;
  if (src.product === "ppa") {
    return src.rateMillsPerKwh ? { kind: "rate", millsPerKwh: src.rateMillsPerKwh } : NONE;
  }
  if (src.product === "lease") {
    return src.monthlyPaymentCents ? { kind: "monthly", cents: src.monthlyPaymentCents } : NONE;
  }
  // Cash, loan, and a deal with no product decided yet: all priced as a total.
  return src.contractPriceCents ? { kind: "total", cents: src.contractPriceCents } : NONE;
}

/**
 * The same value as a string.
 *
 * `money` is passed in rather than imported: this renders on the server through
 * the company's own formatter (currency and locale come from settings) and in
 * client components that carry their own. A module that reached for one of them
 * could only ever be used from one side.
 */
export function formatSolarDealValue(
  value: SolarDealValue,
  money: (cents: number) => string
): string {
  switch (value.kind) {
    case "total":
      return money(value.cents);
    case "monthly":
      return `${money(value.cents)}/mo`;
    case "rate":
      // Mills are tenths of a cent, so a PPA rate is three decimals of a
      // dollar — $0.145/kWh. Rounded to the mill it was quoted at rather than
      // to the cent, which would print every rate in the market as $0.15.
      return `$${(value.millsPerKwh / 1000).toFixed(3)}/kWh`;
    case "none":
      return "—";
  }
}

/**
 * What a solar deal's `Lead.value` should be set to.
 *
 * Only a purchase writes one. A lease and a PPA have no system price, and
 * carrying the old loan figure forward after a product switch would leave every
 * pipeline total quoting a contract that no longer exists — so they clear it to
 * zero rather than lie by omission. The deal page still shows the monthly or
 * the rate, from the snapshot, where a reader can see which it is.
 */
export function solarLeadValueCents(src: SolarPriceSource | null | undefined): number {
  const value = solarDealValue(src);
  return value.kind === "total" ? value.cents : 0;
}
