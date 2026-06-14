import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getCostTemplate } from "@/server/modules/scope/template-queries";
import { ScopeTemplateEditor } from "@/components/portal/scope-template-editor";

export const metadata = { title: "Cost Template" };

export default async function CostTemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, "update", "Settings")) redirect("/portal/dashboard");
  const template = await getCostTemplate(user.companyId, id);
  if (!template) notFound();
  return <ScopeTemplateEditor kind="cost" template={template} />;
}
