import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { resolvePeriod, resolveScope } from "@/server/modules/reports/builders";
import { buildContractorPayReport } from "@/server/modules/reports/contractor-pay";
import { buildReportPdf } from "@/server/modules/reports/pdf";

export async function GET(req: Request) {
  const user = await requireUser();
  if (!can(user, "export", "Report") || !can(user, "read", "Commission")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const period = resolvePeriod(
    url.searchParams.get("period") ?? "month",
    url.searchParams.get("from") ?? undefined,
    url.searchParams.get("to") ?? undefined,
  );
  const ru = { companyId: user.companyId, userId: user.userId, role: user.role };
  const scope = await resolveScope(ru, url.searchParams.get("scope") ?? undefined);
  const report = await buildContractorPayReport(ru, period, scope);

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
      "Content-Disposition": `attachment; filename="contractor-pay-${period.preset}.pdf"`,
    },
  });
}
