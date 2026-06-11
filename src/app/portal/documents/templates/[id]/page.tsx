import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/portal/ui";
import { TemplateBuilder } from "@/components/esign/template-builder";
import { TemplatePdfUploader } from "@/components/esign/template-pdf-uploader";
import { buildFieldCatalog } from "@/server/modules/esign/autofill";

export const metadata = { title: "Template" };

export default async function TemplateEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, "update", "Document")) redirect("/portal/documents");

  const template = await prisma.documentTemplate.findFirst({
    where: { id, companyId: user.companyId },
    include: { fields: true },
  });
  if (!template) notFound();

  // Dynamic CRM field catalog: built-ins + this company's custom fields.
  const customDefs = await prisma.customFieldDef.findMany({
    where: { companyId: user.companyId },
    orderBy: [{ entity: "asc" }, { position: "asc" }],
    select: { key: true, label: true, entity: true },
  });
  const catalog = buildFieldCatalog(customDefs);

  const body = (template.body as unknown as { page: number; type: string; text: string; x: number; y: number }[]) ?? [];
  const pages = (template.pages as unknown as { width: number; height: number }[]) ?? [];
  const pdfUrl = template.sourcePdfKey ? `/portal/documents/templates/${template.id}/source` : undefined;

  return (
    <div className="space-y-6">
      <Link
        href="/portal/documents"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to documents
      </Link>
      <PageHeader
        title={`Edit: ${template.name}`}
        description="Upload your own PDF or use the built-in page, then drag fields and map auto-fill data from the CRM."
      />
      <TemplatePdfUploader templateId={template.id} hasPdf={!!template.sourcePdfKey} />
      <TemplateBuilder
        templateId={template.id}
        templateName={template.name}
        body={body}
        pages={pages}
        pdfUrl={pdfUrl}
        catalog={catalog}
        initialFields={template.fields.map((f) => ({
          page: f.page,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
          type: f.type as "text" | "date" | "checkbox" | "signature" | "initials",
          signerRole: f.signerRole as "customer" | "co_customer" | "company_rep" | "witness",
          label: f.label ?? "",
          valueToken: f.valueToken ?? "",
          defaultValue: f.defaultValue ?? "",
          required: f.required,
        }))}
      />
    </div>
  );
}
