import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getReportData } from "@/server/modules/reports/queries";

function cell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  const user = await requireUser();
  if (!can(user, "export", "Report")) return new NextResponse("Forbidden", { status: 403 });

  const data = await getReportData({ companyId: user.companyId, userId: user.userId, role: user.role });

  const lines: string[][] = [];
  lines.push(["Sales by Rep"]);
  lines.push(["Rep", "Jobs", "Revenue (USD)"]);
  for (const r of data.salesByRep) lines.push([r.name, String(r.jobs), (r.revenueCents / 100).toFixed(2)]);
  lines.push([]);
  lines.push(["Appointments by Source"]);
  lines.push(["Source", "Count"]);
  for (const r of data.leadsBySource) lines.push([r.name, String(r.count)]);
  lines.push([]);
  lines.push(["Summary"]);
  lines.push(["Total Appointments", String(data.totals.totalLeads)]);
  lines.push(["Closing Rate %", String(data.totals.closingRate)]);
  lines.push(["Jobs Completed", String(data.totals.jobsCompleted)]);
  lines.push(["Revenue (USD)", (data.totals.revenueCents / 100).toFixed(2)]);
  lines.push(["Commissions Owed (USD)", (data.totals.commissionsOwedCents / 100).toFixed(2)]);
  lines.push(["Payroll Owed (USD)", (data.totals.payrollOwedCents / 100).toFixed(2)]);

  const csv = lines.map((r) => r.map(cell).join(",")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="anexa_reports.csv"`,
    },
  });
}
