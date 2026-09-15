import { canSeeFinancials } from "@/server/modules/dashboard/queries";
import { NOT_SET, formatDay, formatMoney, zonedDayRange } from "../format";
import { CONTRACT_VALUE_RULE, contractsSigned, scopeIsNarrowed } from "../sales";
import { defineTool, z } from "./define";

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

export const getSalesSummary = defineTool({
  name: "get_sales_summary",
  kind: "read",
  description:
    "Contracts signed in a date range and their total contract value, with the definition to say out loud. Use for any question about sales, sold deals, closed deals or revenue from signed contracts.",
  input: z.object({
    from: DAY.describe("First day, YYYY-MM-DD, in the company's timezone."),
    to: DAY.describe("Last day (inclusive), YYYY-MM-DD, in the company's timezone."),
  }),
  async run(ctx, { from, to }) {
    // Computed from source — signed deals at or past the sale line, valued at
    // their proposal's contract price. NOT the dashboard's revenue or SOLD
    // figures, which add up project values. The reasons are at the top of
    // sales.ts; boundaries.test.ts keeps it that way.
    let range: { start: Date; endExclusive: Date };
    try {
      range = zonedDayRange(from, to, ctx.timeZone);
    } catch (e) {
      return { ok: false, reason: "invalid", message: (e as Error).message };
    }

    const { saleLineLabel, deals, undated } = await contractsSigned(ctx.user, range);
    if (!saleLineLabel && deals.length === 0) {
      return {
        ok: true,
        data: {
          contracts_signed: 0,
          definition: "No stage in the Solar pipeline is marked as the sale, so nothing counts as a signed contract yet.",
        },
      };
    }

    const seeMoney = canSeeFinancials(ctx.user);
    const priced = deals.filter((d) => d.price?.contractPriceCents != null);
    const total = priced.reduce((sum, d) => sum + (d.price!.contractPriceCents as number), 0);
    const period = `${formatDay(range.start, ctx.timeZone)} to ${formatDay(
      new Date(range.endExclusive.getTime() - 1),
      ctx.timeZone
    )}`;
    const whose = scopeIsNarrowed(ctx.user) ? " among the deals you can see" : "";

    return {
      ok: true,
      data: {
        definition:
          `Contracts signed: Solar deals now at or past "${saleLineLabel ?? "the sale stage"}" that first reached it from ${period}${whose}. ` +
          (seeMoney ? `Value: ${CONTRACT_VALUE_RULE}.` : "Your role doesn't see dollar figures."),
        period,
        contracts_signed: deals.length,
        ...(seeMoney
          ? {
              total_contract_value: formatMoney(total),
              priced_deals: priced.length,
              deals_without_contract_price: deals
                .filter((d) => d.price?.contractPriceCents == null)
                .map((d) => d.customer),
            }
          : {}),
        deals: deals.slice(0, 25).map((d) => ({
          customer: d.customer,
          signed_on: formatDay(d.signedAt, ctx.timeZone),
          assigned_rep: d.rep ?? NOT_SET,
          ...(seeMoney
            ? {
                contract_price: formatMoney(d.price?.contractPriceCents),
                priced_from: d.price
                  ? `Proposal v${d.price.version}${d.price.approved ? " (approved)" : " (newest)"}`
                  : "no proposal",
              }
            : {}),
        })),
        ...(undated > 0
          ? { note: `${undated} deal(s) past the sale stage have no record of when they reached it, so they are not in any period.` }
          : {}),
      },
    };
  },
});
