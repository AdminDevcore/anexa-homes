import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FilePlus2 } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listSupplementTemplates } from "@/server/modules/scope/template-queries";
import { Button } from "@/components/ui/button";
import { SettingsScreenHeader } from "@/components/portal/settings-kit/screen-header";
import { ScopeTemplateList } from "@/components/portal/scope-template-list";

export const metadata = { title: "Supplement Templates" };

export default async function SupplementTemplatesPage() {
  const user = await requireUser("/portal/settings/scope-supplement-templates");
  if (!can(user, "update", "Settings")) redirect("/portal/dashboard");
  const templates = await listSupplementTemplates(user.companyId);

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        icon={FilePlus2}
        title="Supplement Templates"
        description="Versioned expected-supplement price lists over the scope catalog, with optional reason, required evidence, and notes per item. A project's Scope of Work selects one to model supplement potential."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/portal/settings/scope-template">
              <ArrowLeft className="size-4" /> Scope catalog
            </Link>
          </Button>
        }
      />
      <ScopeTemplateList kind="supplement" basePath="/portal/settings/scope-supplement-templates" templates={templates} />
    </div>
  );
}
