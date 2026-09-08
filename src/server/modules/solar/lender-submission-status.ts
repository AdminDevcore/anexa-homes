import { prisma } from "@/server/db/client";

/**
 * DID THIS GO TO THE LENDER, AND FOR WHICH VERSION?
 *
 * The submission log already recorded every attempt, but only in one place a
 * rep could reach: a diagnostic panel on the proposal preview, opened by
 * somebody who already suspected there was something to find. The question a
 * deal actually gets asked — "has this been sent out?" — had no answer on the
 * deal, and no answer at all against a particular version.
 *
 * So the state is read here, once, in a shape both surfaces can use: the deal's
 * standing overall, and the standing of each individual document.
 *
 * DELIBERATELY THE LATEST ATTEMPT, not "any successful one". A deal submitted,
 * refused, corrected and re-submitted stands where its last attempt left it;
 * reporting the earlier success would say a deal is with the underwriter when
 * the underwriter's own last word was no.
 */
export type LenderAttempt = {
  lenderName: string;
  /** Whether the partner accepted the application. */
  ok: boolean;
  at: string;
  /** Their reference, on an accepted one. What a support desk asks for. */
  referenceNumber: string | null;
  /** Their words, on a refusal. */
  message: string | null;
  /** Who pressed it. Null on the customer's own door. */
  actorName: string | null;
};

export type LenderAttempts = {
  /** Where the DEAL stands — the newest attempt, whichever version it was for. */
  latest: LenderAttempt | null;
  /**
   * Where each DOCUMENT stands, keyed by proposal id.
   *
   * Attempts recorded before submissions carried a proposal id are absent from
   * this map on purpose. They are real attempts and they still count towards
   * `latest`; what they cannot do is claim a version, and guessing one would
   * put "sent at this price" on a sheet that may never have been sent.
   */
  byProposal: Map<string, LenderAttempt>;
};

/**
 * Nothing recorded. Exported so the pages that skip the query — a roofing deal,
 * a proposal with no direct-submission lender — hand the same TYPE downstream
 * as the ones that run it, rather than an inline literal whose Map widens to
 * `any` and quietly disables the checking on every read below it.
 */
export const NO_LENDER_ATTEMPTS: LenderAttempts = { latest: null, byProposal: new Map() };

/**
 * Every attempt on one deal, folded to the latest per version.
 *
 * Capped at the same 25 the diagnostic reads. A deal with more than
 * twenty-five submission attempts has a problem this summary is not going to
 * be the one to surface.
 */
export async function readLenderAttempts(
  companyId: string,
  leadId: string,
): Promise<LenderAttempts> {
  let rows;
  try {
    rows = await prisma.solarLenderSubmission.findMany({
      where: { companyId, leadId },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        proposalId: true,
        lenderName: true,
        ok: true,
        createdAt: true,
        referenceNumber: true,
        message: true,
        actorName: true,
      },
    });
  } catch {
    // A badge is not worth taking a deal page down for. Absent reads as "no
    // attempt recorded", which is what the page said before this existed.
    return NO_LENDER_ATTEMPTS;
  }

  const byProposal = new Map<string, LenderAttempt>();
  let latest: LenderAttempt | null = null;

  for (const r of rows) {
    const attempt: LenderAttempt = {
      lenderName: r.lenderName,
      ok: r.ok,
      at: r.createdAt.toISOString(),
      referenceNumber: r.referenceNumber,
      message: r.message,
      actorName: r.actorName,
    };
    // Newest first, so the first row seen for a key is the one that stands.
    if (!latest) latest = attempt;
    if (r.proposalId && !byProposal.has(r.proposalId)) byProposal.set(r.proposalId, attempt);
  }

  return { latest, byProposal };
}

/**
 * One version's lender badge, in the shape the row renders.
 *
 * A function rather than the map read inline at each call site: both pages that
 * show the version list need the same narrowing, and doing it twice by hand is
 * how the two lists end up disagreeing about what "sent" means.
 */
export function versionLenderBadge(attempts: LenderAttempts, proposalId: string) {
  const a = attempts.byProposal.get(proposalId);
  if (!a) return null;
  return {
    name: a.lenderName,
    ok: a.ok,
    at: a.at,
    referenceNumber: a.referenceNumber,
    message: a.message,
  };
}
