import type { FinanceProduct, Prisma } from "@prisma/client";
import type { CreditLadder } from "@/lib/solar-credit-ladder";
import type { SnapshotFinancing, SolarProposalSnapshot } from "@/lib/solar-proposal";

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

/**
 * WHICH VERSION A SOLAR DEAL IS REPORTED AT, as an ordering.
 *
 * The approved one where a deal has one — a customer signature applies that
 * mark by itself — and the newest otherwise. Exported because it is asked in
 * three places now (the deal page, the stamp on `Lead.value`, the backfill
 * script) and three copies of a sort rule is three chances to drift.
 *
 * **`nulls: "last"` is load-bearing.** Postgres sorts NULLs FIRST on a DESC
 * order, so an ordering written without it asks for the approved version and
 * reliably returns whichever draft was generated last — which reads as an
 * off-by-one in the caller rather than as a sort default. Pinned against real
 * Postgres in `proposal-approval.itest.ts`.
 *
 * It lives HERE, beside the resolver it feeds, rather than in a server module:
 * a plain script has to be able to ask this question without dragging in the
 * vertical-scoped Prisma client.
 */
export const REPORTED_PROPOSAL_ORDER: Prisma.SolarProposalOrderByWithRelationInput[] = [
  { approvedAt: { sort: "desc", nulls: "last" } },
  { version: "desc" },
];

/** Where the reported figures came from, so a screen can say so out loud. */
export type ReportedSystemSource =
  | {
      kind: "proposal";
      version: number;
      status: string;
      at: string | null;
      /** True when this is the version somebody marked as the one that sold. */
      approved: boolean;
    }
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
 * THE APPROVED VERSION WINS. A deal accumulates versions — ten on the deal that
 * prompted the approval mark — and exactly one of them can be stamped as the
 * one that sold (a partial unique index enforces that, and a customer signature
 * stamps it by itself). Where that stamp exists it is the whole answer: it is
 * the document the household agreed to, the one the funder is submitted and the
 * one the rep is paid on, and a later draft generated while somebody explored a
 * bigger array must not restate the deal underneath it.
 *
 * With nothing approved the NEWEST proposal answers, at any status: a draft that
 * was generated and never sent is still a document somebody produced from a
 * deliberate state of the design, and it is the last such state. The live
 * design answers only while no proposal exists at all — the one moment it IS
 * the best account of the job.
 *
 * Picking between versions is the CALLER's job — it is a query, not a
 * computation, and the deal page's own `orderBy` does it. This function is
 * handed the version that won and says what it says.
 */
export function resolveReportedSystem({
  proposal,
  design,
}: {
  proposal: {
    version: number;
    status: string;
    at: string | null;
    approved: boolean;
    snapshot: SolarProposalSnapshot;
  } | null;
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
        approved: proposal.approved,
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
  // "Contract", not "System cost". The cost tile leads with the household's NET
  // now and labels the contract underneath it, so a drift row calling the
  // contract "System cost" would name one figure two ways on one card.
  add(
    "contractPrice",
    "Contract",
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

/**
 * ONE RUNG OF THE PRICE, as a screen draws it: a total, and the rate per
 * installed watt that total works out at.
 *
 * `ppwCents` is NULL rather than zero wherever there are no installed watts to
 * be per — every storage-only job. A rate of "$0.00/W" beside a $19,000 battery
 * is a page inventing a price for an array that was never sold, and it is the
 * same rule the snapshot itself follows when it freezes `finalPpwCents` as null
 * on a storage document.
 */
export type PriceRung = { totalCents: number; ppwCents: number | null };

/**
 * THE PRICE LADDER THIS DEAL IS REPORTED AT.
 *
 * `source` is the whole reason the shape exists: the two ladders below are not
 * the same arithmetic said twice, and a screen drawing them has to know which
 * one it has.
 *
 * - `"proposal"` — the rungs the customer's own document was frozen with. The
 *   dealer fee is already INSIDE `base` and `adders` (that is what "sticker"
 *   means), so `base + adders + battery === contract` holds to the cent, and a
 *   rep reading the card is reading the sheet on the kitchen table.
 * - `"design"` — today's working derivation, on a deal that has never produced
 *   a document. `base` is the pre-fee figure the rep typed in the builder, so
 *   the rungs deliberately do NOT sum to the contract: the lender's cut sits
 *   between them and is not shown here.
 */
export type ReportedPriceLadder = {
  source: "proposal" | "design";
  base: PriceRung;
  adders: PriceRung;
  /** Zero on a deal without storage, which shows no rung at all. */
  batteryPriceCents: number;
  batteryQty: number;
  final: PriceRung;
  /** The system these rungs priced, watts. Zero on a storage-only job. */
  systemWatts: number;
  /** The credits taken off that price. Null wherever there are none. */
  credits: CreditLadder | null;
};

const rung = (totalCents: number, watts: number): PriceRung => ({
  totalCents,
  ppwCents: watts > 0 ? Math.round(totalCents / watts) : null,
});

/**
 * The ladder the approved document was signed against.
 *
 * READ, NEVER RE-DERIVED. Every figure here is lifted out of the frozen
 * snapshot: the rates on the deal move, the catalogue moves, statute moves, and
 * none of that is allowed to restate a price a household has already agreed to.
 * The only arithmetic performed is the division into a rate per watt, and that
 * is done here rather than read off the row so the rate and the total on the
 * same line always divide into each other.
 *
 * Null on a document that quotes no price — a lease and a PPA are sold as a
 * monthly and a rate per kWh, and there is no ladder under either.
 *
 * `basePriceCents` is absent on documents generated before the base was frozen;
 * those fall back to the total less everything priced separately, which is the
 * same reading the customer's own cost chapter takes of them.
 */
export function frozenPriceLadder(
  financing: SnapshotFinancing,
  sizeKwDc: number
): ReportedPriceLadder | null {
  const contractPriceCents = financing.contractPriceCents;
  if (contractPriceCents == null) return null;
  const watts = Math.max(0, Math.round(sizeKwDc * 1000));
  const batteryPriceCents = Math.max(0, financing.batteryPriceCents ?? 0);
  const adderTotalCents = Math.max(0, financing.adderTotalCents ?? 0);
  const basePriceCents =
    financing.basePriceCents ?? contractPriceCents - adderTotalCents - batteryPriceCents;
  return {
    source: "proposal",
    base: rung(basePriceCents, watts),
    adders: rung(adderTotalCents, watts),
    batteryPriceCents,
    batteryQty: financing.batteryQty ?? (financing.batteryLabel ? 1 : 0),
    // The document's own rate where it froze one, and the contract divided by
    // the array where it did not — never the stored gross, which is a third
    // number arrived at another way.
    final: {
      totalCents: contractPriceCents,
      ppwCents:
        financing.finalPpwCents ?? (watts > 0 ? Math.round(contractPriceCents / watts) : null),
    },
    systemWatts: watts,
    credits: financing.creditLadder ?? null,
  };
}
