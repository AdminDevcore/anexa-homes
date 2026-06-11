import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/portal/ui";
import { CustomFieldsManager } from "@/components/portal/custom-fields-manager";

export const metadata = { title: "Custom Fields" };

export default async function CustomFieldsSettingsPage() {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  const fields = await prisma.customFieldDef.findMany({
    where: { companyId: user.companyId },
    orderBy: [{ entity: "asc" }, { position: "asc" }],
  });

  return (
    <div className="space-y-6">
      <Link href="/portal/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader title="Custom Fields" description="Add custom fields to capture extra data on appointments and projects." />
      <CustomFieldsManager
        fields={fields.map((f) => ({ id: f.id, entity: f.entity, label: f.label, type: f.type, required: f.required }))}
      />
    </div>
  );
}
