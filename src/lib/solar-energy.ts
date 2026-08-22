import { deriveUtilityRateMills } from "./solar-money";

/**
 * Turning what a customer can tell you into what a system has to cover.
 *
 * A homeowner rarely knows their annual kWh — it is the number they are least
 * likely to have to hand. What they DO know is what they pay a month, and often
 * what they pay per kWh. This module is the arithmetic between those facts and
 * a system size.
 *
 * Pure on purpose, like `solar-layout.ts`: the Energy form, the server action
 * that stores the result and the tests all need the same maths, and a module
 * with no React and no Prisma in it is the only version all three can hold.
 *
 * Units are the ones the rest of solar already uses: cents for money, MILLS per
 * kWh for the rate (1 cent = 10 mills), whole kWh for usage.
 */

export const MONTHS_PER_YEAR = 12;

/** Annual kWh from one typical month. Null for anything that is not a usage. */
export function annualFromMonthlyKwh(monthlyKwh: number | null | undefined): number | null {
  if (monthlyKwh == null || !Number.isFinite(monthlyKwh) || monthlyKwh <= 0) return null;
  return Math.round(monthlyKwh * MONTHS_PER_YEAR);
}

/**
 * Annual kWh implied by a monthly bill at a known rate.
 *
 * $200 a month at $0.20/kWh is 1,000 kWh a month, so 12,000 a year.
 *
 * The null guards are the point rather than defensive noise: a rate of zero
 * would return Infinity, and an Infinity reaching the offset calculation is
 * exactly the five-figure percentage this domain keeps trying to print.
 */
export function annualUsageFromBill(
  avgMonthlyBillCents: number | null | undefined,
  rateMillsPerKwh: number | null | undefined
): number | null {
  if (!avgMonthlyBillCents || avgMonthlyBillCents <= 0) return null;
  if (!rateMillsPerKwh || rateMillsPerKwh <= 0) return null;
  const monthlyKwh = (avgMonthlyBillCents * 10) / rateMillsPerKwh;
  if (!Number.isFinite(monthlyKwh)) return null;
  return Math.round(monthlyKwh * MONTHS_PER_YEAR);
}

/**
 * The consumption a system actually has to cover.
 *
 * The bill figure is what the house uses TODAY. It is not what the house will
 * use once this contract has bolted an EV charger to the garage wall, and
 * offset worked out against the smaller number is a promise the array cannot
 * keep — the customer is shown 105% and gets a bill anyway.
 *
 * Kept as a named function rather than a `+` at four call sites so that offset,
 * sizing and the customer's own usage chart cannot drift into disagreeing about
 * which of the two numbers they mean.
 */
export function effectiveUsageKwh(
  annualUsageKwh: number | null | undefined,
  usageAdjustmentKwh: number | null | undefined
): number {
  const base = annualUsageKwh && annualUsageKwh > 0 ? annualUsageKwh : 0;
  const extra = usageAdjustmentKwh && usageAdjustmentKwh > 0 ? usageAdjustmentKwh : 0;
  return base + extra;
}

/**
 * The monthly bill implied by a usage at a known rate — the third side of the
 * same triangle, for showing a rep what their figures add up to.
 */
export function monthlyBillFromUsage(
  annualUsageKwh: number | null | undefined,
  rateMillsPerKwh: number | null | undefined
): number | null {
  if (!annualUsageKwh || annualUsageKwh <= 0) return null;
  if (!rateMillsPerKwh || rateMillsPerKwh <= 0) return null;
  const cents = (annualUsageKwh / MONTHS_PER_YEAR) * (rateMillsPerKwh / 10);
  if (!Number.isFinite(cents)) return null;
  return Math.round(cents);
}

/**
 * The customer's rate: what they told us, else what their bill implies.
 *
 * Every surface that shows a rate goes through this. Three call sites deriving
 * it separately is how a rep's validation screen and the homeowner's proposal
 * end up disagreeing about what that homeowner pays.
 *
 * Null stays meaningful — it is what makes "no rate" a blocking validation
 * issue rather than an invented assumption.
 */
export function resolveUtilityRateMills(d: {
  utilityRateMills?: number | null;
  avgMonthlyBillCents?: number | null;
  annualUsageKwh?: number | null;
}): number | null {
  if (d.utilityRateMills && d.utilityRateMills > 0) return d.utilityRateMills;
  return deriveUtilityRateMills(d.avgMonthlyBillCents, d.annualUsageKwh);
}

/**
 * There is deliberately no "how big a system does this house need" here.
 *
 * Usage alone cannot answer that: what a kW produces on THIS roof depends on
 * which way the planes face, their pitch and what shades them. A flat
 * kWh-per-kW divided into a year's usage quotes a south-facing roof and a
 * north-facing one the same size, and it is wrong on at least one of them.
 *
 * Size comes out of the array a rep actually draws — see `year1Production` in
 * `solar-money.ts`, which sizes from the drawn panels and the site's solar
 * resource, and only then compares that production against the usage above.
 */
