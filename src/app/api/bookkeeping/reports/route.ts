import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { computeReportsFromDb } from "@/server/modules/bookkeeping/reports-db";

/**
 * The P&L and Balance Sheet for one period, as JSON.
 *
 * WHO THIS IS FOR. The bookkeeping screen's period picker recomputes locally so
 * a change of period is instant, and that is exact only while the page it holds
 * is the whole ledger. Past the cap it would report any period below the cut as
 * $0 — the same truncation this endpoint exists to route around — so the picker
 * asks here instead. See `BookkeepingData.ledgerComplete`.
 *
 * `read`, not `export`: nothing leaves the product as a file here, it is the
 * same figures the page is already rendering. The download routes next door ask
 * for `export`.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Bookkeeping")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  // Epoch milliseconds, exactly as `resolvePeriod` produces them. A value that
  // is not a finite number is treated as absent rather than as zero, which
  // would silently mean "1 January 1970".
  const num = (key: string): number | null => {
    const raw = url.searchParams.get(key);
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const reports = await computeReportsFromDb(user.companyId, {
    startMs: num("start"),
    endMs: num("end"),
  });

  return NextResponse.json({
    pnl: reports.pnl,
    balanceSheet: reports.balanceSheet,
    moneyIn: reports.moneyIn,
    moneyOut: reports.moneyOut,
  });
}
