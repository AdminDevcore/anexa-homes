import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getPayStubData, buildPayStubPdf } from "@/server/modules/payroll/paystub";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await params;
  const me = await requireUser();
  // Payroll exporters see anyone's stub; an employee may fetch their own.
  if (!can(me, "export", "Payroll") && me.userId !== userId) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const data = await getPayStubData(me.companyId, id, userId);
  if (!data) return new NextResponse("Not found", { status: 404 });

  const pdf = await buildPayStubPdf(data);
  const name = `paystub_${data.run.label.replace(/[^a-z0-9]+/gi, "_")}_${data.employee.lastName}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
    },
  });
}
