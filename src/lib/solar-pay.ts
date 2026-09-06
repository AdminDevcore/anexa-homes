import type {
  FinanceProduct,
  SolarBatteryPayPlan,
  SolarLeadAdjustMode,
  SolarRepPayMode,
} from "@prisma/client";

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
 * Both of those are denominated in WATTS, so neither can reach a job that sells
 * storage on its own. Such a job is paid by the same two ideas counted per
 * BATTERY, off a second lender setting — `batteryPayMode` — because a partner
 * routinely holds different opinions about the two: Amos pays a flat $/W on an
 * array while pricing storage at a flat $10,000 a battery.
 *
 *   BATTERY REDLINE — everything the deal holds above the rep's net $/battery.
 *   BATTERY FLAT    — a flat amount per installed battery, whatever it prices at.
 *
 * Nothing in here prices a deal. Price comes from `pricePurchase` /
 * `priceThirdParty` in solar-money.ts and is passed in, so there is one pricing
 * model and this file cannot drift from it.
 */

export type SolarPayBasis = "redline" | "per_watt" | "battery_redline" | "battery_flat";

/**
 * The terms one deal is paid on. Deliberately flat and serialisable: these are
 * the exact three values snapshotted onto the Commission row at generation, so
 * raising a rep's redline never re-prices a deal they already sold.
 */
export type SolarPayTerms = {
  basis: SolarPayBasis;
  /** Cents per watt of BASE price — net of the lender's fee, before adders.
   *  Set only on `redline`. */
  redlineCentsPerWatt: number | null;
  /** Mills (tenths of a cent) per watt. Set only on `per_watt`. */
  millsPerWatt: number | null;
  /** Cents of BASE price per BATTERY. Set only on `battery_redline`. */
  redlinePerBatteryCents: number | null;
  /** Flat cents per installed BATTERY. Set only on `battery_flat`. */
  perBatteryFlatCents: number | null;
};

/** The rep's own configured terms, straight off their User row. */
export type SolarRepConfig = {
  solarRedlineCentsPerWatt: number | null;
  solarPerWattMills: number | null;
  /**
   * WHICH battery-only plan this rep is on. A property of the REP.
   *
   * It used to be read off the lender's `batteryPayMode`, which was wrong: two
   * reps selling the same battery through the same partner can be on different
   * plans, and a partner's pricing model is not an employment agreement. The
   * lender's setting still prices the deal; it no longer decides anybody's pay.
   *
   * Null = not configured, which writes no line rather than a misleading zero.
   */
  solarBatteryPayPlan: SolarBatteryPayPlan | null;
  /** The company's battery COST basis for this rep. Read on the `margin` plan. */
  solarRedlinePerBatteryCents: number | null;
  /** Flat cents per installed battery. Read on the `flat` plan. */
  solarPerBatteryFlatCents: number | null;
};

/**
 * What the payroll engine should do with this deal.
 *
 * THREE answers, and the third is the reason this stopped being a nullable
 * return.
 *
 * `unconfigured` is the old `null`: nobody has set this rep up for this kind of
 * deal, so no line is written at all. NOT zero — a $0 line reads as a deal
 * genuinely worth nothing, and a configured 0 is a real and different answer.
 *
 * `refused` is new. A rule that prices per watt, meeting a deal that has none,
 * is not a rep who is owed nothing: it is a MISCONFIGURATION, and the two must
 * not look alike on a payroll run. Paying zero quietly is exactly how every
 * solar commission came out at $0 when `Project.contractValue` was read instead
 * of `SolarFinance`, and nobody noticed for weeks.
 */
export type SolarPayResolution =
  | { kind: "terms"; terms: SolarPayTerms }
  | { kind: "unconfigured" }
  | { kind: "refused"; reason: string };

/**
 * Which basis this deal pays on, and on what terms.
 */
export function resolveSolarPay(input: {
  /** What the deal sells. `pv` and `pv_storage` are the same answer. */
  systemType: "pv" | "pv_storage" | "storage";
  product: FinanceProduct;
  /** The deal's lender pay mode. Null when the deal has no lender yet. */
  lenderPayMode: SolarRepPayMode | null;
  rep: SolarRepConfig;
}): SolarPayResolution {
  const { systemType, product, lenderPayMode, rep } = input;

  if (systemType === "storage") {
    // A lease or PPA sells electricity, so there is no system price for a
    // redline to measure — and unlike PV there is no per-watt rate to fall back
    // on, because there are no watts. Say so rather than paying on nothing.
    //
    // THE ONLY REFUSAL LEFT ON THIS BRANCH. There used to be a second — a
    // per-watt lender meeting a deal with no watts — and it was not a rule but
    // an admission that no column could answer the question. The REP's own
    // battery plan answers it, so no lender setting is consulted here at all: a
    // partner that pays a flat $/W on an array can price storage any way it
    // likes, and how the REP is paid on it is a separate agreement.
    if (product === "lease" || product === "ppa") {
      return {
        kind: "refused",
        reason:
          "A lease or PPA has no system price to measure a redline against, and a storage deal has no watts to pay a rate on.",
      };
    }
    // The rep's plan, and nothing else. No plan configured is `unconfigured` —
    // not a silent default to one of them, because guessing which way a rep is
    // paid is exactly the mistake that reading the lender's column was.
    if (rep.solarBatteryPayPlan == null) return { kind: "unconfigured" };
    if (rep.solarBatteryPayPlan === "flat") {
      if (rep.solarPerBatteryFlatCents == null) return { kind: "unconfigured" };
      return {
        kind: "terms",
        terms: {
          basis: "battery_flat",
          redlineCentsPerWatt: null,
          millsPerWatt: null,
          redlinePerBatteryCents: null,
          perBatteryFlatCents: rep.solarPerBatteryFlatCents,
        },
      };
    }
    if (rep.solarRedlinePerBatteryCents == null) return { kind: "unconfigured" };
    return {
      kind: "terms",
      terms: {
        basis: "battery_redline",
        redlineCentsPerWatt: null,
        millsPerWatt: null,
        redlinePerBatteryCents: rep.solarRedlinePerBatteryCents,
        perBatteryFlatCents: null,
      },
    };
  }

  // pv and pv_storage: the identical path, exactly as it read before storage
  // existed. A battery on the roof changes nothing about how an array is paid.

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
    if (rep.solarPerWattMills == null) return { kind: "unconfigured" };
    return {
      kind: "terms",
      terms: {
        basis,
        redlineCentsPerWatt: null,
        millsPerWatt: rep.solarPerWattMills,
        redlinePerBatteryCents: null,
        perBatteryFlatCents: null,
      },
    };
  }
  if (rep.solarRedlineCentsPerWatt == null) return { kind: "unconfigured" };
  return {
    kind: "terms",
    terms: {
      basis,
      redlineCentsPerWatt: rep.solarRedlineCentsPerWatt,
      millsPerWatt: null,
      redlinePerBatteryCents: null,
      perBatteryFlatCents: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Company-provided leads
// ---------------------------------------------------------------------------

/**
 * The company's cut of a rep's commission when the COMPANY provided the lead.
 *
 * READ THE DIRECTION CAREFULLY. This percentage is the COMPANY TAKE, not the
 * rep's share — `solarCompanyLeadTakePct = 25` means the company keeps 25% and
 * the rep is paid 75%. It is the opposite convention to roofing's
 * `providedLeadSplitPct`, which names the REP's percentage of the pool, and the
 * two must never be read into one another.
 *
 * Applied to the rep's gross commission, whatever basis produced it — a redline
 * overage, a per-watt rate, or a per-battery amount on a storage job. The lead
 * came from the company in all four cases.
 *
 * WHEN IT IS DECIDED. Whether a deal was company-provided is finalised at M1,
 * not at signing: a lead's origin is routinely still being argued about while
 * the job is being built, and M1 is the first moment the answer has to be right
 * because it is the moment the money moves. The rate itself is snapshotted with
 * the rest of the rep's terms, so raising the company take tomorrow cannot
 * reprice a deal that has already funded.
 *
 * Null or zero is "no take", which is also what every deal did before this
 * existed — so an unconfigured company keeps paying exactly what it paid.
 */
export type CompanyLeadTake = {
  /** True only once M1 has finalised the classification. */
  companyProvided: boolean;
  /**
   * WHICH adjustment applies. Explicit, never inferred from which amount is
   * non-null — "nothing configured" and "a take of zero" are different answers
   * and a nullable pair cannot tell them apart.
   */
  mode: SolarLeadAdjustMode;
  /** The COMPANY's percentage. Read only on `percentage`. */
  takePct: number | null;
  /** The COMPANY's flat deduction, cents. Read only on `flat`. */
  flatCents: number | null;
};

export type SolarRepPayout = {
  /** What the basis produced, before the company's lead adjustment. */
  grossCents: number;
  /** What the company keeps because it provided the lead. Never negative. */
  companyTakeCents: number;
  /** What the rep is actually owed. This is the figure an override is a % of. */
  netCents: number;
  /** Which adjustment was applied. `none` when nothing was. */
  appliedMode: SolarLeadAdjustMode;
  /** The rate applied, snapshotted onto the commission row. 0 when not a percentage. */
  appliedTakePct: number;
  /** The flat amount applied, cents. 0 when not a flat deduction. */
  appliedFlatCents: number;
};

/**
 * Apply the company's lead adjustment to a gross commission.
 *
 * EXACTLY ONE METHOD. A rep is on a percentage, a flat deduction, or neither —
 * never both. `mode` decides, and the other amount is ignored rather than
 * combined, so a stale value left on a rep's profile from a previous
 * arrangement cannot quietly stack on top of the current one.
 *
 * Worked, from the spec:
 *   gross $10,000, percentage 40%  → company $4,000, rep $6,000
 *   gross $10,000, flat $1,500     → company $1,500, rep $8,500
 *   self-generated                 → company $0,     rep $10,000
 *
 * Never returns a negative. A percentage is clamped to 0–100 and a flat
 * deduction cannot exceed the gross: owing a rep a negative commission is a
 * chargeback, and a chargeback is raised deliberately and approved by an admin.
 * A mistyped rate must not be able to create one silently.
 */
/**
 * WHICH AMOUNT A PROFILE IS ALLOWED TO KEEP once a mode is chosen.
 *
 * The write-side twin of `applyCompanyLeadTake`. That function ignores the
 * amount its mode does not name; this one makes sure the ignored column is not
 * there to be read at all.
 *
 * Both halves are needed. Ignoring on read stops the wrong figure being
 * applied; clearing on write stops it existing — so a rep moved from "40%
 * company take" to "$1,500 flat" does not keep a 40% sitting underneath,
 * waiting for the next reader, the next report, or the next author who assumes
 * a non-null column means something.
 *
 * Returns exactly what should be persisted, both columns, always. Pure, so the
 * rule can be proved without a session or a database.
 */
export function leadAdjustColumns(
  mode: SolarLeadAdjustMode,
  input: { takePct: number | null; flatCents: number | null }
): { solarCompanyLeadTakePct: number | null; solarCompanyLeadFlatCents: number | null } {
  if (mode === "percentage") {
    return { solarCompanyLeadTakePct: input.takePct, solarCompanyLeadFlatCents: null };
  }
  if (mode === "flat") {
    return { solarCompanyLeadTakePct: null, solarCompanyLeadFlatCents: input.flatCents };
  }
  // "none" is an answer, not an absence: this rep gives up nothing on a company
  // lead. Both amounts go, so there is nothing left to read back.
  return { solarCompanyLeadTakePct: null, solarCompanyLeadFlatCents: null };
}

export function applyCompanyLeadTake(grossCents: number, take: CompanyLeadTake): SolarRepPayout {
  const gross = Math.max(0, Math.round(grossCents));
  const none: SolarRepPayout = {
    grossCents: gross,
    companyTakeCents: 0,
    netCents: gross,
    appliedMode: "none",
    appliedTakePct: 0,
    appliedFlatCents: 0,
  };
  if (!take.companyProvided || take.mode === "none") return none;

  if (take.mode === "percentage") {
    const pct = Math.min(100, Math.max(0, take.takePct ?? 0));
    if (pct === 0) return none;
    const companyTakeCents = Math.round((gross * pct) / 100);
    return {
      grossCents: gross,
      companyTakeCents,
      netCents: Math.max(0, gross - companyTakeCents),
      appliedMode: "percentage",
      appliedTakePct: pct,
      appliedFlatCents: 0,
    };
  }

  // flat
  const flat = Math.max(0, Math.round(take.flatCents ?? 0));
  if (flat === 0) return none;
  const companyTakeCents = Math.min(gross, flat);
  return {
    grossCents: gross,
    companyTakeCents,
    netCents: Math.max(0, gross - companyTakeCents),
    appliedMode: "flat",
    appliedTakePct: 0,
    appliedFlatCents: companyTakeCents,
  };
}

// ---------------------------------------------------------------------------
// Manager overrides
// ---------------------------------------------------------------------------

/**
 * What a manager's override pays on one deal.
 *
 * Four shapes, and the caller supplies the two figures they measure against:
 *
 *   ppw        — the system's DC watts × the manager's rate. Independent of what
 *                the rep earned; a manager on $/W is paid for the system going
 *                on the roof.
 *   percentage — a share of the rep's FINAL commission, after the company's lead
 *                adjustment. Off the contract price a manager's cut moved with
 *                the size of the system rather than with the rep's performance,
 *                and on a company-provided lead they were paid a share of money
 *                the company had already taken back.
 *   flat       — a fixed amount per qualifying deal.
 *   none       — no override. Represented by the absence of a row, so this
 *                function is never asked for it.
 *
 * NEVER SUBTRACTED FROM THE REP. An override is the company's arrangement with a
 * manager, paid alongside the rep's commission; several managers can hold one on
 * the same rep and they do not compete with each other or with the rep.
 */
export type ManagerOverrideTerms = {
  type: "percentage" | "flat" | "ppw";
  percent: number;
  flatAmount: number;
  perWattMills: number;
};

export type ManagerOverrideResult = {
  amountCents: number;
  /** What the amount was measured against — watts on `ppw`, cents otherwise. */
  basisCents: number;
};

export function managerOverrideCents(
  terms: ManagerOverrideTerms,
  deal: { systemWatts: number; repNetCents: number }
): ManagerOverrideResult {
  if (terms.type === "flat") {
    return { amountCents: Math.max(0, Math.round(terms.flatAmount)), basisCents: 0 };
  }
  if (terms.type === "ppw") {
    const watts = Math.max(0, Math.round(deal.systemWatts));
    // Mills are tenths of a cent, so the rate divides by 10 — not 1000. The same
    // arithmetic as the rep's per-watt basis, deliberately: one $/W convention.
    return {
      amountCents: Math.max(0, Math.round((watts * Math.max(0, terms.perWattMills)) / 10)),
      basisCents: watts,
    };
  }
  const net = Math.max(0, Math.round(deal.repNetCents));
  return {
    amountCents: Math.max(0, Math.round((net * Math.max(0, terms.percent)) / 100)),
    basisCents: net,
  };
}

export type SolarPayResult = {
  amountCents: number;
  /** What the amount was computed from: the base price on `redline`, watts on `per_watt`. */
  basisCents: number;
  /** The deal's BASE price per watt, cents — before adders, after the lender's
   *  cut. Zero on a system with no watts. */
  basePpwCents: number;
  /** How far above the redline the deal landed, cents per watt. Zero on `per_watt`. */
  overageCentsPerWatt: number;
};

/**
 * What the terms pay on this deal.
 *
 * `basePriceCents` is the BASE system price — what the company keeps for the
 * system once the lender's cut comes out, and before adders. The base rather
 * than the final price because moving a deal onto expensive money has to come
 * out of the rep, not the company: the same $3.20/W sticker is worth $6,240 to
 * the rep through an 18% partner and $1,760 through a 32% one. Before adders
 * because a steep-roof charge is priced from the catalogue to cover its own
 * cost — it is not rep overage, and it carries its own share of the dealer fee
 * so that the catalogue price survives the lender intact.
 */
export function solarRepPayCents(
  terms: SolarPayTerms,
  deal: { systemWatts: number; basePriceCents: number; batteryQty?: number }
): SolarPayResult {
  const watts = Math.max(0, Math.round(deal.systemWatts));
  const basePpwCents = watts > 0 ? deal.basePriceCents / watts : 0;

  if (terms.basis === "battery_redline") {
    const qty = Math.max(0, Math.round(deal.batteryQty ?? 0));
    const redline = terms.redlinePerBatteryCents ?? 0;
    // GUARDED ON THE COUNT, not merely clamped at zero.
    //
    // Without the guard, a deal with no batteries pays
    // `max(0, basePriceCents − redline × 0)` — the ENTIRE base price. That is
    // the shape of this bug on the per-watt basis too, and it is worse than the
    // silent zero this basis exists to prevent: a rep would be paid the whole
    // system.
    const amountCents = qty > 0 ? Math.max(0, deal.basePriceCents - redline * qty) : 0;
    return {
      amountCents,
      basisCents: qty > 0 ? Math.max(0, deal.basePriceCents) : 0,
      // There are no watts, so there is no per-watt figure to report. Zero here
      // is the honest answer rather than a division that did not happen.
      basePpwCents: 0,
      overageCentsPerWatt: 0,
    };
  }

  if (terms.basis === "battery_flat") {
    const qty = Math.max(0, Math.round(deal.batteryQty ?? 0));
    // The per-watt basis's twin, counted per battery, and guarded on the count
    // for the reason its sibling above is: a rate is only honestly zero when
    // there is nothing to pay it on. Cents, not mills — see the column.
    const amountCents = qty > 0 ? Math.max(0, qty * (terms.perBatteryFlatCents ?? 0)) : 0;
    // The basis is the COUNT, exactly as it is the watt count on `per_watt`.
    return { amountCents, basisCents: qty, basePpwCents: 0, overageCentsPerWatt: 0 };
  }

  if (terms.basis === "per_watt") {
    // Mills are tenths of a cent, so the rate divides by 10 — not 1000. A $0.40/W
    // rate is 400 mills, and 10,000 W of it is $4,000.
    const amountCents = Math.round((watts * (terms.millsPerWatt ?? 0)) / 10);
    return { amountCents: Math.max(0, amountCents), basisCents: watts, basePpwCents, overageCentsPerWatt: 0 };
  }

  const redline = terms.redlineCentsPerWatt ?? 0;
  // Integer throughout: subtracting the redline's whole-system value beats
  // multiplying a per-watt overage that has already been rounded.
  const amountCents = Math.max(0, deal.basePriceCents - redline * watts);
  return {
    amountCents,
    basisCents: Math.max(0, deal.basePriceCents),
    basePpwCents,
    overageCentsPerWatt: watts > 0 ? Math.max(0, basePpwCents - redline) : 0,
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

/** `$1,500/battery` from 150000 cents. Whole dollars — a battery is not priced
 *  to the cent, and the rate sits inline in a sentence. */
export function perBatteryLabel(cents: number): string {
  return `${usd(cents)}/battery`;
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
  if (terms.basis === "battery_redline") {
    return `Solar battery redline (${usd(terms.redlinePerBatteryCents ?? 0)}/battery)`;
  }
  if (terms.basis === "battery_flat") {
    const n = Math.max(0, Math.round(result.basisCents));
    return `Solar battery flat (${usd(terms.perBatteryFlatCents ?? 0)}/battery · ${n} ${
      n === 1 ? "battery" : "batteries"
    })`;
  }
  const size = `${watts.toLocaleString("en-US")} W`;
  if (terms.basis === "per_watt") {
    return `Solar per-watt (${millsPerWattLabel(terms.millsPerWatt ?? 0)} · ${size})`;
  }
  const over = `$${(result.overageCentsPerWatt / 100).toFixed(2)}/W`;
  return `Solar redline (${over} over ${centsPerWattLabel(terms.redlineCentsPerWatt ?? 0)} · ${size})`;
}

/** The one-line explanation under the worked example on the team page. */
export function solarPayExplanation(terms: SolarPayTerms, result: SolarPayResult): string {
  if (terms.basis === "battery_redline")
    return `Keeps everything above ${usd(terms.redlinePerBatteryCents ?? 0)} a battery — ${usd(
      result.amountCents
    )} to the rep.`;
  if (terms.basis === "battery_flat")
    return `Flat ${usd(terms.perBatteryFlatCents ?? 0)} a battery, whatever the deal prices at.`;
  if (terms.basis === "per_watt") return `Flat rate, whatever the deal prices at.`;
  return `Nets ${centsPerWattLabel(Math.round(result.basePpwCents))} against a ${centsPerWattLabel(
    terms.redlineCentsPerWatt ?? 0
  )} redline — ${usd(result.amountCents)} to the rep.`;
}
