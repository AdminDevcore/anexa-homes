/**
 * CONTRACT SIGNED IS EARNED, NOT DRAGGED.
 *
 * A solar deal is at Contract Signed when TWO documents exist, not when
 * somebody moves a card:
 *
 *   1. the customer has signed the proposal (SolarProposal.signedAt), AND
 *   2. a completed contract sits in the deal's Contract folder — either a
 *      COMPLETED e-signature package from a template classified as the solar
 *      contract (Anexa's own), or a PDF explicitly MARKED as the lender's
 *      signed contract (Amos). Nothing counts for being in the folder alone: a
 *      utility bill, a photo, an unsigned or generated document, a package
 *      still out for signature — none of them is a contract.
 *
 * Either one alone is not a sale. A signed proposal with no contract is a
 * customer who agreed to a price; a contract with no signed proposal is paper
 * nobody can tie to the system that was quoted.
 *
 * WHICH STAGE IS "CONTRACT SIGNED" is `PipelineStage.milestone`, never the
 * stage's name or key. Names are edited in Settings ("Contract Signed / Hold"
 * in production) and a hand-made stage gets an auto-suffixed key, so matching
 * either would leave the gate open on exactly the pipeline that matters.
 *
 * Pure: no database. The server half is server/modules/pipeline/contract-signed.ts.
 */

export const CONTRACT_SIGNED_MILESTONE = "contract_signed" as const;

/** The solar Contract folder. Load-bearing — see lib/deal-folders.ts. */
export const CONTRACT_FOLDER_KEY = "contract";

/** The template type whose COMPLETED packages are the Anexa contract. */
export const SOLAR_CONTRACT_TEMPLATE_TYPE = "solar_contract" as const;

/** The classification that makes an uploaded PDF the lender's signed contract. */
export const SIGNED_LENDER_CONTRACT = "signed_lender_contract" as const;

/** The only file type a signed lender contract may be. */
export const CONTRACT_MIME_TYPE = "application/pdf";

export type MilestoneStage = {
  id: string;
  position: number;
  isLost: boolean;
  milestone: string | null;
};

/** The pipeline's Contract Signed stage, or null when none is marked. */
export function contractSignedStage<T extends MilestoneStage>(stages: T[]): T | null {
  return stages.find((s) => s.milestone === CONTRACT_SIGNED_MILESTONE && !s.isLost) ?? null;
}

/**
 * Does this move carry the deal over the Contract Signed line?
 *
 * AT OR PAST, BY POSITION: jumping straight to Permitting claims the same sale
 * as landing on Contract Signed, so it clears the same bar.
 *
 * NOT when the deal is already over the line. A job moving from Permitting to
 * Install is not re-signing anything, and deals that passed the stage before
 * this rule existed keep moving normally.
 *
 * A LOST STAGE IS NEVER PAST THE LINE, in either direction: cancelling is never
 * gated, and a cancelled deal being reopened into a live stage has to earn the
 * line again rather than inherit Cancelled's end-of-pipeline position.
 *
 * No marked stage means no line to cross — the Settings gap says so.
 */
export function crossesContractSigned(
  stages: MilestoneStage[],
  from: { position: number; isLost: boolean } | null,
  target: { position: number; isLost: boolean },
): boolean {
  if (target.isLost) return false;
  const gate = contractSignedStage(stages);
  if (!gate) return false;
  if (target.position < gate.position) return false;
  const alreadyOver = from != null && !from.isLost && from.position >= gate.position;
  return !alreadyOver;
}

export type ContractSignedEvidence = {
  /** The customer signed a proposal on this deal. */
  signedProposal: boolean;
  /** A COMPLETED package from a solar-contract template, in the Contract folder. */
  contractPackage: boolean;
  /** A PDF in the Contract folder MARKED as the lender's signed contract. */
  contractFile: boolean;
};

export const NO_EVIDENCE: ContractSignedEvidence = {
  signedProposal: false,
  contractPackage: false,
  contractFile: false,
};

export function contractSignedMet(e: ContractSignedEvidence): boolean {
  return e.signedProposal && (e.contractPackage || e.contractFile);
}

/**
 * The sentence to refuse a move with, naming exactly what is missing — or null
 * when both requirements are met. A rep told "not allowed" goes looking for a
 * permission; a rep told which document is missing goes and gets it.
 */
export function contractSignedMissing(e: ContractSignedEvidence): string | null {
  if (contractSignedMet(e)) return null;
  const missing: string[] = [];
  if (!e.signedProposal) missing.push("the customer's signature on the proposal");
  if (!e.contractPackage && !e.contractFile) {
    missing.push(
      "a completed contract in the Contract folder (a fully signed e-signature package of the solar contract template, or the lender's signed contract PDF marked as the signed contract)",
    );
  }
  return `Contract Signed needs both a signed proposal and a completed contract. Still missing: ${missing.join("; and ")}.`;
}
