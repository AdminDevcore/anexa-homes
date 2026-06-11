import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getPhotoTemplates } from "@/server/modules/photos/queries";
import { PageHeader } from "@/components/portal/ui";
import { PhotoTemplatesManager } from "@/components/portal/photo-templates-manager";

export const metadata = { title: "Photo Templates" };

export default async function PhotoTemplatesPage() {
  const user = await requireUser("/portal/settings/photo-templates");
  if (!can(user, "update", "Settings")) redirect("/portal/dashboard");

  const templates = await getPhotoTemplates(user.companyId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Photo Templates"
        description="Define the Site/Inspection and Install photo checklists reps complete on every project."
      />
      <PhotoTemplatesManager
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          kind: t.kind,
          items: t.items.map((i) => ({ id: i.id, label: i.label, required: i.required })),
        }))}
      />
    </div>
  );
}
