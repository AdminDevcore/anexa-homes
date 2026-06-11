import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getActiveIndustry } from "@/server/auth/industry";
import { listKnowledge } from "@/server/modules/knowledge/queries";
import { canManageKnowledge, TRAINING_AUDIENCE_ROLES } from "@/server/modules/knowledge/policies";
import { roleLabel } from "@/lib/roles";
import { PageHeader } from "@/components/portal/ui";
import { KnowledgeClient } from "@/components/portal/knowledge-client";

export const metadata = { title: "Knowledge Base" };

export default async function KnowledgePage() {
  const user = await requireUser();
  if (!can(user, "read", "Knowledge")) redirect("/portal/dashboard");

  const industry = await getActiveIndustry(user);
  const categories = await listKnowledge(user, industry);
  const canManage = canManageKnowledge(user.role);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Knowledge Base & Training"
        description={
          canManage
            ? "Upload training materials and choose which roles can see each category."
            : "Training materials and resources shared with your role."
        }
      />
      <KnowledgeClient
        canManage={canManage}
        roleOptions={TRAINING_AUDIENCE_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))}
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          visibleRoles: c.visibleRoles,
          items: c.items.map((i) => ({
            id: i.id,
            type: i.type,
            title: i.title,
            description: i.description,
            url: i.url,
            body: i.body,
            hasFile: !!i.fileId,
          })),
        }))}
      />
    </div>
  );
}
