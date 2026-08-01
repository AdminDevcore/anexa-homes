import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getPublicSolarProposal, recordProposalView } from "@/server/modules/solar/proposal-public";
import { SolarProposalView } from "@/components/proposal/solar-proposal-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const p = await getPublicSolarProposal(token);
  if (!p) return { title: "Proposal" };
  return { title: `${p.snapshot.company.name} — Solar proposal for ${p.snapshot.customer.name}` };
}

export default async function PublicSolarProposalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const proposal = await getPublicSolarProposal(token);
  if (!proposal) notFound();

  // Best-effort first-view tracking; never blocks the render.
  try {
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    await recordProposalView(token, ip);
  } catch {
    /* non-fatal */
  }

  return (
    <div className="min-h-screen bg-background">
      <SolarProposalView
        snapshot={proposal.snapshot}
        token={token}
        alreadySigned={!!proposal.signedAt}
        superseded={!!proposal.supersededAt}
      />
    </div>
  );
}
