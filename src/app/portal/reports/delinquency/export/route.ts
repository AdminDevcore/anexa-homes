import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { resolveScope } from "@/server/modules/reports/builders";
import { buildDelinquencyReport, delinquencyRenderable } from "@/server/modules/reports/delinquency";
import { reportToCsv } from "@/server/modules/reports/csv";

export async function GET(req: Request) {
  const user = await requireUser();
  if (!can(user, "export", "Report")) return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const ru = { companyId: user.companyId, userId: user.userId, role: user.role };
  const scope = await resolveScope(ru, url.searchParams.get("scope") ?? undefined);
  const report = await buildDelinquencyReport(scope, { includeDueSoon: url.searchParams.get("due") === "1" });

  const csv = reportToCsv(delinquencyRenderable(report));
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="delinquency-report.csv"`,
    },
  });
}
