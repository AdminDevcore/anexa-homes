import { solarVerticalEnabled } from "@/server/vertical/flag";
import { resolveVertical } from "@/server/vertical/context";

/**
 * Vertical filter for the TAGGED ledger models (Transaction, Commission,
 * Invoice, ProjectCost) inside Reports.
 *
 * Those models are stamped with a vertical on write but deliberately NOT
 * filtered on read — one company, one general ledger, so the P&L still rolls up
 * to a consolidated total. That is right for bookkeeping and wrong for Reports,
 * which must show one workspace at a time. Report queries therefore filter
 * explicitly, here, rather than by promoting the models to SCOPED and breaking
 * the consolidated books.
 *
 * The leak this closes: report scoping went through `scopeProjectIds()`, which
 * returns `null` for a company-wide scope — and a null project filter means NO
 * filter, so an admin's Financial Summary summed both verticals' money.
 *
 * Two deliberate choices keep Roofing byte-for-byte unchanged:
 *
 *  1. Flag off → `{}`. No clause is added at all, so the SQL is identical to
 *     what shipped before this existed.
 *  2. NULL vertical is always included. Genuinely company-level rows (office
 *     rent, a software subscription) carry no vertical, and dropping them would
 *     silently change Roofing's P&L the moment the flag went on. They show in
 *     both workspaces, the standard treatment of unallocated overhead.
 */
export async function ledgerVerticalFilter(): Promise<
  Record<string, never> | { OR: [{ vertical: "roofing" | "solar" }, { vertical: null }] }
> {
  if (!solarVerticalEnabled()) return {};
  const res = await resolveVertical();
  if (res.mode !== "vertical") return {};
  return { OR: [{ vertical: res.vertical }, { vertical: null }] };
}
