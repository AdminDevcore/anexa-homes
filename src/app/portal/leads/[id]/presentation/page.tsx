import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { ensureProposal, getProposalForBuilder } from "@/server/modules/proposals/queries";
import { PresentationBuilder } from "@/components/portal/presentation-builder";

export const dynamic = "force-dynamic";

export default async function PresentationBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, "create", "Proposal") && !can(user, "update", "Proposal")) redirect(`/portal/leads/${id}`);

  // Get-or-create the draft so the builder always has a record.
  if (!(await ensureProposal(user, id))) notFound();

  const data = await getProposalForBuilder(user, id);
  if (!data) notFound();

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
      <PresentationBuilder data={data} leadId={id} />
    </div>
  );
}
