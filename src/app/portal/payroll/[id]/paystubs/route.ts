import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getRunStubList, buildCombinedPayStubsPdf } from "@/server/modules/payroll/paystub";
import { prisma } from "@/server/db/client";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  if (!can(me, "export", "Payroll")) return new NextResponse("Forbidden", { status: 403 });

  const list = await getRunStubList(me.companyId, id);
  if (list.length === 0) return new NextResponse("Not found", { status: 404 });

  const run = await prisma.payrollRun.findFirst({ where: { id, companyId: me.companyId }, select: { label: true } });
  const pdf = await buildCombinedPayStubsPdf(list);
  const name = `paystubs_${(run?.label ?? "run").replace(/[^a-z0-9]+/gi, "_")}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"` },
  });
}
