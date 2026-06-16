import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { getWelcomeCallTemplate } from "@/server/modules/welcome-call/queries";
import { buildFieldCatalog } from "@/server/modules/esign/autofill";
import { PageHeader } from "@/components/portal/ui";
import { WelcomeCallTemplateEditor } from "@/components/portal/welcome-call-template-editor";
import { CALL_KIND_LABELS } from "@/server/modules/welcome-call/types";

export const metadata = { title: "Edit Call Template" };

export default async function CallTemplateEditPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  const { id } = await params;
  const [tpl, customDefs] = await Promise.all([
    getWelcomeCallTemplate(user.companyId, id),
    prisma.customFieldDef.findMany({ where: { companyId: user.companyId }, select: { key: true, label: true, entity: true } }),
  ]);
  if (!tpl) notFound();

  const catalog = buildFieldCatalog(customDefs).map((c) => ({ token: c.token, label: c.label, group: c.group }));

  return (
    <div className="space-y-6">
      <Link href="/portal/settings/call-templates" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to templates
      </Link>
      <PageHeader title={tpl.name} description={`${CALL_KIND_LABELS[tpl.kind]} script — write the intro, the items the customer confirms, and a closing message. Use merge fields for live deal data.`} />
      <WelcomeCallTemplateEditor
        templateId={tpl.id}
        initial={{ intro: tpl.intro, closing: tpl.closing, items: tpl.items }}
        catalog={catalog}
      />
    </div>
  );
}
