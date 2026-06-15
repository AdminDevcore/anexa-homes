import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import {
  resolvePeriod,
  resolveScope,
  buildReportSection,
  allowedSections,
  type ReportType,
} from "@/server/modules/reports/builders";
import { reportToCsv } from "@/server/modules/reports/csv";

function isSection(s: string): s is ReportType {
  return s === "executive" || s === "operations" || s === "financial" || s === "payroll";
}

export async function GET(req: Request, ctx: { params: Promise<{ section: string }> }) {
  const { section } = await ctx.params;
  const user = await requireUser();
  if (!isSection(section)) return new NextResponse("Not found", { status: 404 });
  if (!can(user, "export", "Report") || !allowedSections(user.role).includes(section)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const period = resolvePeriod(
    url.searchParams.get("period") ?? "week",
    url.searchParams.get("from") ?? undefined,
    url.searchParams.get("to") ?? undefined,
  );
  const ru = { companyId: user.companyId, userId: user.userId, role: user.role };
  const scope = await resolveScope(ru, url.searchParams.get("scope") ?? undefined);
  const report = await buildReportSection(ru, section, period, scope);

  const csv = reportToCsv(report);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${section}-report-${period.preset}.csv"`,
    },
  });
}
