import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { resolvePeriod, resolveScope } from "@/server/modules/reports/builders";
import { buildCanvassingReport } from "@/server/modules/reports/canvassing";
import { reportToCsv } from "@/server/modules/reports/csv";

export async function GET(req: Request) {
  const user = await requireUser();
  if (!can(user, "export", "Report")) return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const period = resolvePeriod(
    url.searchParams.get("period") ?? "month",
    url.searchParams.get("from") ?? undefined,
    url.searchParams.get("to") ?? undefined,
  );
  const ru = { companyId: user.companyId, userId: user.userId, role: user.role };
  const scope = await resolveScope(ru, url.searchParams.get("scope") ?? undefined);
  const report = await buildCanvassingReport(ru, period, scope);

  return new NextResponse(reportToCsv(report), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="canvassing-${period.preset}.csv"`,
    },
  });
}
