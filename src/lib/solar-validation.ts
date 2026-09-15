import type { FinanceProduct } from "@prisma/client";
import {
  basePpwFromSticker,
  underBaseFloor,
  type SolarAssumptions,
} from "./solar-money";
import { resolveUtilityRateMills } from "./solar-energy";

/**
 * Guard rails on a solar design and its pricing.
 *
 * A competitor has a live customer-facing proposal quoting **10,814% offset**.
 * That is what missing validation looks like: nobody typed that number, the
 * system computed it from a usage figure nobody checked and rendered it to a
 * homeowner. The rep never saw it, the customer did.
 *
 * So there are two severities:
 *
 *   BLOCK — physically impossible or commercially indefensible. The proposal
 *           cannot be generated at all. No override, because every override
 *           becomes the default.
 *   WARN  — unusual but legitimate (a big battery bank, an EV owner sizing for
 *           future load). Shown prominently and must be acknowledged, but the
 *           rep can proceed.
 *
 * Bounds are DATA (SolarSettings), not constants, because "reasonable PPW"
 * differs by market and moves with equipment costs.
 *
 * Every issue carries a STABLE CODE. The message is written for a rep and will
 * be reworded; the code is what tests assert on and what the UI keys off to
 * offer the right "take me there" link, so it must not change once shipped.
 */

export type IssueSeverity = "block" | "warn";

/** Which screen the rep has to go to. Drives the grouped readiness report. */
export type IssueGroup =
  | "customer"
  | "utility"
  | "design"
  | "equipment"
  | "pricing"
  | "financing"
  | "company"
  | "documents";

export type IssueAction = { label: string; href: string };

export type ValidationIssue = {
  severity: IssueSeverity;
  /** Stable, machine-readable. Never reworded. */
  code: string;
  group: IssueGroup;
  field: string;
  message: string;
  action?: IssueAction;
};

/** True when nothing blocks generation. Warnings do not block. */
export function canGenerate(issues: ValidationIssue[]): boolean {
  return !issues.some((i) => i.severity === "block");
}

/** Group issues for the readiness panel, preserving order within each group. */
export const ISSUE_GROUP_LABEL: Record<IssueGroup, string> = {
  customer: "Customer & property",
  utility: "Utility",
  design: "Design",
  equipment: "Equipment",
  pricing: "Pricing",
  financing: "Financing",
  company: "Company identity",
  documents: "Documents",
};

export function groupIssues(issues: ValidationIssue[]): { group: IssueGroup; label: string; issues: ValidationIssue[] }[] {
  const order: IssueGroup[] = [
    "customer", "utility", "design", "equipment",
    "pricing", "financing", "company", "documents",
  ];
  return order
    .map((group) => ({ group, label: ISSUE_GROUP_LABEL[group], issues: issues.filter((i) => i.group === group) }))
    .filter((g) => g.issues.length > 0);
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type DesignForValidation = {
  /**
   * What this deal sells. OPTIONAL and `pv` when absent, so a caller not yet
   * updated is judged exactly as it was — the safe direction for every optional
   * field on these input shapes.
   */
  systemType?: "pv" | "pv_storage" | "storage";
  batteryQty?: number;
  systemSizeKwDc: number;
  year1ProductionKwh: number;
  annualUsageKwh: number | null;
  offsetPct: number;
  moduleQty: number;
  moduleRatingW: number | null;
  avgMonthlyBillCents?: number | null;
  /** The rate a rep was told, when there is one. See resolveUtilityRateMills. */
  utilityRateMills?: number | null;
  hasLayoutImage?: boolean;
  hasBattery?: boolean;
  /**
   * What this deal's LENDER does about an array with no storage on it.
   *
   * A rule about the partner, not about the company: some paper will not fund
   * grid-tied PV at all and some does not care, and the app used to hold one
   * opinion for both. Rides on the design shape for the same reason the
   * partner's margin floor rides on the finance shape — it belongs to the
   * lender this one deal was designed for.
   *
   * Optional, and `warn` when absent: a cash deal has no lender to ask, and a
   * caller that has not been updated is judged exactly as it was before.
   */
  batteryRule?: LenderBatteryRule | null;
  utilityProvider?: string | null;
};

/** See `SolarLenderBatteryRule`. Restated here so the lib does not import Prisma. */
export type LenderBatteryRule = "optional" | "warn" | "required";

export type FinanceForValidation = {
  systemType?: "pv" | "pv_storage" | "storage";
  /** The storage sticker, per battery. Zero on a PV deal. */
  stickerPricePerBatteryCents?: number;
  batteryQty?: number;
  /** The partner's per-battery floor. Null on cash and on lenders that set none. */
  minBasePricePerBatteryCents?: number | null;
  /** Whether the chosen programme funds a battery with no array. */
  financesStorageOnly?: boolean;
  product: FinanceProduct;
  /**
   * The STICKER — what the customer pays per watt, this lender's fee already
   * inside it. Not the base, which is why every rule below that means "margin"
   * runs it back through `basePpwFromSticker` first.
   */
  grossPpwCents: number;
  dealerFeePct: number;
  /**
   * The floor this deal's LENDER puts under the company's margin, cents per
   * watt. Null on a cash deal, on a lender that sets none, and on every lender
   * until somebody does. Rides on the finance shape rather than on assumptions
   * because it belongs to the partner this one deal was designed for.
   */
  minBasePpwCents?: number | null;
  contractPriceCents: number;
  rateMillsPerKwh: number | null;
  monthlyPaymentCents: number | null;
  escalatorPct: number | null;
  termYears: number | null;
  downPaymentCents: number | null;
  loanMonthlyPaymentCents: number | null;
  aprPct?: number | null;
  loanTermMonths?: number | null;
  /**
   * True when this deal's terms were QUOTED from one of the lender's published
   * programmes rather than typed from memory.
   *
   * Changes what the sanity rules below are for. A figure a person keyed in is
   * worth guarding against typos; the same figure read off a rate sheet is a
   * fact about a partner, and refusing it tells a rep their own lender is not
   * plausible — with no box left to correct, because a quoted deal reads its
   * terms from the sheet.
   */
  fromRateSheet?: boolean;
  /**
   * True when that programme publishes a payment factor, so a monthly can be
   * quoted before any approval comes back. See `factorQuote`.
   */
  hasPaymentFactor?: boolean;
};

export type CustomerForValidation = {
  firstName: string | null;
  lastName: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

export type CompanyForValidation = {
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
};

/**
 * Which step of the proposal builder fixes a given finding.
 *
 * The builder and this file have to agree on the vocabulary: the report MINTS
 * these links and the builder READS them back to switch steps in place, so the
 * builder and the parser live next to the builder that produces them.
 */
export type BuilderStep = "design" | "financing";

export const builderHref = (leadId: string, step: BuilderStep) =>
  `/portal/leads/${leadId}/solar-proposal?step=${step}`;

/**
 * The step a "take me there" link points at, or null when it leads somewhere
 * else entirely (the deal, company settings, solar settings).
 *
 * The readiness report is rendered INSIDE the builder, where a link to another
 * step of that same builder is a link to the page you are already on: the route
 * does not change, so the builder never remounts and its step never moves. The
 * report uses this to turn those particular links into a direct step switch and
 * leave every other one a real navigation.
 */
export function builderStepFromHref(href: string): BuilderStep | null {
  const [path, query = ""] = href.split("?");
  if (!path.endsWith("/solar-proposal")) return null;
  const step = new URLSearchParams(query).get("step");
  // A bare builder link — no step — starts at the beginning, same as the page.
  return step === "financing" ? "financing" : "design";
}

const DESIGN_HREF = (leadId: string) => builderHref(leadId, "design");
const FINANCE_HREF = (leadId: string) => builderHref(leadId, "financing");
/** Not deal-scoped: the catalogue is company-wide, and so is its fix. */
const EQUIPMENT_HREF = "/portal/settings/solar-equipment";

// ---------------------------------------------------------------------------
// Design
// ---------------------------------------------------------------------------

export function validateDesign(
  d: DesignForValidation,
  a: SolarAssumptions,
  leadId?: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const to = leadId ? { label: "Open system design", href: DESIGN_HREF(leadId) } : undefined;
  const block = (code: string, group: IssueGroup, field: string, message: string) =>
    issues.push({ severity: "block", code, group, field, message, action: to });
  const warn = (code: string, group: IssueGroup, field: string, message: string) =>
    issues.push({ severity: "warn", code, group, field, message, action: to });

  /**
   * A storage deal is asked the questions it HAS.
   *
   * Not "the array gates pass trivially" — they cannot pass, because there is
   * no array and never will be. Asked at all, they block every battery job
   * permanently with findings nobody can clear.
   */
  if (d.systemType === "storage") {
    if (!d.hasBattery) {
      block("storage.no_battery", "equipment", "batteryId", "Pick a battery before generating a proposal.");
    }
    if (!(d.batteryQty && d.batteryQty > 0)) {
      block("storage.no_qty", "equipment", "batteryQty", "Say how many batteries this deal installs.");
    }
    /**
     * Usage is a BLOCK on a battery deal, not the warning it used to be.
     *
     * It was a warning while runtime came from the company's list of named load
     * profiles: a deal with no usage still had hours to print, and only lost
     * the bill saving. Whole-home backup derives the runtime from this house's
     * own usage, so a blank Energy step now costs the document BOTH of the two
     * things a battery is bought for — how long the lights stay on, and what
     * comes off the bill. That leaves a storage proposal with nothing to say,
     * which is exactly what the old missing-profile block existed to prevent.
     */
    if (d.annualUsageKwh == null || d.annualUsageKwh <= 0) {
      block(
        "storage.no_usage",
        "design",
        "annualUsageKwh",
        "No usage on file, so the proposal cannot say how long this battery lasts or what it saves."
      );
    }
    return issues;
  }

  if (d.systemSizeKwDc <= 0) {
    block("design.size_zero", "design", "systemSizeKwDc", "System size must be greater than zero.");
  }
  // The panel is no longer a rep's choice, so neither of these is their fault.
  // Both findings send whoever CAN fix it to the catalogue instead.
  if (d.moduleRatingW == null) {
    issues.push({
      severity: "block",
      code: "equipment.no_module",
      group: "equipment",
      field: "moduleId",
      message: "No default solar panel is set in the catalogue, so a system cannot be sized.",
      action: { label: "Open the equipment catalogue", href: EQUIPMENT_HREF },
    });
  } else if (d.moduleRatingW <= 0) {
    issues.push({
      severity: "block",
      code: "equipment.module_rating_zero",
      group: "equipment",
      field: "moduleId",
      message: "The default panel has no wattage on it. Fix the catalogue entry before quoting it.",
      action: { label: "Open the equipment catalogue", href: EQUIPMENT_HREF },
    });
  }
  if (d.moduleQty <= 0) {
    block("equipment.module_qty_zero", "equipment", "moduleQty", "Module quantity must be at least one.");
  }

  // ── Usage is the anchor for everything downstream ──────────────────────
  if (d.annualUsageKwh == null || d.annualUsageKwh <= 0) {
    block(
      "utility.usage_missing",
      "utility",
      "annualUsageKwh",
      "Enter the home's annual usage from the utility bill. Offset cannot be calculated without it — this is how a proposal ends up claiming a five-figure offset."
    );
  }

  // The bill is what today's rate is derived from, and today's rate is what the
  // entire savings projection stands on. Without it there is nothing to compare
  // solar against, so this blocks rather than warns.
  // What matters is that a RATE exists, not which of the two routes produced it.
  // A deal filled in from the bill and the rate has no derivable bill ÷ usage
  // and must still pass; judging the bill alone failed exactly those deals.
  if (d.avgMonthlyBillCents !== undefined) {
    const rate = resolveUtilityRateMills(d);
    if (rate == null) {
      block(
        "utility.rate_missing",
        "utility",
        "avgMonthlyBillCents",
        "No utility rate. Enter the bill and the annual usage, or the bill and the rate per kWh — savings cannot be projected without one."
      );
    } else if (rate < 50 || rate > 600) {
      // Nowhere in the US retails residential power below ~5c or above ~60c.
      warn(
        "utility.rate_implausible",
        "utility",
        "avgMonthlyBillCents",
        `That works out at $${(rate / 1000).toFixed(3)}/kWh, which is outside the normal US retail range. Check the figures.`
      );
    }
  }

  if (d.utilityProvider !== undefined && !d.utilityProvider?.trim()) {
    block(
      "utility.provider_missing",
      "utility",
      "utilityProvider",
      "Record the utility provider before generating a proposal. Net-metering, meter fees, and savings assumptions cannot be verified without it."
    );
  }
  // ── Offset ─────────────────────────────────────────────────────────────
  if (d.offsetPct < a.minOffsetPct) {
    block("design.offset_below_min", "design", "offsetPct", `Offset of ${d.offsetPct.toFixed(0)}% is below the minimum of ${a.minOffsetPct}%.`);
  }
  if (d.offsetPct > a.maxOffsetPct) {
    block(
      "design.offset_above_max",
      "design",
      "offsetPct",
      `Offset of ${d.offsetPct.toFixed(0)}% exceeds the maximum of ${a.maxOffsetPct}%. Check the annual usage figure — an offset this high almost always means the usage is wrong, not that the system is huge.`
    );
  } else if (d.offsetPct > 110) {
    warn(
      "design.offset_high",
      "design",
      "offsetPct",
      `Offset is ${d.offsetPct.toFixed(0)}%. Most utilities do not credit production far beyond usage — confirm the customer is adding load (EV, pool, addition).`
    );
  }
  // A minimum of 0 is not a guard rail, it is the absence of one: it permits a
  // proposal that offsets nothing. Surfaced so it gets configured rather than
  // silently passing every deal.
  if (a.minOffsetPct <= 0) {
    block(
      "config.min_offset_unset",
      "design",
      "minOffsetPct",
      "No minimum offset is configured (currently 0%), so an undersized system cannot be caught. Set one in Solar settings before generating a proposal.",
    );
  }

  // ── Production must track usage and size ───────────────────────────────
  if (d.year1ProductionKwh <= 0 && d.systemSizeKwDc > 0) {
    block("design.production_zero", "design", "year1ProductionKwh", "Year-one production has not been calculated.");
  }
  if (d.systemSizeKwDc > 0 && d.year1ProductionKwh > 0) {
    // Production is now modelled from system size and the company-wide derate
    // alone — there is no per-deal shading factor to divide back out.
    const impliedKwhPerKw = d.year1ProductionKwh / d.systemSizeKwDc;
    // Nowhere on earth is outside roughly 700-2200 kWh/kW/yr for a fixed array.
    if (impliedKwhPerKw < 700 || impliedKwhPerKw > 2200) {
      block(
        "design.production_implausible",
        "design",
        "year1ProductionKwh",
        `Production of ${Math.round(impliedKwhPerKw)} kWh per kW/year is outside any real-world range (700–2200). The system size and production do not agree.`
      );
    }
  }

  // ── Module count must agree with system size ───────────────────────────
  if (d.moduleRatingW && d.moduleQty > 0) {
    const impliedKw = (d.moduleQty * d.moduleRatingW) / 1000;
    if (Math.abs(impliedKw - d.systemSizeKwDc) > 0.5) {
      block(
        "design.size_mismatch",
        "design",
        "systemSizeKwDc",
        `${d.moduleQty} × ${d.moduleRatingW}W is ${impliedKw.toFixed(2)} kW, but the system is recorded as ${d.systemSizeKwDc.toFixed(2)} kW.`
      );
    }
  }

  // ── Documents ──────────────────────────────────────────────────────────
  // Blocking, not a warning: the module count — and therefore the price — is
  // how many panels were drawn on the roof, so a proposal without the drawing
  // is quoting a system nobody has shown will fit.
  if (d.hasLayoutImage === false) {
    block(
      "documents.no_layout",
      "documents",
      "layoutImageFileId",
      "No panel layout has been drawn. The module count, and therefore the price, comes from it."
    );
  }
  /**
   * Storage on a PV job is the LENDER'S call.
   *
   * Three answers, and the default is the one that was hardcoded here before
   * the column existed, so nothing about an existing deal changes: `warn` says
   * it and lets it through, `optional` says nothing at all, `required` stops
   * the proposal. A partner that will not write a loan without a battery is not
   * a partner a rep should find out about at submission, with a signed quote
   * already in the homeowner's inbox.
   *
   * The code is deliberately the SAME on the warning and the block. It names
   * the finding, not its severity, and a rep switching a deal between two
   * lenders should see one issue change its mind rather than two issues take
   * turns.
   */
  if (d.hasBattery === false) {
    const rule: LenderBatteryRule = d.batteryRule ?? "warn";
    if (rule === "required") {
      block(
        "equipment.no_battery",
        "equipment",
        "batteryId",
        "This lender will not fund a system without a battery. Add storage to the design, or move the deal to a lender that finances grid-tied."
      );
    } else if (rule === "warn") {
      warn("equipment.no_battery", "equipment", "batteryId", "No battery on this design. Fine for a grid-tied system — the proposal will say the system shuts off in an outage.");
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

export function validateFinance(
  f: FinanceForValidation,
  a: SolarAssumptions,
  leadId?: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const to = leadId ? { label: "Open financing", href: FINANCE_HREF(leadId) } : undefined;
  const block = (code: string, group: IssueGroup, field: string, message: string) =>
    issues.push({ severity: "block", code, group, field, message, action: to });
  const warn = (code: string, group: IssueGroup, field: string, message: string) =>
    issues.push({ severity: "warn", code, group, field, message, action: to });

  /**
   * A storage deal's price is per battery, and so is everything guarding it.
   * The $/W band below would divide by zero watts and wave every price through.
   */
  if (f.systemType === "storage") {
    if (f.product === "cash" || f.product === "loan") {
      const sticker = f.stickerPricePerBatteryCents ?? 0;
      if (sticker <= 0) {
        block(
          "storage.no_price",
          "pricing",
          "stickerPricePerBatteryCents",
          "Price the batteries before generating a proposal."
        );
      } else if (underBaseFloor(sticker, f.dealerFeePct, f.minBasePricePerBatteryCents)) {
        block(
          "storage.under_floor",
          "pricing",
          "stickerPricePerBatteryCents",
          "This price leaves less per battery than this lender allows."
        );
      }
      // Loans only: cash has no lender paper for eligibility to be a question
      // about, so a cash storage deal is never blocked on one.
      if (f.product === "loan" && f.financesStorageOnly === false) {
        block(
          "storage.product_not_eligible",
          "financing",
          "lenderProductId",
          "This lender's paper does not fund a storage-only job."
        );
      }
    } else {
      block(
        "storage.product_unsupported",
        "financing",
        "product",
        "A lease or PPA sells electricity, and a battery on its own generates none. Quote cash or a loan."
      );
    }
    return issues;
  }

  if (f.product === "cash" || f.product === "loan") {
    // WHAT THIS DEAL LEAVES THE COMPANY, which is not the number stored on the
    // row: `grossPpwCents` is the sticker and the fee is already inside it.
    //
    // There is exactly ONE margin rule now, and it belongs to the LENDER. The
    // company-wide Min/Max $/W band that used to sit above it was removed on
    // 2026-09-02: pricing is a property of the loan product, not of the app,
    // and asking one universal band about it blocked real deals three separate
    // times as the meaning of "the base" moved underneath it.
    //
    // Asked of the base, and it matters: a capped lender lowers the sticker
    // after the fact, so the base a rep typed is not the base anyone ends up
    // with, and the floor has to be about the second one to protect anything.
    const basePpwCents = basePpwFromSticker(f.grossPpwCents, f.dealerFeePct);
    if (underBaseFloor(f.grossPpwCents, f.dealerFeePct, f.minBasePpwCents)) {
      block(
        "pricing.below_lender_floor",
        "pricing",
        "grossPpwCents",
        `This leaves $${(basePpwCents / 100).toFixed(2)}/W before the lender's cut, under this lender's $${((f.minBasePpwCents ?? 0) / 100).toFixed(2)}/W minimum.`
      );
    }
    // A cash deal has no lender, so it cannot carry a lender's fee.
    if (f.product === "cash" && f.dealerFeePct > 0) {
      block("pricing.cash_dealer_fee", "pricing", "dealerFeePct", "A cash deal has no lender and therefore no dealer fee.");
    }
    if (f.product === "loan" && f.dealerFeePct <= 0) {
      warn("pricing.loan_no_dealer_fee", "pricing", "dealerFeePct", "This loan has no dealer fee. Confirm with the lender — that is unusual.");
    }
    /**
     * A TYPO GUARD, and only that.
     *
     * Half the contract going to the lender is not a number anybody keys in by
     * accident twice, so on a hand-quoted deal it is worth stopping. Off a rate
     * sheet it is not a typo at all: Amos Capital Fund publishes 65% against a
     * flat $5.50/W, and that arrangement is the entire reason the flat mode
     * exists. Blocking it told a rep their own partner was implausible — and
     * since a quoted deal reads its fee from the sheet, left them no field to
     * change. What actually protects margin here is the lender's own floor
     * above, which is measured on what survives the fee.
     */
    if (f.dealerFeePct >= 50 && !f.fromRateSheet) {
      block(
        "pricing.dealer_fee_implausible",
        "pricing",
        "dealerFeePct",
        `A dealer fee of ${f.dealerFeePct}% is not plausible. If that really is this lender's rate, put it on their rate sheet and quote the deal from it.`
      );
    }
    if (f.contractPriceCents <= 0) {
      block("pricing.contract_price_zero", "pricing", "contractPriceCents", "Contract price has not been calculated.");
    }
    // A down payment at or above the system price means there is nothing left
    // to finance — almost always a stray decimal, and it would put a nonsense
    // "amount financed" in front of a customer.
    if (f.downPaymentCents && f.contractPriceCents > 0 && f.downPaymentCents >= f.contractPriceCents) {
      block(
        "financing.down_payment_exceeds_price",
        "financing",
        "downPaymentCents",
        `A down payment of $${(f.downPaymentCents / 100).toLocaleString()} is not less than the $${(f.contractPriceCents / 100).toLocaleString()} system price — there would be nothing to finance.`
      );
    }
    // Cash is paid in full and has no lender, so neither figure can apply.
    if (f.product === "cash" && f.downPaymentCents) {
      block("financing.cash_down_payment", "financing", "downPaymentCents", "A cash deal is paid in full — it has no down payment.");
    }
    if (f.product === "cash" && f.loanMonthlyPaymentCents) {
      block("financing.cash_monthly", "financing", "loanMonthlyPaymentCents", "A cash deal has no lender and no monthly payment.");
    }

    // A loan is not "complete" without the three figures the lender issued. The
    // proposal quotes a monthly payment; quoting one we never received, or
    // omitting it entirely, is the difference between a quote and a guess.
    if (f.product === "loan") {
      /**
       * A DOCUMENT MAY NEVER QUOTE NO MONTHLY — but it does not need the
       * lender's own figure to quote one.
       *
       * The snapshot takes the payment from the rate sheet's published factor,
       * falling back to our amortisation of the quoted APR and term. Both are
       * the programme's own numbers; neither is in doubt on a deal like 0% over
       * 360 months at a fixed price, which is arithmetic rather than a
       * negotiation.
       *
       * There is no longer a third source above those two. `loanMonthlyPayment`
       * — the lender's figure re-keyed from an approval — had its own form on
       * the financing step and nobody ever filled it in, so the form went and
       * the warning that pointed at it went with it: telling a rep to enter a
       * number no screen accepts is worse than saying nothing.
       *
       * So this blocks only when NOTHING can produce a payment — a quoted
       * programme with neither a factor nor a term to amortise over. A stored
       * figure on a row written before the form was removed still outranks
       * both, which is why it satisfies this rule too.
       */
      const canDerivePayment =
        !!f.hasPaymentFactor ||
        (f.aprPct != null && f.aprPct >= 0 && !!f.loanTermMonths && f.loanTermMonths > 0);
      if (!canDerivePayment && !(f.loanMonthlyPaymentCents && f.loanMonthlyPaymentCents > 0)) {
        block(
          "financing.loan_monthly_missing",
          "financing",
          "loanMonthlyPaymentCents",
          "This programme publishes neither a payment factor nor a term to amortise over, so no monthly payment can be quoted. Add them to its rate sheet."
        );
      }
      /**
       * ZERO IS AN APR. A dealer-fee-buydown loan is written at 0% — that is
       * what the 65% fee bought — and treating it as "not entered" blocked
       * every deal on the product, unfixably: the APR is read off the rate
       * sheet, so there was no number a rep could type to satisfy it. Missing
       * is null; negative is nonsense; nought is a rate.
       */
      if (f.aprPct == null) {
        block("financing.loan_apr_missing", "financing", "aprPct", "Enter the loan's APR from the approval.");
      } else if (f.aprPct < 0) {
        block("financing.loan_apr_negative", "financing", "aprPct", "A loan's APR cannot be negative.");
      }
      if (!f.loanTermMonths || f.loanTermMonths <= 0) {
        block("financing.loan_term_missing", "financing", "loanTermMonths", "Enter the loan term in months from the approval.");
      }
    }
  } else {
    // Lease and PPA carry their own payment model; a loan payment here would be
    // a leftover from a product switch.
    if (f.loanMonthlyPaymentCents) {
      block(
        "financing.tpo_loan_monthly",
        "financing",
        "loanMonthlyPaymentCents",
        "A loan monthly payment does not belong on a lease or PPA. Use the lease's own monthly."
      );
    }
    if (f.downPaymentCents) {
      block("financing.tpo_down_payment", "financing", "downPaymentCents", "A lease or PPA is third-party owned — there is no down payment on a system you do not buy.");
    }
    if (f.aprPct != null) {
      block("financing.tpo_apr", "financing", "aprPct", "A lease or PPA has no APR. Clear the loan terms before quoting it.");
    }
    // Lease / PPA
    if (!f.termYears || f.termYears < 5 || f.termYears > 30) {
      block("financing.tpo_term_range", "financing", "termYears", "Lease and PPA terms run 5–30 years.");
    }
    if (f.escalatorPct == null || f.escalatorPct < 0 || f.escalatorPct > 5) {
      block("financing.escalator_range", "financing", "escalatorPct", "Annual escalator must be between 0% and 5%.");
    }
    if (f.product === "ppa") {
      if (!f.rateMillsPerKwh || f.rateMillsPerKwh <= 0) {
        block("financing.ppa_rate_missing", "financing", "rateMillsPerKwh", "A PPA needs a price per kWh.");
      } else if (f.rateMillsPerKwh > 400) {
        block("financing.ppa_rate_implausible", "financing", "rateMillsPerKwh", `$${(f.rateMillsPerKwh / 1000).toFixed(3)}/kWh is above any plausible retail rate.`);
      }
      if (f.monthlyPaymentCents) {
        block("financing.ppa_has_monthly", "financing", "monthlyPaymentCents", "A PPA is billed per kWh, not as a fixed monthly. Use a Lease for a fixed payment.");
      }
    }
    if (f.product === "lease") {
      if (!f.monthlyPaymentCents || f.monthlyPaymentCents <= 0) {
        block("financing.lease_monthly_missing", "financing", "monthlyPaymentCents", "A lease needs a fixed monthly payment.");
      }
      if (f.rateMillsPerKwh) {
        block("financing.lease_has_rate", "financing", "rateMillsPerKwh", "A lease is a fixed monthly, not a per-kWh rate. Use a PPA for per-kWh billing.");
      }
    }
    // PPW and gross price are meaningless on a third-party-owned system.
    if (f.grossPpwCents > 0) {
      warn("pricing.tpo_ppw", "pricing", "grossPpwCents", "Price per watt does not apply to a lease or PPA and will not be shown to the customer.");
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Customer & company identity
// ---------------------------------------------------------------------------

export function validateCustomer(c: CustomerForValidation, leadId?: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const to = leadId ? { label: "Open the deal", href: `/portal/leads/${leadId}` } : undefined;
  const push = (code: string, field: string, message: string) =>
    issues.push({ severity: "block", code, group: "customer", field, message, action: to });

  if (!`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim()) {
    push("customer.name_missing", "name", "The deal has no customer name. A proposal cannot be addressed to nobody.");
  }
  if (!c.address?.trim()) {
    push("customer.address_missing", "address", "The property address is missing.");
  }
  if (!c.city?.trim() || !c.state?.trim() || !c.zip?.trim()) {
    push("customer.address_incomplete", "address", "The property address is incomplete — city, state and ZIP are all required on the proposal.");
  }
  return issues;
}

/**
 * The company identity that has to appear on a customer-facing document.
 *
 * Blocking, not cosmetic: a proposal with no phone number on it is a document
 * the homeowner cannot act on, and one with no company address is not a
 * business record. These are configured once in Settings and then never think
 * about again — which is exactly why nobody notices they are blank.
 */
export function validateCompanyIdentity(c: CompanyForValidation): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  // Branding, not a "company settings" page: the Company Information card lives
  // there and is the only screen that writes these columns. The link used to
  // point at /portal/settings/company, which has never been a route, so the one
  // finding a rep could do nothing about was also the one that 404'd.
  const to = { label: "Open company information", href: "/portal/settings/branding" };
  const push = (code: string, field: string, message: string) =>
    issues.push({ severity: "block", code, group: "company", field, message, action: to });

  if (!c.name?.trim()) push("company.name_missing", "name", "Company name is not set. It has to appear on the proposal.");
  if (!c.phone?.trim()) push("company.phone_missing", "phone", "No company phone number is set. The customer needs a way to reach you from the document.");
  if (!c.email?.trim()) push("company.email_missing", "email", "No company email is set.");
  if (!c.address?.trim()) push("company.address_missing", "address", "No company address is set. A customer-facing quote has to carry the business's address.");
  return issues;
}

// ---------------------------------------------------------------------------
// Everything, together
// ---------------------------------------------------------------------------

/** Everything wrong with a deal, design and money together. */
export function validateSolarDeal(
  design: DesignForValidation,
  finance: FinanceForValidation,
  a: SolarAssumptions,
  leadId?: string
): ValidationIssue[] {
  return [...validateDesign(design, a, leadId), ...validateFinance(finance, a, leadId)];
}

/**
 * The full readiness report — the one generation is gated on.
 *
 * Deliberately a superset of validateSolarDeal rather than a replacement: the
 * design and money rules are the same rules, and having two copies that drift
 * is how a proposal gets generated around its own guard rails.
 */
export function validateProposalReadiness(args: {
  leadId?: string;
  customer: CustomerForValidation;
  design: DesignForValidation;
  finance: FinanceForValidation;
  company: CompanyForValidation;
  assumptions: SolarAssumptions;
}): ValidationIssue[] {
  return [
    ...validateCustomer(args.customer, args.leadId),
    ...validateDesign(args.design, args.assumptions, args.leadId),
    ...validateFinance(args.finance, args.assumptions, args.leadId),
    ...validateCompanyIdentity(args.company),
  ];
}
