import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { resolveScope } from "@/server/modules/reports/builders";
import { buildArAgingReport } from "@/server/modules/reports/ar-aging";
import { reportToCsv } from "@/server/modules/reports/csv";

export async function GET(req: Request) {
  const user = await requireUser();
  if (!can(user, "export", "Report")) return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const ru = { companyId: user.companyId, userId: user.userId, role: user.role };
  const scope = await resolveScope(ru, url.searchParams.get("scope") ?? undefined);
  const report = await buildArAgingReport(ru, scope);

  return new NextResponse(reportToCsv(report), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ar-aging.csv"`,
    },
  });
}
