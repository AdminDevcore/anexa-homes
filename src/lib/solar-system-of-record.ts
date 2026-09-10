import type { FinanceProduct } from "@prisma/client";
import type { SolarProposalSnapshot } from "@/lib/solar-proposal";

/**
 * WHICH SYSTEM THIS DEAL IS, when the deal holds two of them.
 *
 * A solar deal carries a frozen `SolarProposal.snapshot` — the document the
 * homeowner was quoted and signed — and a live `SolarDesign`, which a rep can
 * reopen and redraw at any time, including after the signature. The two are
 * different systems the moment anybody touches the builder again, and both are
 * legitimate: one is what was sold, the other is what is currently drawn.
 *
 * The defect this module exists to stop is REPORTING BOTH AT ONCE. The deal
 * page derived its System info slide and its Deal Value from the snapshot while
 * deriving the System & financing tiles from the live design, so a deal signed
 * at 25 panels / 11.00 kW / $60,500 showed 24 panels / 10.56 kW / $58,080 one
 * tab away, with nothing on screen saying the two figures were answers to
 * different questions. A rep reads that as a broken page; an installer reads it
 * as a spec sheet and orders the wrong array.
 *
 * So: ONE resolver, used by every surface that REPORTS the deal, and one drift
 * report for the case the two really have diverged. The builder is deliberately
 * not a caller — it is the surface you go to in order to MOVE the design, and
 * it must keep showing the design it is moving.
 *
 * Related: src/lib/solar-deal-value.ts, which applies the same rule to price.
 */

/** Where the reported figures came from, so a screen can say so out loud. */
export type ReportedSystemSource =
  | { kind: "proposal"; version: number; status: string; at: string | null }
  | { kind: "design" };

/**
 * The live design, flattened.
 *
 * Plain fields rather than a Prisma row: the equipment labels are assembled
 * from relations by the caller, and a module that took the row would only be
 * usable from the one query shape that happened to `include` them.
 */
export type DesignSystem = {
  sizeKwDc: number;
  moduleQty: number;
  moduleRatingW: number | null;
  year1ProductionKwh: number;
  offsetPct: number;
  annualUsageKwh: number | null;
  moduleLabel: string | null;
  inverterLabel: string | null;
  batteryLabel: string | null;
  batteryQty: number;
  product: FinanceProduct | null;
  /**
   * Cash and loan only — what this system was PRICED at, at today's design.
   *
   * THE PRICE, NOT THE CONTRACT, on a partner that writes its paper above it.
   * This field is compared field-for-field against the live finance row to
   * report drift, and the live row holds the price; reading the document's
   * printed total here would report a $70,000 "System cost has changed" on
   * every such deal, every time, for a design nobody had touched.
   */
  contractPriceCents: number | null;
  /**
   * THE SAME SYSTEM WITH THE HOUSEHOLD'S CREDITS OFF IT, cents.
   *
   * Purchase only, and null wherever this deal claims nothing — a lease and a
   * PPA own no array and therefore earn no credit, and neither does a deal a
   * rep has unticked every box on.
   *
   * It is the SECOND price on a solar deal and it belongs beside the first for
   * the same reason the contract does: since the credits started driving the
   * payment, what the household finances is what is left after them, so a card
   * showing only the contract shows a price no payment on the page divides
   * into. `buildCreditLadder` is the only thing that produces it — on a frozen
   * proposal it is read out of the ladder the customer's own document was
   * signed against, never recomputed.
   */
  netAfterCreditsCents: number | null;
  monthlyPaymentCents: number | null;
  rateMillsPerKwh: number | null;
};

export type ReportedSystem = DesignSystem & { source: ReportedSystemSource };

/**
 * The system this deal should be reported as.
 *
 * The newest proposal wins whenever there is one, at any status: a draft that
 * was generated and never sent is still a document somebody produced from a
 * deliberate state of the design, and it is the last such state. The live
 * design answers only while no proposal exists at all — the one moment it IS
 * the best account of the job.
 */
export function resolveReportedSystem({
  proposal,
  design,
}: {
  proposal: { version: number; status: string; at: string | null; snapshot: SolarProposalSnapshot } | null;
  design: DesignSystem | null;
}): ReportedSystem | null {
  if (proposal) {
    const { system, financing } = proposal.snapshot;
    // `energy` arrived with schemaVersion 2. Read as possibly-absent rather
    // than trusted: the whole promise of a snapshot is that a document
    // generated under an older shape still renders instead of throwing on a
    // key nobody wrote that year.
    const energy = proposal.snapshot.energy as SolarProposalSnapshot["energy"] | undefined;
    const label = (e: { manufacturer: string | null; model: string } | null | undefined) =>
      e ? `${e.manufacturer ? `${e.manufacturer} ` : ""}${e.model}` : null;
    return {
      source: {
        kind: "proposal",
        version: proposal.version,
        status: proposal.status,
        at: proposal.at,
      },
      sizeKwDc: system.sizeKwDc,
      // v1 snapshots have only the labels; v2 and later carry the catalogue
      // rows. Both render, because a frozen document has to keep working after
      // the shape around it moved on.
      moduleQty: system.module?.qty ?? system.moduleQty,
      moduleRatingW: system.module?.ratingW ?? null,
      year1ProductionKwh: system.year1ProductionKwh,
      offsetPct: system.offsetPct,
      annualUsageKwh: energy?.annualUsageKwh ?? null,
      moduleLabel: label(system.module) ?? system.moduleLabel,
      inverterLabel: label(system.inverter) ?? system.inverterLabel,
      batteryLabel: label(system.battery) ?? system.batteryLabel,
      // A v1 document names a battery without counting it; one is the only
      // honest reading of "there is a battery on this deal".
      batteryQty: system.battery?.qty ?? (system.batteryLabel ? 1 : 0),
      product: financing.product,
      contractPriceCents: financing.contractPriceCents,
      // THE LADDER THE DOCUMENT WAS SIGNED AGAINST, not today's rates and not
      // today's tick-boxes. Statute moves and a rep can untick a bonus after
      // the signature; neither changes what the household was handed. Absent on
      // every snapshot before v7, which reports no net at all rather than one
      // worked out from figures that were not in force.
      netAfterCreditsCents: financing.creditLadder?.netCostCents ?? null,
      monthlyPaymentCents: financing.monthlyPaymentCents,
      rateMillsPerKwh: financing.rateMillsPerKwh,
    };
  }
  return design ? { source: { kind: "design" }, ...design } : null;
}

export type DriftUnit = "kw" | "count" | "kwh" | "pct" | "cents";

/** One figure that moved, with both readings of it. */
export type SystemDriftRow = {
  key: string;
  label: string;
  unit: DriftUnit;
  proposed: number;
  working: number;
};

/**
 * What has changed on the design since the proposal being reported was frozen.
 *
 * Empty is the normal answer, and empty is also the answer when there is
 * nothing to compare — a deal with no proposal is reporting its design already,
 * so the design cannot disagree with itself.
 *
 * COMPARED AT DISPLAY PRECISION, not at float precision. Two offsets that both
 * print as 110% are the same figure as far as anybody reading the screen is
 * concerned, and a notice raised over the third decimal place is a notice reps
 * learn to ignore.
 */
export function systemDrift(
  reported: ReportedSystem | null,
  design: DesignSystem | null
): SystemDriftRow[] {
  if (!reported || !design || reported.source.kind !== "proposal") return [];
  const rows: SystemDriftRow[] = [];
  const add = (
    key: string,
    label: string,
    unit: DriftUnit,
    proposed: number | null,
    working: number | null,
    round: (n: number) => number
  ) => {
    if (proposed == null || working == null) return;
    if (round(proposed) === round(working)) return;
    rows.push({ key, label, unit, proposed, working });
  };
  const whole = (n: number) => Math.round(n);
  const twoDp = (n: number) => Math.round(n * 100);

  add("sizeKwDc", "System size", "kw", reported.sizeKwDc, design.sizeKwDc, twoDp);
  add("moduleQty", "Panels", "count", reported.moduleQty, design.moduleQty, whole);
  add(
    "year1ProductionKwh",
    "Year-1 production",
    "kwh",
    reported.year1ProductionKwh,
    design.year1ProductionKwh,
    whole
  );
  add("offsetPct", "Offset", "pct", reported.offsetPct, design.offsetPct, whole);
  add("batteryQty", "Batteries", "count", reported.batteryQty, design.batteryQty, whole);
  // Only a purchase has a contract price. A lease and a PPA are quoted as a
  // monthly or a rate, and reporting "$0 → $0" on one would invent a change
  // out of two fields neither side ever filled.
  add(
    "contractPrice",
    "System cost",
    "cents",
    reported.contractPriceCents,
    design.contractPriceCents,
    whole
  );
  // AND THE OTHER PRICE. This one moves for a second reason the row above does
  // not: the credits a deal claims are tick-boxes on the finance row, so a rep
  // who unticks the domestic-content bonus after signing changes what the deal
  // says the household nets without touching the drawing or the price. Left
  // unreported, the tile reads the frozen ladder while the card's own
  // breakdown re-derives a live one, and the deal shows two "after credits"
  // figures with nothing on screen saying why.
  add(
    "netAfterCredits",
    "After credits",
    "cents",
    reported.netAfterCreditsCents,
    design.netAfterCreditsCents,
    whole
  );
  return rows;
}
