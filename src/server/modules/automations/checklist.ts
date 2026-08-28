import { prisma } from "@/server/db/client";

/**
 * Did THIS upload just complete the checklist?
 *
 * Returns the checklist's kind if so, null otherwise.
 *
 * "Just" is load-bearing. A crew re-shooting one slot on a finished checklist
 * must not recompile the report and move the job a second time. So the answer
 * is yes only when every required slot is now filled AND the slot this photo
 * landed in held nothing before it — i.e. this upload is the one that closed
 * the last gap.
 *
 * The `once` flag on a rule is a backstop for this, not a substitute: a rule
 * may deliberately be set to repeat, and it should still repeat only when the
 * checklist genuinely completes again.
 */
export async function checklistJustCompleted(
  companyId: string,
  leadId: string,
  photoTemplateItemId: string
): Promise<"site" | "install" | null> {
  const item = await prisma.photoTemplateItem.findFirst({
    where: { id: photoTemplateItemId, template: { companyId } },
    select: { id: true, required: true, template: { select: { id: true, kind: true } } },
  });
  if (!item) return null;

  // A photo into an optional slot can never be the one that completes it.
  if (!item.required) return null;

  const required = await prisma.photoTemplateItem.findMany({
    where: { templateId: item.template.id, required: true },
    select: { id: true },
  });
  if (required.length === 0) return null;

  const shots = await prisma.fileAsset.groupBy({
    by: ["photoTemplateItemId"],
    where: {
      companyId,
      leadId,
      kind: "photo",
      photoTemplateItemId: { in: required.map((r) => r.id) },
    },
    _count: { _all: true },
  });

  const counts = new Map(shots.map((s) => [s.photoTemplateItemId, s._count._all]));
  const allFilled = required.every((r) => (counts.get(r.id) ?? 0) > 0);
  if (!allFilled) return null;

  // This slot holds exactly one photo? Then this upload is the one that closed
  // it. More than one, and the slot was already filled before this shot.
  if ((counts.get(item.id) ?? 0) !== 1) return null;

  return item.template.kind as "site" | "install";
}
