import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, "export", "Payroll")) return new NextResponse("Forbidden", { status: 403 });

  const run = await prisma.payrollRun.findFirst({
    where: { id, companyId: user.companyId },
    include: {
      items: {
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
          commission: { include: { project: { select: { projectNumber: true } } } },
        },
      },
    },
  });
  if (!run) return new NextResponse("Not found", { status: 404 });

  const header = ["Recipient", "Email", "Item", "Project", "Amount (USD)", "Paid"];
  const rows = run.items.map((i) => [
    `${i.user.firstName} ${i.user.lastName}`,
    i.user.email,
    i.label,
    i.commission?.project.projectNumber ?? "",
    (i.amount / 100).toFixed(2),
    i.paid ? "Yes" : "No",
  ]);
  const total = run.items.reduce((s, i) => s + i.amount, 0);
  rows.push(["", "", "", "TOTAL", (total / 100).toFixed(2), ""]);

  const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
  const filename = `payroll_${run.label.replace(/[^a-z0-9]+/gi, "_")}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
