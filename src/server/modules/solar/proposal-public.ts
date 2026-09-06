import { prisma } from "@/server/db/client";
import { runUnscoped, runInVertical, asActiveVertical } from "@/server/vertical/context";
import type { SolarProposalSnapshot } from "@/lib/solar-proposal";
import type { ActiveVertical } from "@/lib/vertical";
import type { ProposalCertificate } from "@/lib/proposal-signature";
import { isSignatureImage } from "@/lib/signature-image";
import { recordStageEntry } from "@/server/modules/pipeline/stage-history";
import { approveProposalVersion } from "./proposal-approval";
import { SIGNATURE_SELECT, certificateFor } from "./proposal-signature";
import { readWitness } from "./witness";
import { snapshotSolarDealComp } from "./deal-comp";

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
          id: true, leadId: true, companyId: true, version: true, status: true,
          sentAt: true, supersededAt: true, snapshot: true,
          showComparison: true, showPaymentOptions: true,
          ...SIGNATURE_SELECT,
          lead: { select: { vertical: true, email: true } },
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
export type AcceptInput = {
  /** The name the signer typed. This is the name that goes on the document. */
  name: string;
  /** The mark, as a PNG data URL from the pad. */
  signature: string;
  /** How the mark was made. */
  signatureType: "typed" | "drawn";
  /**
   * When the signer ticked the electronic-signature consent, as the browser
   * saw it. Server-clamped — see `consentTimestamp`.
   */
  consentAtMs: number | null;
  /** Minted by a rep opening an in-person session. See ./witness. */
  witness?: string | null;
  ip: string | null;
  userAgent: string | null;
};

/**
 * When the signer consented, as a timestamp this application is willing to put
 * its name to.
 *
 * The browser's clock is the only thing that knows when the box was actually
 * ticked, and the browser's clock is also the one thing in this transaction the
 * customer can set to anything they like. So it is USED but BOUNDED: a consent
 * that claims to be in the future, or older than the whole session could
 * plausibly be, is discarded and the server's own time stands instead. A record
 * saying "consented and signed in the same second" is weaker than one saying
 * "consented two minutes earlier" and stronger than one quoting a fabricated
 * time as fact.
 */
function consentTimestamp(claimedMs: number | null, now: Date): Date {
  if (!claimedMs || !Number.isFinite(claimedMs)) return now;
  const claimed = new Date(claimedMs);
  if (claimed > now) return now;
  if (now.getTime() - claimed.getTime() > 6 * 60 * 60 * 1000) return now;
  return claimed;
}

export async function acceptSolarProposal(
  token: string,
  meta: AcceptInput
): Promise<{ ok: boolean; error?: string; certificate?: ProposalCertificate }> {
  // getPublicSolarProposal already refuses anything not sent, so acceptance is
  // unreachable for a draft or an internally-generated preview.
  const proposal = await getPublicSolarProposal(token);
  if (!proposal) return { ok: false, error: "This proposal link is not valid." };
  if (proposal.supersededAt) {
    return { ok: false, error: "A newer version of this proposal has been issued. Please ask for the current link." };
  }
  if (proposal.signedAt) return { ok: false, error: "This proposal has already been accepted." };

  // Validated HERE and not only in the form. The form is a convenience; this
  // endpoint is public and its only authorization is the share token, so
  // everything it stores has to be checked as if it arrived by hand.
  const name = meta.name.trim().replace(/\s+/g, " ").slice(0, 120);
  if (name.length < 2) return { ok: false, error: "Please type your full name." };
  if (meta.signatureType !== "typed" && meta.signatureType !== "drawn") {
    return { ok: false, error: "That signature could not be read. Please sign again." };
  }
  // A raster data URL and nothing else. An SVG would be a script tag in a
  // picture, rendered back into the rep's portal and the lender's PDF.
  if (!isSignatureImage(meta.signature)) {
    return { ok: false, error: "That signature could not be read. Please sign again." };
  }
  if (!meta.consentAtMs) {
    return { ok: false, error: "Please agree to sign electronically before signing." };
  }

  // Only a token minted by a signed-in rep for THIS proposal makes it in
  // person. A forged or expired one is not an error — the customer really did
  // sign — it simply records the weaker, provable claim.
  const hostId = readWitness(meta.witness, proposal.id);

  const now = new Date();
  const vertical = asActiveVertical(proposal.lead.vertical);
  await runInVertical(vertical, async () => {
    await prisma.solarProposal.update({
      where: { id: proposal.id },
      data: {
        status: "signed",
        signedAt: now,
        signatureData: meta.signature,
        signatureType: meta.signatureType,
        signerName: name,
        // The mailbox the link went to, copied at signing time. The lead's
        // address can be edited afterwards; what the certificate has to say is
        // where the document was delivered when it was signed.
        signerEmail: proposal.lead.email,
        signedIp: meta.ip,
        signedUserAgent: meta.userAgent?.slice(0, 500) ?? null,
        consentAt: consentTimestamp(meta.consentAtMs, now),
        signedVia: hostId ? "in_person" : "remote",
        signedHostId: hostId,
        events: {
          create: {
            type: "signed",
            actorId: hostId,
            actorName: name,
            ip: meta.ip,
            detail: hostId ? "in person, on a representative's device" : "remotely, from the customer's link",
          },
        },
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

    // Freeze what this deal pays, now that it is sold. Best-effort and
    // create-only: a customer's signature must never fail because a rep's
    // redline was not configured. See solar/deal-comp.ts.
    await snapshotSolarDealComp({ companyId: co, leadId: proposal.leadId, signedAt: now });

    await prisma.activityLog.create({
      data: {
        companyId: co,
        type: "system",
        message: `${name} signed solar proposal v${proposal.version}${hostId ? " in person" : ""}`,
        leadId: proposal.leadId,
      },
    });
  });

  // THE SIGNED VERSION IS NOW THE APPROVED ONE, and this is the case the whole
  // feature exists for. A signature is the strongest statement anybody makes
  // about which proposal this deal sold — stronger than an admin's guess made
  // before the customer had seen it — so it does not wait for someone to go and
  // record it by hand. It also retires whatever PDF was in the deal's Proposal
  // folder: if this version was already approved, that copy was rendered BEFORE
  // the signature, and an unsigned copy of a signed proposal is precisely the
  // document the lender will not take.
  await approveOnSignature(
    { id: proposal.id, companyId: proposal.companyId, leadId: proposal.leadId, version: proposal.version },
    vertical,
    name,
  );

  /**
   * The whole signing record, handed straight back.
   *
   * NOT a bare "ok" with the page left to re-fetch. A refresh here re-runs the
   * public read — which logs a VIEW — so the certificate of a proposal signed
   * seconds ago carried a line saying the customer opened it at the moment they
   * signed it. Nothing opened it: the application did, to find out what it had
   * just written. Returning the record means the document has everything it
   * needs without asking, and the trail says only what actually happened.
   */
  return { ok: true, certificate: (await certificateFor(proposal.id)) ?? undefined };
}

/**
 * The signed version becomes the version this deal sold.
 *
 * Approval used to be entirely by hand, and the hand was frequently late: a
 * customer signed on Tuesday, nobody pressed Approve, and the deal's Proposal
 * folder stayed empty or — worse — held the pre-signature draft. Signing is an
 * unambiguous decision by the only person whose decision it is, so it now makes
 * the record itself.
 *
 * IT OVERRIDES AN EARLIER APPROVAL, deliberately. An admin who approved v12
 * yesterday was saying "this is what we sold" about a document nobody had
 * signed yet; the customer signing v13 today answers the same question with
 * better evidence. The override is one-way in time and not a fight: nothing
 * re-runs afterwards, so an admin who then approves a different version by hand
 * has the last word and keeps it.
 *
 * THE PDF IS NOT RENDERED HERE. The renderer boots Chromium and can take the
 * better part of a minute; a homeowner pressing Sign must not wait behind it,
 * and a browser failing to start must not fail their signature. Approval leaves
 * `approvedFileId` null, which the version list already reads as "copy not
 * filed" — and now also acts on: the next portal user with the authority to
 * approve files it in the background. See ProposalVersionList.
 *
 * Best effort and never fatal, matching the housekeeping it replaces. The
 * signature is committed by the time this runs, and the worst outcome of it
 * failing is an approval somebody makes by hand — which is exactly where this
 * feature started.
 */
async function approveOnSignature(
  proposal: { id: string; companyId: string; leadId: string; version: number },
  vertical: ActiveVertical,
  signerName: string,
): Promise<void> {
  try {
    await runInVertical(vertical, () =>
      approveProposalVersion(
        // No user id: nobody pressed anything. See ApprovalActor.
        { companyId: proposal.companyId, userId: null, fullName: signerName },
        proposal,
        "on_signature",
      )
    );
  } catch (err) {
    // Non-fatal — see above — but not silent. This is the one step here nobody
    // is watching: the signature is already committed and the customer is
    // already looking at their certificate, so a failure shows up later as a
    // deal somebody has to approve by hand, with nothing saying why.
    console.warn(`[proposal] could not approve v${proposal.version} on signature`, err);
  }
}
