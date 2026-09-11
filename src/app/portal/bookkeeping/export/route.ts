import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { buildTransactionReportPdf, type TxnReportRow } from "@/server/modules/bookkeeping/pdf";

function cell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseDay(s: string | null, end: boolean): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T${end ? "23:59:59.999" : "00:00:00"}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Export of BOOKED transactions with flexible filters:
 *   ?from=YYYY-MM-DD &to=YYYY-MM-DD &category=<id|all> &vendor=<name|all>
 *   &direction=in|out|all &format=csv|pdf
 * Filters compose with AND. Only approved (booked) transactions are exported.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  // A download is `export`, not `read`. Same grant list either way today
  // (super_admin + accounting), but the 1099 CSV carries recipient TINs and
  // the books leave the product as a file — so the verb that exists to be
  // withheld is the one that has to be asked for.
  if (!can(user, "export", "Bookkeeping")) return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const from = parseDay(url.searchParams.get("from"), false);
  const to = parseDay(url.searchParams.get("to"), true);
  const category = url.searchParams.get("category") || "all";
  const vendor = url.searchParams.get("vendor") || "all";
  const direction = url.searchParams.get("direction") || "all"; // all | in | out
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "csv";

  const where: Prisma.TransactionWhereInput = { companyId: user.companyId, approved: true };
  if (from || to) where.date = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  if (category !== "all") where.categoryId = category === "uncategorized" ? null : category;
  if (vendor !== "all") where.vendor = vendor;
  if (direction === "in") where.amountCents = { gt: 0 };
  else if (direction === "out") where.amountCents = { lt: 0 };

  const txns = await prisma.transaction.findMany({
    where,
    orderBy: { date: "asc" },
    select: {
      date: true,
      description: true,
      account: true,
      amountCents: true,
      vendor: true,
      projectId: true,
      category: { select: { name: true } },
    },
  });

  // Transaction has no `project` relation — map deal labels by projectId.
  const projectIds = [...new Set(txns.map((t) => t.projectId).filter((x): x is string => !!x))];
  const projects = projectIds.length
    ? await prisma.project.findMany({
        where: { id: { in: projectIds }, companyId: user.companyId },
        select: { id: true, projectNumber: true, lead: { select: { firstName: true, lastName: true } } },
      })
    : [];
  const dealById = new Map(
    projects.map((p) => [p.id, `${p.projectNumber}${p.lead ? ` · ${p.lead.firstName} ${p.lead.lastName}`.trimEnd() : ""}`]),
  );

  const span = [url.searchParams.get("from"), url.searchParams.get("to")].filter(Boolean).join("_to_") || "all";

  if (format === "pdf") {
    // Resolve a human-readable category label for the filter summary.
    let categoryLabel = "All categories";
    if (category === "uncategorized") categoryLabel = "Uncategorized";
    else if (category !== "all") {
      const c = await prisma.bookkeepingCategory.findFirst({ where: { id: category, companyId: user.companyId }, select: { name: true } });
      categoryLabel = `Category: ${c?.name ?? category}`;
    }
    const filters = [
      from || to ? `Dates: ${url.searchParams.get("from") || "start"} – ${url.searchParams.get("to") || "today"}` : "All dates",
      categoryLabel,
      vendor === "all" ? "All vendors" : `Vendor: ${vendor}`,
      direction === "in" ? "Income only" : direction === "out" ? "Expenses only" : "Income & expenses",
    ];
    const reportRows: TxnReportRow[] = txns.map((t) => ({
      date: t.date.toISOString().slice(0, 10),
      description: t.description,
      category: t.category?.name ?? "Uncategorized",
      vendor: t.vendor ?? "",
      deal: t.projectId ? dealById.get(t.projectId) ?? "" : "",
      amountCents: t.amountCents,
    }));
    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      select: { name: true, address: true, city: true, state: true, zip: true, phone: true, email: true },
    });
    if (!company) return new NextResponse("Not found", { status: 404 });
    const asOf = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const pdf = await buildTransactionReportPdf(company, reportRows, { asOf, filters });
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="transactions-${span}.pdf"`,
      },
    });
  }

  const header = ["Date", "Description", "Account", "Category", "Vendor", "Deal", "Type", "Amount"];
  const rows = txns.map((t) => {
    const deal = t.projectId ? dealById.get(t.projectId) ?? "" : "";
    return [
      t.date.toISOString().slice(0, 10),
      t.description,
      t.account ?? "",
      t.category?.name ?? "Uncategorized",
      t.vendor ?? "",
      deal,
      t.amountCents >= 0 ? "Income" : "Expense",
      (t.amountCents / 100).toFixed(2),
    ];
  });

  // A totals line for quick reconciliation.
  const total = txns.reduce((s, t) => s + t.amountCents, 0);
  const lines = [header, ...rows, [], ["", "", "", "", "", "", "Net", (total / 100).toFixed(2)]];

  const csv = lines.map((r) => r.map(cell).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="transactions-${span}.csv"`,
    },
  });
}
