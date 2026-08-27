import { prisma } from "@/server/db/client";

/**
 * Approving a version, and the copy that files itself when you do.
 *
 * NOT a "use server" module — this is the work, and proposal-actions.ts is the
 * endpoint that authenticates and calls it. Keeping the two apart is what lets
 * a test drive the logic without a session.
 *
 * The deal's **Proposal** folder has existed since the folder grid shipped —
 * "the copy of what was sold" — and nothing has ever written to it. The
 * 2026-08-19 auto-filing work looked at it and left it manual on purpose: there
 * was no moment in the app that meant "this is the one". Approval is that
 * moment, so this is where the folder finally gets filled.
 */

export type ApprovalOutcome = {
  /** The version is approved. The copy is filed separately — see below. */
  approved: true;
};

/**
 * Mark one version approved, clearing any other on the same deal.
 *
 * The swap happens in ONE transaction because the database enforces "at most
 * one approved version per lead" with a partial unique index. Setting the new
 * one before clearing the old is a constraint violation, and clearing the old
 * in a separate transaction is a window in which the deal has no approved
 * version at all — which the deal page would render as "nothing was sold yet"
 * to anyone who looked in that instant.
 *
 * THE PDF IS NOT RENDERED HERE. Filing the copy lives behind its own route
 * (api/solar/proposals/[id]/file-copy) for two reasons, and both matter:
 *
 *  1. Booting Chromium inside a serverless function is the least reliable thing
 *     in this feature by a wide margin, and a business decision — this is the
 *     proposal we sold — must not be blocked by a browser binary failing to
 *     start. Approving is instant and always succeeds; the copy fills in after,
 *     and a version approved with a null `approvedFileId` is exactly the state
 *     the retry affordance reads.
 *  2. `@sparticuz/chromium` is a 66MB browser, and anything that imports it is
 *     traced into the deployed function. Called from a Server Action it landed
 *     in BOTH page bundles that host one — the deal page and the builder —
 *     measured at 220 traced browser files each. One route carries it now.
 */
export async function approveProposalVersion(
  actor: { companyId: string; userId: string; fullName: string },
  proposal: { id: string; leadId: string; version: number },
): Promise<ApprovalOutcome> {
  const previouslyFiled = await prisma.$transaction(async (tx) => {
    const others = await tx.solarProposal.findMany({
      where: {
        companyId: actor.companyId,
        leadId: proposal.leadId,
        approvedAt: { not: null },
        id: { not: proposal.id },
      },
      select: { id: true, approvedFileId: true },
    });

    if (others.length > 0) {
      await tx.solarProposal.updateMany({
        where: { id: { in: others.map((o) => o.id) } },
        data: { approvedAt: null, approvedById: null, approvedFileId: null },
      });
    }

    await tx.solarProposal.update({
      where: { id: proposal.id },
      data: {
        approvedAt: new Date(),
        approvedById: actor.userId,
        // Cleared, not carried. A version re-approved after being unapproved
        // must not inherit a file id whose row was deleted the first time.
        approvedFileId: null,
        events: {
          create: {
            type: "approved",
            actorId: actor.userId,
            actorName: actor.fullName,
            detail: others.length > 0 ? "replaced the previously approved version" : null,
          },
        },
      },
    });

    return others.map((o) => o.approvedFileId).filter((id): id is string => !!id);
  });

  // The superseded copy comes out of the folder only once the swap has
  // committed. Deleting first would lose the file if the transaction rolled
  // back, leaving a deal whose approved version points at nothing.
  await removeFiledCopies(actor.companyId, previouslyFiled);

  await prisma.activityLog.create({
    data: {
      companyId: actor.companyId,
      type: "system",
      message: `${actor.fullName} approved solar proposal v${proposal.version} as final`,
      leadId: proposal.leadId,
      actorId: actor.userId,
    },
  });

  return { approved: true };
}

/** Take the approval off a version, and its copy out of the folder. */
export async function unapproveProposalVersion(
  actor: { companyId: string; userId: string; fullName: string },
  proposal: { id: string; leadId: string; version: number; approvedFileId: string | null },
): Promise<void> {
  await prisma.solarProposal.update({
    where: { id: proposal.id },
    data: {
      approvedAt: null,
      approvedById: null,
      approvedFileId: null,
      events: {
        create: {
          type: "unapproved",
          actorId: actor.userId,
          actorName: actor.fullName,
        },
      },
    },
  });

  await removeFiledCopies(actor.companyId, [proposal.approvedFileId].filter((id): id is string => !!id));

  await prisma.activityLog.create({
    data: {
      companyId: actor.companyId,
      type: "system",
      message: `${actor.fullName} withdrew approval of solar proposal v${proposal.version}`,
      leadId: proposal.leadId,
      actorId: actor.userId,
    },
  });
}

/**
 * Drop filed copies from the folder.
 *
 * Row-only, matching deleteFileAction: the stored object is left behind rather
 * than destroyed, so a mistaken unapprove costs a database row and not the
 * document itself.
 */
export async function removeFiledCopies(companyId: string, fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return;
  await prisma.fileAsset.deleteMany({
    where: { companyId, id: { in: fileIds } },
  });
}

/**
 * The name to print beside the approved badge.
 *
 * A separate lookup rather than a relation on the column, matching
 * `layoutApprovedById` and `createdById` on the same models — these actor
 * stamps are bare ids throughout this schema. At most one version per deal is
 * approved, so this is one row, and it returns an empty map rather than
 * throwing when the user has since been deleted.
 */
export async function approverNames(
  companyId: string,
  proposals: { approvedById: string | null }[],
): Promise<Map<string, string>> {
  const ids = [...new Set(proposals.map((p) => p.approvedById).filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { companyId, id: { in: ids } },
    select: { id: true, firstName: true, lastName: true },
  });
  return new Map(
    users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]),
  );
}
