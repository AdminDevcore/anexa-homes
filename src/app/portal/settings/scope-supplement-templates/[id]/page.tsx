import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getSupplementTemplate } from "@/server/modules/scope/template-queries";
import { ScopeTemplateEditor } from "@/components/portal/scope-template-editor";

export const metadata = { title: "Supplement Template" };

export default async function SupplementTemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, "update", "Settings")) redirect("/portal/dashboard");
  const template = await getSupplementTemplate(user.companyId, id);
  if (!template) notFound();
  return <ScopeTemplateEditor kind="supplement" template={template} />;
}
