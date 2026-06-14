import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listCostTemplates } from "@/server/modules/scope/template-queries";
import { PageHeader } from "@/components/portal/ui";
import { ScopeTemplateList } from "@/components/portal/scope-template-list";

export const metadata = { title: "Cost Templates" };

export default async function CostTemplatesPage() {
  const user = await requireUser("/portal/settings/scope-cost-templates");
  if (!can(user, "update", "Settings")) redirect("/portal/dashboard");
  const templates = await listCostTemplates(user.companyId);

  return (
    <div className="space-y-6">
      <Link href="/portal/settings/scope-template" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to catalog
      </Link>
      <PageHeader
        title="Cost Templates"
        description="Versioned cost-per-unit price lists over the scope catalog. A project's Scope of Work selects one to compute internal cost. Editing prices here never changes the master catalog."
      />
      <ScopeTemplateList kind="cost" basePath="/portal/settings/scope-cost-templates" templates={templates} />
    </div>
  );
}
