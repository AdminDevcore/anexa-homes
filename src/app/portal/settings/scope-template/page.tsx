import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getActiveIndustry } from "@/server/auth/industry";
import { listScopeTemplate } from "@/server/modules/scope/queries";
import { PageHeader } from "@/components/portal/ui";
import { ScopeTemplateManager } from "@/components/portal/scope-template-manager";

export const metadata = { title: "Scope Template" };

export default async function ScopeTemplatePage() {
  const user = await requireUser("/portal/settings/scope-template");
  if (!can(user, "update", "Settings")) redirect("/portal/dashboard");

  const industry = await getActiveIndustry(user);
  const items = await listScopeTemplate(user.companyId, industry);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Scope of Work Template"
        description="Default line items with your standard cost rates. Load them into any deal's Scope of Work to estimate profit fast."
      />
      <ScopeTemplateManager
        items={items.map((i) => ({
          id: i.id,
          category: i.category,
          description: i.description,
          unit: i.unit,
          defaultInsuranceUnitPrice: i.defaultInsuranceUnitPrice,
          defaultCostUnitPrice: i.defaultCostUnitPrice,
        }))}
      />
    </div>
  );
}
