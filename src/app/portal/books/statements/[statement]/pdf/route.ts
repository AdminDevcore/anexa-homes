import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { buildReportPdf } from "@/server/modules/reports/pdf";
import { ledgerAccountOptions } from "@/server/modules/books/statements";
import {
  buildStatement,
  isStatementSlug,
  resolveStatementRequest,
} from "@/server/modules/books/statement-request";

/**
 * The PDF of a statement — the artifact an accountant actually files.
 *
 * Same resolver as the page and the CSV, so all three describe one request.
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

  const [report, company] = await Promise.all([
    buildStatement(user.companyId, request, accountLabel),
    prisma.company.findUnique({
      where: { id: user.companyId },
      select: { name: true, address: true, city: true, state: true, zip: true },
    }),
  ]);

  const pdf = await buildReportPdf(
    {
      name: company?.name ?? "Company",
      address: company?.address ?? null,
      city: company?.city ?? null,
      state: company?.state ?? null,
      zip: company?.zip ?? null,
    },
    report
  );

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${statement}.pdf"`,
    },
  });
}
