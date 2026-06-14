import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, DollarSign, FilePlus2 } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getScopeCatalog } from "@/server/modules/scope/queries";
import { PageHeader } from "@/components/portal/ui";
import { Button } from "@/components/ui/button";
import { ScopeCatalogManager } from "@/components/portal/scope-catalog-manager";

export const metadata = { title: "Scope of Work Catalog" };

export default async function ScopeCatalogPage() {
  const user = await requireUser("/portal/settings/scope-template");
  if (!can(user, "update", "Settings")) redirect("/portal/dashboard");

  const items = await getScopeCatalog(user.companyId);

  return (
    <div className="space-y-6">
      <Link href="/portal/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Scope of Work Catalog"
        description="The master list of insurance-restoration line items. No pricing here — cost and supplement prices live in separate versioned templates, and insurance pricing is entered inside each Project → Scope of Work."
        action={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/portal/settings/scope-cost-templates">
                <DollarSign className="size-4" /> Cost Templates
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/portal/settings/scope-supplement-templates">
                <FilePlus2 className="size-4" /> Supplement Templates
              </Link>
            </Button>
          </>
        }
      />
      <ScopeCatalogManager
        items={items.map((i) => ({
          id: i.id,
          category: i.category,
          subcategory: i.subcategory,
          description: i.description,
          unit: i.unit,
          trade: i.trade,
          isCommonInsuranceItem: i.isCommonInsuranceItem,
          isSupplementEligible: i.isSupplementEligible,
          isActive: i.isActive,
        }))}
      />
    </div>
  );
}
