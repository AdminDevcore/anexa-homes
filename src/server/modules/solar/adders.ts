import { prisma } from "@/server/db/client";
import { adderTotals, type AdderLine } from "@/lib/solar-adders";

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

export type DealAdderRow = AdderLine & {
  equipmentId: string | null;
  sortOrder: number;
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
      id: true, label: true, basis: true, flatCents: true,
      millsPerWatt: true, qty: true, sortOrder: true, equipmentId: true,
    },
  });
  return rows.map((r) => ({ ...r, basis: r.basis as AdderLine["basis"] }));
}

/**
 * Recompute `SolarFinance.adderTotalCents` from the lines and the drawn system.
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
export async function resolveAdderTotal(
  companyId: string,
  leadId: string
): Promise<number> {
  const [lines, design, finance] = await Promise.all([
    listDealAdders(companyId, leadId),
    prisma.solarDesign.findUnique({ where: { leadId }, select: { systemSizeKwDc: true } }),
    prisma.solarFinance.findUnique({ where: { leadId }, select: { adderTotalCents: true } }),
  ]);
  if (lines.length === 0) return finance?.adderTotalCents ?? 0;
  return adderTotals(lines, Math.round((design?.systemSizeKwDc ?? 0) * 1000)).totalCents;
}

export async function recomputeAdderTotal(
  companyId: string,
  leadId: string,
  opts: { force?: boolean } = {}
): Promise<number> {
  const [lines, design, finance] = await Promise.all([
    listDealAdders(companyId, leadId),
    prisma.solarDesign.findUnique({
      where: { leadId },
      select: { systemSizeKwDc: true },
    }),
    prisma.solarFinance.findUnique({
      where: { leadId },
      select: { id: true, adderTotalCents: true },
    }),
  ]);

  const watts = Math.round((design?.systemSizeKwDc ?? 0) * 1000);
  const { totalCents } = adderTotals(lines, watts);

  if (!finance) return totalCents;

  // The legacy case: a typed total, nothing itemised, and nobody has touched
  // the adders. Leave it exactly as it is.
  if (!opts.force && lines.length === 0 && finance.adderTotalCents > 0) {
    return finance.adderTotalCents;
  }

  if (finance.adderTotalCents !== totalCents) {
    await prisma.solarFinance.update({
      where: { leadId },
      data: { adderTotalCents: totalCents },
    });
  }
  return totalCents;
}
