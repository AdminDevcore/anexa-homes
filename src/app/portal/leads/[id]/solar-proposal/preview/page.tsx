import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { SolarProposalView } from "@/components/proposal/solar-proposal-view";
import type { SolarProposalSnapshot } from "@/lib/solar-proposal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Proposal preview" };

/**
 * The generated proposal, exactly as the customer would see it — read from
 * INSIDE the portal.
 *
 * Deliberately not "open the public link in a new tab":
 *
 *  1. Hitting /proposal/[token] records a customer VIEW and stamps viewedAt.
 *     A rep checking their own work would show up in the audit trail as the
 *     homeowner opening it, which corrupts the one signal that says whether
 *     the customer actually read the thing.
 *  2. It puts the share token in browser history, screenshots and support
 *     tickets. The token IS the authorization; an internal review should not
 *     need to handle it.
 *
 * Acceptance is disabled here regardless — see `previewMode`.
 */
export default async function SolarProposalPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { id } = await params;
  const { v } = await searchParams;
  const user = await requireUser();
  if (!can(user, "read", "Proposal")) redirect(`/portal/leads/${id}`);

  const proposal = await prisma.solarProposal.findFirst({
    where: {
      companyId: user.companyId,
      leadId: id,
      ...(v ? { version: Number(v) } : {}),
    },
    orderBy: { version: "desc" },
    select: {
      version: true, snapshot: true, signedAt: true, supersededAt: true, createdAt: true,
    },
  });
  if (!proposal) notFound();

  const snapshot = proposal.snapshot as unknown as SolarProposalSnapshot;

  // The snapshot points the layout image at /proposal/<token>/layout-image,
  // because that is the URL the CUSTOMER's copy has to use. Rendering it here
  // would put the share token into this page's HTML — the one thing this route
  // exists to avoid. Swap in the authenticated file URL for the preview only;
  // no customer-visible figure is touched.
  if (snapshot.layout) {
    const design = await prisma.solarDesign.findUnique({
      where: { leadId: id },
      select: { layoutImageFileId: true },
    });
    snapshot.layout = design?.layoutImageFileId
      ? { ...snapshot.layout, imageUrl: `/portal/files/${design.layoutImageFileId}` }
      : null;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 pt-6 print:hidden sm:px-6">
        <Link
          href={`/portal/leads/${id}/solar-proposal`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to builder
        </Link>
        <span className="text-xs text-muted-foreground">
          v{proposal.version} · generated {proposal.createdAt.toLocaleDateString()}
        </span>
      </div>

      <SolarProposalView
        snapshot={snapshot}
        // No token is handed to the preview: acceptance is disabled, so there is
        // nothing for one to authorize, and it stays out of the page source.
        token=""
        alreadySigned={!!proposal.signedAt}
        superseded={!!proposal.supersededAt}
        previewMode
      />
    </div>
  );
}
