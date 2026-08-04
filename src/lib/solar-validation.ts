import type { FinanceProduct } from "@prisma/client";
import type { SolarAssumptions } from "./solar-money";

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
 */

export type IssueSeverity = "block" | "warn";

export type ValidationIssue = {
  severity: IssueSeverity;
  field: string;
  message: string;
};

export type DesignForValidation = {
  systemSizeKwDc: number;
  year1ProductionKwh: number;
  annualUsageKwh: number | null;
  offsetPct: number;
  moduleQty: number;
  moduleRatingW: number | null;
};

export type FinanceForValidation = {
  product: FinanceProduct;
  grossPpwCents: number;
  dealerFeePct: number;
  contractPriceCents: number;
  rateMillsPerKwh: number | null;
  monthlyPaymentCents: number | null;
  escalatorPct: number | null;
  termYears: number | null;
  downPaymentCents: number | null;
  loanMonthlyPaymentCents: number | null;
};

/** True when nothing blocks generation. Warnings do not block. */
export function canGenerate(issues: ValidationIssue[]): boolean {
  return !issues.some((i) => i.severity === "block");
}

export function validateDesign(
  d: DesignForValidation,
  a: SolarAssumptions
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const block = (field: string, message: string) =>
    issues.push({ severity: "block", field, message });
  const warn = (field: string, message: string) =>
    issues.push({ severity: "warn", field, message });

  if (d.systemSizeKwDc <= 0) {
    block("systemSizeKwDc", "System size must be greater than zero.");
  }

  // ── Usage is the anchor for everything downstream ──────────────────────
  if (d.annualUsageKwh == null || d.annualUsageKwh <= 0) {
    block(
      "annualUsageKwh",
      "Enter the home's annual usage from the utility bill. Offset cannot be calculated without it — this is how a proposal ends up claiming a five-figure offset."
    );
  }

  // ── Offset ─────────────────────────────────────────────────────────────
  if (d.offsetPct < a.minOffsetPct) {
    block("offsetPct", `Offset of ${d.offsetPct.toFixed(0)}% is below the minimum of ${a.minOffsetPct}%.`);
  }
  if (d.offsetPct > a.maxOffsetPct) {
    block(
      "offsetPct",
      `Offset of ${d.offsetPct.toFixed(0)}% exceeds the maximum of ${a.maxOffsetPct}%. Check the annual usage figure — an offset this high almost always means the usage is wrong, not that the system is huge.`
    );
  } else if (d.offsetPct > 110) {
    warn(
      "offsetPct",
      `Offset is ${d.offsetPct.toFixed(0)}%. Most utilities do not credit production far beyond usage — confirm the customer is adding load (EV, pool, addition).`
    );
  }

  // ── Production must track usage and size ───────────────────────────────
  if (d.year1ProductionKwh <= 0 && d.systemSizeKwDc > 0) {
    block("year1ProductionKwh", "Year-one production has not been calculated.");
  }
  if (d.systemSizeKwDc > 0 && d.year1ProductionKwh > 0) {
    const impliedKwhPerKw = d.year1ProductionKwh / d.systemSizeKwDc;
    // Nowhere on earth is outside roughly 700-2200 kWh/kW/yr for a fixed array.
    if (impliedKwhPerKw < 700 || impliedKwhPerKw > 2200) {
      block(
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
        "systemSizeKwDc",
        `${d.moduleQty} × ${d.moduleRatingW}W is ${impliedKw.toFixed(2)} kW, but the system is recorded as ${d.systemSizeKwDc.toFixed(2)} kW.`
      );
    }
  }

  return issues;
}

export function validateFinance(
  f: FinanceForValidation,
  a: SolarAssumptions
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const block = (field: string, message: string) =>
    issues.push({ severity: "block", field, message });
  const warn = (field: string, message: string) =>
    issues.push({ severity: "warn", field, message });

  if (f.product === "cash" || f.product === "loan") {
    if (f.grossPpwCents < a.minPpwCents || f.grossPpwCents > a.maxPpwCents) {
      block(
        "grossPpwCents",
        `$${(f.grossPpwCents / 100).toFixed(2)}/W is outside the allowed range of $${(a.minPpwCents / 100).toFixed(2)}–$${(a.maxPpwCents / 100).toFixed(2)}/W.`
      );
    }
    // A cash deal has no lender, so it cannot carry a lender's fee.
    if (f.product === "cash" && f.dealerFeePct > 0) {
      block("dealerFeePct", "A cash deal has no lender and therefore no dealer fee.");
    }
    if (f.product === "loan" && f.dealerFeePct <= 0) {
      warn("dealerFeePct", "This loan has no dealer fee. Confirm with the lender — that is unusual.");
    }
    if (f.dealerFeePct >= 50) {
      block("dealerFeePct", `A dealer fee of ${f.dealerFeePct}% is not plausible.`);
    }
    if (f.contractPriceCents <= 0) {
      block("contractPriceCents", "Contract price has not been calculated.");
    }
    // A down payment at or above the system price means there is nothing left
    // to finance — almost always a stray decimal, and it would put a nonsense
    // "amount financed" in front of a customer.
    if (f.downPaymentCents && f.contractPriceCents > 0 && f.downPaymentCents >= f.contractPriceCents) {
      block(
        "downPaymentCents",
        `A down payment of $${(f.downPaymentCents / 100).toLocaleString()} is not less than the $${(f.contractPriceCents / 100).toLocaleString()} system price — there would be nothing to finance.`
      );
    }
    // Cash is paid in full and has no lender, so neither figure can apply.
    if (f.product === "cash" && f.downPaymentCents) {
      block("downPaymentCents", "A cash deal is paid in full — it has no down payment.");
    }
    if (f.product === "cash" && f.loanMonthlyPaymentCents) {
      block("loanMonthlyPaymentCents", "A cash deal has no lender and no monthly payment.");
    }
  } else {
    // Lease and PPA carry their own payment model; a loan payment here would be
    // a leftover from a product switch.
    if (f.loanMonthlyPaymentCents) {
      block(
        "loanMonthlyPaymentCents",
        "A loan monthly payment does not belong on a lease or PPA. Use the lease's own monthly."
      );
    }
    if (f.downPaymentCents) {
      block("downPaymentCents", "A lease or PPA is third-party owned — there is no down payment on a system you do not buy.");
    }
    // Lease / PPA
    if (!f.termYears || f.termYears < 5 || f.termYears > 30) {
      block("termYears", "Lease and PPA terms run 5–30 years.");
    }
    if (f.escalatorPct == null || f.escalatorPct < 0 || f.escalatorPct > 5) {
      block("escalatorPct", "Annual escalator must be between 0% and 5%.");
    }
    if (f.product === "ppa") {
      if (!f.rateMillsPerKwh || f.rateMillsPerKwh <= 0) {
        block("rateMillsPerKwh", "A PPA needs a price per kWh.");
      } else if (f.rateMillsPerKwh > 400) {
        block("rateMillsPerKwh", `$${(f.rateMillsPerKwh / 1000).toFixed(3)}/kWh is above any plausible retail rate.`);
      }
      if (f.monthlyPaymentCents) {
        block("monthlyPaymentCents", "A PPA is billed per kWh, not as a fixed monthly. Use a Lease for a fixed payment.");
      }
    }
    if (f.product === "lease") {
      if (!f.monthlyPaymentCents || f.monthlyPaymentCents <= 0) {
        block("monthlyPaymentCents", "A lease needs a fixed monthly payment.");
      }
      if (f.rateMillsPerKwh) {
        block("rateMillsPerKwh", "A lease is a fixed monthly, not a per-kWh rate. Use a PPA for per-kWh billing.");
      }
    }
    // PPW and gross price are meaningless on a third-party-owned system.
    if (f.grossPpwCents > 0) {
      warn("grossPpwCents", "Price per watt does not apply to a lease or PPA and will not be shown to the customer.");
    }
  }

  return issues;
}

/** Everything wrong with a deal, design and money together. */
export function validateSolarDeal(
  design: DesignForValidation,
  finance: FinanceForValidation,
  a: SolarAssumptions
): ValidationIssue[] {
  return [...validateDesign(design, a), ...validateFinance(finance, a)];
}
