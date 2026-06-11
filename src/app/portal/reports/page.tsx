import { redirect } from "next/navigation";
import {
  Users,
  FolderKanban,
  TrendingUp,
  CheckCircle2,
  Wallet,
  DollarSign,
  Download,
} from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getReportData } from "@/server/modules/reports/queries";
import { PageHeader, StatCard } from "@/components/portal/ui";
import { BarChartCard, PieChartCard } from "@/components/portal/charts";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/format";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const user = await requireUser();
  if (!can(user, "read", "Report")) redirect("/portal/dashboard");

  const data = await getReportData({ companyId: user.companyId, userId: user.userId, role: user.role });
  const canExport = can(user, "export", "Report");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Performance across sales, production, and insurance."
        action={
          canExport ? (
            <Button asChild variant="outline" size="sm">
              <a href="/portal/reports/export">
                <Download className="size-4" /> Export CSV
              </a>
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Appointments" value={data.totals.totalLeads} icon={Users} />
        <StatCard label="Closing Rate" value={`${data.totals.closingRate}%`} icon={CheckCircle2} />
        <StatCard label="Jobs Sold" value={data.totals.jobsSold} icon={FolderKanban} />
        <StatCard label="Jobs Completed" value={data.totals.jobsCompleted} icon={CheckCircle2} />
        <StatCard label="Revenue (Closed)" value={formatCents(data.totals.revenueCents, { compact: true })} icon={TrendingUp} accent />
        <StatCard label="Commissions Owed" value={formatCents(data.totals.commissionsOwedCents, { compact: true })} icon={DollarSign} />
        <StatCard label="Payroll Owed" value={formatCents(data.totals.payrollOwedCents, { compact: true })} icon={Wallet} />
        <StatCard label="Won Appointments" value={data.totals.wonLeads} icon={CheckCircle2} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <BarChartCard
          title="Sales by Rep (Revenue)"
          data={data.salesByRep.map((r) => ({ name: r.name, revenue: r.revenueCents / 100 }))}
          dataKey="revenue"
          nameKey="name"
          format="currencyK"
        />
        <PieChartCard title="Appointments by Source" data={data.leadsBySource} dataKey="count" nameKey="name" />
        <BarChartCard title="Projects by Status" data={data.projectsByStatus} dataKey="count" nameKey="status" />
        <PieChartCard title="Insurance Claims by Status" data={data.claimsByStatus} dataKey="count" nameKey="status" />
      </div>
    </div>
  );
}
