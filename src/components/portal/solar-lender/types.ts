import type { FinanceProduct } from "@prisma/client";

/**
 * The shapes the lenders screen is handed, and the parsers that turn what an
 * admin types back into what the database stores.
 *
 * Their own module because five panels now share them. When these lived beside
 * the markup, the first panel to be split off took a copy of `ppwToCents` with
 * it — two validators for one column is how a cap gets accepted in one place
 * and refused in another.
 */

export type LenderRow = {
  id: string;
  name: string;
  isActive: boolean;
  rank: number;
  notes: string | null;
  /** Rep-facing dealer portal. Never rendered to a customer. */
  portalUrl: string | null;
  /** Customer-facing application link — the proposal's Qualify button. */
  applyUrl: string | null;
  creditInstructions: string | null;
  /**
   * How reps are paid on this lender's deals: they keep the overage above their
   * own redline, or they earn a flat rate per installed watt.
   */
  repPayMode: "redline" | "per_watt";
  /**
   * The most this partner's paper ever puts in front of a homeowner per watt,
   * cents, dealer fee and adders included. Null — nearly every lender — leaves
   * pricing exactly as it was.
   */
  maxFinalPpwCents: number | null;
  /** Whether that figure is a ceiling or this partner's flat price. */
  finalPpwMode: "cap" | "flat";
  /**
   * The least this partner's deals may leave the company per watt, cents,
   * before its cut. Null — nearly every lender — means no floor.
   */
  minBasePpwCents: number | null;
  minBasePricePerBatteryCents: number | null;
  maxFinalPricePerBatteryCents: number | null;
  finalBatteryPriceMode: "cap" | "flat";
  /**
   * Whether this partner funds an array with no storage on it. `warn` is what
   * every lender did before the column existed.
   */
  batteryRule: "optional" | "warn" | "required";
  /**
   * THE PROGRAMME CONTRIBUTION — the one setting on this screen that makes the
   * contract value and the customer's obligation two different numbers.
   *
   * Off on every lender until somebody turns it on. The label and the
   * disclosure carry no defaults on purpose: what the money is CALLED is a
   * legal characterisation, and the app is not entitled to pick one.
   */
  contractAdjustmentEnabled: boolean;
  contractAdjustmentType: "fixed";
  contractAdjustmentCents: number | null;
  contractAdjustmentLabel: string | null;
  contractAdjustmentDisclosure: string | null;
  /** ISO date (YYYY-MM-DD), or null for "already running". */
  contractAdjustmentEffectiveAt: string | null;
  /** What the household ends up owning, in this partner's own words. */
  ownershipDisclosure: string | null;
  /**
   * This partner's answer, per adder, to "on top of your $/W or out of it?".
   * Keyed by catalogue id. An id that is ABSENT has no rule and falls back to
   * the catalogue — which is a different thing from a rule of `false`.
   */
  adderRules: Record<string, boolean>;
  /** The partner's own mark, when one has been uploaded or fetched. */
  logoUrl: string | null;
  /** How many catalogue items this lender approves. */
  approvedCount: number;
  /** How many designs are being built for it. */
  dealCount: number;
  /** The terms this lender finances on. Empty until somebody enters them. */
  products: LenderProduct[];
};

export type LenderProduct = {
  id: string;
  lenderId: string;
  product: FinanceProduct;
  name: string | null;
  aprPct: number | null;
  termMonths: number | null;
  dealerFeePct: number | null;
  leaseRateCentsPerKwMonth: number | null;
  financesStorageOnly: boolean;
  rateMillsPerKwh: number | null;
  escalatorPct: number | null;
  termYears: number | null;
  /** Payment factors in millionths. Loan only; null when the sheet quotes none. */
  factorWithPaydownMicros: number | null;
  factorWithoutPaydownMicros: number | null;
  paydownPct: number | null;
  paydownMonths: number | null;
  isActive: boolean;
};

/** One adder the company sells, as a lender is asked to rule on it. */
export type AdderRuleOption = {
  id: string;
  label: string;
  description: string | null;
  /** "$2,700", "$0.05/W" — the RULE, not a resolved amount. */
  rateLabel: string;
  /** What the catalogue says, and therefore what a lender with no rule does. */
  catalogueOnTop: boolean;
};

/**
 * How this partner arrives at the homeowner's number.
 *
 * Three answers on the screen where the database has two columns, because
 * "is there a figure" and "is that figure a ceiling or the price" are one
 * question to the person answering it. The old screen asked them separately —
 * type a number, and only then does a cap/flat dropdown appear — which reads
 * as a form that changes shape while you fill it in.
 */
export type PricingMode = "normal" | "cap" | "flat";

/**
 * A price per watt, between the box a person types in and the cents stored.
 *
 * Blank is a real answer here and means "no ceiling", so it is kept distinct
 * from a bad one: `null` clears the cap, `"invalid"` is a typo to be reported.
 * Collapsing the two would let a mistyped cap silently clear a lender's ceiling
 * and put every deal on that partner back at the ungoverned price.
 */
export function ppwToCents(s: string): number | null | "invalid" {
  const t = s.trim().replace(/^\$/, "");
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return "invalid";
  const cents = Math.round(n * 100);
  return cents >= 50 && cents <= 2000 ? cents : "invalid";
}

export const ppwToDollars = (cents: number | null) =>
  cents == null ? "" : (cents / 100).toFixed(2);

/**
 * A price per BATTERY, typed in whole dollars.
 *
 * Separate from `ppwToCents` because the ranges are three orders of magnitude
 * apart: $0.50–$20.00 a watt against $500–$100,000 a battery. One function
 * covering both would have to accept a range so wide it validates nothing, and
 * a $9.00 typo where $9,000 was meant would sail through it.
 */
export function batteryPriceToCents(s: string): number | null | "invalid" {
  const t = s.trim().replace(/^\$/, "").replace(/,/g, "");
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return "invalid";
  const cents = Math.round(n * 100);
  return cents >= 500_00 && cents <= 100_000_00 ? cents : "invalid";
}

export const batteryPriceToDollars = (cents: number | null) =>
  cents == null ? "" : String(Math.round(cents / 100));

/**
 * The programme contribution, typed in whole dollars.
 *
 * A third range, for the same reason there is already a second: this figure is
 * $70,000 where a battery is $13,000 and a watt is $5.50, and a validator wide
 * enough to accept all three accepts every typo as well. $1 to $5,000,000.
 *
 * The three-way return matters as much here as on the cap: `null` turns the
 * contribution off, `"invalid"` is a mistake to report. Collapsing them would
 * let a slipped keystroke quietly stop a partner's contract being adjusted at
 * all, and the deals generated afterwards would simply look ordinary.
 */
export function adjustmentToCents(s: string): number | null | "invalid" {
  const t = s.trim().replace(/^\$/, "").replace(/,/g, "");
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return "invalid";
  const cents = Math.round(n * 100);
  return cents >= 100 && cents <= 5_000_000_00 ? cents : "invalid";
}

/** Whole dollars, as this screen writes money everywhere else. */
export const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

/** Empty string, not 0 — a real 0% escalator has to stay typeable. */
export const str = (n: number | null | undefined, div = 1) =>
  n == null ? "" : String(n / div);

export const intOrNull = (v: string, mul = 1) => {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * mul) : null;
};

export const floatOrNull = (v: string) => {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * How many adders this lender funds on top of its own price.
 *
 * Counted the way the deal will resolve it — the lender's rule where it has
 * one, the catalogue's answer where it has not — rather than by counting rows
 * in the override table. A partner that has never been opened still puts the
 * roof on top if the catalogue says so, and a summary that read 0 there would
 * be describing a screen rather than a price.
 */
export function adderOnTopCount(lender: LenderRow, catalogue: AdderRuleOption[]): number {
  return catalogue.filter((a) => lender.adderRules[a.id] ?? a.catalogueOnTop).length;
}

/**
 * The lender's own draft, as strings.
 *
 * Every value is a STRING because these are text inputs, and a controlled input
 * handed a null renders React's uncontrolled-component warning and then eats the
 * first keystroke. Parsed back on save, where an empty box means "clear it".
 *
 * ONE definition, used by the initial state, by Discard, and by the dirty
 * check. Two copies of this literal is how a field gets added to the form,
 * saves correctly, and then silently fails to come back when somebody cancels.
 */
export function draftFrom(lender: LenderRow) {
  return {
    name: lender.name,
    notes: lender.notes ?? "",
    portalUrl: lender.portalUrl ?? "",
    applyUrl: lender.applyUrl ?? "",
    creditInstructions: lender.creditInstructions ?? "",
    repPayMode: lender.repPayMode,
    ppwMode: (lender.maxFinalPpwCents == null
      ? "normal"
      : lender.finalPpwMode) as PricingMode,
    maxFinalPpw: ppwToDollars(lender.maxFinalPpwCents),
    minBasePpw: ppwToDollars(lender.minBasePpwCents),
    batteryMode: (lender.maxFinalPricePerBatteryCents == null
      ? "normal"
      : lender.finalBatteryPriceMode) as PricingMode,
    maxFinalBattery: batteryPriceToDollars(lender.maxFinalPricePerBatteryCents),
    minBaseBattery: batteryPriceToDollars(lender.minBasePricePerBatteryCents),
    batteryRule: lender.batteryRule,
    adjustmentEnabled: lender.contractAdjustmentEnabled,
    adjustmentAmount:
      lender.contractAdjustmentCents == null
        ? ""
        : String(Math.round(lender.contractAdjustmentCents / 100)),
    adjustmentLabel: lender.contractAdjustmentLabel ?? "",
    adjustmentDisclosure: lender.contractAdjustmentDisclosure ?? "",
    adjustmentEffectiveAt: lender.contractAdjustmentEffectiveAt ?? "",
    ownershipDisclosure: lender.ownershipDisclosure ?? "",
  };
}

export type LenderDraft = ReturnType<typeof draftFrom>;

/** The screen's answer per adder: the lender's rule, or the catalogue's. */
export function resolvedAdderRules(
  lender: LenderRow,
  catalogue: AdderRuleOption[]
): Record<string, boolean> {
  return Object.fromEntries(
    catalogue.map((a) => [a.id, lender.adderRules[a.id] ?? a.catalogueOnTop])
  );
}
