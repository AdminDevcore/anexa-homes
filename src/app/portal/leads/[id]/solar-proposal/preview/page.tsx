import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { resolveLayoutAsset } from "@/server/modules/solar/layout-asset";
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

  // The snapshot stores the layout's FILE ID, not a URL, so the preview serves
  // it through the authenticated portal route — no share token is involved, and
  // none appears in this page's HTML.
  //
  // Resolved rather than assumed: if the drawing has since been deleted, or its
  // bytes are gone, the section is omitted and the rep is told, instead of a
  // broken image sitting in a document about to go to a customer.
  const layoutAsset = snapshot.layout
    ? await resolveLayoutAsset(user.companyId, id, snapshot.layout.fileId)
    : null;
  const layoutImageUrl = layoutAsset ? `/portal/files/${layoutAsset.id}` : null;
  const layoutMissing = !!snapshot.layout && !layoutAsset;

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

      {/* Internal only — the customer's copy simply omits the section. This is
          the rep's cue to fix it BEFORE the proposal goes anywhere. */}
      {layoutMissing && (
        <div className="mx-auto mt-4 max-w-3xl px-4 print:hidden sm:px-6">
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              The panel-layout image is unavailable. Upload or replace it before sending.{" "}
              <Link
                href={`/portal/leads/${id}/solar-proposal?step=design`}
                className="font-medium underline underline-offset-2"
              >
                Open system design →
              </Link>
            </span>
          </div>
        </div>
      )}

      <SolarProposalView
        snapshot={snapshot}
        // No token is handed to the preview: acceptance is disabled, so there is
        // nothing for one to authorize, and it stays out of the page source.
        token=""
        alreadySigned={!!proposal.signedAt}
        superseded={!!proposal.supersededAt}
        previewMode
        layoutImageUrl={layoutImageUrl}
      />
    </div>
  );
}
