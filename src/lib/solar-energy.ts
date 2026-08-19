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

export type TargetAssumptions = {
  kwhPerKwYear: number;
  derateFactor: number;
  targetOffsetPct: number;
};

/**
 * How big a system this house needs, and roughly how many panels that is.
 *
 * A TARGET, not a decision. It tells a rep what to aim for while drawing; what
 * gets quoted is still the array actually on the roof, because what fits beats
 * what the arithmetic wants.
 */
export function targetSystem(args: {
  annualUsageKwh: number | null | undefined;
  assumptions: TargetAssumptions;
  panelWatts: number | null | undefined;
}): { kwDc: number; panels: number | null } | null {
  const usage = args.annualUsageKwh;
  if (!usage || usage <= 0) return null;

  const { kwhPerKwYear, derateFactor, targetOffsetPct } = args.assumptions;
  const kwhPerKw = kwhPerKwYear * derateFactor;
  if (!Number.isFinite(kwhPerKw) || kwhPerKw <= 0) return null;

  const kwDc = (usage * (targetOffsetPct / 100)) / kwhPerKw;
  if (!Number.isFinite(kwDc) || kwDc <= 0) return null;

  // Up, always: a tenth of a panel is not a thing anybody can install.
  const panels =
    args.panelWatts && args.panelWatts > 0 ? Math.ceil((kwDc * 1000) / args.panelWatts) : null;

  return { kwDc, panels };
}
