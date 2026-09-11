import { prisma } from "@/server/db/client";
import { restampLeadValue } from "./deal-value";

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
 * Who is approving.
 *
 * `userId` is NULLABLE because the strongest approval in this system is not
 * made by a user at all. When the customer signs, that version becomes the one
 * the deal sold and nobody pressed anything — so there is no id to record.
 * Inventing one (the rep who built it, the last admin who touched the deal)
 * would put a name against a decision that person did not make. A null id is
 * exactly what the row means by "approved on signature", and the list reads it
 * that way.
 */
export type ApprovalActor = {
  companyId: string;
  userId: string | null;
  /** The name on the event line: the admin who pressed it, or the signer. */
  fullName: string;
};

/**
 * How this approval came about.
 *
 * Only ever the difference between two sentences — the swap itself is
 * identical, because a signature and an admin are making the same claim about
 * the same deal. It is NOT a stored column: `approvedById` already separates
 * them (see ApprovalActor), and a second field saying the same thing is a
 * second field that can disagree with the first.
 */
export type ApprovalVia = "by_hand" | "on_signature";

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
  actor: ApprovalActor,
  proposal: { id: string; leadId: string; version: number },
  via: ApprovalVia = "by_hand",
): Promise<ApprovalOutcome> {
  const { stale, replaced } = await prisma.$transaction(async (tx) => {
    /**
     * Every approved version on this deal, INCLUDING the one being approved.
     *
     * The target is in this list because its own filed copy is about to be
     * orphaned: `approvedFileId` is cleared below, and a file nothing points at
     * would sit in the Proposal folder forever with no row able to say it is
     * stale. That case is not hypothetical — it is the signing path. A version
     * approved before the customer signed has an UNSIGNED pdf in the folder,
     * and re-approving it on the signature is precisely when that copy has to
     * come out.
     */
    const approved = await tx.solarProposal.findMany({
      where: {
        companyId: actor.companyId,
        leadId: proposal.leadId,
        approvedAt: { not: null },
      },
      select: { id: true, version: true, approvedFileId: true, approvedParFileId: true },
    });
    const others = approved.filter((a) => a.id !== proposal.id);

    if (others.length > 0) {
      await tx.solarProposal.updateMany({
        where: { id: { in: others.map((o) => o.id) } },
        data: {
          approvedAt: null,
          approvedById: null,
          approvedFileId: null,
          approvedParFileId: null,
        },
      });
    }

    const list = others.map((o) => `v${o.version}`).join(", ");
    await tx.solarProposal.update({
      where: { id: proposal.id },
      data: {
        approvedAt: new Date(),
        approvedById: actor.userId,
        // Cleared, not carried. A version re-approved after being unapproved
        // must not inherit a file id whose row was deleted the first time.
        // BOTH copies — a signed proposal that earns credits files the deal at
        // par alongside it, and half a pair left pointing at a deleted row is
        // the same bug wearing a second column.
        approvedFileId: null,
        approvedParFileId: null,
        events: {
          create: {
            type: "approved",
            actorId: actor.userId,
            actorName: actor.fullName,
            detail:
              via === "on_signature"
                ? list
                  ? `the customer signed this version — replaced ${list}`
                  : "the customer signed this version"
                : list
                  ? "replaced the previously approved version"
                  : null,
          },
        },
      },
    });

    return {
      stale: approved
        .flatMap((a) => [a.approvedFileId, a.approvedParFileId])
        .filter((id): id is string => !!id),
      replaced: list,
    };
  });

  // The superseded copy comes out of the folder only once the swap has
  // committed. Deleting first would lose the file if the transaction rolled
  // back, leaving a deal whose approved version points at nothing.
  await removeFiledCopies(actor.companyId, stale);

  // The pipeline follows the approval. Approving v13 over a newer v14 hands the
  // deal page back to v13, and a lead value still stamped from v14 would leave
  // every list totalling a document this deal no longer reports.
  await restampLeadValue(actor.companyId, proposal.leadId);

  await prisma.activityLog.create({
    data: {
      companyId: actor.companyId,
      type: "system",
      message:
        via === "on_signature"
          ? `Solar proposal v${proposal.version} was approved automatically — ${actor.fullName} signed it${replaced ? ` (replacing ${replaced})` : ""}`
          : `${actor.fullName} approved solar proposal v${proposal.version} as final`,
      leadId: proposal.leadId,
      actorId: actor.userId,
    },
  });

  return { approved: true };
}

/** Take the approval off a version, and its copy out of the folder. */
export async function unapproveProposalVersion(
  actor: ApprovalActor,
  proposal: {
    id: string;
    leadId: string;
    version: number;
    approvedFileId: string | null;
    approvedParFileId?: string | null;
  },
): Promise<void> {
  await prisma.solarProposal.update({
    where: { id: proposal.id },
    data: {
      approvedAt: null,
      approvedById: null,
      approvedFileId: null,
      approvedParFileId: null,
      events: {
        create: {
          type: "unapproved",
          actorId: actor.userId,
          actorName: actor.fullName,
        },
      },
    },
  });

  await removeFiledCopies(
    actor.companyId,
    [proposal.approvedFileId, proposal.approvedParFileId].filter((id): id is string => !!id),
  );

  // And back again: with the mark gone the newest version answers once more, so
  // the column has to follow the report rather than keep the withdrawn one.
  await restampLeadValue(actor.companyId, proposal.leadId);

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
 * Row-only, matching deleteFileAction and pruneSupersededLayouts: the stored
 * object is left behind rather than destroyed, so a mistaken unapprove costs a
 * database row and not the document itself.
 *
 * That retention is deliberate and applies to every deletion path in the
 * application, which is why bytes accumulate. `server/storage/release.ts` can
 * free them safely (it refuses while any other FileAsset still points at the
 * key) but is intentionally NOT wired in here — reversing this policy is a
 * product decision, not a refactor. `scripts/storage-orphans.ts` lists what has
 * built up in the meantime.
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
