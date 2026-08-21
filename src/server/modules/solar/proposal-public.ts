import { prisma } from "@/server/db/client";
import { runUnscoped, runInVertical, asActiveVertical } from "@/server/vertical/context";
import type { SolarProposalSnapshot } from "@/lib/solar-proposal";
import { recordStageEntry } from "@/server/modules/pipeline/stage-history";

/**
 * Statuses that make a proposal publicly readable.
 *
 * A token is NOT authorization on its own. `draft` and `generated` mean nobody
 * has decided to show this to the customer yet, and until that decision is made
 * the document has no public existence — even if a token somehow sits on the
 * row (an old one minted by the previous generate-mints-a-token behaviour, a
 * restored backup, a hand-written UPDATE).
 *
 * Belt AND braces on purpose: the send action is what mints a token, so an
 * unsent proposal should have none to try. This check is what makes that a
 * guarantee rather than an assumption.
 */
const PUBLICLY_READABLE = ["sent", "viewed", "signed"] as const;

/**
 * Public read of a proposal by its share token.
 *
 * The token identifies exactly one row, whose workspace is not known until it
 * is read — the same pattern as the other public token pages. Returns the
 * FROZEN snapshot, never a recomputation, so the customer always sees exactly
 * what was generated for them.
 *
 * Returns null for anything not yet sent, which the route renders as a 404 —
 * deliberately indistinguishable from a bad token, so probing cannot tell the
 * difference between "no such proposal" and "exists but not sent yet".
 */
export async function getPublicSolarProposal(token: string) {
  if (!token) return null;
  const proposal = await runUnscoped(
    "public proposal page: resolve by share token before the workspace is known",
    () =>
      prisma.solarProposal.findUnique({
        where: { publicToken: token },
        select: {
          id: true, leadId: true, companyId: true, version: true, status: true, signedAt: true,
          sentAt: true, supersededAt: true, snapshot: true,
          showComparison: true, showPaymentOptions: true,
          lead: { select: { vertical: true } },
        },
      })
  );
  if (!proposal) return null;
  // The gate. Both conditions, because status and sentAt are written together
  // and either one being wrong should close the door rather than open it.
  if (!PUBLICLY_READABLE.includes(proposal.status as (typeof PUBLICLY_READABLE)[number])) return null;
  if (!proposal.sentAt) return null;
  return { ...proposal, snapshot: proposal.snapshot as unknown as SolarProposalSnapshot };
}

/** First-view tracking. Best effort — never blocks the render. */
export async function recordProposalView(token: string, ip: string | null) {
  const proposal = await getPublicSolarProposal(token);
  if (!proposal) return;
  await runInVertical(asActiveVertical(proposal.lead.vertical), async () => {
    // Only a SENT proposal can transition to viewed. `generated` used to be in
    // this list, which meant an internal preview could mark a document the
    // customer had never received as "viewed" — destroying the one signal that
    // says whether they actually opened it.
    await prisma.solarProposal.updateMany({
      where: { id: proposal.id, status: "sent" },
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
  // getPublicSolarProposal already refuses anything not sent, so acceptance is
  // unreachable for a draft or an internally-generated preview.
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
      select: { id: true, name: true, position: true, defaultBlocker: true },
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
      await recordStageEntry({ leadId: proposal.leadId, stageId: stage.id, stage });
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
