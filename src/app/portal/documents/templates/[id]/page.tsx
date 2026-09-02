import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/portal/ui";
import { TemplateBuilder } from "@/components/esign/template-builder";
import { TemplateSettings } from "@/components/esign/template-settings";
import { foldersFor, packageDestinations } from "@/lib/deal-folders";
import { buildFieldCatalog } from "@/server/modules/esign/autofill";
import { finalPacketTemplates } from "@/server/modules/esign/final-docs";
import { listCompanySigners } from "@/server/modules/esign/signers";

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
    include: { fields: true, documents: { orderBy: { order: "asc" } } },
  });
  if (!template) notFound();

  // Dynamic CRM field catalog: built-ins + this company's custom fields.
  const customDefs = await prisma.customFieldDef.findMany({
    where: { companyId: user.companyId },
    orderBy: [{ entity: "asc" }, { position: "asc" }],
    select: { key: true, label: true, entity: true },
  });
  /**
   * The signers, for the "signed on our behalf by" picker AND for the field
   * catalogue: each signer's credential lines become mappable tokens, exactly
   * as this company's custom fields do.
   */
  const signers = await listCompanySigners(user.companyId);
  const catalog = buildFieldCatalog(
    customDefs,
    signers.flatMap((s) => s.credentials.map((c) => ({ key: c.key, label: c.label })))
  );

  // Where this document sits in the closeout packet, so the tick box can say
  // "2nd of 3" rather than leaving the order to be guessed. Asked only on solar,
  // because only solar sends a packet — roofing's editor is unchanged.
  const packet = template.vertical === "solar" ? await finalPacketTemplates(user.companyId) : [];
  const packetPosition = packet.findIndex((t) => t.id === template.id);

  const body = (template.body as unknown as { page: number; type: string; text: string; x: number; y: number }[]) ?? [];
  const pages = (template.pages as unknown as { width: number; height: number }[]) ?? [];

  // A template is a list of PDFs. Templates that predate that carry no document
  // rows, so the template's own PDF stands in as the single slot (empty id) —
  // which is what keeps the editor identical for every existing template.
  const documents =
    template.documents.length > 0
      ? template.documents.map((d) => ({
          id: d.id,
          name: d.name,
          order: d.order,
          pages: (d.pages as unknown as { width: number; height: number }[]) ?? [],
          pdfUrl: d.sourcePdfKey
            ? `/portal/documents/templates/${template.id}/source?doc=${d.id}`
            : undefined,
        }))
      : [
          {
            id: "",
            name: template.name,
            order: 1,
            pages,
            pdfUrl: template.sourcePdfKey
              ? `/portal/documents/templates/${template.id}/source`
              : undefined,
          },
        ];

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
        description="Upload one or more PDFs — they go out as a single envelope — then drag fields and map auto-fill data from the CRM."
      />
      <TemplateSettings
        templateId={template.id}
        initialName={template.name}
        initialFolderKey={template.folderKey}
        finalPacket={
          template.vertical === "solar"
            ? {
                checked: template.finalPacket,
                // -1 when it is not in the packet yet; the control then
                // describes what ticking it would do instead of a position.
                position: packetPosition,
                total: packet.length,
              }
            : null
        }
        // The packages folder is already the default option, so it is not
        // offered a second time under its own name — two entries that do the
        // same thing only raise the question of how they differ.
        destinations={packageDestinations(template.vertical)
          .filter((f) => !f.hostsPackages)
          .map((f) => ({ key: f.key, label: f.label }))}
        fallbackLabel={
          foldersFor(template.vertical).find((f) => f.hostsPackages)?.label ?? "Contract"
        }
        // Retired signers are not offered, but one already chosen stays in the
        // list — otherwise the picker would silently show "Company default"
        // for a template that names somebody, and saving would move it.
        signers={signers
          .filter((s) => s.active || s.id === template.companySignerId)
          .map((s) => ({ id: s.id, name: s.name, title: s.title, isDefault: s.isDefault }))}
        initialCompanySignerId={template.companySignerId}
        hasCompanyFields={template.fields.some((f) => f.signerRole === "company_rep")}
      />
      <TemplateBuilder
        templateId={template.id}
        templateName={template.name}
        body={body}
        documents={documents}
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
          documentId: f.documentId ?? "",
        }))}
      />
    </div>
  );
}
