import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getPublicSolarProposal, recordProposalView } from "@/server/modules/solar/proposal-public";
import { SolarProposalView } from "@/components/proposal/solar-proposal-view";
import { prisma } from "@/server/db/client";
import { objectExists } from "@/server/storage";
import { runUnscoped } from "@/server/vertical/context";

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

  // The layout is only offered to the renderer when the bytes are genuinely
  // there. A FileAsset can outlive its object (a bucket lifecycle rule, a
  // database restored without its storage) and the customer would otherwise get
  // a broken-image icon on the one page that has to look trustworthy.
  const layoutImageUrl = proposal.snapshot.layout
    ? await layoutUrlIfAvailable(token, proposal.snapshot.layout.fileId, proposal.leadId)
    : null;

  return (
    <div className="min-h-screen bg-background">
      <SolarProposalView
        snapshot={proposal.snapshot}
        showComparison={proposal.showComparison}
        token={token}
        alreadySigned={!!proposal.signedAt}
        superseded={!!proposal.supersededAt}
        layoutImageUrl={layoutImageUrl}
      />
    </div>
  );
}

/** Token-scoped layout URL, or null when the drawing cannot be served. */
async function layoutUrlIfAvailable(token: string, fileId: string, leadId: string) {
  const file = await runUnscoped(
    "public proposal: confirm the layout drawing is still fetchable",
    () =>
      prisma.fileAsset.findFirst({
        where: { id: fileId, leadId, kind: "photo" },
        select: { storageKey: true },
      })
  );
  if (!file) return null;
  return (await objectExists(file.storageKey)) ? `/proposal/${token}/layout-image` : null;
}
