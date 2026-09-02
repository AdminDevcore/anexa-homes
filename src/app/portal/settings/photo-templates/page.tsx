import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { getPhotoTemplates } from "@/server/modules/photos/queries";
import { KIND_BLURB, KIND_LABEL } from "@/server/modules/photos/defaults";
import { VERTICAL_LABEL } from "@/lib/vertical";
import { photoExampleUrl } from "@/lib/photo-example";
import { SettingsScreenHeader } from "@/components/portal/settings-kit/screen-header";
import { PhotoTemplatesManager } from "@/components/portal/photo-templates-manager";

export const metadata = { title: "Photo Templates" };

export default async function PhotoTemplatesPage() {
  const user = await requireUser("/portal/settings/photo-templates");
  if (!can(user, "update", "Settings")) redirect("/portal/dashboard");

  // Checklists are per workspace, so this page always shows the current one's —
  // Roofing's list is not Solar's list and neither should be edited from the
  // other.
  const vertical = await getActiveVertical(user);
  const templates = await getPhotoTemplates(user.companyId);

  const kinds = (["site", "install"] as const).map((kind) => ({
    kind,
    name: KIND_LABEL[kind][vertical],
    blurb: KIND_BLURB[kind][vertical],
  }));

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        section="photo_templates" vertical={vertical}
        description={`The photo checklists reps and crews complete on every ${VERTICAL_LABEL[vertical]} job. Each workspace keeps its own. Set an example photo on a slot and the crew sees exactly what the shot should look like before they take it.`}
      />
      <PhotoTemplatesManager
        kinds={kinds}
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          kind: t.kind,
          items: t.items.map((i) => ({
            id: i.id,
            label: i.label,
            required: i.required,
            exampleUrl: photoExampleUrl(i.id, i.exampleUpdatedAt),
          })),
        }))}
      />
    </div>
  );
}
