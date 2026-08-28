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
  const stage = (needle: string) =>
    pipeline?.stages.find((s) => s.name.toLowerCase().includes(needle))?.id ?? null;

  const checklists = await prisma.photoTemplate.findMany({
    where: { companyId },
    select: { kind: true },
  });
  const hasInstallChecklist = checklists.some((c) => c.kind === "install");

  const planned: PlannedAutomation[] = [];

  const installed = stage("install");
  const inspection = stage("inspection");

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
