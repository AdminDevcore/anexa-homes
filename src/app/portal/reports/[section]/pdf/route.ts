import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import {
  resolvePeriod,
  resolveScope,
  buildReportSection,
  allowedSections,
  type ReportType,
} from "@/server/modules/reports/builders";
import { buildReportPdf } from "@/server/modules/reports/pdf";

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

  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
    select: { name: true, address: true, city: true, state: true, zip: true },
  });

  const pdf = await buildReportPdf(
    { name: company?.name ?? "Company", address: company?.address ?? null, city: company?.city ?? null, state: company?.state ?? null, zip: company?.zip ?? null },
    report,
  );

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${section}-report-${period.preset}.pdf"`,
    },
  });
}
