import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { SettingsScreenHeader } from "@/components/portal/settings-kit/screen-header";
import { CommissionRulesManager } from "@/components/portal/commission-rules-manager";

export const metadata = { title: "Commission Settings" };

export default async function CommissionRulesPage({
  searchParams,
}: {
  /** Which rule is open. Read on the SERVER so the first paint is the right one. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const user = await requireUser();
  if (!can(user, "update", "Settings")) redirect("/portal/settings");
  // Roofing's page. Solar's hub no longer offers it — a rep's split lives on
  // his own profile there, and there is no crew or PM line for a rule to pay.
  // Hiding the card alone would leave the URL live, and CommissionRule rows are
  // vertical-isolated, so anything saved from a solar session would be written
  // into a workspace that never reads it.
  if ((await getActiveVertical(user)) === "solar") redirect("/portal/settings");

  const [company, rules] = await Promise.all([
    prisma.company.findUnique({ where: { id: user.companyId }, select: { overheadPct: true, paFeePct: true } }),
    prisma.commissionRule.findMany({
      where: { companyId: user.companyId },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
  ]);

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        section="commission_rules"
        description="Define how commissions and crew pay are calculated by role, type, and project type."
      />
      <CommissionRulesManager
        overheadPct={company?.overheadPct ?? 10}
        paFeePct={company?.paFeePct ?? 10}
        initialRuleId={one(params.rule)}
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
