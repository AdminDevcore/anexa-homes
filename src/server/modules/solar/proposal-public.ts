import { prisma } from "@/server/db/client";
import { runUnscoped, runInVertical, asActiveVertical } from "@/server/vertical/context";
import type { SolarProposalSnapshot } from "@/lib/solar-proposal";

/**
 * Public read of a proposal by its share token.
 *
 * The token is the authorization and identifies exactly one row, whose
 * workspace is not known until it is read — the same pattern as the other
 * public token pages. Returns the FROZEN snapshot, never a recomputation, so
 * the customer always sees exactly what was generated for them.
 */
export async function getPublicSolarProposal(token: string) {
  const proposal = await runUnscoped(
    "public proposal page: resolve by share token before the workspace is known",
    () =>
      prisma.solarProposal.findUnique({
        where: { publicToken: token },
        select: {
          id: true, leadId: true, version: true, status: true, signedAt: true,
          supersededAt: true, snapshot: true, lead: { select: { vertical: true } },
        },
      })
  );
  if (!proposal) return null;
  return { ...proposal, snapshot: proposal.snapshot as unknown as SolarProposalSnapshot };
}

/** First-view tracking. Best effort — never blocks the render. */
export async function recordProposalView(token: string, ip: string | null) {
  const proposal = await getPublicSolarProposal(token);
  if (!proposal) return;
  await runInVertical(asActiveVertical(proposal.lead.vertical), async () => {
    await prisma.solarProposal.updateMany({
      where: { id: proposal.id, status: { in: ["generated", "sent"] } },
      data: { status: "viewed", viewedAt: new Date() },
    });
    await prisma.solarProposalEvent.create({
      data: { proposalId: proposal.id, type: "viewed", ip, actorName: "Customer" },
    });
  });
}

/**
 * Customer accepts the proposal.
 *
 * Advances the deal to Contract Signed — the one stage move a customer action
 * is allowed to make, because signing IS the event. NTP stays a coordinator
 * action, consistent with how credit approval is handled: an approval carries
 * stipulations, and pushing unfunded deals into design spend is exactly what we
 * are avoiding.
 */
export async function acceptSolarProposal(
  token: string,
  meta: { name: string; ip: string | null }
): Promise<{ ok: boolean; error?: string }> {
  const proposal = await getPublicSolarProposal(token);
  if (!proposal) return { ok: false, error: "This proposal link is not valid." };
  if (proposal.supersededAt) {
    return { ok: false, error: "A newer version of this proposal has been issued. Please ask for the current link." };
  }
  if (proposal.signedAt) return { ok: false, error: "This proposal has already been accepted." };

  const vertical = asActiveVertical(proposal.lead.vertical);
  await runInVertical(vertical, async () => {
    await prisma.solarProposal.update({
      where: { id: proposal.id },
      data: {
        status: "signed",
        signedAt: new Date(),
        events: { create: { type: "signed", actorName: meta.name, ip: meta.ip } },
      },
    });

    // Signing advances the pipeline to Contract Signed, if that stage exists.
    const { companyId: co } = await prisma.solarProposal.findUniqueOrThrow({
      where: { id: proposal.id },
      select: { companyId: true },
    });
    const stage = await prisma.pipelineStage.findFirst({
      where: { key: "contract_signed", pipeline: { companyId: co, vertical } },
      select: { id: true, defaultBlocker: true },
    });
    if (stage) {
      await prisma.lead.update({
        where: { id: proposal.leadId },
        data: {
          stageId: stage.id,
          stageChangedAt: new Date(),
          stageAlertLevel: 0,
          stageOverdue: false,
          blockedBy: stage.defaultBlocker,
          lastTouchAt: new Date(),
          lastChaseAlertAt: null,
        },
      });
    }

    const { companyId } = await prisma.solarProposal.findUniqueOrThrow({
      where: { id: proposal.id },
      select: { companyId: true },
    });
    await prisma.activityLog.create({
      data: {
        companyId,
        type: "system",
        message: `${meta.name} accepted solar proposal v${proposal.version}`,
        leadId: proposal.leadId,
      },
    });
  });

  return { ok: true };
}
