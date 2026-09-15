import { prisma } from "@/server/db/client";

type TargetStage = { key: string; name: string };

/**
 * Conditions that must be true before a solar job is recorded as contract-signed.
 *
 * This lives beside the pipeline rather than in one UI action because stage
 * changes can originate from the board, the deal page, or an automation. A
 * stage cannot be a reliable business record if one of those paths bypasses
 * the same checks.
 */
export async function solarStageRequirementError(args: {
  companyId: string;
  leadId: string;
  vertical: string;
  stage: TargetStage;
}): Promise<string | null> {
  if (args.vertical !== "solar" || args.stage.key !== "contract_signed") return null;

  const [signedProposal, contractTemplate, completedContract] = await Promise.all([
    prisma.solarProposal.findFirst({
      where: { companyId: args.companyId, leadId: args.leadId, status: "signed" },
      select: { id: true },
    }),
    // A null folder key is the established Contract default. Keeping that
    // convention here also covers templates created before folder routing.
    prisma.documentTemplate.findFirst({
      where: {
        companyId: args.companyId,
        vertical: "solar",
        active: true,
        folderKey: null,
      },
      select: { id: true },
    }),
    prisma.documentPackage.findFirst({
      where: {
        companyId: args.companyId,
        leadId: args.leadId,
        vertical: "solar",
        status: "completed",
        folderKey: null,
      },
      select: { id: true },
    }),
  ]);

  if (!signedProposal) {
    return "Contract Signed requires a customer-signed solar proposal.";
  }
  if (!contractTemplate) {
    return "Contract Signed requires an active solar contract template. Configure one in Documents first.";
  }
  if (!completedContract) {
    return "Contract Signed requires a completed contract package on this deal.";
  }
  return null;
}
