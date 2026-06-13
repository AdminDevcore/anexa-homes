import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";

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
 * CSV export of BOOKED transactions with flexible filters:
 *   ?from=YYYY-MM-DD &to=YYYY-MM-DD &category=<id|all> &direction=in|out|all
 * Only approved (booked) transactions are ever exported.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  if (!can(user, "read", "Bookkeeping")) return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const from = parseDay(url.searchParams.get("from"), false);
  const to = parseDay(url.searchParams.get("to"), true);
  const category = url.searchParams.get("category") || "all";
  const direction = url.searchParams.get("direction") || "all"; // all | in | out

  const where: Prisma.TransactionWhereInput = { companyId: user.companyId, approved: true };
  if (from || to) where.date = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  if (category !== "all") where.categoryId = category === "uncategorized" ? null : category;
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
  const span = [url.searchParams.get("from"), url.searchParams.get("to")].filter(Boolean).join("_to_") || "all";
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="transactions-${span}.csv"`,
    },
  });
}
