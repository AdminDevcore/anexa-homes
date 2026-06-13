import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { get1099Report } from "@/server/modules/bookkeeping/tax1099";

function cell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 1099-NEC CSV for an e-file service. ?year=YYYY &all=1 (include under-$600). */
export async function GET(req: Request) {
  const user = await requireUser();
  if (!can(user, "read", "Bookkeeping")) return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year")) || new Date().getFullYear();
  const includeAll = url.searchParams.get("all") === "1";
  const report = await get1099Report(user.companyId, year);
  const rows = includeAll ? report.rows : report.rows.filter((r) => r.reportable);

  const header = [
    "Payer Name", "Payer TIN", "Payer Address",
    "Recipient Name", "Recipient TIN", "Recipient Address",
    "Box 1 Nonemployee Compensation", "Tax Year", "Reportable (>=$600)",
  ];
  const lines = [
    header,
    ...rows.map((r) => [
      report.payer.name,
      report.payer.einTaxId ?? "MISSING — SET COMPANY EIN",
      report.payer.address,
      r.legalName || r.name,
      r.einTaxId ?? "MISSING",
      r.address || "MISSING",
      (r.totalCents / 100).toFixed(2),
      String(year),
      r.reportable ? "yes" : "no",
    ]),
  ];

  const csv = lines.map((row) => row.map(cell).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="1099-nec-${year}.csv"`,
    },
  });
}
