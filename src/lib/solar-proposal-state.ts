/**
 * Where a solar deal's proposal stands, as one value.
 *
 * DERIVED, not stored. A `proposalState` column would need writing from four
 * different places (design save, finance save, generation, acceptance) and
 * would be wrong the moment one of them was missed or a validation rule
 * changed — and a stale "Ready" badge on a deal that no longer validates is
 * worse than no badge, because a rep trusts it. Deriving it from the rows that
 * already exist means it cannot disagree with them.
 *
 * The states the launch cycle needs are the first four; the rest are read off
 * the generated proposal row, which already tracks them.
 */

export type SolarProposalState =
  | "not_started"
  | "draft"
  | "ready"
  | "generated"
  | "sent"
  | "viewed"
  | "accepted"
  | "declined"
  | "superseded";

export type SolarProposalStateInput = {
  hasDesign: boolean;
  hasFinance: boolean;
  /** True when nothing BLOCKS generation. Warnings do not count. */
  isReady: boolean;
  /** The newest non-superseded proposal, if one has been generated. */
  latestProposal: {
    status: string;
    sentAt: Date | string | null;
    viewedAt: Date | string | null;
    signedAt: Date | string | null;
    supersededAt: Date | string | null;
  } | null;
};

export function solarProposalState(i: SolarProposalStateInput): SolarProposalState {
  const p = i.latestProposal;
  if (p) {
    // The proposal row's own lifecycle wins once one exists — a generated
    // document is a fact, whatever the inputs have done since.
    if (p.signedAt) return "accepted";
    if (p.status === "declined") return "declined";
    if (p.supersededAt) return "superseded";
    if (p.viewedAt) return "viewed";
    if (p.sentAt) return "sent";
    return "generated";
  }
  if (!i.hasDesign && !i.hasFinance) return "not_started";
  return i.isReady ? "ready" : "draft";
}

/** Customer-neutral label for the deal page badge. */
export const SOLAR_PROPOSAL_STATE_LABEL: Record<SolarProposalState, string> = {
  not_started: "Not started",
  draft: "Draft",
  ready: "Ready",
  generated: "Generated",
  sent: "Sent",
  viewed: "Viewed",
  accepted: "Accepted",
  declined: "Declined",
  superseded: "Superseded",
};

/**
 * What the card's button should say. The action changes with the state so a rep
 * is told what to do next rather than being handed the same "Build Proposal"
 * button on a deal that has already been signed.
 */
export const SOLAR_PROPOSAL_STATE_CTA: Record<SolarProposalState, string> = {
  not_started: "Build proposal",
  draft: "Continue draft",
  ready: "Review and generate",
  generated: "View proposal",
  sent: "View proposal",
  viewed: "View proposal",
  accepted: "View proposal",
  declined: "View proposal",
  superseded: "Build new version",
};

/** Badge tone. Kept out of the components so both call sites agree. */
export const SOLAR_PROPOSAL_STATE_TONE: Record<SolarProposalState, "neutral" | "progress" | "ready" | "done"> = {
  not_started: "neutral",
  draft: "progress",
  ready: "ready",
  generated: "progress",
  sent: "progress",
  viewed: "progress",
  accepted: "done",
  declined: "neutral",
  superseded: "neutral",
};

/**
 * Whether a new version may take the previous one's customer link.
 *
 * The successor to `proposalIsLocked`, which froze the whole builder once a
 * customer had accepted anything. That rule was aimed at the right thing and
 * hit the wrong one: what a signature has to protect is the RECORD of what was
 * agreed, and a new version does not touch it — it is its own row, with its own
 * snapshot and its own reference. The deals that need a v14 are precisely the
 * ones that got a signature.
 *
 * What a signature really does close is this one door. A live re-price hands
 * the customer's URL to the new version so the tab open on the kitchen table
 * keeps up; do that to a signed document and the address the homeowner put
 * their name at silently starts resolving to an unsigned draft. So the link
 * stays where the signature is, and the new version gets its own when it is
 * sent.
 *
 * @param previous the version being superseded — null when this is the first.
 */
export function mayInheritLiveLink(
  previous: { publicToken: string | null; signedAt: Date | string | null } | null
): boolean {
  if (!previous?.publicToken) return false;
  return !previous.signedAt;
}
