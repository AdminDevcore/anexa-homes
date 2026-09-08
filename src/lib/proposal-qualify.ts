/**
 * What the proposal is allowed to offer behind its Qualify button.
 *
 * Resolved on the server at render and passed down as a prop, so the type has
 * to be reachable from both a server page and a client component without
 * dragging either one's imports into the other.
 *
 * Null — no offer at all — is the ordinary case and means the button stays the
 * plain external link it has always been: the deal's lender has no API
 * credentials, or the reader has switched to an option this deal is not priced
 * at.
 */
export type QualifyOffer =
  | {
      state: "ready";
      lenderName: string;
      /**
       * What is about to be sent, built on the server from the same rows the
       * submission reads. Shown to the household BEFORE they commit to it,
       * because "we sent your details to a bank" is not something to discover
       * afterwards.
       */
      summary: {
        customer: string;
        property: string;
        system: string;
        financing: string;
      };
    }
  | {
      state: "blocked";
      /**
       * NULL when the block is about the DOCUMENT rather than the deal — a
       * version that has been replaced is refused before the deal's lender is
       * ever looked up, because which partner would have taken it is not the
       * point and reading it would be a query asked for a sentence.
       */
      lenderName: string | null;
      /**
       * Why it cannot be sent, in the words the preflight uses. REP-FACING
       * ONLY — the customer's copy is never handed this shape, and the server
       * is what enforces that rather than the component. See
       * `readProposalQualifyOffer`.
       */
      problems: string[];
    };
