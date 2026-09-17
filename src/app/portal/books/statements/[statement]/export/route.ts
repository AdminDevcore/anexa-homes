import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { reportToCsv } from "@/server/modules/reports/csv";
import { ledgerAccountOptions } from "@/server/modules/books/statements";
import {
  buildStatement,
  isStatementSlug,
  resolveStatementRequest,
} from "@/server/modules/books/statement-request";

/**
 * The CSV of a statement.
 *
 * `export` on `Bookkeeping`, which is the verb the outside CPA holds — a
 * year-end handover is a set of files, not a screen share. Pinned by
 * export-route-guard.test.ts and export-grants.test.ts.
 *
 * The report is built from the SAME resolver the page uses, so this file cannot
 * drift into exporting a different period or basis than the one on screen.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ statement: string }> }
) {
  const { statement } = await params;
  if (!isStatementSlug(statement)) return new NextResponse("Not found", { status: 404 });

  const user = await requireUser();
  if (!can(user, "export", "Bookkeeping")) return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const request = resolveStatementRequest(statement, url.searchParams);

  const accountLabel =
    statement === "general-ledger"
      ? (await ledgerAccountOptions(user.companyId)).find((a) => a.value === request.accountId)?.label
      : undefined;

  const report = await buildStatement(user.companyId, request, accountLabel);

  return new NextResponse(reportToCsv(report), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${statement}.csv"`,
    },
  });
}
