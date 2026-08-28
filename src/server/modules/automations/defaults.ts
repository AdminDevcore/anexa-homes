import { prisma } from "@/server/db/client";

/**
 * A starting set, so the page is not an empty box.
 *
 * Every rule is resolved against what this workspace ACTUALLY has — one naming
 * a stage, template or checklist that does not exist here is dropped rather
 * than created broken, because a rule that can never fire is worse than no rule
 * at all: it looks like coverage. Same approach as the notification starters.
 */
export type PlannedAutomation = {
  name: string;
  trigger: "stage_entered" | "photo_checklist_completed";
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>[];
};

/**
 * No vertical parameter: every read below goes through the scoped client, so
 * the active workspace already decides which pipeline, checklists and templates
 * are visible — and the rules created from this plan are stamped by the same
 * extension.
 */
export async function planStarterAutomations(companyId: string): Promise<PlannedAutomation[]> {
  const pipeline = await prisma.pipeline.findFirst({
    where: { companyId },
    orderBy: { isDefault: "desc" },
    include: { stages: { orderBy: { position: "asc" } } },
  });
  /**
   * Match a stage by EXACT name, trying each candidate in turn.
   *
   * Deliberately not a substring match. Solar's pipeline carries "Install
   * Scheduled" before "Installed", so `includes("install")` picks the stage
   * where the crew has not turned up yet — a starter rule that generates the
   * Certificate of Acceptance weeks early. A starter rule wired to the wrong
   * milestone is worse than no starter rule, and an unmatched name simply
   * drops the rule below.
   */
  const stage = (...candidates: string[]) => {
    const stages = pipeline?.stages ?? [];
    for (const want of candidates) {
      const hit = stages.find((s) => s.name.toLowerCase() === want.toLowerCase());
      if (hit) return hit.id;
    }
    return null;
  };

  const checklists = await prisma.photoTemplate.findMany({
    where: { companyId },
    select: { kind: true },
  });
  const hasInstallChecklist = checklists.some((c) => c.kind === "install");

  const planned: PlannedAutomation[] = [];

  const installed = stage("Installed", "Install Complete", "Installation Complete");
  // Roofing seeds "QC Inspection"; solar's own stage is spelled
  // "Building / Electrical Inspection". Both are named outright so each
  // workspace actually gets the starter rule rather than silently skipping it.
  const inspection = stage(
    "QC Inspection",
    "Building / Electrical Inspection",
    "Inspection",
    "Final Inspection"
  );

  // The motivating example, and the one worth shipping switched on: the crew
  // finishes the photos, the report writes itself, the job moves.
  if (hasInstallChecklist && installed && inspection) {
    planned.push({
      name: "Install photos in → compile and move to Inspection",
      trigger: "photo_checklist_completed",
      conditions: { kind: "install" },
      actions: [
        { type: "compile_photos", kind: "install" },
        { type: "move_stage", stageId: inspection },
      ],
    });
  }

  const acceptance = await prisma.documentTemplate.findFirst({
    where: { companyId, active: true, name: { contains: "cceptance" } },
    select: { id: true },
  });
  if (installed && acceptance) {
    planned.push({
      name: "Installed → generate the Certificate of Acceptance",
      trigger: "stage_entered",
      conditions: { stageId: installed },
      actions: [{ type: "generate_document", templateId: acceptance.id }],
    });
  }

  return planned;
}
