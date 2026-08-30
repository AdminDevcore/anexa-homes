import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { mintPrintSignature } from "@/server/modules/solar/print-signature";

export const dynamic = "force-dynamic";

/**
 * Mint a five-minute key to one proposal's submission summary, and go there.
 *
 * A ROUTE RATHER THAN A LINK STRAIGHT TO THE DOCUMENT, because the document
 * lives behind a print signature that only this server can issue — the same
 * door the PDF renderer walks through. A route also means the authority check
 * happens once, on the way in, rather than being restated by every screen that
 * wants to offer the link.
 *
 * WHO MAY: anybody who can read this company's proposals. It is an internal
 * processing document about a deal, and the people who submit files to funders
 * are the same people who work the deals. It is NOT public and never carries a
 * share token: a homeowner's key opens the customer's proposal, and this is not
 * that document.
 *
 * ONLY ON A SIGNED VERSION. The summary describes the agreement that was
 * signed, quotes its fingerprint, and exists to be submitted against it —
 * produced from a draft it would be a contract value with nothing behind it,
 * and one that a later version could quietly contradict.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  if (!can(user, "read", "Proposal")) {
    return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
  }

  const proposal = await prisma.solarProposal.findFirst({
    where: { companyId: user.companyId, id },
    select: { id: true, signedAt: true },
  });
  if (!proposal) {
    return NextResponse.json({ ok: false, error: "Proposal not found." }, { status: 404 });
  }
  if (!proposal.signedAt) {
    return NextResponse.json(
      { ok: false, error: "A submission summary is produced once the customer has signed." },
      { status: 409 }
    );
  }

  return NextResponse.redirect(
    new URL(`/proposal/submission/${mintPrintSignature(proposal.id)}`, _req.url)
  );
}
