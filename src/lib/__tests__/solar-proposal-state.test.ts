import { describe, it, expect } from "vitest";
import {
  solarProposalState,
  mayInheritLiveLink,
  mayStartApplication,
  proposalVersionStanding,
  SOLAR_PROPOSAL_STATE_CTA,
  type SolarProposalStateInput,
} from "@/lib/solar-proposal-state";

const base: SolarProposalStateInput = {
  hasDesign: false,
  hasFinance: false,
  isReady: false,
  latestProposal: null,
};

const proposal = (over: Partial<NonNullable<SolarProposalStateInput["latestProposal"]>> = {}) => ({
  status: "generated",
  sentAt: null,
  viewedAt: null,
  signedAt: null,
  supersededAt: null,
  ...over,
});

describe("a deal's proposal state follows the rows that already exist", () => {
  it("is not started until something has been saved", () => {
    expect(solarProposalState(base)).toBe("not_started");
  });

  it("becomes a draft the moment step 1 is saved", () => {
    expect(solarProposalState({ ...base, hasDesign: true })).toBe("draft");
  });

  it("stays a draft while anything still blocks generation", () => {
    expect(
      solarProposalState({ ...base, hasDesign: true, hasFinance: true, isReady: false })
    ).toBe("draft");
  });

  it("becomes ready once design and financing validate", () => {
    expect(
      solarProposalState({ ...base, hasDesign: true, hasFinance: true, isReady: true })
    ).toBe("ready");
  });

  it("becomes generated once a proposal exists", () => {
    expect(
      solarProposalState({
        ...base, hasDesign: true, hasFinance: true, isReady: true,
        latestProposal: proposal(),
      })
    ).toBe("generated");
  });

  it("reads sent, viewed and accepted off the proposal itself", () => {
    const on = { ...base, hasDesign: true, hasFinance: true, isReady: true };
    expect(solarProposalState({ ...on, latestProposal: proposal({ sentAt: new Date() }) })).toBe("sent");
    expect(
      solarProposalState({ ...on, latestProposal: proposal({ sentAt: new Date(), viewedAt: new Date() }) })
    ).toBe("viewed");
    expect(
      solarProposalState({ ...on, latestProposal: proposal({ signedAt: new Date() }) })
    ).toBe("accepted");
  });

  it("an accepted proposal outranks everything, including a later supersede", () => {
    // What the customer agreed to is a fact; nothing after it re-opens the deal.
    expect(
      solarProposalState({
        ...base, hasDesign: true, hasFinance: true, isReady: true,
        latestProposal: proposal({ signedAt: new Date(), supersededAt: new Date() }),
      })
    ).toBe("accepted");
  });

  it("does not fall back to draft when the inputs stop validating after generation", () => {
    // A generated document exists whatever the inputs have done since. Showing
    // "Draft" over a proposal the customer is holding would be a lie.
    expect(
      solarProposalState({
        ...base, hasDesign: true, hasFinance: true, isReady: false,
        latestProposal: proposal(),
      })
    ).toBe("generated");
  });
});

describe("the card's action follows the state", () => {
  it("tells the rep what to do next rather than always saying Build", () => {
    expect(SOLAR_PROPOSAL_STATE_CTA.not_started).toBe("Build proposal");
    expect(SOLAR_PROPOSAL_STATE_CTA.draft).toBe("Continue draft");
    expect(SOLAR_PROPOSAL_STATE_CTA.ready).toBe("Review and generate");
    expect(SOLAR_PROPOSAL_STATE_CTA.generated).toBe("View proposal");
  });
});

describe("a signature keeps the customer's link, not the whole builder", () => {
  it("lets a live re-price carry the link off an unsigned version", () => {
    expect(mayInheritLiveLink({ publicToken: "tok", signedAt: null })).toBe(true);
  });

  it("refuses to move the link off a version the customer signed", () => {
    // The whole point of the rule: the address a homeowner put their name at
    // must not start resolving to an unsigned newer draft.
    expect(mayInheritLiveLink({ publicToken: "tok", signedAt: new Date() })).toBe(false);
    expect(mayInheritLiveLink({ publicToken: "tok", signedAt: "2026-08-27T12:00:00Z" })).toBe(false);
  });

  it("has nothing to carry from a version that was never sent", () => {
    expect(mayInheritLiveLink({ publicToken: null, signedAt: null })).toBe(false);
  });

  it("has nothing to carry when this is the first version", () => {
    expect(mayInheritLiveLink(null)).toBe(false);
  });
});

/**
 * WHICH DOCUMENT MAY PUT A PRICE IN FRONT OF AN UNDERWRITER.
 *
 * The rule this replaces was "not superseded", which is a proxy for "this is
 * what the deal is written at" — and the proxy breaks on precisely the row the
 * customer holds. A signature pins the live link to the version that was
 * signed (see `mayInheritLiveLink` above), so generating a v14 leaves the
 * household on a signed, superseded v13 with no newer link in existence.
 */
describe("which document may start a credit application", () => {
  it("lets the current document through", () => {
    expect(
      mayStartApplication({ supersededAt: null, signedAt: null, approvedAt: null })
    ).toBe(true);
  });

  it("lets the version the customer SIGNED through, newer versions or not", () => {
    expect(
      mayStartApplication({
        supersededAt: new Date(),
        signedAt: new Date(),
        approvedAt: null,
      })
    ).toBe(true);
  });

  it("lets the version an admin approved through", () => {
    // Signing approves automatically, but approval predates nothing: an admin
    // naming the version this deal sold is making the same claim by hand.
    expect(
      mayStartApplication({
        supersededAt: new Date(),
        signedAt: null,
        approvedAt: new Date(),
      })
    ).toBe(true);
  });

  it("refuses a superseded draft nobody agreed to", () => {
    // The rule that must survive: an ordinary generate does NOT move the
    // customer's link, so a household can sit on a retracted price for weeks.
    expect(
      mayStartApplication({ supersededAt: new Date(), signedAt: null, approvedAt: null })
    ).toBe(false);
  });

  it("reads dates that arrived as strings", () => {
    expect(
      mayStartApplication({
        supersededAt: "2026-09-01T00:00:00Z",
        signedAt: "2026-08-30T00:00:00Z",
        approvedAt: null,
      })
    ).toBe(true);
  });
});

describe("proposalVersionStanding", () => {
  const version = {
    status: "generated",
    sentAt: null as Date | string | null,
    viewedAt: null as Date | string | null,
    signedAt: null as Date | string | null,
    supersededAt: null as Date | string | null,
  };

  it("says Not sent on a version that has only been generated", () => {
    expect(proposalVersionStanding(version)).toEqual({ label: "Not sent", tone: "progress" });
  });

  it("says Pending signature once it has gone to the customer", () => {
    expect(proposalVersionStanding({ ...version, status: "sent", sentAt: new Date() })).toEqual({
      label: "Pending signature",
      tone: "ready",
    });
  });

  it("still says Pending signature after they open it", () => {
    // Opening is not an outcome. It belongs on the row as a timeline, not as
    // the word that says where the document stands.
    expect(
      proposalVersionStanding({
        ...version,
        status: "viewed",
        sentAt: new Date(),
        viewedAt: new Date(),
      })
    ).toEqual({ label: "Pending signature", tone: "ready" });
  });

  it("says Signed on a signed version even after a newer one replaces it", () => {
    // THE CASE THE OLD BADGE GOT WRONG: building a v14 supersedes the signed
    // v13, and the row used to lose the only word saying a human agreed to it.
    expect(
      proposalVersionStanding({
        ...version,
        status: "signed",
        signedAt: new Date(),
        supersededAt: new Date(),
      })
    ).toEqual({ label: "Signed", tone: "done" });
  });

  it("says Superseded on an unsigned version that was replaced", () => {
    expect(proposalVersionStanding({ ...version, supersededAt: new Date() })).toEqual({
      label: "Superseded",
      tone: "neutral",
    });
  });

  it("keeps a refusal visible through a supersede", () => {
    expect(
      proposalVersionStanding({ ...version, status: "declined", supersededAt: new Date() })
    ).toEqual({ label: "Declined", tone: "neutral" });
  });

  it("says Draft before anything has been generated", () => {
    expect(proposalVersionStanding({ ...version, status: "draft" })).toEqual({
      label: "Draft",
      tone: "neutral",
    });
  });
});
