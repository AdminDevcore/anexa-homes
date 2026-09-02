import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getActiveVertical } from "@/server/auth/vertical";
import { prisma } from "@/server/db/client";
import { ensureProposal, getProposalForBuilder } from "@/server/modules/proposals/queries";
import { PresentationBuilder } from "@/components/portal/presentation-builder";
import type { SendDocsTemplate, SendDocsDefaults } from "@/components/esign/send-docs-dialog";
import { listCompanySigners } from "@/server/modules/esign/signers";

export const dynamic = "force-dynamic";

export default async function PresentationBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, "create", "Proposal") && !can(user, "update", "Proposal")) redirect(`/portal/leads/${id}`);

  // Get-or-create the draft so the builder always has a record.
  if (!(await ensureProposal(user, id))) notFound();

  const data = await getProposalForBuilder(user, id);
  if (!data) notFound();

  // "Send docs" on step 5: the contract templates for this workspace, plus the
  // signer this deal already implies. Fetched here rather than in the client so
  // the dialog opens filled in instead of spinning. A roofing rep never sees
  // solar paperwork — the template list is scoped to the active vertical.
  const canSendDocs = can(user, "create", "Document");
  let docTemplates: SendDocsTemplate[] = [];
  let docDefaults: SendDocsDefaults | null = null;
  if (canSendDocs) {
    const vertical = await getActiveVertical(user);
    const [templates, lead, signers] = await Promise.all([
      prisma.documentTemplate.findMany({
        where: { companyId: user.companyId, active: true, vertical },
        orderBy: { name: "asc" },
        select: { id: true, name: true, type: true },
      }),
      prisma.lead.findUnique({
        where: { id },
        select: {
          firstName: true,
          lastName: true,
          email: true,
          coOwnerName: true,
          coOwnerEmail: true,
        },
      }),
      listCompanySigners(user.companyId),
    ]);
    const defaultSigner = signers.find((s) => s.active && s.isDefault) ?? null;
    docTemplates = templates;
    docDefaults = {
      customerName: lead ? `${lead.firstName} ${lead.lastName}`.trim() : data.proposal.customerName,
      customerEmail: lead?.email ?? data.customerEmail ?? "",
      coOwnerName: lead?.coOwnerName ?? null,
      coOwnerEmail: lead?.coOwnerEmail ?? null,
      // Named, not typed: our half of the document is applied by the send from
      // whichever authorised signer the template resolves. The rep sending it
      // is recorded as who applied it, on the certificate.
      companySigner: defaultSigner
        ? { name: defaultSigner.name, title: defaultSigner.title }
        : null,
    };
  }

  return (
    // Printing from here means printing the proposal being built, so the page's
    // own heading and back-link step out of the way of the document.
    <div className="mx-auto w-full max-w-4xl px-4 py-6 print:max-w-none print:p-0">
      <Link href={`/portal/leads/${id}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground print:hidden">
        <ArrowLeft className="size-4" /> Back to deal
      </Link>
      <div className="mb-6 print:hidden">
        <h1 className="font-serif text-2xl font-bold">Build Proposal</h1>
        <p className="text-sm text-muted-foreground">{data.proposal.customerName} · {data.proposal.propertyAddress}</p>
      </div>
      <PresentationBuilder
        data={data}
        leadId={id}
        docs={docDefaults ? { templates: docTemplates, defaults: docDefaults } : null}
      />
    </div>
  );
}
