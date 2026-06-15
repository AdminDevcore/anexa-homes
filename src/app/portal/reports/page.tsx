import { redirect } from "next/navigation";
import Link from "next/link";
import { Gauge, Activity, DollarSign, Wallet, Briefcase, AlarmClock, HardHat, ArrowRight, type LucideIcon } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { visibleReportGroups, type ReportIcon } from "@/server/modules/reports/catalog";

export const metadata = { title: "Reports" };

const ICONS: Record<ReportIcon, LucideIcon> = {
  executive: Gauge,
  operations: Activity,
  financial: DollarSign,
  payroll: Wallet,
  jobs: Briefcase,
  delinquency: AlarmClock,
  contractorPay: HardHat,
};

export default async function ReportsPage() {
  const user = await requireUser();
  if (!can(user, "read", "Report")) redirect("/portal/dashboard");

  const groups = visibleReportGroups(user);

  return (
    <div className="space-y-8">
      <PageHeader title="Reports" description="Pick a report to view, then download it as a PDF or CSV." />

      {groups.map((group) => (
        <section key={group.group} className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.cards.map((card) => {
              const Icon = ICONS[card.icon];
              return (
                <Link
                  key={card.id}
                  href={card.href}
                  className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-gold/40 hover:bg-muted/40"
                >
                  <span className="inline-flex size-10 items-center justify-center rounded-xl bg-muted text-foreground">
                    <Icon className="size-5" />
                  </span>
                  <div className="space-y-1">
                    <h3 className="font-display text-base font-semibold tracking-tight">{card.title}</h3>
                    <p className="text-sm text-muted-foreground">{card.description}</p>
                  </div>
                  <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-gold-muted">
                    Open <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
