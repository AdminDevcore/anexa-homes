/**
 * The customer-facing solar proposal.
 *
 * The document itself lives in ./solar — one file per concern, because this was
 * a single 2,074-line component and a file that long is one nobody edits
 * confidently. This module stays as the import path so `/proposal/[token]` and
 * the portal preview did not have to move.
 */
export { SolarProposalView } from "./solar";
