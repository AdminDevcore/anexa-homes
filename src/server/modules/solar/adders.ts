import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import {
  adderConsumptionKwh,
  adderTotals,
  catalogueBasis,
  inAutoApplyBand,
  type AdderLine,
} from "@/lib/solar-adders";
import { effectiveUsageKwh } from "@/lib/solar-energy";
import { offsetPct } from "@/lib/solar-money";

/**
 * Reading a deal's adders, and keeping the cached total honest.
 *
 * Deliberately NOT in `adder-actions.ts`: that file is `"use server"`, so every
 * export there has to be an async server action. This is data resolution with
 * no notion of a request, and it is imported by the layout save as well as by
 * the adder actions — because a per-watt adder is priced off the system size,
 * and the system size changes when somebody draws on the roof.
 *
 * `SolarEquipment` and `SolarDealAdder` are SCOPED models, so callers outside a
 * portal session must wrap these in `runInVertical("solar", …)`.
 */

export { catalogueBasis, inAutoApplyBand };

export type DealAdderRow = AdderLine & {
  equipmentId: string | null;
  sortOrder: number;
  /** The words the customer reads, copied off the catalogue at pick time. */
  description: string | null;
  /** Named to the customer under "Additional services" on their proposal. */
  showOnProposal: boolean;
  /**
   * Added to the loan ON TOP of a partner's fixed or maximum $/W, at its own
   * price. Copied off the catalogue at pick time, like the price and the basis.
   */
  financedOnTop: boolean;
  /** What this adds to the household's yearly consumption, kWh. */
  consumptionKwhPerYear: number | null;
  /** The system-size rule put this here, so the same rule may take it away. */
  autoApplied: boolean;
};

/** Every adder line on a deal, in the order a breakdown should read them. */
export async function listDealAdders(
  companyId: string,
  leadId: string
): Promise<DealAdderRow[]> {
  const rows = await prisma.solarDealAdder.findMany({
    where: { companyId, leadId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, label: true, description: true, basis: true, flatCents: true,
      millsPerWatt: true, qty: true, sortOrder: true, equipmentId: true,
      showOnProposal: true, financedOnTop: true, consumptionKwhPerYear: true,
      autoApplied: true,
    },
  });
  return rows.map((r) => ({ ...r, basis: r.basis as AdderLine["basis"] }));
}

/**
 * What the adders on a deal add to the household's yearly consumption.
 *
 * Summed rather than stored per deal by hand, for the same reason the money is:
 * a rep who changes an EV-charger line from one unit to two has changed the
 * consumption, and a figure that only moves when somebody remembers to move it
 * is a figure that is wrong most of the time.
 */
export function adderUsageAdjustmentKwh(lines: DealAdderRow[]): number {
  return lines.reduce((n, l) => n + adderConsumptionKwh(l), 0);
}

/**
 * The catalogue adders that put THEMSELVES on a deal, and the band they do it
 * in.
 *
 * Only sellable rows with a band on them, because an auto-apply rule on a
 * retired adder is a retired adder still being sold.
 */
async function autoApplyRules(companyId: string) {
  return prisma.solarEquipment.findMany({
    where: {
      companyId,
      kind: "adder",
      isActive: true,
      OR: [{ autoApplyMinKw: { not: null } }, { autoApplyMaxKw: { not: null } }],
    },
    orderBy: [{ rank: "asc" }, { model: "asc" }],
    select: {
      id: true, manufacturer: true, model: true, description: true,
      adderBasis: true, priceCents: true, priceMillsPerWatt: true,
      showOnProposal: true, financedOnTop: true, autoApplyMinKw: true,
      autoApplyMaxKw: true,
    },
  });
}

/**
 * Which adders THIS lender puts on top of its own price.
 *
 * The catalogue's `financedOnTop` is the fallback, not the answer. It says what
 * the company does with a piece of work in general; the lender says what this
 * partner does with it, and only the second one is a fact about the paper the
 * customer signs. Amos funds a roof above its flat $5.50/W; the next capped
 * partner may well roll the same roof into the same ceiling, and the catalogue
 * has one tick to lend both of them.
 *
 * Absent from the map means NO RULE, which is different from a rule of false —
 * "no opinion, use the catalogue" against "this partner keeps it inside the
 * price even though the catalogue says otherwise". Both are real answers and
 * the second one is the whole reason the table stores `false` rows.
 *
 * A cash deal, or one whose lender has not been chosen yet, has no lender to
 * ask: the map comes back empty and every adder answers to the catalogue,
 * exactly as it did before this existed.
 */
export async function lenderAdderRules(
  lenderId: string | null | undefined
): Promise<Map<string, boolean>> {
  if (!lenderId) return new Map();
  const rows = await prisma.solarLenderAdderRule.findMany({
    where: { lenderId },
    select: { equipmentId: true, financedOnTop: true },
  });
  return new Map(rows.map((r) => [r.equipmentId, r.financedOnTop]));
}

/** The lender rule if this partner stated one, otherwise the catalogue's. */
export function financedOnTopFor(
  rules: Map<string, boolean>,
  equipmentId: string | null | undefined,
  catalogueDefault: boolean
): boolean {
  if (!equipmentId) return catalogueDefault;
  return rules.get(equipmentId) ?? catalogueDefault;
}

/** The lender a deal is designed for, or null. */
export async function dealLenderId(leadId: string): Promise<string | null> {
  const d = await prisma.solarDesign.findUnique({
    where: { leadId },
    select: { lenderId: true },
  });
  return d?.lenderId ?? null;
}

/**
 * Re-stamp every catalogue-linked adder line against the deal's CURRENT lender.
 *
 * `SolarDealAdder.financedOnTop` is copied at pick time and deliberately does
 * not move when Settings changes — a catalogue edit must never re-price a quote
 * somebody has already been shown. Changing the LENDER is not a settings edit
 * though: it is a decision about this one deal, taken on this one deal, and it
 * is the moment the partner's own rules start applying. Leaving the lines alone
 * through it is how a deal moved onto Amos ends up with its roof still buried
 * inside a ceiling Amos would have funded on top.
 *
 * Hand-typed lines are left exactly where they are. They have no catalogue row
 * for a lender to hold an opinion about, and the rep who ticked the box on one
 * is the only person who can have meant it.
 *
 * Returns how many lines actually moved, so a caller can say so rather than
 * leaving a rep to notice a number that changed by itself.
 */
export async function restampAddersForLender(
  companyId: string,
  leadId: string,
  lenderId: string | null
): Promise<number> {
  const lines = await prisma.solarDealAdder.findMany({
    where: { companyId, leadId, equipmentId: { not: null } },
    select: { id: true, equipmentId: true, financedOnTop: true },
  });
  if (lines.length === 0) return 0;

  const ids = [...new Set(lines.map((l) => l.equipmentId!))];
  const [rules, catalogue] = await Promise.all([
    lenderAdderRules(lenderId),
    prisma.solarEquipment.findMany({
      where: { companyId, id: { in: ids } },
      select: { id: true, financedOnTop: true },
    }),
  ]);
  const fallback = new Map(catalogue.map((c) => [c.id, c.financedOnTop]));

  const moved = lines.filter((l) => {
    // A line whose catalogue row has been deleted has no fallback to fall back
    // to. Its own stored flag is the only record of what it was sold as, so it
    // is left holding it rather than being reset to false by an absent row.
    if (!fallback.has(l.equipmentId!)) return false;
    return (
      financedOnTopFor(rules, l.equipmentId, fallback.get(l.equipmentId!)!) !==
      l.financedOnTop
    );
  });
  if (moved.length === 0) return 0;

  await prisma.$transaction(
    moved.map((l) =>
      prisma.solarDealAdder.update({
        where: { id: l.id },
        data: {
          financedOnTop: financedOnTopFor(
            rules,
            l.equipmentId,
            fallback.get(l.equipmentId!)!
          ),
        },
      })
    )
  );
  return moved.length;
}

/** How a catalogue row reads as a deal line. One place, so the two agree. */
export function lineFromCatalogue(
  item: {
    id: string;
    manufacturer: string | null;
    model: string;
    description: string | null;
    adderBasis: string | null;
    priceCents: number;
    priceMillsPerWatt: number | null;
    showOnProposal: boolean;
    financedOnTop: boolean;
  },
  /**
   * This deal's lender's own rules, when the caller has them. Omitted, the
   * catalogue answers for itself — which is right for a cash deal and for any
   * caller with no lender in hand.
   */
  rules: Map<string, boolean> = new Map()
) {
  const basis = catalogueBasis(item);
  return {
    equipmentId: item.id,
    // The label is COPIED, not joined at read time: the quote has to keep
    // saying what was sold even after somebody renames the catalogue row.
    label: [item.manufacturer, item.model].filter(Boolean).join(" ") || item.model,
    description: item.description,
    basis,
    flatCents: basis === "perWatt" ? null : item.priceCents,
    millsPerWatt: basis === "perWatt" ? item.priceMillsPerWatt : null,
    showOnProposal: item.showOnProposal,
    // COPIED like the price, and for the same reason: this decides what the
    // customer's contract comes to, and re-reading it through the catalogue
    // would let a settings tick move the total on a quote already shown.
    // Resolved against the LENDER first — see `financedOnTopFor`.
    financedOnTop: financedOnTopFor(rules, item.id, item.financedOnTop),
  };
}

/** The ids a rep has taken off this deal by hand, read out of the design's JSON. */
export function parseOptOut(value: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * Put the size-triggered adders where the drawn array says they belong.
 *
 * Called by the design recompute, so it runs on exactly the events that can
 * change the answer: a rep draws another string, swaps to a bigger panel, or
 * rubs half the array out. A small-system charge that applies under 5 kW has to
 * come OFF the moment the roof turns out to hold six.
 *
 * TWO THINGS IT WILL NOT TOUCH. A line somebody added by hand is never removed
 * — `autoApplied` is what separates "the rule put this here" from "a rep decided
 * this" — and an adder the rep has explicitly taken off this deal is never put
 * back, which is what `SolarDesign.autoAdderOptOut` remembers. Without the
 * second, removing an auto adder is a dead button: the next save silently
 * reinstates it.
 *
 * Returns what it changed, so a caller can say so rather than leaving a rep to
 * notice a line they did not add.
 */
export async function applyAutoAdders(
  companyId: string,
  leadId: string
): Promise<{ added: string[]; removed: string[] }> {
  const [design, rules] = await Promise.all([
    prisma.solarDesign.findUnique({
      where: { leadId },
      // The lender comes along because it decides whether an adder the SIZE
      // rule just added rides on top of this partner's price or inside it.
      select: { systemSizeKwDc: true, autoAdderOptOut: true, lenderId: true },
    }),
    autoApplyRules(companyId),
  ]);
  if (!design || rules.length === 0) return { added: [], removed: [] };
  const lenderRules = await lenderAdderRules(design.lenderId);

  const optedOut = new Set(parseOptOut(design.autoAdderOptOut));
  const existing = await prisma.solarDealAdder.findMany({
    where: { companyId, leadId, equipmentId: { not: null } },
    select: { id: true, equipmentId: true, autoApplied: true, label: true },
  });
  const onDeal = new Map(existing.map((l) => [l.equipmentId!, l]));

  const wanted = rules.filter(
    (r) => inAutoApplyBand(design.systemSizeKwDc, r) && !optedOut.has(r.id)
  );
  const wantedIds = new Set(wanted.map((r) => r.id));

  const toAdd = wanted.filter((r) => !onDeal.has(r.id));
  const toRemove = existing.filter(
    (l) => l.autoApplied && !wantedIds.has(l.equipmentId!)
  );
  if (toAdd.length === 0 && toRemove.length === 0) return { added: [], removed: [] };

  const last = await prisma.solarDealAdder.findFirst({
    where: { companyId, leadId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  let sortOrder = last?.sortOrder ?? 0;

  await prisma.$transaction([
    ...(toRemove.length
      ? [prisma.solarDealAdder.deleteMany({ where: { id: { in: toRemove.map((l) => l.id) } } })]
      : []),
    ...toAdd.map((r) =>
      prisma.solarDealAdder.create({
        data: {
          companyId,
          leadId,
          ...lineFromCatalogue(r, lenderRules),
          qty: 1,
          autoApplied: true,
          sortOrder: ++sortOrder,
        },
      })
    ),
  ]);

  return {
    added: toAdd.map((r) => [r.manufacturer, r.model].filter(Boolean).join(" ") || r.model),
    removed: toRemove.map((l) => l.label),
  };
}

/**
 * Recompute `SolarFinance.adderTotalCents` and `onTopAdderTotalCents` from the
 * lines and the drawn system.
 *
 * The cached total is what pricing, commissions and the customer's proposal all
 * read, so it has to be refreshed by everything that can move it — and there
 * are TWO such things, not one. Adding a line obviously moves it. Redrawing the
 * roof moves it too, because a per-watt adder is a rate: leaving the total
 * alone when the array grows is the exact staleness the typed "Adders $" box
 * had, just hidden one level deeper.
 *
 * `force` is about the deals that came BEFORE the lines existed. Those carry a
 * total somebody typed into a box, with nothing recorded about what it was for,
 * and no line items to rebuild it from. Recomputing one of those from an empty
 * table would silently zero money already quoted — so an untouched deal keeps
 * its figure, and only an edit to the adders themselves (`force`) hands
 * ownership of the total to the table. Removing the last line then correctly
 * takes it to zero, because that was a decision somebody made on purpose.
 *
 * A deal with no finance row yet is left alone rather than having one created:
 * an adder is not a decision to price the deal, and an empty finance row would
 * make the readiness report claim a product had been chosen.
 */
/**
 * What a deal's adders come to right now, WITHOUT writing anything.
 *
 * `saveSolarFinanceAction` needs the figure to price the contract and must not
 * take it from the request: the panel never sent one, so `f.adderTotalCents ??
 * 0` in `financeRowForProduct` wrote a zero over the cached total on every
 * save, and the contract price it stored had the customer's re-roof missing
 * from it — a quote short by the price of the extra work, generated from a
 * screen that had been showing the right number the whole time.
 *
 * Applies the same rule `recomputeAdderTotal` does: the lines win the moment
 * there is one, and a legacy typed total survives until somebody itemises it.
 */
export type AdderSplit = {
  /** Inside the partner's price: grosses up by the fee, eats into a ceiling. */
  adderTotalCents: number;
  /** On top of the partner's $/W (dealer fee still applied). A roof on a flat-rate partner. */
  onTopAdderTotalCents: number;
};

export async function resolveAdderTotal(
  companyId: string,
  leadId: string
): Promise<AdderSplit> {
  const [lines, design, finance] = await Promise.all([
    listDealAdders(companyId, leadId),
    prisma.solarDesign.findUnique({ where: { leadId }, select: { systemSizeKwDc: true } }),
    prisma.solarFinance.findUnique({
      where: { leadId },
      select: { adderTotalCents: true, onTopAdderTotalCents: true },
    }),
  ]);
  // The legacy branch keeps BOTH stored figures, not just the one: a deal with
  // no lines has nothing to re-derive either half from, and rebuilding one of
  // them from an empty table would move the customer's price.
  if (lines.length === 0) {
    return {
      adderTotalCents: finance?.adderTotalCents ?? 0,
      onTopAdderTotalCents: finance?.onTopAdderTotalCents ?? 0,
    };
  }
  const totals = adderTotals(lines, Math.round((design?.systemSizeKwDc ?? 0) * 1000));
  return {
    adderTotalCents: totals.financedInCents,
    onTopAdderTotalCents: totals.onTopCents,
  };
}

export async function recomputeAdderTotal(
  companyId: string,
  leadId: string,
  opts: { force?: boolean } = {}
): Promise<AdderSplit> {
  const [lines, design, finance] = await Promise.all([
    listDealAdders(companyId, leadId),
    prisma.solarDesign.findUnique({
      where: { leadId },
      select: {
        systemSizeKwDc: true,
        annualUsageKwh: true,
        usageAdjustmentKwh: true,
        year1ProductionKwh: true,
      },
    }),
    prisma.solarFinance.findUnique({
      where: { leadId },
      select: { id: true, adderTotalCents: true, onTopAdderTotalCents: true },
    }),
  ]);

  const watts = Math.round((design?.systemSizeKwDc ?? 0) * 1000);
  const { financedInCents, onTopCents } = adderTotals(lines, watts);
  const next: AdderSplit = {
    adderTotalCents: financedInCents,
    onTopAdderTotalCents: onTopCents,
  };

  /**
   * The consumption side, kept in step with the money side.
   *
   * Selling somebody an EV charger raises what their house will use, and offset
   * is a fraction with that figure underneath it — so an adder that changes
   * consumption and does not move the offset is a proposal promising a coverage
   * the array was never sized for. Written here rather than in the design
   * recompute because it is the ADDERS that moved, and this runs on every one
   * of those edits.
   */
  if (design) {
    const adjustment = adderUsageAdjustmentKwh(lines);
    if (adjustment !== design.usageAdjustmentKwh) {
      const usage = effectiveUsageKwh(design.annualUsageKwh, adjustment);
      await prisma.solarDesign.update({
        where: { leadId },
        data: {
          usageAdjustmentKwh: adjustment,
          offsetPct: usage > 0 ? offsetPct(design.year1ProductionKwh, usage) : 0,
        },
      });
    }
  }

  if (!finance) return next;

  // The legacy case: a typed total, nothing itemised, and nobody has touched
  // the adders. Leave it exactly as it is.
  if (!opts.force && lines.length === 0 && finance.adderTotalCents > 0) {
    return {
      adderTotalCents: finance.adderTotalCents,
      onTopAdderTotalCents: finance.onTopAdderTotalCents,
    };
  }

  if (
    finance.adderTotalCents !== next.adderTotalCents ||
    finance.onTopAdderTotalCents !== next.onTopAdderTotalCents
  ) {
    await prisma.solarFinance.update({ where: { leadId }, data: next });
  }
  return next;
}
