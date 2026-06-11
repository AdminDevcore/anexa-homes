import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/portal/ui";
import { CommissionRulesManager } from "@/components/portal/commission-rules-manager";
import { DealSplitSettings } from "@/components/portal/deal-split-settings";

export const metadata = { title: "Commission Settings" };

export default async function CommissionRulesPage() {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  const [company, splitReps, rules] = await Promise.all([
    prisma.company.findUnique({ where: { id: user.companyId }, select: { overheadPct: true } }),
    prisma.user.findMany({
      where: { companyId: user.companyId, status: "active", role: { in: ["sales_rep", "manager"] } },
      select: { id: true, firstName: true, lastName: true, role: true, commissionSplitPct: true },
      orderBy: [{ firstName: "asc" }],
    }),
    prisma.commissionRule.findMany({
      where: { companyId: user.companyId },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
  ]);

  return (
    <div className="space-y-6">
      <Link
        href="/portal/settings"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Commission Rules"
        description="Define how commissions and crew pay are calculated by role, type, and project type."
      />
      <DealSplitSettings
        overheadPct={company?.overheadPct ?? 10}
        reps={splitReps.map((r) => ({
          id: r.id,
          name: `${r.firstName} ${r.lastName}`.trim(),
          role: r.role,
          splitPct: r.commissionSplitPct,
        }))}
      />
      <CommissionRulesManager
        rules={rules.map((r) => ({
          id: r.id,
          name: r.name,
          role: r.role,
          type: r.type,
          percent: r.percent,
          flatAmount: r.flatAmount,
          projectType: r.projectType,
          active: r.active,
        }))}
      />
    </div>
  );
}
