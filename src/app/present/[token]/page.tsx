import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { getPublicProposal } from "@/server/modules/proposals/queries";
import { PresentationView } from "@/components/proposal/presentation-view";

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
      <PresentationView data={data} mode="public" />
    </main>
  );
}
