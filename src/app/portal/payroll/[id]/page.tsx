import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { PageHeader, StatCard } from "@/components/portal/ui";
import { PayrollRunActions } from "@/components/portal/payroll-actions";
import { PayStubActions } from "@/components/portal/pay-stub-actions";
import { PayStubBatchActions } from "@/components/portal/pay-stub-batch";
import { Button } from "@/components/ui/button";
import { currentFormatters } from "@/lib/format-server";
import { Wallet } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Payroll Run" };

export default async function PayrollRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const fmt = await currentFormatters();
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, "read", "Payroll")) redirect("/portal/dashboard");

  const run = await prisma.payrollRun.findFirst({
    where: { id, companyId: user.companyId },
    include: {
      items: {
        include: {
          user: { select: { firstName: true, lastName: true } },
          commission: { include: { project: { select: { projectNumber: true } } } },
        },
      },
    },
  });
  if (!run) notFound();

  const total = run.items.reduce((s, i) => s + i.amount, 0);
  const paidTotal = run.items.filter((i) => i.paid).reduce((s, i) => s + i.amount, 0);
  const canManage = can(user, "update", "Payroll");
  const canExport = can(user, "export", "Payroll");

  // Group line items per employee for pay stubs.
  const byEmployee = new Map<string, { name: string; total: number; count: number }>();
  for (const i of run.items) {
    const e = byEmployee.get(i.userId) ?? { name: `${i.user.firstName} ${i.user.lastName}`, total: 0, count: 0 };
    e.total += i.amount;
    e.count += 1;
    byEmployee.set(i.userId, e);
  }

  return (
    <div className="space-y-6">
      <Link
        href="/portal/payroll"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to payroll
      </Link>

      <PageHeader
        title={run.label}
        description={`${fmt.date(run.periodStart)} – ${fmt.date(run.periodEnd)}`}
        action={
          <div className="flex items-center gap-2">
            {canExport && (
              <Button asChild variant="outline" size="sm">
                <a href={`/portal/payroll/${run.id}/export`}>
                  <Download className="size-4" /> Export CSV
                </a>
              </Button>
            )}
            {canExport && <PayStubBatchActions runId={run.id} />}
            {canManage && <PayrollRunActions id={run.id} status={run.status} />}
            <span className="rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background capitalize">
              {run.status}
            </span>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total" value={fmt.money(total)} icon={Wallet} accent />
        <StatCard label="Paid" value={fmt.money(paidTotal)} icon={Wallet} />
        <StatCard label="Items" value={run.items.length} icon={Wallet} />
      </div>

      {canExport && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3 font-semibold">Pay stubs</div>
          <ul className="divide-y divide-border">
            {[...byEmployee.entries()].map(([uid, e]) => (
              <li key={uid} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div>
                  <div className="font-medium">{e.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {e.count} item{e.count === 1 ? "" : "s"} · {fmt.money(e.total)} net
                  </div>
                </div>
                <PayStubActions runId={run.id} userId={uid} canEmail={canExport} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Recipient</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="hidden sm:table-cell">Project</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Paid</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {run.items.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-medium">{i.user.firstName} {i.user.lastName}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{i.label}</TableCell>
                <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                  {i.commission?.project.projectNumber ?? "—"}
                </TableCell>
                <TableCell className="text-right font-medium">{fmt.money(i.amount)}</TableCell>
                <TableCell>
                  <span className={`text-xs font-medium ${i.paid ? "text-emerald-600" : "text-muted-foreground"}`}>
                    {i.paid ? "Paid" : "Unpaid"}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
