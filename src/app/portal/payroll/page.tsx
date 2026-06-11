import { redirect } from "next/navigation";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { PageHeader, EmptyState, StatCard } from "@/components/portal/ui";
import { ListFilter } from "@/components/portal/list-filter";
import { NewPayrollRunDialog } from "@/components/portal/payroll-actions";
import { currentFormatters } from "@/lib/format-server";

export const metadata = { title: "Payroll" };

export default async function PayrollPage() {
  const fmt = await currentFormatters();
  const user = await requireUser();
  if (!can(user, "read", "Payroll")) redirect("/portal/dashboard");

  const canManage = can(user, "update", "Payroll");

  const [runs, pendingAgg, commissionAgg] = await Promise.all([
    prisma.payrollRun.findMany({
      where: { companyId: user.companyId },
      orderBy: { createdAt: "desc" },
      include: { items: true },
    }),
    prisma.payrollItem.aggregate({
      where: { paid: false, payrollRun: { companyId: user.companyId } },
      _sum: { amount: true },
    }),
    prisma.commission.aggregate({
      where: { companyId: user.companyId, status: { in: ["pending", "approved"] } },
      _sum: { amount: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll & Accounting"
        description="Batch approved commissions into payroll runs, approve, and pay."
        action={canManage ? <NewPayrollRunDialog /> : undefined}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Unpaid Payroll" value={fmt.money(pendingAgg._sum.amount ?? 0, { compact: true })} icon={Wallet} accent />
        <StatCard label="Commissions Owed" value={fmt.money(commissionAgg._sum.amount ?? 0, { compact: true })} icon={Wallet} />
        <StatCard label="Payroll Runs" value={runs.length} icon={Wallet} />
      </div>

      {runs.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No payroll runs yet"
          description={
            canManage
              ? "Create a payroll run to batch approved commissions for a pay period."
              : "Payroll runs will appear here."
          }
        />
      ) : (
        <ListFilter placeholder="Search payroll runs…">
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {runs.map((r) => (
            <Link
              key={r.id}
              data-search-item
              data-search-text={`${r.label} ${r.status}`}
              href={`/portal/payroll/${r.id}`}
              className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-muted/40"
            >
              <div>
                <div className="font-medium">{r.label}</div>
                <div className="text-xs text-muted-foreground">
                  {fmt.date(r.periodStart)} – {fmt.date(r.periodEnd)} · {r.items.length} item(s)
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-medium">
                  {fmt.money(r.items.reduce((s, i) => s + i.amount, 0), { compact: true })}
                </span>
                <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium capitalize">
                  {r.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
        </ListFilter>
      )}
    </div>
  );
}
