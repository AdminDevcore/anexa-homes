import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { SettingsScreenHeader } from "@/components/portal/settings-kit/screen-header";
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
      <SettingsScreenHeader
        section="custom_fields" title="Custom Fields" description="Add custom fields to capture extra data on appointments and projects." />
      <CustomFieldsManager
        fields={fields.map((f) => ({
          id: f.id,
          entity: f.entity,
          // The internal name every recorded answer is keyed by. On screen only
          // to say what a rename does NOT touch.
          key: f.key,
          label: f.label,
          type: f.type,
          required: f.required,
          options: Array.isArray(f.options) ? (f.options as string[]) : [],
        }))}
      />
    </div>
  );
}
