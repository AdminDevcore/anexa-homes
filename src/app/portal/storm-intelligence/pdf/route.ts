import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { buildReportPdf } from "@/server/modules/reports/pdf";
import { buildStormReport } from "@/server/modules/storm/report";

export async function GET(req: Request) {
  const user = await requireUser();
  // Same rule as the CSV sibling: a download is `export`, not `read`.
  if (!can(user, "export", "StormIntelligence")) return new NextResponse("Forbidden", { status: 403 });

  const sp = new URL(req.url).searchParams;
  const minScoreRaw = sp.get("minScore");
  const minScore = minScoreRaw != null && minScoreRaw !== "" ? Number(minScoreRaw) : undefined;
  const subject = sp.get("subject");
  const subjectType = subject === "lead" || subject === "knock" ? subject : undefined;

  const report = await buildStormReport(user, {
    minScore: Number.isFinite(minScore) ? minScore : undefined,
    subjectType,
  });

  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
    select: { name: true, address: true, city: true, state: true, zip: true },
  });

  const pdf = await buildReportPdf(
    {
      name: company?.name ?? "Company",
      address: company?.address ?? null,
      city: company?.city ?? null,
      state: company?.state ?? null,
      zip: company?.zip ?? null,
    },
    report,
  );

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="storm-intelligence.pdf"`,
    },
  });
}
