import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { getPublicProposal } from "@/server/modules/proposals/queries";
import { PresentationView } from "@/components/proposal/presentation-view";
import { PrintButton } from "@/components/proposal/print-button";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await getPublicProposal(token);
  if (!data) return { title: "Proposal" };
  return { title: `${data.branding.companyName} — Roofing Proposal for ${data.customerName}` };
}

export default async function PublicPresentationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await getPublicProposal(token);
  if (!data) notFound();

  // Best-effort first-view tracking (generated/sent -> viewed).
  try {
    await prisma.proposal.updateMany({
      where: { publicToken: token, status: { in: ["generated", "sent"] } },
      data: { status: "viewed", viewedAt: new Date() },
    });
  } catch {
    /* non-fatal */
  }

  return (
    <main className="bg-white">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-200 bg-white/90 px-4 py-2.5 backdrop-blur print:hidden">
        <span className="text-sm font-medium text-neutral-500">{data.branding.companyName}</span>
        <PrintButton />
      </div>
      <PresentationView data={data} mode="public" />
    </main>
  );
}
