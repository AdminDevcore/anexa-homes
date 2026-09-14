import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { runUnscoped } from "@/server/vertical/context";
import { assertCronRequest } from "@/server/auth/cron";
import { hasCreditSwitch } from "@/lib/solar-proposal";
import { fileApprovedCopy } from "@/server/modules/solar/proposal-file-copy";

/**
 * File the signed proposal PDFs that nobody has filed yet.
 *
 * ── WHY A SWEEP ─────────────────────────────────────────────────────────────
 * A customer signing approves their version, and approval is what puts the
 * document in the deal's Proposal folder. But the renderer boots Chromium and
 * can take the better part of a minute, so the signature deliberately does NOT
 * wait for it — a homeowner pressing Sign must not queue behind a browser
 * starting, and a browser that fails to start must not fail their signature.
 *
 * What filled the gap was a `useEffect` on the deal page: the first person to
 * open the deal WHO MAY APPROVE rendered it. That is not a guarantee, it is a
 * hope. A rep opening their own signed deal triggers nothing (they hold no
 * `Settings:update`), and until an admin happens to visit, the deal has a
 * signed proposal and an EMPTY Proposal folder — which is exactly the state
 * that blocks assembling a lender packet.
 *
 * So the sweep is the guarantee and the on-open path stays as the fast case.
 *
 * ── IDEMPOTENT ──────────────────────────────────────────────────────────────
 * `fileApprovedCopy` REPLACES rather than accumulates: it reads whatever the
 * proposal's own two columns point at, writes the new copies, then removes the
 * old rows. So a second run cannot leave "Proposal (1).pdf" beside
 * "Proposal.pdf" — the row names its copies and there is only ever one pair.
 * The re-check immediately before each call keeps this sweep from racing an
 * admin who opened the deal in the same minute.
 *
 * ── PARTIAL FAILURE ─────────────────────────────────────────────────────────
 * A proposal that earns credits files TWO copies and both renders complete
 * before anything is written, so a half-pair cannot reach the folder. A render
 * that fails leaves the columns null, which is precisely the state this query
 * looks for — so the next sweep tries again rather than the deal being stuck.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Rendering is slow; a run takes a bounded bite rather than timing out. */
const BATCH = 10;

export async function GET(req: Request) {
  const denied = assertCronRequest(req);
  if (denied) return denied;

  /**
   * Unscoped: this crosses every company and has no workspace of its own. The
   * `vertical` filter is explicit for the same reason payroll's is — a cron has
   * no async-local context for the isolation extension to read.
   */
  const candidates = await runUnscoped(
    "file signed proposals: sweep every company's approved-but-unfiled documents",
    () =>
      prisma.solarProposal.findMany({
        where: {
          vertical: "solar",
          approvedAt: { not: null },
          signedAt: { not: null },
          OR: [{ approvedFileId: null }, { approvedParFileId: null }],
        },
        orderBy: { approvedAt: "asc" },
        take: BATCH * 3, // over-fetch: most PAR nulls are legitimately null
        select: {
          id: true,
          companyId: true,
          leadId: true,
          version: true,
          snapshot: true,
          approvedFileId: true,
          approvedParFileId: true,
        },
      })
  );

  /**
   * A single-copy document has a legitimately null `approvedParFileId`.
   *
   * `hasCreditSwitch` is the ONE definition of "this document has two honest
   * readings", shared with the filing itself — so the sweep and the filer
   * cannot disagree about how many copies a proposal is supposed to have and
   * re-render a complete deal for ever.
   */
  const needsFiling = candidates.filter((p) => {
    const pair = hasCreditSwitch(p.snapshot);
    return p.approvedFileId == null || (pair && p.approvedParFileId == null);
  });

  let filed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const p of needsFiling.slice(0, BATCH)) {
    // Re-read immediately before rendering: an admin may have opened the deal
    // while this loop was working through the ones before it.
    const fresh = await runUnscoped("file signed proposals: re-check before rendering", () =>
      prisma.solarProposal.findUnique({
        where: { id: p.id },
        select: { approvedFileId: true, approvedParFileId: true, snapshot: true },
      })
    );
    if (!fresh) continue;
    const stillNeeded =
      fresh.approvedFileId == null ||
      (hasCreditSwitch(fresh.snapshot) && fresh.approvedParFileId == null);
    if (!stillNeeded) continue;

    // No user did this, and `FileAsset.uploadedById` is nullable for exactly
    // that case — inventing an uploader would put a name against an act nobody
    // performed, the same reasoning as `ApprovalActor.userId`.
    const res = await fileApprovedCopy(
      { companyId: p.companyId, userId: null },
      { id: p.id, leadId: p.leadId, version: p.version }
    );
    if (res.error) {
      failed += 1;
      // Loud: a document that will not render is a lender packet that cannot be
      // assembled, and nobody is watching this run.
      console.error(`[cron:file-signed-proposals] v${p.version} on ${p.leadId}: ${res.error}`);
      errors.push(res.error);
    } else {
      filed += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    considered: needsFiling.length,
    filed,
    failed,
    ...(errors.length ? { errors: errors.slice(0, 3) } : {}),
  });
}
